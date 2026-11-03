param([ValidateSet('SelfTest','Checkpoint','InstallOld','InstallNew','Uninstall','RestoreInstallation')][string]$Action='SelfTest')
$ErrorActionPreference='Stop'
$run='D:\AgentVN\output\host-nsis-cross-20261018-01'
$phase=Join-Path $run 'en-US'
$work='F:\AgentVN-QA-NSISCross-20261018-01'
$target=Join-Path $work 'installed-editor'
$frozen='F:\AgentVN-QA-HostUpgrade-20261018-02\installed-editor'
$backupRoot='F:\AgentVN-QA-HostMSINext-Backup-20261018-01'
$old='D:\AgentVN\releases\editor\AgentVN_Editor_v1.7.1_20260804_173759.exe'
$candidate='F:\AgentVN-QA-Preserved\cleanup-20261017-generated-01\full-regression-20261017-01\candidate-02\installers\AgentVN Editor_1.9.9_x64-setup.exe'
$utf8=New-Object Text.UTF8Encoding($false)
function Sha($file){
    $stream=[IO.File]::OpenRead($file);$algorithm=[Security.Cryptography.SHA256]::Create()
    try{[BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
    finally{$algorithm.Dispose();$stream.Dispose()}
}
function Save($file,$value){[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 18),$utf8)}
function Idle {
    if(@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')
    }).Count){throw 'AgentVN process active; stop before installation/profile operations'}
}
function Boundary($candidatePath){
    if([IO.Path]::GetFullPath($candidatePath) -notin @($target,$frozen)){throw 'Only two exact declared QA installation directories allowed'}
}
function NoLinks($directory){
    Boundary $directory
    if(Test-Path -LiteralPath $directory){
        $entries=@((Get-Item -LiteralPath $directory))+@(Get-ChildItem -LiteralPath $directory -Recurse -Force)
        if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Linked installation entry'}
    }
}
function RegistrySnapshot {
    @('HKCU:\Software\agentvn\AgentVN Editor',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor')|ForEach-Object {
        $key=Get-Item -LiteralPath $_ -ErrorAction SilentlyContinue
        @{path=$_;exists=($null -ne $key);values=@(if($key){foreach($name in $key.GetValueNames()){
            @{name=$name;kind=[string]$key.GetValueKind($name);value=$key.GetValue($name)}
        }})}
    }
}
function Registrations {
    @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|
        Where-Object {$_.DisplayName -match 'AgentVN'}|
        Select-Object DisplayName,DisplayVersion,InstallLocation,WindowsInstaller,PSPath)
}
if($Action -eq 'SelfTest'){
    $tests=@(@($target,$true),@($frozen,$true),@('D:\AgentVN',$false),@('F:\',$false),
        @($work,$false),@((Join-Path $target '..\other'),$false))
    foreach($test in $tests){
        $allowed=$true;try{Boundary $test[0]}catch{$allowed=$false}
        if($allowed -ne $test[1]){throw 'Boundary selftest failed'}
    }
    Write-Output 'PASS: six exact-directory boundary checks; no installation or profile mutation';exit
}
Idle
$prep=Get-Content -LiteralPath (Join-Path $run 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($prep.status -ne 'PASS' -or $prep.verifiedOriginalFiles -ne 55 -or !$prep.blankDefaultProfiles){throw 'Four original profiles/blank defaults required'}
foreach($row in $prep.profiles){if(!(Test-Path -LiteralPath $row.held)){throw 'Original whole profile not held'}}
$backup=Get-Content -LiteralPath (Join-Path $backupRoot 'backup.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($backup.status -ne 'PASS' -or $backup.source -ne $frozen -or $backup.fileCount -ne 12848){throw 'Trusted full original installation backup required'}
$null=New-Item -ItemType Directory -Path $phase -Force
$file=Join-Path $run ($Action+'.json')
if(Test-Path -LiteralPath $file){throw 'Never overwrite an operation receipt/retry automatically'}
$result=@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');operation=$Action;
    installerKind='NSIS';installRoot=$target;registrationsBefore=@(Registrations);error=$null}
Save $file $result
try{
    if($Action -eq 'Checkpoint'){
        if(Test-Path -LiteralPath $target){throw 'Fresh isolated NSIS directory required'}
        NoLinks $frozen
        foreach($row in $backup.files){
            if((Sha (Join-Path $frozen $row.relative)) -ne $row.sha256 -or
                (Sha (Join-Path $backupRoot ('installation\'+$row.relative))) -ne $row.sha256){throw 'Current installation/original independent backup differs'}
        }
        if(@(Get-ChildItem -LiteralPath $frozen -Recurse -File -Force).Count -ne $backup.fileCount){throw 'Original file count changed'}
        if(@($result.registrationsBefore|Where-Object {$_.WindowsInstaller -eq 1}).Count){throw 'Unexpected active MSI registration'}
        $result.registry=@(RegistrySnapshot);$result.shortcuts=@()
        $shell=New-Object -ComObject WScript.Shell
        foreach($folder in @('C:\Users\1\Desktop','C:\Users\Public\Desktop',
            'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs','C:\ProgramData\Microsoft\Windows\Start Menu\Programs')){
            foreach($entry in Get-ChildItem -LiteralPath $folder -Filter '*AgentVN*.lnk' -File -ErrorAction SilentlyContinue){
                $copy=Join-Path $work ('original-shortcuts\'+$result.shortcuts.Count+'.lnk')
                $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($copy)) -Force
                Copy-Item -LiteralPath $entry.FullName -Destination $copy
                if((Sha $copy) -ne (Sha $entry.FullName)){throw 'Shortcut checkpoint differs'}
                $result.shortcuts+=@{path=$entry.FullName;backup=$copy;sha256=(Sha $copy);target=$shell.CreateShortcut($entry.FullName).TargetPath}
            }
        }
        if((Sha $old) -ne '07126f13c50aa329babd5d87268057d19e11f79823cc5c551200f951a137adbf' -or
            (Sha $candidate) -ne '14ce31f9fa026797a99c9bfea92ca3a41a449255d9a8a8946f21a8af0db2beb4'){throw 'Trusted NSIS source mismatch'}
        $result.packages=@(@{version='1.7.1';path=$old;sha256=(Sha $old)},@{version='1.9.9';path=$candidate;sha256=(Sha $candidate)})
        $result.originalInstallation=@{root=$frozen;backup=(Join-Path $backupRoot 'backup.json');sha256=(Sha (Join-Path $backupRoot 'backup.json'));
            checkedFiles=$backup.fileCount;bytes=$backup.totalBytes}
        $result.devSha256=Sha 'D:\AgentVN\AgentVN Dev.exe'
        $result.originalCodeCheckpoint='F:\AgentVN-QA-NSISCross-Checkpoint-20261018-01'
    }else{
        $checkpoint=Get-Content -LiteralPath (Join-Path $run 'Checkpoint.json') -Raw -Encoding UTF8|ConvertFrom-Json
        if($checkpoint.status -ne 'PASS'){throw 'Original installation/registry/shortcut checkpoint missing'}
        NoLinks $target
        if($Action -in @('InstallOld','InstallNew')){
            $version=if($Action -eq 'InstallOld'){'1.7.1'}else{'1.9.9'}
            $package=@($checkpoint.packages|Where-Object {$_.version -eq $version})
            if($package.Count -ne 1 -or (Sha $package[0].path) -ne $package[0].sha256){throw 'Package changed'}
            if($Action -eq 'InstallOld' -and (Test-Path -LiteralPath $target)){throw 'Old target must be fresh'}
            if($Action -eq 'InstallNew'){
                if((Get-Item -LiteralPath (Join-Path $target 'agentvn-editor.exe')).VersionInfo.ProductVersion -ne '1.7.1'){throw 'Actual installed old version required'}
                $before=Get-Content -LiteralPath (Join-Path $phase 'before-upgrade-snapshot.json') -Raw -Encoding UTF8|ConvertFrom-Json
                $ui=Get-Content -LiteralPath (Join-Path $phase 'old-ui-data-created.json') -Raw -Encoding UTF8|ConvertFrom-Json
                if($before.status -ne 'PASS' -or $ui.status -ne 'PASS'){throw 'Actual old UI/save/disk snapshot required'}
            }
            $result.version=$version;$result.package=$package[0].path;$result.packageSha256=$package[0].sha256
            $result.arguments=@('/S',('/D='+$target))
            $installer=Start-Process -FilePath $package[0].path -ArgumentList $result.arguments -WindowStyle Hidden -PassThru
            $result.installerPid=$installer.Id;Save $file $result
            $installer.WaitForExit();$result.exitCode=$installer.ExitCode
            if($installer.ExitCode -ne 0){throw "NSIS exit $($installer.ExitCode)"}
            $exe=Join-Path $target 'agentvn-editor.exe'
            $result.actualVersion=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
            $result.executableSha256=Sha $exe
            if($result.actualVersion -ne $version){throw 'Actual NSIS installation path/version differs'}
            if($version -eq '1.9.9' -and $result.executableSha256 -ne 'f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c'){throw 'Actual NSIS candidate executable hash differs'}
        }elseif($Action -eq 'Uninstall'){
            $uninstaller=Join-Path $target 'uninstall.exe'
            if(!(Test-Path -LiteralPath $uninstaller)){throw 'Actual tested NSIS uninstaller missing'}
            $result.uninstallerSha256=Sha $uninstaller
            $result.arguments=@('/S',('_?='+$target))
            $process=Start-Process -FilePath $uninstaller -ArgumentList $result.arguments -WindowStyle Hidden -PassThru
            $result.installerPid=$process.Id;Save $file $result
            $process.WaitForExit();$result.exitCode=$process.ExitCode
            if($process.ExitCode -ne 0 -or (Test-Path -LiteralPath (Join-Path $target 'agentvn-editor.exe'))){throw 'Test NSIS uninstall incomplete'}
        }else{
            if(!(Test-Path -LiteralPath (Join-Path $run 'Uninstall.json'))){throw 'Uninstall tested NSIS before restoring registration'}
            $same=(Test-Path -LiteralPath $frozen)
            if($same){
                foreach($row in $backup.files){
                    if(!(Test-Path -LiteralPath (Join-Path $frozen $row.relative)) -or (Sha (Join-Path $frozen $row.relative)) -ne $row.sha256){$same=$false;break}
                }
                if($same -and @(Get-ChildItem -LiteralPath $frozen -Recurse -File -Force).Count -ne $backup.fileCount){$same=$false}
            }
            if(!$same){
                foreach($row in $backup.files){if((Sha (Join-Path $backupRoot ('installation\'+$row.relative))) -ne $row.sha256){throw 'Original backup changed'}}
                NoLinks $frozen
                $retained=Join-Path $work 'changed-original-installation-retained'
                if(Test-Path -LiteralPath $retained){throw 'Recovery collision'}
                if(Test-Path -LiteralPath $frozen){[IO.Directory]::Move($frozen,$retained)}
                $null=New-Item -ItemType Directory -Path $frozen
                foreach($row in $backup.files){
                    $destination=Join-Path $frozen $row.relative
                    $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force
                    Copy-Item -LiteralPath (Join-Path $backupRoot ('installation\'+$row.relative)) -Destination $destination
                    if((Sha $destination) -ne $row.sha256){throw 'Restored original file differs'}
                }
            }
            $result.originalInstallationWasUnchanged=$same;$result.restoredFileCount=$backup.fileCount
            foreach($row in $checkpoint.registry){
                if(!$row.exists -or $row.path -notin @('HKCU:\Software\agentvn\AgentVN Editor',
                    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor')){throw 'Unexpected original registration boundary'}
                $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($row.path.Substring(6))
                try{
                    foreach($name in $key.GetValueNames()){
                        if($name -notin @($row.values|ForEach-Object {$_.name})){throw 'Unexpected registration value; do not erase'}
                    }
                    foreach($value in $row.values){$key.SetValue($value.name,$value.value,[Microsoft.Win32.RegistryValueKind]$value.kind)}
                }finally{$key.Dispose()}
            }
            foreach($row in $checkpoint.shortcuts){
                if((Sha $row.backup) -ne $row.sha256){throw 'Shortcut backup changed'}
                Copy-Item -LiteralPath $row.backup -Destination $row.path -Force
                if((Sha $row.path) -ne $row.sha256){throw 'Shortcut restore differs'}
            }
            $result.registryAfter=@(RegistrySnapshot)
        }
    }
    $result.registrationsAfter=@(Registrations);$result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{$result.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save $file $result}
Write-Output ([pscustomobject]$result|Select-Object status,operation,version,actualVersion,exitCode,installRoot,error|ConvertTo-Json)
