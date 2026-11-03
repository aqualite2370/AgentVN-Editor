param(
  [Parameter(Mandatory=$true)][string]$ResourceReport,
  [Parameter(Mandatory=$true)][string]$RunRoot,
  [ValidateSet('1.9.36','1.9.37','1.9.38','1.9.39','1.9.40','1.9.41')][string]$ExpectedVersion='1.9.36',
  [string]$AllowedRunRoot='F:\AgentVN\QA\Player-Aspect-20261102-01'
)
$ErrorActionPreference='Stop'
$run=[IO.Path]::GetFullPath($RunRoot)
$allowed=[IO.Path]::GetFullPath($AllowedRunRoot)
if($allowed -notin @('F:\AgentVN\QA\Player-Aspect-20261102-01',
    'F:\AgentVN\QA\Knowledge-Draft-Candidate-1937-20261102-01',
    'F:\AgentVN\QA\Credential-Boundaries-20261102-01',
    'F:\AgentVN\QA\Novel-Branch-Completion-20261103-01',
    'F:\AgentVN\QA\Original-Component-Replay-20261103-01',
    'F:\AgentVN\QA\Dialog-Pointer-Sequence-20261103-01')){
  throw 'Unexpected installation evidence root'
}
if([IO.Path]::GetDirectoryName($run) -cne $allowed -or
  [IO.Path]::GetFileName($run) -notmatch '^installation-\d{2}$' -or (Test-Path -LiteralPath $run)){
  throw 'Fresh exact player-aspect installation directory required'
}
$audit=Get-Content -Raw -Encoding UTF8 -LiteralPath $ResourceReport|ConvertFrom-Json
if($audit.status -cne 'PASS' -or $audit.version -cne $ExpectedVersion -or $audit.installers.Count -ne 1){
  throw 'Passing exact candidate payload report required'
}
$payload=@($audit.deployments|Where-Object kind -CEQ 'NSIS actual payload')
if($payload.Count -ne 1){throw 'One actual NSIS payload required'}
$package=$audit.installers[0]
function Sha($file){
  $algorithm=[Security.Cryptography.SHA256]::Create()
  $stream=[IO.File]::OpenRead($file)
  try{([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
  finally{$stream.Dispose();$algorithm.Dispose()}
}
if((Sha $package.path) -cne $package.sha256){throw 'Installer bytes changed'}
function Idle{
  if(@(Get-CimInstance Win32_Process|Where-Object {
    $_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\.exe$'
  }).Count){throw 'Refuse install while user Editor, Player or backend is running'}
}
function Snapshot($relative){
  $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($relative)
  if(!$key){throw "Expected original registration missing: $relative"}
  try{
    if($key.SubKeyCount){throw 'Unexpected nested registration'}
    @{path=$relative;values=@(foreach($name in $key.GetValueNames()){
      @{name=$name;kind=$key.GetValueKind($name).ToString();
        value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}
    })}
  }finally{$key.Dispose()}
}
function Restore($row){
  $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($row.path,$true)
  if(!$key){throw 'Original registration unexpectedly removed'}
  try{
    foreach($name in $key.GetValueNames()){
      if($name -notin @($row.values|ForEach-Object {$_.name})){$key.DeleteValue($name)}
    }
    foreach($v in $row.values){$key.SetValue([string]$v.name,$v.value,[Microsoft.Win32.RegistryValueKind]::$($v.kind))}
  }finally{$key.Dispose()}
  $actual=Snapshot $row.path
  if($actual.values.Count -ne $row.values.Count){throw 'Restored registry count mismatch'}
  foreach($v in $row.values){
    $value=@($actual.values|Where-Object name -CEQ $v.name)
    if($value.Count -ne 1 -or $value[0].kind -cne $v.kind -or
      ($value[0].value|ConvertTo-Json -Compress) -cne ($v.value|ConvertTo-Json -Compress)){
      throw 'Restored original registry differs'
    }
  }
}
Idle
New-Item -ItemType Directory -Path $run|Out-Null
$install=Join-Path $run 'installed-editor'
$receipt=Join-Path $run 'installation.json'
$state=[ordered]@{status='RUNNING';startedAt=[DateTime]::UtcNow.ToString('o');
  version=$ExpectedVersion;scope='ACTUAL_NSIS_NEW_DIRECTORY_NOT_UPGRADE_OR_CLEAN_MACHINE';
  installer=$package;installRoot=$install;arguments=@('/S',('/D='+$install));registry=@();shortcuts=@();
  resources=@();metadataRestoration='PENDING';protectedFiles=@();modelRequests=0}
function Save{[IO.File]::WriteAllText($receipt,($state|ConvertTo-Json -Depth 25),[Text.UTF8Encoding]::new($false))}
foreach($key in @('Software\agentvn\AgentVN Editor','Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor')){
  $state.registry+=Snapshot $key
}
$shell=New-Object -ComObject WScript.Shell
$links=@('C:\Users\1\Desktop\AgentVN Editor.lnk',
  'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\AgentVN Editor.lnk',
  'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\AgentVN Editor\AgentVN Editor.lnk')
foreach($file in $links){
  $row=@{path=$file;existed=(Test-Path -LiteralPath $file)}
  if($row.existed){
    $row.backup=Join-Path $run ('original-shortcut-'+$state.shortcuts.Count+'.lnk')
    $row.sha256=Sha $file;Copy-Item -LiteralPath $file -Destination $row.backup
    if((Sha $row.backup) -cne $row.sha256){throw 'Shortcut backup differs'}
  }
  $state.shortcuts+=$row
}
foreach($base in @($env:APPDATA,[Environment]::GetFolderPath('ApplicationData'))|Select-Object -Unique){
  foreach($relative in @('com.agentvn.editor\backend\vn_engine.db','com.agentvn.editor\backend\vn_engine.db-wal','com.agentvn.editor\backend\vn_engine.db-shm')){
    $file=Join-Path $base $relative
    if(Test-Path -LiteralPath $file -PathType Leaf){$state.protectedFiles+=@{path=$file;sha256=(Sha $file)}}
  }
}
Save
try{
  Idle
  $process=Start-Process -FilePath $package.path -ArgumentList $state.arguments -WindowStyle Hidden -PassThru
  $state.installerPid=$process.Id;Save
  if(!$process.WaitForExit(180000)){throw 'Installer still live: preserve journal, do not restart'}
  $state.exitCode=$process.ExitCode
  if($state.exitCode -ne 0){throw "Installer exit $($state.exitCode)"}
  $exe=Join-Path $install 'agentvn-editor.exe'
  $state.executable=@{path=$exe;sha256=(Sha $exe);version=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion}
  if($state.executable.sha256 -cne $payload[0].executable.sha256 -or $state.executable.version -cne $ExpectedVersion){
    throw 'Actual installed executable differs from payload/version'
  }
  $resourceNames=@('creator-backend.exe','agentvn-player.exe','build-versions.json',
    'shared\cartridge\gameViewport.ts','GameCli_framework\src\store\settingsStore.ts',
    'GameCli_framework\src\store\runtimeStore.ts','GameCli_framework\src\components\shell\SettingsScreen.tsx')
  if($ExpectedVersion -in @('1.9.40','1.9.41')){
    $resourceNames+=@('shared\cartridge\renpyTitleControls.ts','GameCli_framework\src\components\shell\RenpyTitleView.tsx')
  }
  if($ExpectedVersion -ceq '1.9.41'){
    $resourceNames+=@('GameCli_framework\src\components\player\DialogBox.tsx',
      'GameCli_framework\src\components\player\StoryPlayer.tsx')
  }
  foreach($relative in $resourceNames){
    $file=Join-Path $install $relative
    if((Sha $file) -cne (Sha (Join-Path $payload[0].installedRoot $relative))){throw "Installed resource differs: $relative"}
    $state.resources+=@{path=$file;sha256=(Sha $file)}
  }
  $state.actualRegistration=Snapshot 'Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor'
  $state.status='PASS'
}catch{$state.status='FAILED';$state.error=$_.Exception.Message}
finally{
  try{
    if($process -and !$process.HasExited){throw 'Cannot restore metadata while installer is live'}
    foreach($row in $state.registry){Restore $row}
    foreach($row in $state.shortcuts){
      if($row.existed){
        Copy-Item -LiteralPath $row.backup -Destination $row.path -Force
        if((Sha $row.path) -cne $row.sha256){throw 'Shortcut restore differs'}
      }elseif(Test-Path -LiteralPath $row.path){
        if($shell.CreateShortcut($row.path).TargetPath -cne (Join-Path $install 'agentvn-editor.exe')){throw 'Unknown shortcut: refuse removal'}
        Remove-Item -LiteralPath $row.path -Force
      }
    }
    foreach($f in $state.protectedFiles){if((Sha $f.path) -cne $f.sha256){throw 'Protected default database changed'}}
    $state.metadataRestoration='PASS'
  }catch{$state.status='FAILED';$state.cleanupError=$_.Exception.Message}
  $state.finishedAt=[DateTime]::UtcNow.ToString('o');Save
}
if($state.status -cne 'PASS'){throw ($state.error+' '+$state.cleanupError)}
'PASS: actual NSIS installation; original registry, shortcuts and databases preserved'
