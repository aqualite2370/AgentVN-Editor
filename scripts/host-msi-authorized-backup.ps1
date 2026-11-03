param()
$ErrorActionPreference='Stop'
$source='D:\agentvntest\AgentVN Editor'
$backupRoot='F:\AgentVN-QA-HostMSI-AuthorizedBackup-20261018-02'
$utf8=New-Object Text.UTF8Encoding($false)
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Save($name,$value){[IO.File]::WriteAllText((Join-Path $backupRoot $name),($value|ConvertTo-Json -Depth 12),$utf8)}
if(Test-Path -LiteralPath $backupRoot){throw 'Fresh full backup required'}
if([IO.Path]::GetFullPath($source) -ne 'D:\agentvntest\AgentVN Editor'){throw 'Source boundary mismatch'}
$active=@(Get-CimInstance Win32_Process|Where-Object {
    $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
    ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')
})
if($active.Count){throw 'Refuse backup while AgentVN is active'}
$items=@(Get-Item -LiteralPath $source)+@(Get-ChildItem -LiteralPath $source -Recurse -Force)
if(@($items|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Unexpected link in source'}
$bytes=(@($items|Where-Object {!$_.PSIsContainer})|Measure-Object Length -Sum).Sum
if((Get-PSDrive F).Free -lt ($bytes+2GB)){throw 'Insufficient backup space'}
$null=New-Item -ItemType Directory -Path $backupRoot
$result=[ordered]@{status='RUNNING';startedAt=(Get-Date).ToUniversalTime().ToString('o');
    source=$source;backupRoot=$backupRoot;authorization='User explicitly approved full F backup then replaceable MSI test installation';
    limitation='Backup is of current post-incident 1.9.8 state, not reconstruction of pre-incident binaries';
    files=@();directories=@();toolCheckpoint=@();shortcuts=@();error=$null}
Save 'journal.json' $result
try{
    $tree=Join-Path $backupRoot 'installation'
    $null=New-Item -ItemType Directory -Path $tree
    foreach($directory in $items|Where-Object {$_.PSIsContainer -and $_.FullName -ne $source}){
        $relative=$directory.FullName.Substring($source.Length+1)
        $null=New-Item -ItemType Directory -Path (Join-Path $tree $relative) -Force
        $result.directories+=@{relative=$relative;attributes=[string]$directory.Attributes}
    }
    $files=@($items|Where-Object {!$_.PSIsContainer})
    foreach($file in $files){
        $relative=$file.FullName.Substring($source.Length+1)
        $target=Join-Path $tree $relative
        Copy-Item -LiteralPath $file.FullName -Destination $target
        $expected=Sha $file.FullName
        if((Sha $target) -ne $expected){throw "Full backup mismatch: $relative"}
        $result.files+=@{relative=$relative;bytes=$file.Length;sha256=$expected;lastWriteUtc=$file.LastWriteTimeUtc.ToString('o')}
    }
    $after=@(Get-ChildItem -LiteralPath $source -Recurse -Force -File)
    if($after.Count -ne $files.Count){throw 'Source file count changed while backing up'}
    foreach($file in $result.files){
        if((Sha (Join-Path $source $file.relative)) -ne $file.sha256){throw 'Source changed during backup'}
    }
    $result.registrations=@(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|
        Where-Object {$_.DisplayName -match 'AgentVN'}|
        Select-Object DisplayName,DisplayVersion,InstallLocation,WindowsInstaller,PSChildName,PSPath)
    $shell=New-Object -ComObject WScript.Shell
    foreach($folder in @('C:\Users\1\Desktop','C:\Users\Public\Desktop',
        'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs','C:\ProgramData\Microsoft\Windows\Start Menu\Programs')){
        foreach($file in Get-ChildItem -LiteralPath $folder -Filter '*AgentVN*.lnk' -File -ErrorAction SilentlyContinue){
            $target=Join-Path $backupRoot ('shortcuts\'+$result.shortcuts.Count+'.lnk')
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
            Copy-Item -LiteralPath $file.FullName -Destination $target
            if((Sha $target) -ne (Sha $file.FullName)){throw 'Shortcut backup mismatch'}
            $result.shortcuts+=@{path=$file.FullName;backup=$target;sha256=(Sha $target);target=$shell.CreateShortcut($file.FullName).TargetPath}
        }
    }
    foreach($relative in @('scripts\installed-preview-session.ps1','scripts\host-msi-session.ps1',
        'scripts\host-msi-launch.ps1','plans\ACTIVE_TASKS.md','plans\FULL_REGRESSION_20261017.md')){
        $original=Join-Path 'D:\AgentVN' $relative
        $target=Join-Path $backupRoot ('tool-checkpoint\'+$relative)
        $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
        Copy-Item -LiteralPath $original -Destination $target
        if((Sha $original) -ne (Sha $target)){throw 'Tool checkpoint mismatch'}
        $result.toolCheckpoint+=@{relative=$relative;sha256=(Sha $target)}
    }
    $result.totalBytes=$bytes;$result.fileCount=$result.files.Count
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{$result.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save 'backup.json' $result}
Write-Output "PASS: full installation backup, $($result.fileCount) files / $bytes bytes, source and backup SHA verified"
