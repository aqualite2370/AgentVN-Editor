param(
    [ValidateSet('SelfTest','Checkpoint','HoldLegacy','RestoreLegacy','Install','Upgrade','Repair','Uninstall','RestoreShortcuts','Elevated')]
    [string]$Action='SelfTest',
    [ValidateSet('recent-en','recent-zh','cross-en','cross-zh')][string]$Chain='recent-en',
    [ValidateSet('Install','Upgrade','Repair','Uninstall','RestoreShortcuts')][string]$Operation='Install'
)
# Actual QA installers only. Explicit authorized D branch; no registry erasure,
# property transforms, fake old builds, data migration consent, or product fix.
$ErrorActionPreference='Stop'
$run='F:\AgentVN\QA\Current-MSI-Upgrade-20261021-02\'+$Chain
$backup='F:\AgentVN\Checkpoints\Current-MSI-Upgrade-20261021-02\'+$Chain
$install='D:\agentvntest\AgentVN Editor'
$held=Join-Path $install ('data.qa-held-current-msi-'+$Chain+'-20261021')
$legacy=Join-Path $install 'data'
$baseVersion=if($Chain.StartsWith('recent-')){'1.9.8'}else{'1.7.1'}
$language=if($Chain.EndsWith('-en')){'en-US'}else{'zh-CN'}
$original='F:\AgentVN\Checkpoints\Current-MSI-Upgrade-20261021-01\checkpoint-verified-02.json'
$manifest='F:\AgentVN\QA\Current-MSI-Upgrade-20261021-01\preflight-02\report.json'
function Read($file){Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Save($file,$value){
    if(Test-Path -LiteralPath $file){throw 'Never overwrite a chain receipt'}
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 18),[Text.UTF8Encoding]::new($false))
}
function Boundary($path,$expected){
    if([IO.Path]::GetFullPath($path) -cne $expected){throw 'Exact upgrade chain boundary required'}
}
function Idle {
    if(@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\.exe$' -or
        ($_.Name -ceq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')
    }).Count){throw 'AgentVN processes active'}
}
function Files($directory){
    $entries=@(Get-Item -LiteralPath $directory -Force)+@(Get-ChildItem -LiteralPath $directory -Recurse -Force)
    if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Internal link'}
    @(foreach($file in $entries|Where-Object {!$_.PSIsContainer}){
        @{relative=$file.FullName.Substring($directory.Length+1);bytes=$file.Length;sha256=(Sha $file.FullName)}
    })
}
function Verify($directory,$expected){
    $actual=@(Files $directory)
    if($actual.Count -ne @($expected).Count){throw 'File count differs'}
    $lookup=@{};foreach($file in $actual){$lookup[$file.relative]=$file}
    foreach($file in $expected){
        $other=$lookup[$file.relative]
        if(!$other -or $other.bytes -ne $file.bytes -or $other.sha256 -cne $file.sha256){throw 'Byte inventory differs'}
    }
}
function Registrations {
    @(Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|
        Where-Object {$_.DisplayName -match 'AgentVN' -and $_.WindowsInstaller -eq 1}|
        Select-Object DisplayName,DisplayVersion,InstallLocation,PSChildName)
}
function Links {
    $shell=New-Object -ComObject WScript.Shell
    @(foreach($folder in @('C:\Users\1\Desktop','C:\Users\Public\Desktop',
        'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs',
        'C:\ProgramData\Microsoft\Windows\Start Menu\Programs')){
        foreach($file in Get-ChildItem -LiteralPath $folder -File -Filter '*AgentVN*.lnk'){
            @{path=$file.FullName;sha256=(Sha $file.FullName);target=$shell.CreateShortcut($file.FullName).TargetPath}
        }
    })
}
Boundary $install 'D:\agentvntest\AgentVN Editor'
Boundary $legacy 'D:\agentvntest\AgentVN Editor\data'
if($Action -ceq 'SelfTest'){
    foreach($path in @('D:\','D:\AgentVN','D:\agentvntest','F:\AgentVN','C:\Users\1',
        ($install+'\nested'),($install+'\..'),($install+'-other'))){
        $accepted=$true;try{Boundary $path $install}catch{$accepted=$false}
        if($accepted){throw 'Unrelated installation accepted'}
    }
    Boundary $install $install;Boundary $legacy $legacy;Boundary $held $held
    "PASS: eleven exact boundaries for $Chain; no changes";exit
}
Idle
if($Action -ceq 'Checkpoint'){
    if((Test-Path -LiteralPath $run) -or (Test-Path -LiteralPath $backup) -or @(Registrations).Count){
        throw 'Fresh session and no registered MSI required'
    }
    if((Get-PSDrive F).Free -lt 2GB){throw 'Insufficient checkpoint space'}
    $previous=Read 'F:\AgentVN\QA\Current-MSI-Upgrade-20261021-01\session-01\terminal-audit-02.json'
    if($previous.evidenceAuditStatus -cne 'PASS'){throw 'Previous incident must be safely restored'}
    $originalState=Read $original
    foreach($file in $originalState.protectedFiles){if((Sha $file.path) -cne $file.sha256){throw 'Protected artifact changed'}}
    $null=New-Item -ItemType Directory -Path $run,$backup
    $result=[ordered]@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o')
        chain=$Chain;source=$install;files=@();shortcuts=@(Links);error=$null
        originalInstallationCheckpoint=@{path=$original;sha256=(Sha $original)}
        authorization='Previously user-authorized replaceable D QA installation, fresh current-state backup'
        scope='Not a clean machine; historical NSIS registration remains; no AppSearch bypass'}
    try{
        $result.files=@(Files $install)
        foreach($file in $result.files){
            $target=Join-Path $backup ('installation\'+$file.relative)
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
            Copy-Item -LiteralPath (Join-Path $install $file.relative) -Destination $target
        }
        Verify (Join-Path $backup 'installation') $result.files
        Verify $install $result.files
        Verify $originalState.source $originalState.files
        foreach($link in $result.shortcuts){
            $target=Join-Path $backup ('shortcuts\'+[array]::IndexOf($result.shortcuts,$link)+'.lnk')
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
            Copy-Item -LiteralPath $link.path -Destination $target
            if((Sha $target) -cne $link.sha256){throw 'Shortcut checkpoint differs'}
            $link.backup=$target
        }
        foreach($relative in @('scripts\current-msi-upgrade-chain.ps1','scripts\current-msi-profiles.ps1',
            'scripts\host-msi-launch.ps1','scripts\host-upgrade-installed-ui.cjs',
            'plans\ACTIVE_TASKS.md','plans\FULL_REGRESSION_20261017.md')){
            $target=Join-Path $backup ('tools\'+$relative)
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
            Copy-Item -LiteralPath (Join-Path 'D:\AgentVN' $relative) -Destination $target
        }
        $result.status='PASS';$result.fileCount=$result.files.Count
        $result.totalBytes=[long](($result.files|ForEach-Object {$_.bytes}|Measure-Object -Sum).Sum)
    }catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
    finally{Save (Join-Path $backup 'checkpoint.json') $result}
    [pscustomobject]$result|Select-Object status,fileCount,totalBytes|ConvertTo-Json;exit
}
$checkpoint=Read (Join-Path $backup 'checkpoint.json')
if($checkpoint.status -cne 'PASS' -or $checkpoint.source -cne $install){throw 'Full fresh D checkpoint required'}
if($Action -in @('HoldLegacy','RestoreLegacy')){
    $destination=Join-Path $run ($Action+'.json')
    if(Test-Path -LiteralPath $destination){throw 'Do not repeat legacy action'}
    $files=@(foreach($file in $checkpoint.files|Where-Object {$_.relative.StartsWith('data\')}){
        @{relative=$file.relative.Substring(5);bytes=$file.bytes;sha256=$file.sha256}
    })
    if(!$files.Count){throw 'Original legacy data must be present'}
    $result=[ordered]@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o')
        source=$legacy;held=$held;files=$files;deletedUserFiles=0;error=$null}
    try{
        if($Action -ceq 'HoldLegacy'){
            if(Test-Path -LiteralPath $held){throw 'Legacy hold collision'}
            Verify $legacy $files;[IO.Directory]::Move($legacy,$held);Verify $held $files
        }else{
            if(@(Registrations).Count){throw 'Uninstall test MSI before restoring original legacy database'}
            if(Test-Path -LiteralPath $legacy){
                # Old 1.7.1 writes its QA DB here. Preserve it independently;
                # never merge it into or overwrite the held historical source.
                $archive=Join-Path $run 'old-install-local-data'
                if(Test-Path -LiteralPath $archive){throw 'Legacy QA archive collision'}
                $qaFiles=@(Files $legacy);Copy-Item -LiteralPath $legacy -Destination $archive -Recurse
                Verify $archive $qaFiles
                $retained=Join-Path $install ('data.qa-tested-'+$Chain+'-20261021')
                if(Test-Path -LiteralPath $retained){throw 'Legacy QA retention collision'}
                Boundary $retained ('D:\agentvntest\AgentVN Editor\data.qa-tested-'+$Chain+'-20261021')
                [IO.Directory]::Move($legacy,$retained)
                $result.qaRetained=$retained;$result.qaArchive=$archive;$result.qaFiles=$qaFiles
            }
            Verify $held $files;[IO.Directory]::Move($held,$legacy);Verify $legacy $files
        }
        $result.status='PASS'
    }catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
    finally{Save $destination $result}
    [pscustomobject]$result|Select-Object status,source,held,deletedUserFiles|ConvertTo-Json;exit
}
$phase=if($Action -ceq 'Elevated'){$Operation}else{$Action}
$destination=Join-Path $run ($phase+'.json')
if(Test-Path -LiteralPath $destination){throw 'Do not repeat installer/restoration action'}
$elevated=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($Action -cne 'Elevated'){
    if($elevated){throw 'Non-admin parent required for real elevation'}
    $wrapper=$destination -replace '\.json$','-elevation.json'
    if(Test-Path -LiteralPath $wrapper){throw 'Inspect existing elevation, never restart it'}
    $result=[ordered]@{status='RUNNING';parentElevated=$false;at=(Get-Date).ToUniversalTime().ToString('o');error=$null}
    try{
        $helper=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
            '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),
            '-Action','Elevated','-Operation',$phase,'-Chain',$Chain)
        $result.helperPid=$helper.Id;$result.helperCreated=$helper.StartTime.ToUniversalTime().ToString('o')
        $helper.WaitForExit();$result.exitCode=$helper.ExitCode
        if((Read $destination).status -cne 'PASS'){throw 'Actual chain operation failed'}
        $result.status='PASS'
    }catch{$result.status='BLOCKED';$result.error=$_.Exception.Message;throw}
    finally{Save $wrapper $result}
    $child=Read $destination;[pscustomobject]$child|Select-Object status,phase,version,isElevated,exitCode|ConvertTo-Json;exit
}
if(!$elevated){throw 'Real elevated token required'}
$result=[ordered]@{status='RUNNING';phase=$phase;chain=$Chain;at=(Get-Date).ToUniversalTime().ToString('o')
    installRoot=$install;isElevated=$true;helperPid=$PID;error=$null}
try{
    if($phase -ceq 'RestoreShortcuts'){
        if(@(Registrations).Count){throw 'Owned MSI still installed'}
        $result.restored=@()
        foreach($link in $checkpoint.shortcuts){
            if((Sha $link.backup) -cne $link.sha256){throw 'Original shortcut checkpoint changed'}
            $current=@(Links|Where-Object {$_.path -ceq $link.path})
            if($current.Count -and $current[0].sha256 -cne $link.sha256 -and
                $current[0].target -cne (Join-Path $install 'agentvn-editor.exe')){throw 'Unknown shortcut change'}
            Copy-Item -LiteralPath $link.backup -Destination $link.path -Force
            if((Sha $link.path) -cne $link.sha256){throw 'Shortcut restoration failed'}
            $result.restored+=@{path=$link.path;sha256=$link.sha256}
        }
        if(@(Links|Where-Object {$_.path -cnotin @($checkpoint.shortcuts.path)}).Count){
            throw 'New shortcut remains: preserve and inspect, not broad cleanup'
        }
    }else{
        $protection=Read (Join-Path $run 'profile-protection.json')
        if($protection.records.Count -ne 2){throw 'Two original profile journals required'}
        foreach($record in $protection.records){if(!(Test-Path -LiteralPath $record.held)){throw 'Original profiles not held'}}
        if((Read (Join-Path $run 'HoldLegacy.json')).status -cne 'PASS' -or !(Test-Path -LiteralPath $held)){
            throw 'Original D data must remain protected'
        }
        $preflight=Read $manifest
        $version=if($phase -ceq 'Install'){$baseVersion}else{'1.9.16'}
        $packages=@(if($version -ceq '1.9.16'){$preflight.packages|Where-Object {$_.language -ceq $language}}
            else{$preflight.oldEditorSamples|Where-Object {
                $_.recordedActualPeVersion -ceq $version -and $_.path.EndsWith('_'+$language+'.msi')
            }})
        if($packages.Count -ne 1 -or (Sha $packages[0].path) -cne $packages[0].sha256){throw 'Exact trusted MSI required'}
        $package=$packages[0];$before=@(Registrations)
        if($phase -ceq 'Install'){
            if($before.Count){throw 'Old baseline requires no registered MSI'}
        }else{
            $expectedVersion=if($phase -ceq 'Upgrade'){$baseVersion}else{'1.9.16'}
            if($before.Count -ne 1 -or $before[0].DisplayVersion -cne $expectedVersion -or
                $before[0].InstallLocation.Trim('"').TrimEnd('\') -cne $install){throw 'Exact owned baseline MSI required'}
            $prior=Read (Join-Path $run $(if($phase -ceq 'Upgrade'){'Install.json'}else{'Upgrade.json'}))
            if($prior.status -cne 'PASS' -or $prior.registration.PSChildName -cne $before[0].PSChildName){throw 'Registered product ownership differs'}
            if($phase -ceq 'Upgrade'){
                $baseline=Read (Join-Path $run 'old-ui-01\report.json')
                if($baseline.status -cne 'PASS' -or !$baseline.project.metadata.projectId){throw 'Real old UI baseline required'}
            }
        }
        $log=$destination -replace '\.json$','.log'
        $verb=switch($phase){'Repair'{'/fa'} 'Uninstall'{'/x'} default{'/i'}}
        $result.version=$version;$result.package=@{path=$package.path;sha256=$package.sha256};$result.log=$log
        $result.registrationsBefore=$before
        if($phase -ceq 'Upgrade'){
            $result.persistenceBefore=@()
            $locations=@(
                @{label='roaming';path='C:\Users\1\AppData\Roaming\com.agentvn.editor'},
                @{label='local';path='C:\Users\1\AppData\Local\com.agentvn.editor'}
            )
            if($baseVersion -ceq '1.7.1'){$locations+=@{label='install-local';path=$legacy}}
            foreach($location in $locations){
                $inventory=@(Files $location.path)
                $copy=Join-Path $run ('old-persistence\'+$location.label)
                if(Test-Path -LiteralPath $copy){throw 'Persistence snapshot already exists'}
                Copy-Item -LiteralPath $location.path -Destination $copy -Recurse
                Verify $copy $inventory
                $result.persistenceBefore+=@{path=$location.path;archive=$copy;files=$inventory}
            }
        }
        $result.arguments=@($verb,('"'+$package.path+'"'),'/qn','/norestart',('INSTALLDIR="'+$install+'"'),'/L*V',('"'+$log+'"'))
        $process=Start-Process msiexec.exe -ArgumentList $result.arguments -WindowStyle Hidden -PassThru
        $result.installerPid=$process.Id;$result.installerCreated=$process.StartTime.ToUniversalTime().ToString('o')
        $process.WaitForExit();$result.exitCode=$process.ExitCode
        if($process.ExitCode -notin @(0,3010)){throw 'Actual MSI operation failed'}
        $after=@(Registrations);$result.registrationsAfter=$after
        if($phase -ceq 'Upgrade'){
            foreach($snapshot in $result.persistenceBefore){Verify $snapshot.path $snapshot.files}
            $result.persistenceUnchangedBeforeFirstNewLaunch=$true
        }
        if($phase -ceq 'Uninstall'){
            if($after.Count -or (Test-Path -LiteralPath (Join-Path $install 'agentvn-editor.exe'))){throw 'MSI uninstall incomplete'}
        }else{
            if($after.Count -ne 1 -or $after[0].DisplayVersion -cne $version -or
                $after[0].InstallLocation.Trim('"').TrimEnd('\') -cne $install){throw 'Actual MSI identity/path differs'}
            $result.registration=$after[0]
            $exe=Join-Path $install 'agentvn-editor.exe'
            $result.executable=@{path=$exe;sha256=(Sha $exe);version=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion}
            if($result.executable.version -cne $version){throw 'Actual PE version differs'}
            if($version -ceq '1.9.16'){
                if($result.executable.sha256 -cne 'c16f1a71cf3e152456560e39a5d28b7c95ebbabc44d8bd50e69c9a3d9ea63f84' -or
                    (Read (Join-Path $install 'build-versions.json')).editorVersion -cne $version){throw 'Current sealed MSI payload differs'}
                if($phase -ceq 'Upgrade' -and $after[0].PSChildName -ceq $before[0].PSChildName){
                    throw 'Expected real major-version product replacement, not same-product repair'
                }
            }
        }
        $originalFiles=@(foreach($file in $checkpoint.files|Where-Object {$_.relative.StartsWith('data\')}){
            @{relative=$file.relative.Substring(5);bytes=$file.bytes;sha256=$file.sha256}
        })
        Verify $held $originalFiles
    }
    $originalState=Read $original
    foreach($file in $originalState.protectedFiles){if((Sha $file.path) -cne $file.sha256){throw 'Protected original changed'}}
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{Save $destination $result}
