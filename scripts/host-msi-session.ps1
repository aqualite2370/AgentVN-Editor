param(
    [ValidateSet('Prepare','InstallOld','InstallNew','Repair','Uninstall','RunElevated','Restore')][string]$Action='Prepare',
    [ValidateSet('en-US','zh-CN')][string]$Language='en-US',
    [ValidateSet('InstallOld','InstallNew','Repair','Uninstall')][string]$InstallerAction='InstallOld',
    [switch]$PreserveUnexpectedInstallation
)
$ErrorActionPreference='Stop'
$runRoot='F:\AgentVN-QA-HostMSI-20261018-01'
$reportRoot='D:\AgentVN\output\host-msi-session-20261018-01'
$utf8=New-Object Text.UTF8Encoding($false)
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Save($file,$value){[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 14),$utf8)}
function Assert-Idle {
    $active=@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.editor')
    })
    if($active.Count){throw 'AgentVN processes are active; refuse system/profile change'}
}
function Registrations {
    @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|
        Where-Object {$_.DisplayName -match 'AgentVN'}|
        Select-Object DisplayName,DisplayVersion,InstallLocation,WindowsInstaller,PSChildName,PSPath)
}
function Assert-ProfileBoundary($profile){
    $expected='C:\Users\1\AppData\'+$profile.kind
    if([IO.Path]::GetDirectoryName($profile.original) -ne $expected -or
        [IO.Path]::GetDirectoryName($profile.held) -ne $expected -or
        [IO.Path]::GetFileName($profile.original) -ne 'com.agentvn.editor' -or
        [IO.Path]::GetFileName($profile.held) -ne 'com.agentvn.editor.qa-hold-msi-20261018-01'){
        throw 'Unexpected exact profile boundary'
    }
}
if($Action -eq 'Prepare'){
    Assert-Idle
    if((Test-Path -LiteralPath $runRoot) -or (Test-Path -LiteralPath $reportRoot)){throw 'Fresh MSI session required'}
    $prior=Get-Content -LiteralPath 'D:\AgentVN\output\host-upgrade-20261018-02\preparation.json' -Raw -Encoding UTF8|ConvertFrom-Json
    if(@(Registrations|Where-Object {$_.WindowsInstaller -eq 1}).Count){throw 'Pre-existing MSI product requires separate decision'}
    $profiles=@()
    foreach($old in $prior.profiles){
        $row=@{kind=$old.kind;original=$old.original;held=(Join-Path ('C:\Users\1\AppData\'+$old.kind) 'com.agentvn.editor.qa-hold-msi-20261018-01');
            backupRoot=$old.backupRoot;verified=@();moved=$false}
        Assert-ProfileBoundary $row
        if((Test-Path -LiteralPath $row.held) -or !(Test-Path -LiteralPath $row.original)){throw 'Profile collision/missing original'}
        foreach($backup in (Get-ChildItem -LiteralPath $old.backupRoot -Recurse -File -Force)){
            $relative=$backup.FullName.Substring($old.backupRoot.Length+1)
            $original=Join-Path $row.original $relative
            if((Sha $backup.FullName) -ne (Sha $original)){throw 'User profile changed since verified backup; do not reuse it'}
            $row.verified+=@{relative=$relative;sha256=(Sha $original)}
        }
        $profiles+=$row
    }
    $null=New-Item -ItemType Directory -Path $runRoot,$reportRoot
    $state=[ordered]@{status='PREPARING';at=(Get-Date).ToUniversalTime().ToString('o');profiles=$profiles;registrations=(Registrations);
        runRoot=$runRoot;reportRoot=$reportRoot;shortcuts=@();error=$null}
    Save (Join-Path $reportRoot 'preparation.json') $state
    try{
        $shell=New-Object -ComObject WScript.Shell
        foreach($shortcut in @(
            'C:\Users\1\Desktop\AgentVN Editor.lnk',
            'C:\Users\Public\Desktop\AgentVN Editor.lnk',
            'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\AgentVN Editor.lnk',
            'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\AgentVN Editor.lnk'
        )){
            if(Test-Path -LiteralPath $shortcut){
                $backup=Join-Path $runRoot ('shortcuts\'+$state.shortcuts.Count+'.lnk')
                $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($backup)) -Force
                Copy-Item -LiteralPath $shortcut -Destination $backup
                if((Sha $shortcut) -ne (Sha $backup)){throw 'Shortcut backup mismatch'}
                $state.shortcuts+=@{path=$shortcut;backup=$backup;sha256=(Sha $backup);target=$shell.CreateShortcut($shortcut).TargetPath}
            }
        }
        foreach($profile in $state.profiles){
            Assert-Idle
            [IO.Directory]::Move($profile.original,$profile.held)
            $profile.moved=$true
            Save (Join-Path $reportRoot 'preparation.json') $state
        }
        $state.status='PASS'
    }catch{
        $state.status='FAILED';$state.error=$_.Exception.Message
        foreach($profile in $state.profiles){
            if($profile.moved -and !(Test-Path -LiteralPath $profile.original) -and (Test-Path -LiteralPath $profile.held)){
                [IO.Directory]::Move($profile.held,$profile.original);$profile.moved=$false
            }
        }
        throw
    }finally{Save (Join-Path $reportRoot 'preparation.json') $state}
    Write-Output 'PASS: both default profiles protected, verified against original independent backup'
    exit
}
$preparation=Get-Content -LiteralPath (Join-Path $reportRoot 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($preparation.status -ne 'PASS'){throw 'MSI preparation not complete'}
Assert-Idle
if($Action -eq 'Restore'){
    $destination=Join-Path $reportRoot 'user-profile-restoration.json'
    if(Test-Path -LiteralPath $destination){throw 'Restoration already recorded'}
    $remainingMsi=@(Registrations|Where-Object {$_.WindowsInstaller -eq 1})
    if($remainingMsi.Count -and !$PreserveUnexpectedInstallation){throw 'MSI test product remains installed; finish owned uninstall first'}
    if($PreserveUnexpectedInstallation -and
        ($remainingMsi.Count -ne 1 -or $remainingMsi[0].PSChildName -ne '{6DAD4267-BCC7-4C95-BCC5-70AF9B6CC52E}' -or
        $remainingMsi[0].InstallLocation -ne 'D:\agentvntest\AgentVN Editor\')){
        throw 'Unexpected installation does not match recorded misdirection incident'
    }
    $result=[ordered]@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');profiles=@();error=$null;
        unexpectedInstallationPreserved=[bool]$PreserveUnexpectedInstallation;remainingMsi=$remainingMsi;
        installationCleanupStatus=if($PreserveUnexpectedInstallation){'BLOCKED_PENDING_USER_DECISION'}else{'PASS'}}
    foreach($profile in $preparation.profiles){
        Assert-ProfileBoundary $profile
        $testHeld=Join-Path ('C:\Users\1\AppData\'+$profile.kind) 'com.agentvn.editor.qa-tested-msi-20261018-01'
        if(!(Test-Path -LiteralPath $profile.held) -or (Test-Path -LiteralPath $testHeld)){throw 'Restoration collision'}
    }
    try{
        foreach($profile in $preparation.profiles){
            $testHeld=Join-Path ('C:\Users\1\AppData\'+$profile.kind) 'com.agentvn.editor.qa-tested-msi-20261018-01'
            if(Test-Path -LiteralPath $profile.original){[IO.Directory]::Move($profile.original,$testHeld)}
            [IO.Directory]::Move($profile.held,$profile.original)
            $checks=@()
            foreach($file in $profile.verified){
                $actual=Sha (Join-Path $profile.original $file.relative)
                $checks+=@{relative=$file.relative;sha256=$actual;match=($actual -eq $file.sha256)}
                if($actual -ne $file.sha256){throw 'Restored user hash mismatch'}
            }
            $result.profiles+=@{kind=$profile.kind;original=$profile.original;testHeld=$testHeld;checks=$checks}
        }
        $result.status='PASS'
    }catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
    finally{Save $destination $result}
    Write-Output 'PASS: original user profiles restored; any created MSI test profiles retained separately'
    exit
}
$phase=if($Action -eq 'RunElevated'){$InstallerAction}else{$Action}
$phaseRoot=Join-Path $reportRoot $Language
$null=New-Item -ItemType Directory -Path $phaseRoot -Force
$destination=Join-Path $phaseRoot ($phase+'.json')
if(Test-Path -LiteralPath $destination){throw 'Do not overwrite installer attempt'}
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isElevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($Action -ne 'RunElevated'){
    $wrapper=Join-Path $phaseRoot ($phase+'-elevation.json')
    if(Test-Path -LiteralPath $wrapper){throw 'Do not repeat installer/elevation attempt'}
    if($isElevated){throw 'Expected non-admin parent to request elevated helper'}
    $request=[ordered]@{status='WAITING_FOR_ELEVATED_HELPER';at=(Get-Date).ToUniversalTime().ToString('o');parentElevated=$false;error=$null}
    Save $wrapper $request
    try{
        $helper=Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
            '-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $PSCommandPath + '"'),
            '-Action','RunElevated','-Language',$Language,'-InstallerAction',$phase)
        $request.helperPid=$helper.Id;Save $wrapper $request
        $helper.WaitForExit()
        $request.helperExitCode=$helper.ExitCode
        if(!(Test-Path -LiteralPath $destination)){throw 'Elevated helper produced no installer evidence'}
        $child=Get-Content -LiteralPath $destination -Raw -Encoding UTF8|ConvertFrom-Json
        if($child.status -ne 'PASS'){throw 'Elevated installer did not pass; preserve child report'}
        $request.status='PASS'
    }catch{$request.status='BLOCKED';$request.error=$_.Exception.Message;throw}
    finally{Save $wrapper $request}
    Write-Output ($child|ConvertTo-Json -Depth 7)
    exit
}
if(!$isElevated){throw 'Elevated installer requires genuine admin token'}
$preflight=Get-Content -LiteralPath 'D:\AgentVN\output\host-msi-20261018-03\preflight.json' -Raw -Encoding UTF8|ConvertFrom-Json
$version=if($phase -eq 'InstallOld'){'1.9.8'}else{'1.9.9'}
$package=@($preflight.packages|Where-Object {$_.language -eq $Language -and $_.expectedVersion -eq $version})
if($package.Count -ne 1){throw 'Ambiguous trusted MSI package'}
$package=$package[0]
$expected=if($Language -eq 'en-US'){
    if($version -eq '1.9.8'){'91b33644e7ff4d841401bc63cff3865a064322419a2fe0fa85d49b5fbd6e622e'}else{'2ddc35faa701b2dc515f3911e2c438aa0240be9b0d610ad55b3e24b1bf5addb3'}
}else{
    if($version -eq '1.9.8'){'61eda8e0301ada96453463fbf09d32f4d250386c1c36fece97055713a7f91821'}else{'d0a82d650262365b6b306808f4530ccd3d39f994d172c8971d52158f26cb711b'}
}
if((Sha $package.path) -ne $expected){throw 'Trusted MSI hash mismatch'}
$installRoot=Join-Path $runRoot ($Language+'\installed-editor')
if([IO.Path]::GetFullPath($installRoot) -ne ('F:\AgentVN-QA-HostMSI-20261018-01\'+$Language+'\installed-editor')){throw 'Install boundary mismatch'}
$log=Join-Path $phaseRoot ($phase+'.log')
$result=[ordered]@{status='RUNNING';startedAt=(Get-Date).ToUniversalTime().ToString('o');isElevated=$true;helperPid=$PID;
    phase=$phase;language=$Language;version=$version;package=$package.path;sha256=$expected;installRoot=$installRoot;
    registrationsBefore=(Registrations);error=$null}
Save $destination $result
try{
    $operation=switch($phase){'Repair'{'/fa'} 'Uninstall'{'/x'} default{'/i'}}
    $arguments=@($operation,('"'+$package.path+'"'),'/qn','/norestart',('INSTALLDIR="'+$installRoot+'"'),'/L*V',('"'+$log+'"'))
    $result.arguments=$arguments
    $process=Start-Process -FilePath msiexec.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
    $result.installerPid=$process.Id;Save $destination $result
    $process.WaitForExit()
    $result.exitCode=$process.ExitCode
    $result.rebootRequested=($process.ExitCode -eq 3010)
    $result.registrationsAfter=Registrations
    if($process.ExitCode -notin @(0,3010)){throw "Windows Installer returned $($process.ExitCode)"}
    if($phase -ne 'Uninstall'){
        $exe=Join-Path $installRoot 'agentvn-editor.exe'
        $result.actualVersion=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
        $result.executableSha256=Sha $exe
        if($result.actualVersion -ne $version){throw 'Installed executable version mismatch'}
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{$result.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save $destination $result}
