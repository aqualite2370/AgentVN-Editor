param(
    [ValidateSet('Backup','Install','Uninstall','HoldLegacy','RestoreLegacy','RestoreInstallation','Elevated')][string]$Action='Backup',
    [ValidateSet('Install','Uninstall','RestoreInstallation')][string]$Operation='Install',
    [ValidateSet('clean','cross-generation')][string]$Scenario='clean',
    [ValidateSet('en-US','zh-CN')][string]$Language='en-US',
    [ValidateSet('1.7.1','1.9.9')][string]$Version='1.9.9',
    [ValidateRange(1,9)][int]$Attempt=1,
    [ValidateSet('F','D')][string]$InstallBoundary='F',
    [switch]$ResumeRegistryRestoration
)
$ErrorActionPreference='Stop'
$reportRoot='D:\AgentVN\output\host-msi-next-20261018-01'
$workRoot='F:\AgentVN-QA-HostMSINext-20261018-01'
$backupRoot='F:\AgentVN-QA-HostMSINext-Backup-20261018-01'
$frozenRoot='F:\AgentVN-QA-HostUpgrade-20261018-02\installed-editor'
$installRoot=if($InstallBoundary -eq 'D'){'D:\agentvntest\AgentVN Editor'}else{$frozenRoot}
if($ResumeRegistryRestoration -and ($InstallBoundary -ne 'F' -or $Attempt -lt 2 -or
    ($Action -ne 'RestoreInstallation' -and !($Action -eq 'Elevated' -and $Operation -eq 'RestoreInstallation')))){
    throw 'Registry restoration resume is restricted to a fresh F restoration attempt'
}
if($Action -eq 'Backup' -and $InstallBoundary -ne 'F'){throw 'F backup only'}
$utf8=New-Object Text.UTF8Encoding($false)
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Save($file,$data){[IO.File]::WriteAllText($file,($data|ConvertTo-Json -Depth 18),$utf8)}
function Idle {
    $active=@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')
    })
    if($active.Count){throw 'AgentVN processes active'}
}
function Registrations {
    @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|
        Where-Object {$_.DisplayName -match 'AgentVN'}|
        Select-Object DisplayName,DisplayVersion,InstallLocation,WindowsInstaller,PSChildName,PSPath)
}
function Values($path){
    $key=Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
    if($key){@($key.GetValueNames()|ForEach-Object {@{name=$_;kind=[string]$key.GetValueKind($_);value=$key.GetValue($_)}})}
    else{@()}
}
function RegistrySnapshot {
    @('HKCU:\Software\agentvn\AgentVN Editor',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor')|ForEach-Object {
        @{path=$_;exists=(Test-Path -LiteralPath $_);values=@(Values $_)}
    }
}
function NoLinks($root){
    if([IO.Path]::GetFullPath($root) -ne $installRoot){throw 'Exact authorized root mismatch'}
    foreach($entry in @((Get-Item -LiteralPath $root))+@(Get-ChildItem -LiteralPath $root -Recurse -Force)){
        if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Unexpected link in installation'}
    }
}
Idle
if($Action -eq 'Backup'){
    if(Test-Path -LiteralPath $backupRoot){throw 'Fresh backup required'}
    NoLinks $installRoot
    $files=@(Get-ChildItem -LiteralPath $installRoot -Recurse -File -Force)
    $bytes=($files|Measure-Object Length -Sum).Sum
    if((Get-PSDrive F).Free -lt ($bytes*3+2GB)){throw 'Insufficient F space'}
    if(@(Registrations|Where-Object {$_.WindowsInstaller -eq 1}).Count){throw 'Unexpected MSI registration'}
    $null=New-Item -ItemType Directory -Path $backupRoot
    $result=@{status='RUNNING';startedAt=(Get-Date).ToUniversalTime().ToString('o');source=$installRoot;
        backupRoot=$backupRoot;authorization='User approved current direction: full backup of F QA installation before replaceable MSI tests';
        files=@();shortcuts=@();registry=@(RegistrySnapshot);registrations=@(Registrations);
        toolCheckpoint=@();error=$null}
    Save (Join-Path $backupRoot 'journal.json') $result
    try{
        foreach($file in $files){
            $relative=$file.FullName.Substring($installRoot.Length+1)
            $target=Join-Path $backupRoot ('installation\'+$relative)
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
            Copy-Item -LiteralPath $file.FullName -Destination $target
            $sha=Sha $file.FullName
            if((Sha $target) -ne $sha){throw 'Installation backup SHA mismatch'}
            $result.files+=@{relative=$relative;bytes=$file.Length;sha256=$sha}
        }
        foreach($file in $result.files){if((Sha (Join-Path $installRoot $file.relative)) -ne $file.sha256){throw 'Source changed'}}
        if(@(Get-ChildItem -LiteralPath $installRoot -Recurse -File -Force).Count -ne $files.Count){throw 'File count changed'}
        $shell=New-Object -ComObject WScript.Shell
        foreach($folder in @('C:\Users\1\Desktop','C:\Users\Public\Desktop',
            'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs','C:\ProgramData\Microsoft\Windows\Start Menu\Programs')){
            foreach($file in Get-ChildItem -LiteralPath $folder -Filter '*AgentVN*.lnk' -File -ErrorAction SilentlyContinue){
                $target=Join-Path $backupRoot ('shortcuts\'+$result.shortcuts.Count+'.lnk')
                $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
                Copy-Item -LiteralPath $file.FullName -Destination $target
                if((Sha $target) -ne (Sha $file.FullName)){throw 'Shortcut backup mismatch'}
                $result.shortcuts+=@{path=$file.FullName;backup=$target;sha256=(Sha $target);
                    target=$shell.CreateShortcut($file.FullName).TargetPath}
            }
        }
        foreach($relative in @('scripts\installed-preview-session.ps1','scripts\host-msi-launch.ps1',
            'scripts\host-msi-next.ps1','scripts\host-msi-installed-resource-audit.cjs','plans\ACTIVE_TASKS.md','plans\FULL_REGRESSION_20261017.md')){
            $source=Join-Path 'D:\AgentVN' $relative
            $target=Join-Path $backupRoot ('tools\'+$relative)
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
            Copy-Item -LiteralPath $source -Destination $target
            if((Sha $source) -ne (Sha $target)){throw 'Tool checkpoint mismatch'}
            $result.toolCheckpoint+=@{relative=$relative;sha256=(Sha $target)}
        }
        $result.fileCount=$result.files.Count;$result.totalBytes=$bytes;$result.status='PASS'
    }catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
    finally{$result.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save (Join-Path $backupRoot 'backup.json') $result}
    Write-Output "PASS: $($result.fileCount) installation files / $bytes bytes backed up and SHA checked"
    exit
}
$backup=Get-Content -LiteralPath (Join-Path $backupRoot 'backup.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($backup.status -ne 'PASS' -or $backup.source -ne $frozenRoot -or !$backup.fileCount){throw 'Full F backup required'}
$prep=Get-Content -LiteralPath (Join-Path $reportRoot 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($prep.status -ne 'PASS' -or $prep.verifiedOriginalFiles -ne 55){throw 'Four profile protection required'}
foreach($row in $prep.profiles){if(!(Test-Path -LiteralPath $row.held)){throw 'Original profiles not held'}}
if($InstallBoundary -eq 'D' -or $Action -in @('HoldLegacy','RestoreLegacy')){
    $dBackup=Get-Content -LiteralPath 'F:\AgentVN-QA-HostMSI-AuthorizedBackup-20261018-02\backup.json' -Raw -Encoding UTF8|ConvertFrom-Json
    if($dBackup.status -ne 'PASS' -or $dBackup.source -ne 'D:\agentvntest\AgentVN Editor' -or $dBackup.fileCount -ne 9073){
        throw 'Previously authorized D full backup required'}
}
if($Action -in @('HoldLegacy','RestoreLegacy')){
    $original='D:\agentvntest\AgentVN Editor\data'
    $held=Join-Path $workRoot 'original-d-legacy-data'
    $receipt=Join-Path $reportRoot ($Action+'.json')
    if(Test-Path -LiteralPath $receipt){throw 'Legacy evidence collision'}
    $files=@($dBackup.files|Where-Object {$_.relative.StartsWith('data\')})
    if(!$files.Count){throw 'No legacy backup'}
    $from=if($Action -eq 'HoldLegacy'){$original}else{$held}
    $to=if($Action -eq 'HoldLegacy'){$held}else{$original}
    if(!(Test-Path -LiteralPath $from) -or (Test-Path -LiteralPath $to)){throw 'Legacy move collision'}
    if($Action -eq 'RestoreLegacy' -and @(Registrations|Where-Object {$_.WindowsInstaller -eq 1}).Count){throw 'Uninstall MSI first'}
    $entries=@((Get-Item -LiteralPath $from))+@(Get-ChildItem -LiteralPath $from -Recurse -Force)
    if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Linked legacy data'}
    foreach($file in $files){if((Sha (Join-Path $from $file.relative.Substring(5))) -ne $file.sha256){throw 'Legacy SHA mismatch'}}
    # Exact paths validated above; use native PowerShell end to end across volumes.
    Move-Item -LiteralPath $from -Destination $to
    foreach($file in $files){if((Sha (Join-Path $to $file.relative.Substring(5))) -ne $file.sha256){throw 'Moved legacy SHA mismatch'}}
    Save $receipt @{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');from=$from;to=$to;files=$files;deletedFiles=0}
    Write-Output "PASS: $Action, $($files.Count) legacy SHA checks"
    exit
}
$phase=if($Action -eq 'Elevated'){$Operation}else{$Action}
$phaseRoot=Join-Path $reportRoot ($Scenario+'\'+$Language)
$null=New-Item -ItemType Directory -Path $phaseRoot -Force
$attemptSuffix=if($Attempt -gt 1){'-attempt'+$Attempt.ToString('00')}else{''}
$destination=if($phase -eq 'RestoreInstallation'){Join-Path $reportRoot ('installation-restoration'+$attemptSuffix+'.json')}
    else{Join-Path $phaseRoot ($phase+'-'+$Version+$attemptSuffix+'.json')}
if(Test-Path -LiteralPath $destination){throw 'Evidence collision; no automatic repetition'}
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($Action -ne 'Elevated'){
    if($elevated){throw 'Expected non-admin parent'}
    $wrapper=$destination -replace '\.json$','-elevation.json'
    if(Test-Path -LiteralPath $wrapper){throw 'Elevation evidence collision'}
    $request=@{status='WAITING';parentElevated=$false;startedAt=(Get-Date).ToUniversalTime().ToString('o');error=$null}
    Save $wrapper $request
    try{
        $helperArguments=@(
            '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),
            '-Action','Elevated','-Operation',$phase,'-Scenario',$Scenario,'-Language',$Language,'-Version',$Version,'-Attempt',$Attempt,'-InstallBoundary',$InstallBoundary)
        if($ResumeRegistryRestoration){$helperArguments+='-ResumeRegistryRestoration'}
        $helper=Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList $helperArguments
        $request.helperPid=$helper.Id;Save $wrapper $request
        $helper.WaitForExit();$request.helperExitCode=$helper.ExitCode
        if(!(Test-Path -LiteralPath $destination)){throw 'Missing elevated result'}
        $child=Get-Content -LiteralPath $destination -Raw -Encoding UTF8|ConvertFrom-Json
        if($child.status -ne 'PASS'){throw 'Installer/restoration failed; preserve original evidence'}
        $request.status='PASS'
    }catch{$request.status='BLOCKED';$request.error=$_.Exception.Message;throw}
    finally{$request.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save $wrapper $request}
    Write-Output ($child|Select-Object status,operation,version,exitCode,actualVersion,installRoot,restoredFileCount|ConvertTo-Json)
    exit
}
if(!$elevated){throw 'Real administrator required'}
$result=@{status='RUNNING';operation=$phase;startedAt=(Get-Date).ToUniversalTime().ToString('o');
    isElevated=$true;helperPid=$PID;installRoot=$installRoot;registrationsBefore=@(Registrations);error=$null}
Save $destination $result
try{
    if($phase -eq 'RestoreInstallation'){
        if($InstallBoundary -ne 'F'){throw 'Restore only frozen F installation'}
        if(@(Registrations|Where-Object {$_.WindowsInstaller -eq 1}).Count){throw 'Uninstall test MSI before restoration'}
        foreach($file in $backup.files){
            if((Sha (Join-Path $backupRoot ('installation\'+$file.relative))) -ne $file.sha256){throw 'Independent backup changed'}
        }
        NoLinks $installRoot
        $archive=Join-Path $workRoot 'post-msi-installation-retained'
        if($ResumeRegistryRestoration){
            $previous=Get-Content -LiteralPath (Join-Path $reportRoot 'installation-restoration.json') -Raw -Encoding UTF8|ConvertFrom-Json
            if($previous.status -ne 'FAILED' -or $previous.operation -ne 'RestoreInstallation' -or
                $previous.error -notmatch 'SetValue' -or !(Test-Path -LiteralPath $archive)){
                throw 'Known interrupted registry restoration required'
            }
            foreach($file in $backup.files){
                if((Sha (Join-Path $installRoot $file.relative)) -ne $file.sha256){throw 'Already restored installation differs'}
            }
            if(@(Get-ChildItem -LiteralPath $installRoot -Recurse -File -Force).Count -ne $backup.fileCount){
                throw 'Unexpected file in already restored installation'
            }
            $result.resumeAfter='Original failed read-only registry handle; all restored installation bytes reverified'
        }else{
            if(Test-Path -LiteralPath $archive){throw 'Restoration archive collision'}
            # Same-volume exact-target rename. Retain test remnants; do not delete.
            [IO.Directory]::Move($installRoot,$archive)
            $null=New-Item -ItemType Directory -Path $installRoot
            foreach($file in $backup.files){
                $target=Join-Path $installRoot $file.relative
                $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
                Copy-Item -LiteralPath (Join-Path $backupRoot ('installation\'+$file.relative)) -Destination $target
                if((Sha $target) -ne $file.sha256){throw 'Restored file differs'}
            }
        }
        foreach($row in $backup.registry){
            if(!$row.exists -or $row.path -notin @('HKCU:\Software\agentvn\AgentVN Editor',
                'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor')){
                throw 'Unexpected baseline registry boundary'
            }
            # Get-Item returns a read-only RegistryKey. Open the existing key
            # explicitly writable; do not recreate/clear it with New-Item -Force.
            $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($row.path.Substring(6),$true)
            if(!$key){throw 'Expected existing baseline registry key'}
            try{
                $expected=@($row.values|ForEach-Object {$_.name})
                foreach($name in $key.GetValueNames()){
                    if($name -notin $expected){throw 'Unexpected registry value; do not erase'}
                }
                foreach($value in $row.values){$key.SetValue($value.name,$value.value,[Microsoft.Win32.RegistryValueKind]$value.kind)}
            }finally{
                $key.Dispose()
            }
        }
        foreach($row in $backup.shortcuts){
            Copy-Item -LiteralPath $row.backup -Destination $row.path -Force
            if((Sha $row.path) -ne $row.sha256){throw 'Shortcut restoration differs'}
        }
        $shell=New-Object -ComObject WScript.Shell
        $result.retainedNewShortcuts=@()
        foreach($folder in @('C:\Users\1\Desktop','C:\Users\Public\Desktop',
            'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs','C:\ProgramData\Microsoft\Windows\Start Menu\Programs')){
            foreach($file in Get-ChildItem -LiteralPath $folder -Filter '*AgentVN*.lnk' -File -ErrorAction SilentlyContinue){
                if($file.FullName -notin @($backup.shortcuts|ForEach-Object {$_.path})){
                    $target=$shell.CreateShortcut($file.FullName).TargetPath
                    if($target -notin @((Join-Path $frozenRoot 'agentvn-editor.exe'),'D:\agentvntest\AgentVN Editor\agentvn-editor.exe')){
                        throw 'Unowned new shortcut; do not alter'}
                    $retained=Join-Path $workRoot ('new-shortcuts\'+$result.retainedNewShortcuts.Count+'.lnk')
                    $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($retained)) -Force
                    Move-Item -LiteralPath $file.FullName -Destination $retained
                    $result.retainedNewShortcuts+=@{source=$file.FullName;retained=$retained;target=$target;sha256=(Sha $retained)}
                }
            }
        }
        $result.retainedTestDirectory=$archive;$result.restoredFileCount=$backup.fileCount
        $result.registryAfter=@(RegistrySnapshot);$result.registrationsAfter=@(Registrations)
    }else{
        $samples=Get-Content -LiteralPath 'D:\AgentVN\output\full-regression-upgrade-preflight-20261018-01\report.json' -Raw -Encoding UTF8|ConvertFrom-Json
        $packages=if($Version -eq '1.7.1'){@($samples.editorSamples|Where-Object {$_.recordedVersion -eq $Version -and $_.path.EndsWith('_'+$Language+'.msi')})}
            else{@((Get-Content -LiteralPath 'D:\AgentVN\output\host-msi-20261018-03\preflight.json' -Raw -Encoding UTF8|ConvertFrom-Json).packages|
                Where-Object {$_.expectedVersion -eq $Version -and $_.language -eq $Language})}
        # A one-result `if` expression is scalar in Windows PowerShell 5.1.
        # Normalize it before Count/indexing; no installer runs before this gate.
        $packages=@($packages)
        if($packages.Count -ne 1){throw 'Ambiguous trusted MSI'}
        $package=$packages[0]
        if((Sha $package.path) -ne $package.sha256){throw 'Trusted source hash mismatch'}
        $msi=@($result.registrationsBefore|Where-Object {$_.WindowsInstaller -eq 1})
        if($phase -eq 'Install' -and ($Scenario -eq 'clean' -or $Version -eq '1.7.1') -and $msi.Count){
            throw 'Expected no existing MSI registration'}
        if(@($msi|Where-Object {$_.InstallLocation.TrimEnd('\') -ne $installRoot}).Count){throw 'MSI outside authorized root'}
        $key=Get-Item -LiteralPath 'HKCU:\Software\agentvn\AgentVN Editor'
        foreach($name in @('','InstallDir')){
            $value=$key.GetValue($name)
            if($value -and [IO.Path]::GetFullPath($value).TrimEnd('\') -notin @($frozenRoot,'D:\agentvntest\AgentVN Editor')){
                throw 'Remembered path outside both authorized boundaries'}
        }
        NoLinks $installRoot
        $msiVerb=if($phase -eq 'Uninstall'){'/x'}else{'/i'}
        $log=$destination -replace '\.json$','.log'
        $arguments=@($msiVerb,('"'+$package.path+'"'),'/qn','/norestart',('INSTALLDIR="'+$installRoot+'"'),'/L*V',('"'+$log+'"'))
        $result.package=$package.path;$result.packageSha256=$package.sha256;$result.version=$Version;$result.language=$Language
        $result.scenario=$Scenario;$result.arguments=$arguments;$result.registryBefore=@(RegistrySnapshot)
        $process=Start-Process -FilePath msiexec.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
        $result.installerPid=$process.Id;Save $destination $result
        $process.WaitForExit();$result.exitCode=$process.ExitCode;$result.registrationsAfter=@(Registrations)
        if($process.ExitCode -notin @(0,3010)){throw "Windows Installer exit $($process.ExitCode)"}
        $msi=@($result.registrationsAfter|Where-Object {$_.WindowsInstaller -eq 1})
        if($phase -eq 'Uninstall'){
            if($msi.Count -or (Test-Path -LiteralPath (Join-Path $installRoot 'agentvn-editor.exe'))){throw 'MSI uninstall incomplete'}
        }else{
            if($msi.Count -ne 1 -or $msi[0].InstallLocation.TrimEnd('\') -ne $installRoot -or $msi[0].DisplayVersion -ne $Version){throw 'Actual MSI identity/path mismatch'}
            $exe=Join-Path $installRoot 'agentvn-editor.exe'
            $result.actualVersion=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
            $result.executableSha256=Sha $exe
            if($result.actualVersion -ne $Version){throw 'Actual executable version differs'}
            if($Version -eq '1.9.9' -and $result.executableSha256 -ne '5c38db3d8569b8f4fcd2553fbbe5e74179f948cfd720e60b315f6968d4752ee9'){throw 'Candidate identity mismatch'}
        }
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{$result.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save $destination $result}
