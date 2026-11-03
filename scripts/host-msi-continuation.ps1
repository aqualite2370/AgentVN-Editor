param(
    [ValidateSet('StageLegacy','InstallOld','InstallNew','InstallClean','Repair','Uninstall','UninstallClean','Elevated')][string]$Action='StageLegacy',
    [ValidateSet('InstallOld','InstallNew','InstallClean','Repair','Uninstall','UninstallClean')][string]$InstallerAction='InstallNew',
    [ValidateSet('en-US','zh-CN')][string]$Language='en-US'
)
$ErrorActionPreference='Stop'
$reportRoot='D:\AgentVN\output\host-msi-continuation-20261018-02'
$workRoot='F:\AgentVN-QA-HostMSI-20261018-02'
$installRoot='D:\agentvntest\AgentVN Editor'
$backupRoot='F:\AgentVN-QA-HostMSI-AuthorizedBackup-20261018-02'
$utf8=New-Object Text.UTF8Encoding($false)
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Save($file,$value){[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 15),$utf8)}
function Idle {
    $active=@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')
    })
    if($active.Count){throw 'AgentVN processes active; no MSI/profile mutation permitted'}
}
function Registrations {
    @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|
        Where-Object {$_.DisplayName -match 'AgentVN'}|
        Select-Object DisplayName,DisplayVersion,InstallLocation,WindowsInstaller,PSChildName,PSPath)
}
Idle
$backup=Get-Content -LiteralPath (Join-Path $backupRoot 'backup.json') -Raw -Encoding UTF8|ConvertFrom-Json
$prep=Get-Content -LiteralPath (Join-Path $reportRoot 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($backup.status -ne 'PASS' -or $backup.source -ne $installRoot -or $backup.fileCount -ne 9073){throw 'Full authorized backup not verified'}
if($prep.status -ne 'PASS' -or $prep.verifiedOriginalFiles -ne 55){throw 'Four profile protection required'}
foreach($profile in $prep.profiles){if(!(Test-Path -LiteralPath $profile.held)){throw 'Original profile protection no longer held'}}
if($Action -eq 'StageLegacy'){
    $receipt=Join-Path $reportRoot 'legacy-data-staged.json'
    if(Test-Path -LiteralPath $receipt){throw 'Legacy data stage already recorded'}
    $source=Join-Path $installRoot 'data'
    $target=Join-Path $workRoot 'original-legacy-data'
    if([IO.Path]::GetFullPath($source) -ne 'D:\agentvntest\AgentVN Editor\data' -or
        [IO.Path]::GetFullPath($target) -ne 'F:\AgentVN-QA-HostMSI-20261018-02\original-legacy-data'){throw 'Exact legacy boundaries mismatch'}
    if(!(Test-Path -LiteralPath $source) -or (Test-Path -LiteralPath $target)){throw 'Legacy data collision'}
    $expected=@($backup.files|Where-Object {$_.relative.StartsWith('data\')})
    if(!$expected.Count){throw 'Legacy data not in full backup'}
    foreach($file in $expected){
        if((Sha (Join-Path $installRoot $file.relative)) -ne $file.sha256 -or
            (Sha (Join-Path (Join-Path $backupRoot 'installation') $file.relative)) -ne $file.sha256){throw 'Legacy source/backup mismatch'}
    }
    # Explicit authorized test directory only. Keep historical data out of the
    # isolated test backend; retain both this original and full verified backup.
    Move-Item -LiteralPath $source -Destination $target
    foreach($file in $expected){
        if((Sha (Join-Path $target $file.relative.Substring(5))) -ne $file.sha256){throw 'Staged legacy file mismatch'}
    }
    Save $receipt @{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');source=$source;target=$target;
        checks=$expected;reason='Do not auto-import historical installation DB into isolated MSI QA profile';deletedFiles=0}
    Write-Output "PASS: original legacy data retained on F and verified ($($expected.Count) files), no deletion"
    exit
}
if(!(Test-Path -LiteralPath (Join-Path $reportRoot 'legacy-data-staged.json'))){throw 'Historical legacy data not isolated'}
$phase=if($Action -eq 'Elevated'){$InstallerAction}else{$Action}
$phaseRoot=Join-Path $reportRoot $Language
$null=New-Item -ItemType Directory -Path $phaseRoot -Force
$destination=Join-Path $phaseRoot ($phase+'.json')
if(Test-Path -LiteralPath $destination){throw 'Do not overwrite an MSI attempt'}
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isElevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($Action -ne 'Elevated'){
    if($isElevated){throw 'Must launch admin helper from non-admin parent'}
    $wrapper=Join-Path $phaseRoot ($phase+'-elevation.json')
    if(Test-Path -LiteralPath $wrapper){throw 'Duplicate elevation attempt'}
    $request=@{status='WAITING';parentElevated=$false;at=(Get-Date).ToUniversalTime().ToString('o');error=$null}
    Save $wrapper $request
    try{
        $helper=Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
            '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),
            '-Action','Elevated','-InstallerAction',$phase,'-Language',$Language)
        $request.helperPid=$helper.Id;Save $wrapper $request
        $helper.WaitForExit()
        $request.helperExitCode=$helper.ExitCode
        if(!(Test-Path -LiteralPath $destination)){throw 'No elevated installer result'}
        $child=Get-Content -LiteralPath $destination -Raw -Encoding UTF8|ConvertFrom-Json
        if($child.status -ne 'PASS'){throw 'Installer evidence FAILED; preserve original result'}
        $request.status='PASS'
    }catch{$request.status='BLOCKED';$request.error=$_.Exception.Message;throw}
    finally{Save $wrapper $request}
    Write-Output ($child|ConvertTo-Json -Depth 6)
    exit
}
if(!$isElevated){throw 'Administrator token required'}
$version=if($phase -eq 'InstallOld'){'1.9.8'}else{'1.9.9'}
$trusted=Get-Content -LiteralPath 'D:\AgentVN\output\host-msi-20261018-03\preflight.json' -Raw -Encoding UTF8|ConvertFrom-Json
$packages=@($trusted.packages|Where-Object {$_.language -eq $Language -and $_.expectedVersion -eq $version})
if($packages.Count -ne 1){throw 'Ambiguous frozen package'}
$package=$packages[0]
if((Sha $package.path) -ne $package.sha256){throw 'Frozen installer source mismatch'}
$before=Registrations
if($phase -eq 'InstallClean'){
    if(@($before|Where-Object {$_.WindowsInstaller -eq 1}).Count){throw 'Fresh /i requires no registered MSI product'}
    $rememberedKey=Get-Item -LiteralPath 'HKCU:\Software\agentvn\AgentVN Editor' -ErrorAction SilentlyContinue
    if($rememberedKey){
        foreach($name in @('','InstallDir')){
            $remembered=$rememberedKey.GetValue($name)
            if($remembered -and [IO.Path]::GetFullPath($remembered).TrimEnd('\') -ne $installRoot){
                throw 'AppSearch remembers an installation outside the approved D boundary; refuse installer before external writes'
            }
        }
    }
}
$unrelated=@($before|Where-Object {$_.WindowsInstaller -eq 1 -and $_.InstallLocation.TrimEnd('\') -ne $installRoot})
if($unrelated.Count){throw 'MSI registered outside approved directory'}
$log=Join-Path $phaseRoot ($phase+'.log')
$result=[ordered]@{status='RUNNING';startedAt=(Get-Date).ToUniversalTime().ToString('o');phase=$phase;language=$Language;
    isElevated=$true;helperPid=$PID;package=$package.path;sha256=$package.sha256;version=$version;
    installRoot=$installRoot;registrationsBefore=$before;error=$null}
Save $destination $result
try{
    $operation=switch($phase){'Repair'{'/fa'} 'Uninstall'{'/x'} 'UninstallClean'{'/x'} default{'/i'}}
    $arguments=@($operation,('"'+$package.path+'"'),'/qn','/norestart',('INSTALLDIR="'+$installRoot+'"'),'/L*V',('"'+$log+'"'))
    $result.arguments=$arguments
    $process=Start-Process -FilePath msiexec.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
    $result.installerPid=$process.Id;Save $destination $result
    $process.WaitForExit();$result.exitCode=$process.ExitCode
    $result.registrationsAfter=Registrations
    if($process.ExitCode -notin @(0,3010)){throw "Windows Installer exit $($process.ExitCode)"}
    $msi=@($result.registrationsAfter|Where-Object {$_.WindowsInstaller -eq 1})
    if($phase -in @('Uninstall','UninstallClean')){
        if($msi.Count){throw 'MSI registration remains after uninstall'}
        $result.executableRemains=Test-Path -LiteralPath (Join-Path $installRoot 'agentvn-editor.exe')
        if($result.executableRemains){throw 'Installed Editor remains after MSI uninstall'}
    }else{
        if($msi.Count -ne 1 -or $msi[0].InstallLocation.TrimEnd('\') -ne $installRoot -or $msi[0].DisplayVersion -ne $version){throw 'Actual MSI registration identity/path mismatch'}
        $exe=Join-Path $installRoot 'agentvn-editor.exe'
        $result.actualVersion=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
        $result.executableSha256=Sha $exe
        if($result.actualVersion -ne $version){throw 'Installed executable version mismatch'}
        if($version -eq '1.9.9'){
            if($result.executableSha256 -ne '5c38db3d8569b8f4fcd2553fbbe5e74179f948cfd720e60b315f6968d4752ee9'){throw 'MSI stamped candidate identity mismatch'}
            $result.versionResource=Get-Content -LiteralPath (Join-Path $installRoot 'build-versions.json') -Raw -Encoding UTF8|ConvertFrom-Json
            if($result.versionResource.editorVersion -ne $version){throw 'Installed version resource mismatch'}
        }
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{$result.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save $destination $result}
Write-Output ($result|ConvertTo-Json -Depth 6)
