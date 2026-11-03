param(
    [ValidateSet('SelfTest','Checkpoint','VerifyCheckpoint','Install','Repair','Uninstall','Restore','Elevated')][string]$Action='SelfTest',
    [ValidateSet('Install','Repair','Uninstall','Restore')][string]$Operation='Install',
    [ValidateSet('clean','recent','cross')][string]$Scenario='clean',
    [ValidateSet('en-US','zh-CN')][string]$Language='en-US',
    [ValidateSet('1.7.1','1.9.8','1.9.16')][string]$Version='1.9.16',
    [ValidateRange(1,99)][int]$Attempt=1
)
# QA-only system installation session. The existing F test installation is the
# previously authorized replacement branch, not the sealed candidate archive.
$ErrorActionPreference='Stop'
$qa='F:\AgentVN\QA\Current-MSI-Upgrade-20261021-01'
$run=Join-Path $qa 'session-01'
$backup='F:\AgentVN\Checkpoints\Current-MSI-Upgrade-20261021-01'
$install='F:\AgentVN-QA-HostUpgrade-20261018-02\installed-editor'
$physicalInstall='F:\AgentVN\QA\AgentVN-QA-HostUpgrade-20261018-02\installed-editor'
$keys=@('Software\agentvn\AgentVN Editor','Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor')
function Save($file,$value){[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 18),[Text.UTF8Encoding]::new($false))}
function Read($file){Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Idle {
    if(@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\.exe$' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')
    }).Count){throw 'AgentVN processes active: refuse installation or restoration'}
}
function Boundary($target){
    $full=[IO.Path]::GetFullPath($target)
    if($full -cne $install -and $full -cne $physicalInstall){throw 'Exact authorized test installation required'}
}
function Files($directory){
    $entries=@(Get-Item -LiteralPath $directory -Force)+@(Get-ChildItem -LiteralPath $directory -Recurse -Force)
    if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Unexpected internal reparse point'}
    @(foreach($f in $entries|Where-Object {!$_.PSIsContainer}){
        @{relative=$f.FullName.Substring($directory.Length+1);bytes=$f.Length;sha256=(Sha $f.FullName)}
    })
}
function Verify($directory,$files){
    $actual=@(Files $directory)
    if($actual.Count -ne @($files).Count){throw "File count differs in $directory"}
    $lookup=@{};foreach($file in $actual){$lookup[$file.relative]=$file}
    foreach($file in $files){
        $other=$lookup[$file.relative]
        if(!$other -or $other.sha256 -cne $file.sha256 -or $other.bytes -ne $file.bytes){throw 'Byte inventory mismatch'}
    }
}
function TotalBytes($files){
    [long](($files|ForEach-Object {$_.bytes}|Measure-Object -Sum).Sum)
}
function Registry {
    @(foreach($relative in $keys){
        $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($relative)
        if(!$key){throw 'Original NSIS registry key missing; do not recreate to bypass installation'}
        try{
            if($key.GetSubKeyNames().Count){throw 'Unexpected nested original registration'}
            @{path=$relative;values=@(foreach($name in $key.GetValueNames()){
                @{name=$name;kind=$key.GetValueKind($name).ToString()
                  value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}
            })}
        }finally{$key.Dispose()}
    })
}
function Registrations {
    @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|
        Where-Object {$_.DisplayName -match 'AgentVN'}|
        Select-Object DisplayName,DisplayVersion,InstallLocation,WindowsInstaller,PSChildName)
}
function Shortcuts {
    $shell=New-Object -ComObject WScript.Shell
    @(foreach($folder in @('C:\Users\1\Desktop','C:\Users\Public\Desktop',
        'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs',
        'C:\ProgramData\Microsoft\Windows\Start Menu\Programs')){
        foreach($file in Get-ChildItem -LiteralPath $folder -Filter '*AgentVN*.lnk' -File -ErrorAction SilentlyContinue){
            $link=$shell.CreateShortcut($file.FullName)
            @{path=$file.FullName;sha256=(Sha $file.FullName);target=$link.TargetPath;arguments=$link.Arguments}
        }
    })
}
Boundary $install
if($Action -eq 'SelfTest'){
    $tests=@(@($install,$true),@($physicalInstall,$true),@('D:\AgentVN',$false),@('F:\AgentVN',$false),
        @(($install+'\nested'),$false),@(($install+'\..'),$false),@(($qa+'\installed-editor'),$false),
        @('C:\Users\1\AppData\Roaming\com.agentvn.editor',$false))
    foreach($case in $tests){
        $ok=$true;try{Boundary $case[0]}catch{$ok=$false}
        if($ok -ne $case[1]){throw 'MSI boundary selftest failed'}
    }
    if((TotalBytes @(@{bytes=3},@{bytes=5})) -ne 8 -or
        (TotalBytes @([pscustomobject]@{bytes=3},[pscustomobject]@{bytes=5})) -ne 8 -or
        (TotalBytes @()) -ne 0){throw 'Hashtable/JSON/empty byte aggregation differs'}
    'PASS: eight installation/restore boundaries and Hashtable/JSON/empty byte totals; no system mutation';exit
}
Idle
if($Action -eq 'VerifyCheckpoint'){
    $original=Join-Path $backup 'checkpoint.json'
    $receipt=Join-Path $backup 'checkpoint-verified-02.json'
    if(Test-Path -LiteralPath $receipt){throw 'Checkpoint verification already recorded'}
    $failed=Read $original
    if($failed.status -cne 'FAILED' -or $failed.error -notmatch 'argument "Property" is not valid' -or
        $failed.source -cne $install -or $failed.fileCount -ne 12848 -or $failed.protectedFiles.Count -ne 3){
        throw 'Only the known post-copy Hashtable aggregation failure can be recovered'
    }
    if(@(Get-ChildItem -LiteralPath $run -Recurse -Filter 'Install-*.json' -File).Count -or
        @(Registrations|Where-Object {$_.WindowsInstaller -eq 1}).Count){throw 'Installer state changed before checkpoint verification'}
    Verify (Join-Path $backup 'installation') $failed.files
    Verify $install $failed.files
    foreach($file in $failed.protectedFiles){if((Sha $file.path) -cne $file.sha256){throw 'Protected file changed'}}
    foreach($link in $failed.shortcuts){
        if((Sha $link.path) -cne $link.sha256 -or (Sha $link.backup) -cne $link.sha256){throw 'Shortcut checkpoint differs'}
    }
    if((@(Registry)|ConvertTo-Json -Depth 8 -Compress) -cne
        ($failed.registry|ConvertTo-Json -Depth 8 -Compress)){throw 'Original registration changed'}
    $failed.status='PASS';$failed.error=$null
    $failed|Add-Member -NotePropertyName totalBytes -NotePropertyValue (TotalBytes $failed.files)
    $failed|Add-Member -NotePropertyName recoveredFrom -NotePropertyValue @{path=$original;sha256=(Sha $original)
        reason='Post-copy Hashtable Measure-Object summary failed; all source/backup bytes independently reverified'}
    $failed.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
    Save $receipt $failed
    [pscustomobject]$failed|Select-Object status,fileCount,totalBytes,recoveredFrom|ConvertTo-Json -Depth 4
    exit
}
if($Action -eq 'Checkpoint'){
    if((Test-Path -LiteralPath $run) -or (Test-Path -LiteralPath $backup)){throw 'Fresh session and checkpoint required'}
    $preflight=Read (Join-Path $qa 'preflight-02\report.json')
    if($preflight.status -cne 'PASS' -or $preflight.oldEditorSamples.Count -ne 6 -or
        (Sha (Join-Path $install 'agentvn-editor.exe')) -cne $preflight.rememberedExecutable.sha256){
        throw 'Actual preflight and original installation identity required'
    }
    if(@(Registrations|Where-Object {$_.WindowsInstaller -eq 1}).Count){throw 'Existing MSI product requires a different branch'}
    if((Get-PSDrive F).Free -lt 3GB){throw 'Insufficient checkpoint space'}
    $null=New-Item -ItemType Directory -Path $run,$backup
    $result=[ordered]@{status='RUNNING';startedAt=(Get-Date).ToUniversalTime().ToString('o')
        source=$install;physicalSource=$physicalInstall;files=@();shortcuts=@();registry=@(Registry)
        registrations=@(Registrations);authorization='Previously authorized replaceable F QA installation; sealed archives unchanged'
        preflight=@{path=(Join-Path $qa 'preflight-02\report.json');sha256=(Sha (Join-Path $qa 'preflight-02\report.json'))}
        protectedFiles=@();error=$null}
    Save (Join-Path $backup 'journal.json') $result
    try{
        $result.files=@(Files $install)
        foreach($file in $result.files){
            $target=Join-Path $backup ('installation\'+$file.relative)
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
            Copy-Item -LiteralPath (Join-Path $install $file.relative) -Destination $target
            if((Sha $target) -cne $file.sha256){throw 'Installation backup SHA mismatch'}
        }
        Verify $install $result.files
        foreach($link in @(Shortcuts)){
            $target=Join-Path $backup ('shortcuts\'+$result.shortcuts.Count+'.lnk')
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
            Copy-Item -LiteralPath $link.path -Destination $target
            if((Sha $target) -cne $link.sha256){throw 'Shortcut backup SHA mismatch'}
            $link.backup=$target;$result.shortcuts+=$link
        }
        foreach($file in @('D:\AgentVN\AgentVN Dev.exe','D:\AgentVN\.git\index',
            'F:\AgentVN\QA\Component-Preview-Release-20261021-02\installed-editor\agentvn-editor.exe')){
            $result.protectedFiles+=@{path=$file;sha256=(Sha $file)}
        }
        foreach($file in @('scripts\current-msi-session.ps1','scripts\current-msi-upgrade-preflight.ps1',
            'plans\ACTIVE_TASKS.md','plans\FULL_REGRESSION_20261017.md')){
            $target=Join-Path $backup ('tools\'+$file)
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
            Copy-Item -LiteralPath (Join-Path 'D:\AgentVN' $file) -Destination $target
            if((Sha $target) -cne (Sha (Join-Path 'D:\AgentVN' $file))){throw 'Tool checkpoint mismatch'}
        }
        $result.status='PASS';$result.fileCount=$result.files.Count
        $result.totalBytes=TotalBytes $result.files
    }catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
    finally{
        $result.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
        Save (Join-Path $backup 'checkpoint.json') $result
    }
    [pscustomobject]$result|Select-Object status,fileCount,totalBytes,source|ConvertTo-Json
    exit
}
$checkpointReceipt=Join-Path $backup 'checkpoint-verified-02.json'
if(!(Test-Path -LiteralPath $checkpointReceipt)){$checkpointReceipt=Join-Path $backup 'checkpoint.json'}
$checkpoint=Read $checkpointReceipt
if($checkpoint.status -cne 'PASS' -or $checkpoint.source -cne $install -or !$checkpoint.fileCount){
    throw 'Complete fresh checkpoint required before system installer'
}
foreach($file in $checkpoint.protectedFiles){if((Sha $file.path) -cne $file.sha256){throw 'Protected file changed'}}
$phase=if($Action -eq 'Elevated'){$Operation}else{$Action}
$phaseFolder=Join-Path $run ($Scenario+'\'+$Language)
$null=New-Item -ItemType Directory -Path $phaseFolder -Force
$destination=if($phase -eq 'Restore'){Join-Path $run ('restoration-'+$Attempt.ToString('00')+'.json')}
    else{Join-Path $phaseFolder ($phase+'-'+$Version+'-'+$Attempt.ToString('00')+'.json')}
if(Test-Path -LiteralPath $destination){throw 'Do not overwrite or repeat an installer attempt'}
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($Action -ne 'Elevated'){
    if($elevated){throw 'Use a non-admin parent to request the real elevated helper'}
    $wrapper=$destination -replace '\.json$','-elevation.json'
    if(Test-Path -LiteralPath $wrapper){throw 'Existing elevation attempt; inspect that handle instead'}
    $request=[ordered]@{status='WAITING_FOR_REAL_ELEVATION';parentElevated=$false;startedAt=(Get-Date).ToUniversalTime().ToString('o');error=$null}
    Save $wrapper $request
    try{
        $helper=Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
            '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Action','Elevated',
            '-Operation',$phase,'-Scenario',$Scenario,'-Language',$Language,'-Version',$Version,'-Attempt',$Attempt)
        $request.helperPid=$helper.Id
        $request.helperCreated=$helper.StartTime.ToUniversalTime().ToString('o');Save $wrapper $request
        $helper.WaitForExit();$request.helperExitCode=$helper.ExitCode
        if(!(Test-Path -LiteralPath $destination)){throw 'Elevated helper produced no terminal installer receipt'}
        $child=Read $destination
        if($child.status -cne 'PASS'){throw 'Actual installer/restoration failed; preserve original evidence'}
        $request.status='PASS'
    }catch{$request.status='BLOCKED';$request.error=$_.Exception.Message;throw}
    finally{$request.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save $wrapper $request}
    [pscustomobject]$child|Select-Object status,phase,version,exitCode,isElevated,actualVersion,restoredFiles|ConvertTo-Json
    exit
}
if(!$elevated){throw 'Genuine administrator token required'}
$result=[ordered]@{status='RUNNING';phase=$phase;version=$Version;language=$Language;scenario=$Scenario
    startedAt=(Get-Date).ToUniversalTime().ToString('o');isElevated=$true;helperPid=$PID
    installRoot=$install;registrationsBefore=@(Registrations);error=$null}
Save $destination $result
try{
    if($phase -eq 'Restore'){
        if(@(Registrations|Where-Object {$_.WindowsInstaller -eq 1}).Count){throw 'Uninstall the owned MSI before restoring original installation'}
        Verify (Join-Path $backup 'installation') $checkpoint.files
        $retained=Join-Path $run 'post-msi-installation'
        if(Test-Path -LiteralPath $retained){throw 'Existing restoration archive: inspect, do not overwrite'}
        Boundary $install
        if(Test-Path -LiteralPath $install){[IO.Directory]::Move($install,$retained)}
        $null=New-Item -ItemType Directory -Path $install
        foreach($file in $checkpoint.files){
            $target=Join-Path $install $file.relative
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
            Copy-Item -LiteralPath (Join-Path $backup ('installation\'+$file.relative)) -Destination $target
        }
        Verify $install $checkpoint.files
        foreach($row in $checkpoint.registry){
            if($row.path -cnotin $keys){throw 'Registry restoration boundary mismatch'}
            $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($row.path,$true)
            if(!$key){throw 'Original registry key disappeared; preserve restoration state for inspection'}
            try{
                foreach($name in $key.GetValueNames()){
                    if($name -cnotin @($row.values.name)){
                        if($row.path -cne $keys[0] -or $name -cne 'InstallDir'){throw 'Unknown extra registry value, do not erase'}
                        $key.DeleteValue($name)
                    }
                }
                foreach($value in $row.values){$key.SetValue($value.name,$value.value,[Microsoft.Win32.RegistryValueKind]$value.kind)}
            }finally{$key.Dispose()}
        }
        foreach($row in $checkpoint.shortcuts){
            Copy-Item -LiteralPath $row.backup -Destination $row.path -Force
            if((Sha $row.path) -cne $row.sha256){throw 'Original shortcut restoration differs'}
        }
        $result.retainedNewShortcuts=@()
        foreach($link in @(Shortcuts)){
            if($link.path -cnotin @($checkpoint.shortcuts.path)){
                if($link.target -cne (Join-Path $install 'agentvn-editor.exe')){throw 'Unknown new shortcut; do not move'}
                $target=Join-Path $run ('retained-shortcuts\'+$result.retainedNewShortcuts.Count+'.lnk')
                $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
                Move-Item -LiteralPath $link.path -Destination $target
                $result.retainedNewShortcuts+=@{source=$link.path;retained=$target;sha256=(Sha $target)}
            }
        }
        $result.registryAfter=@(Registry);$result.shortcutsAfter=@(Shortcuts)
        if(($result.registryAfter|ConvertTo-Json -Depth 8 -Compress) -cne
            ($checkpoint.registry|ConvertTo-Json -Depth 8 -Compress)){throw 'Original registration restoration differs'}
        $result.restoredFiles=$checkpoint.fileCount;$result.retainedInstallation=$retained
    }else{
        $preflight=Read (Join-Path $qa 'preflight-02\report.json')
        $packages=@(if($Version -ceq '1.9.16'){
            $preflight.packages|Where-Object {$_.language -ceq $Language}
        }else{
            $preflight.oldEditorSamples|Where-Object {
                $_.recordedActualPeVersion -ceq $Version -and $_.path.EndsWith('_'+$Language+'.msi')
            }
        })
        if($packages.Count -ne 1 -or (Sha $packages[0].path) -cne $packages[0].sha256){throw 'Exact trusted installer required'}
        $package=$packages[0]
        $msi=@(Registrations|Where-Object {$_.WindowsInstaller -eq 1})
        foreach($registration in $msi){
            if($registration.InstallLocation.Trim('"').TrimEnd('\') -cne $install){throw 'MSI outside authorized branch'}
        }
        if($Scenario -ceq 'clean' -and $phase -ceq 'Install' -and $msi.Count){throw 'Ordinary /i requires no registered MSI'}
        if($phase -in @('Repair','Uninstall') -and
            ($msi.Count -ne 1 -or $msi[0].DisplayVersion -cne $Version)){throw 'Exact installed MSI version required'}
        $remembered=@(Registry)[0]
        foreach($value in $remembered.values|Where-Object {$_.name -in @('','InstallDir')}){
            if($value.value -and $value.value.TrimEnd('\') -cne $install){throw 'Remembered path outside authorized branch'}
        }
        $verb=switch($phase){'Repair'{'/fa'} 'Uninstall'{'/x'} default{'/i'}}
        $log=$destination -replace '\.json$','.log'
        $result.arguments=@($verb,('"'+$package.path+'"'),'/qn','/norestart',('INSTALLDIR="'+$install+'"'),'/L*V',('"'+$log+'"'))
        $result.package=@{path=$package.path;sha256=$package.sha256};$result.log=$log
        $process=Start-Process -FilePath msiexec.exe -ArgumentList $result.arguments -WindowStyle Hidden -PassThru
        $result.installerPid=$process.Id;$result.installerCreated=$process.StartTime.ToUniversalTime().ToString('o')
        Save $destination $result
        $process.WaitForExit();$result.exitCode=$process.ExitCode;$result.registrationsAfter=@(Registrations)
        if($process.ExitCode -notin @(0,3010)){throw "Actual Windows Installer exit $($process.ExitCode)"}
        $after=@($result.registrationsAfter|Where-Object {$_.WindowsInstaller -eq 1})
        if($phase -ceq 'Uninstall'){
            if($after.Count -or (Test-Path -LiteralPath (Join-Path $install 'agentvn-editor.exe'))){throw 'Actual MSI uninstall incomplete'}
        }else{
            if($after.Count -ne 1 -or $after[0].DisplayVersion -cne $Version -or
                $after[0].InstallLocation.Trim('"').TrimEnd('\') -cne $install){throw 'Actual MSI identity or target mismatch'}
            $exe=Join-Path $install 'agentvn-editor.exe'
            $result.actualVersion=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
            $result.executable=@{path=$exe;sha256=(Sha $exe)}
            if($result.actualVersion -cne $Version){throw 'Actual installed PE version mismatch'}
            if($Version -ceq '1.9.16'){
                if($result.executable.sha256 -cne 'c16f1a71cf3e152456560e39a5d28b7c95ebbabc44d8bd50e69c9a3d9ea63f84'){
                    throw 'Actual MSI executable differs from exact sealed MSI payload'
                }
                $result.versionResource=@{path=(Join-Path $install 'build-versions.json')
                    sha256=(Sha (Join-Path $install 'build-versions.json'))
                    content=(Read (Join-Path $install 'build-versions.json'))}
                if($result.versionResource.content.editorVersion -cne $Version){throw 'Actual installed version resource mismatch'}
            }
            $result.shortcuts=@(Shortcuts)
        }
        if((Sha $package.path) -cne $package.sha256){throw 'Source MSI changed'}
    }
    foreach($file in $checkpoint.protectedFiles){if((Sha $file.path) -cne $file.sha256){throw 'Protected artifact changed'}}
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{$result.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save $destination $result}
