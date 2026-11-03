param(
  [Parameter(Mandatory=$true)][string]$ResourceReport,
  [Parameter(Mandatory=$true)][string]$RunRoot
)
$ErrorActionPreference='Stop'
$Audit=Get-Content -Raw -Encoding UTF8 -LiteralPath $ResourceReport|ConvertFrom-Json
if($Audit.status -ne 'PASS'){throw 'Completed resource audit required'}
$RunRoot=[IO.Path]::GetFullPath($RunRoot)
$Allowed=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\output'))+[IO.Path]::DirectorySeparatorChar
if(-not $RunRoot.StartsWith($Allowed,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $RunRoot)){throw 'Fresh owned output session required'}
$Candidate=@($Audit.deployments|Where-Object {$_.kind -eq 'NSIS actual payload'})
if($Candidate.Count -ne 1){throw 'Exactly one verified NSIS payload required'}
$Installer=@($Audit.installers|Where-Object {$_.path.EndsWith('-setup.exe')})
if($Installer.Count -ne 1){throw 'Exactly one NSIS installer required'}
if((Get-FileHash -LiteralPath $Installer[0].path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Installer[0].sha256){throw 'Installer changed since audit'}
$Running=@(Get-CimInstance Win32_Process -Filter "Name = 'agentvn-editor.exe' OR Name = 'creator-backend.exe' OR Name = 'AgentVN Editor.exe'")
if($Running.Count){throw 'Installer preinstall hook kills these names; refuse while unrelated Editor/backend runs'}
$Generated=Join-Path $PSScriptRoot '..\editor\src-tauri\target\release\nsis\x64\installer.nsi'
if(-not (Select-String -LiteralPath $Generated -SimpleMatch '!define INSTALLMODE "currentUser"' -Quiet)){throw 'This helper only isolates current-user installers'}
New-Item -ItemType Directory -Path $RunRoot | Out-Null
$InstallRoot=Join-Path $RunRoot 'installed-nsis'
$Keys=@('Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor','Software\agentvn\AgentVN Editor')
$Backup=@();$Result=[ordered]@{status='RUNNING';startedAt=[DateTime]::UtcNow.ToString('o');installer=$Installer[0];installRoot=$InstallRoot;registryRestored=$false}
try{
  for($Index=0;$Index -lt $Keys.Count;$Index++){
    $Key=$Keys[$Index];$Existing=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($Key);$Exists=($null -ne $Existing)
    $Values=@{}
    if($Existing){foreach($Name in $Existing.GetValueNames()){$Values[$Name]=@{value=$Existing.GetValue($Name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);kind=[int]$Existing.GetValueKind($Name)}};$Existing.Close()}
    $Export=Join-Path $RunRoot "registry-before-$Index.reg"
    $Backup+=@{key=$Key;exists=$Exists;values=$Values;export=$Export}
    if($Exists){& reg.exe export "HKCU\$Key" $Export /y|Out-Null;if($LASTEXITCODE -ne 0){throw 'Registry backup failed'}}
  }
  # Prevent the installer from following a previous installation/uninstaller.
  foreach($Item in $Backup){[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($Item.key,$false)}
  $Process=Start-Process -FilePath $Installer[0].path -ArgumentList @('/S','/NS',"/D=$InstallRoot") -WindowStyle Hidden -PassThru
  $Result.installerPid=$Process.Id
  if(-not $Process.WaitForExit(120000)){throw 'Isolated NSIS install timed out'}
  $Result.exitCode=$Process.ExitCode;if($Process.ExitCode -ne 0){throw "Installer failed $($Process.ExitCode)"}
  $Exe=Join-Path $InstallRoot 'agentvn-editor.exe';$Hash=(Get-FileHash -LiteralPath $Exe -Algorithm SHA256).Hash.ToLowerInvariant()
  if($Hash -ne $Candidate[0].executable.sha256){throw 'Actual installed editor does not match verified payload'}
  $Result.executable=@{path=$Exe;sha256=$Hash};$Result.status='PASS'
}catch{$Result.status='FAILED';$Result.error=$_.Exception.Message;throw}
finally{
  foreach($Item in $Backup){
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($Item.key,$false)
    if($Item.exists){& reg.exe import $Item.export|Out-Null;if($LASTEXITCODE -ne 0){throw 'Registry restore failed'}}
    $Check=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($Item.key)
    try{
      if($Item.exists){
        if(-not $Check -or $Check.ValueCount -ne $Item.values.Count){throw 'Restored registry values differ'}
        foreach($Name in $Item.values.Keys){if($Check.GetValue($Name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) -ne $Item.values[$Name].value -or [int]$Check.GetValueKind($Name) -ne $Item.values[$Name].kind){throw 'Restored registry value differs'}}
      }elseif($Check){throw 'Unexpected new registration remains'}
    }finally{if($Check){$Check.Close()}}
  }
  $Result.registryRestored=$true;$Result.finishedAt=[DateTime]::UtcNow.ToString('o')
  [IO.File]::WriteAllText((Join-Path $RunRoot 'actual-installation.json'),($Result|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
}
if($Result.status -ne 'PASS'){throw 'Installation incomplete'}
$Actual=@{kind='NSIS actual isolated installation';installedRoot=$InstallRoot;executable=$Result.executable}
$Audit.deployments=@($Audit.deployments)+$Actual
[IO.File]::WriteAllText((Join-Path $RunRoot 'installer-resource-report.json'),($Audit|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
$Result|ConvertTo-Json -Depth 10
