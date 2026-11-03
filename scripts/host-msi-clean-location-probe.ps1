$ErrorActionPreference='Stop'
$root='D:\AgentVN\output\host-msi-continuation-20261018-02'
$destination=Join-Path $root 'clean-install-location-probe.json'
if(Test-Path -LiteralPath $destination){throw 'Fresh read-only location receipt required'}
$installer=New-Object -ComObject WindowsInstaller.Installer
$trusted=Get-Content -LiteralPath 'D:\AgentVN\output\host-msi-20261018-03\preflight.json' -Raw -Encoding UTF8|ConvertFrom-Json
function Query($db,$table,$fields){
    $names=@($fields|ForEach-Object {([string][char]96)+$_+([string][char]96)})
    $view=$db.OpenView(('SELECT '+($names -join ',')+' FROM '+[char]96+$table+[char]96))
    $view.Execute();$rows=@()
    while($record=$view.Fetch()){
        $row=[ordered]@{}
        for($i=0;$i -lt $fields.Count;$i++){$row[$fields[$i]]=$record.StringData($i+1)}
        $rows+=$row
    }
    $view.Close();return $rows
}
$result=@{status='BLOCKED';evidenceStatus='RUNNING';scope='READ_ONLY_PREDICTED_APPSEARCH_TARGET_NOT_INSTALLATION_ATTEMPT';
    at=(Get-Date).ToUniversalTime().ToString('o');approvedDirectory='D:\agentvntest\AgentVN Editor';
    packages=@();registrations=@();remembered=@();error=$null;
    cleanCandidateInstallation='NOT_RUN';registryEdited=$false;installerInvoked=$false;
    reason='Current AppSearch memory points at the separate frozen F NSIS installation, outside this D-only authorization';
    limitation='This receipt predicts a search target; does not claim a fresh MSI was actually run or redirected';
    safeNextChoices='New specific backup/replace scope for F test installation, or an interactive verified directory selection after AppSearch; do not delete registry or bypass MSI actions'}
try{
    foreach($package in $trusted.packages|Where-Object {$_.expectedVersion -eq '1.9.9'}){
        $hash=(Get-FileHash -LiteralPath $package.path -Algorithm SHA256).Hash.ToLowerInvariant()
        if($hash -ne $package.sha256){throw 'Frozen package mismatch'}
        $db=$installer.OpenDatabase($package.path,0)
        $search=@(Query $db 'AppSearch' @('Property','Signature_')|Where-Object {$_.Property -eq 'INSTALLDIR'})
        $locator=@(Query $db 'RegLocator' @('Signature_','Root','Key','Name','Type')|
            Where-Object {$_.Signature_ -in @($search.Signature_)})
        if($search.Count -ne 2 -or $locator.Count -ne 2){throw 'Unexpected installation location search contract'}
        $result.packages+=@{path=$package.path;sha256=$hash;language=$package.language;appSearch=$search;regLocator=$locator}
    }
    $key=Get-Item -LiteralPath 'HKCU:\Software\agentvn\AgentVN Editor'
    foreach($name in @('','InstallDir')){$result.remembered+=@{hive='HKCU';key='Software\agentvn\AgentVN Editor';name=$name;value=$key.GetValue($name)}}
    if($result.remembered[0].value -ne 'F:\AgentVN-QA-HostUpgrade-20261018-02\installed-editor'){throw 'Remembered target changed; re-evaluate boundary'}
    $result.targetExe=@{path='F:\AgentVN-QA-HostUpgrade-20261018-02\installed-editor\agentvn-editor.exe';
        sha256=(Get-FileHash -LiteralPath 'F:\AgentVN-QA-HostUpgrade-20261018-02\installed-editor\agentvn-editor.exe' -Algorithm SHA256).Hash.ToLowerInvariant()}
    if($result.targetExe.sha256 -ne 'f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c'){throw 'Frozen NSIS installation changed'}
    $result.registrations=@(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|
        Where-Object {$_.DisplayName -match 'AgentVN'}|Select-Object DisplayName,DisplayVersion,InstallLocation,WindowsInstaller)
    if(@($result.registrations|Where-Object {$_.WindowsInstaller -eq 1}).Count){throw 'MSI test uninstall incomplete'}
    $result.evidenceStatus='PASS'
}catch{$result.evidenceStatus='FAILED';$result.error=$_.Exception.Message;throw}
finally{[IO.File]::WriteAllText($destination,($result|ConvertTo-Json -Depth 12),(New-Object Text.UTF8Encoding($false)))}
Write-Output 'BLOCKED: fresh MSI target memory outside approved D directory; read-only evidence PASS, no fresh installer invoked'
