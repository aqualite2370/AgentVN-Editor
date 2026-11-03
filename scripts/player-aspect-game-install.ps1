param(
    [ValidateSet('Install','Uninstall','Cleanup')][string]$Action,
    [Parameter(Mandatory=$true)][string]$RunDirectory,
    [Parameter(Mandatory=$true)][string]$BuildReport
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$qa='F:\AgentVN\QA\Windows-Package-20261021-01'
$run=[IO.Path]::GetFullPath($RunDirectory)
if([IO.Path]::GetDirectoryName($run) -cne $qa -or [IO.Path]::GetFileName($run) -cnotmatch '^runtime-\d{2}$'){
    throw 'Exact standalone QA child required'
}
if([IO.Path]::GetFullPath($BuildReport) -cne ($qa+'\editor-20\report.json')){throw 'Exact current build required'}
function Read($file){Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($file){
    $stream=[IO.File]::OpenRead($file);$hasher=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
    finally{$hasher.Dispose();$stream.Dispose()}
}
function Save($name,$value){
    $file=Join-Path $run $name
    if(Test-Path -LiteralPath $file){throw "Evidence collision: $file"}
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 18),[Text.UTF8Encoding]::new($false))
}
function Describe($file){@{path=$file;sha256=(Sha $file);bytes=(Get-Item -LiteralPath $file).Length}}
$source=Read $BuildReport
if($source.status -cne 'PASS' -or $source.cleanup -cne 'PASS' -or $source.builds -ne 1 -or
    (Sha $source.installer.path) -cne $source.installer.sha256){throw 'Actual complete build and bytes required'}
$product='AgentVN Aspect QA1936'
$client=Join-Path $run 'installed-client'
$exe=Join-Path $client 'agentvn-player.exe'
$uninstaller=Join-Path $client 'uninstall.exe'
$keys=@(('Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$product),('Software\agentvn\'+$product))
$shortcuts=@((Join-Path ([Environment]::GetFolderPath('Desktop')) ($product+'.lnk')),
    (Join-Path ([Environment]::GetFolderPath('Programs')) ($product+'.lnk')))
function RegistrySnapshot {
    @(foreach($hive in @('CurrentUser','LocalMachine')){foreach($view in @('Registry32','Registry64')){
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]$hive,[Microsoft.Win32.RegistryView]$view)
        try{foreach($key in $keys){
            $opened=$base.OpenSubKey($key)
            try{
                $values=@()
                if($opened){foreach($name in $opened.GetValueNames()){$values+=@{name=$name;value=$opened.GetValue($name)}}}
                @{hive=$hive;view=$view;key=$key;exists=($null -ne $opened);values=$values}
            }finally{if($opened){$opened.Dispose()}}
        }}finally{$base.Dispose()}
    }})
}
function Shortcut($file){
    if(!(Test-Path -LiteralPath $file)){return @{path=$file;exists=$false}}
    $shell=New-Object -ComObject WScript.Shell
    try{$link=$shell.CreateShortcut($file);@{path=$file;exists=$true;target=$link.TargetPath;arguments=$link.Arguments}}
    finally{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)}
}
function AssertStopped {
    if(@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -eq 'agentvn-player.exe' -or
        ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($run+'\',[StringComparison]::OrdinalIgnoreCase))
    }).Count){throw 'Runtime/installer still live; no installer mutation'}
}
function RunInstaller($file,$arguments,$label){
    $process=Start-Process -FilePath $file -ArgumentList $arguments -WindowStyle Hidden -PassThru
    $identity=Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
    Save ($label+'-process.json') @{pid=$process.Id;file=$file;arguments=$arguments;
        created=$(if($identity){$identity.CreationDate.ToUniversalTime().ToString('o')}else{$null})}
    $deadline=(Get-Date).AddSeconds(120)
    while(!$process.WaitForExit(500)){if((Get-Date) -gt $deadline){throw 'Installer still running; do not restart'}}
    $process.WaitForExit()
    if($process.ExitCode -ne 0){throw "Installer exit $($process.ExitCode)"}
    @{pid=$process.Id;exitCode=$process.ExitCode;at=(Get-Date).ToUniversalTime().ToString('o')}
}
AssertStopped
if($Action -eq 'Install'){
    $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Ordinary user acceptance required'}
    if(Test-Path -LiteralPath $client){throw 'Fresh install directory required'}
    $before=@(RegistrySnapshot)
    if(@($before|Where-Object exists).Count){throw 'Existing product registration protected; refuse collision'}
    foreach($file in $shortcuts){if(Test-Path -LiteralPath $file){throw 'Existing shortcut protected'}}
    $protection=Read (Join-Path $run 'profile-protection.json')
    if(@($protection.records).Count -ne 2){throw 'Profile protection required before installation'}
    foreach($r in $protection.records){if($r.existed -and !(Test-Path -LiteralPath $r.held)){throw 'Profile hold missing'}}
    Save 'setup-protection.json' @{product=$product;client=$client;registry=$before;shortcuts=$shortcuts;
        source=@{path=$BuildReport;sha256=(Sha $BuildReport)}}
    $receipt=@{status='RUNNING';startedAt=(Get-Date).ToUniversalTime().ToString('o');client=$client;
        installer=$source.installer;method='ACTUAL_NSIS_S_INSTALL_NOT_EXTRACTION';isElevated=$false}
    try{
        $receipt.process=RunInstaller $source.installer.path @('/S',('/D='+$client)) 'install'
        $receipt.executable=Describe $exe;$receipt.uninstaller=Describe $uninstaller
        $receipt.pe=(Get-Item -LiteralPath $exe).VersionInfo|Select-Object ProductName,FileVersion
        if($receipt.pe.ProductName -cne $product -or $receipt.pe.FileVersion -cne '1.0.0'){throw 'Installed PE identity differs'}
        $receipt.resources=@()
        foreach($resource in $source.artifacts|Where-Object {$_.path.StartsWith($source.embedded.directory+'\',[StringComparison]::OrdinalIgnoreCase)}){
            $file=Join-Path $client ('embedded-cartridge\'+$resource.path.Substring($source.embedded.directory.Length+1))
            if((Sha $file) -cne $resource.sha256){throw 'Installed resource bytes differ'}
            $receipt.resources+=Describe $file
        }
        if($receipt.resources.Count -ne 6){throw 'Complete embedded resource set required'}
        $receipt.registry=@(RegistrySnapshot)
        $registered=@($receipt.registry|Where-Object {$_.exists -and $_.key -ceq $keys[0]})
        if(!$registered.Count -or @($registered|Where-Object {$_.hive -cne 'CurrentUser'}).Count){throw 'User uninstall registration missing'}
        foreach($key in $registered){
            if(@($key.values|Where-Object {$_.name -ceq 'DisplayVersion' -and $_.value -ceq '1.0.0'}).Count -ne 1){throw 'Registry version differs'}
            if(@($key.values|Where-Object {$_.name -ceq 'UninstallString' -and $_.value.Trim('"') -ceq $uninstaller}).Count -ne 1){throw 'Uninstall target differs'}
        }
        $receipt.shortcuts=@($shortcuts|ForEach-Object {Shortcut $_})
        if(@($receipt.shortcuts|Where-Object {!$_.exists -or $_.target -cne $exe -or $_.arguments}).Count){throw 'Default shortcuts differ'}
        # Preserve actual installed binary evidence before normal uninstall.
        $archive=Join-Path $run 'installed-binary-evidence'
        $null=New-Item -ItemType Directory -Path $archive
        Copy-Item -LiteralPath $exe -Destination (Join-Path $archive 'agentvn-player.exe')
        Copy-Item -LiteralPath $uninstaller -Destination (Join-Path $archive 'uninstall.exe')
        $receipt.archivedExecutable=Describe (Join-Path $archive 'agentvn-player.exe')
        if($receipt.archivedExecutable.sha256 -cne $receipt.executable.sha256){throw 'Archived installed bytes differ'}
        $receipt.status='PASS'
    }catch{$receipt.status='FAILED';$receipt.error=$_.Exception.Message;throw}
    finally{$receipt.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save 'installation.json' $receipt}
    'PASS actual ordinary NSIS installation, resources and shortcuts';exit
}
$journal=Read (Join-Path $run 'setup-protection.json')
if($journal.client -cne $client -or $journal.product -cne $product -or
    @($journal.registry|Where-Object exists).Count){throw 'Exact absent-before journal required'}
if($Action -eq 'Uninstall'){
    if(!(Test-Path -LiteralPath $uninstaller)){throw 'Actual owned uninstaller absent'}
    $installed=Read (Join-Path $run 'installation.json')
    if($installed.uninstaller.sha256 -and (Sha $uninstaller) -cne $installed.uninstaller.sha256){throw 'Uninstaller bytes changed'}
    $receipt=@{status='RUNNING';source=(Describe $uninstaller);startedAt=(Get-Date).ToUniversalTime().ToString('o')}
    try{
        $receipt.process=RunInstaller $uninstaller @('/S') 'uninstall'
        $deadline=(Get-Date).AddSeconds(90)
        do{
            $after=@(RegistrySnapshot)
            $done=!(Test-Path -LiteralPath $exe) -and !(Test-Path -LiteralPath $uninstaller) -and
                !@($after|Where-Object {$_.exists -and $_.key -ceq $keys[0]}).Count
            if(!$done){Start-Sleep -Milliseconds 250}
        }while(!$done -and (Get-Date) -lt $deadline)
        $receipt.registry=$after;$receipt.shortcuts=@($shortcuts|ForEach-Object {Shortcut $_})
        if(!$done -or @($receipt.shortcuts|Where-Object exists).Count){throw 'Actual uninstall incomplete'}
        $receipt.status='PASS'
    }catch{$receipt.status='FAILED';$receipt.error=$_.Exception.Message;throw}
    finally{$receipt.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save 'uninstallation.json' $receipt}
    'PASS actual uninstaller removed binaries/registration/shortcuts';exit
}
$removed=@()
foreach($entry in @(RegistrySnapshot)|Where-Object exists){
    if($entry.hive -cne 'CurrentUser' -or $entry.key -cne $keys[1]){throw 'Unknown registration residue protected'}
    foreach($value in $entry.values){
        if($value.name -notin @('','Installer Language') -or ($value.name -ceq '' -and $value.value -cne $client)){
            throw 'Unknown settings residue protected'
        }
    }
    $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]$entry.view)
    try{$base.DeleteSubKeyTree($entry.key,$false)}finally{$base.Dispose()}
    $removed+=@{hive=$entry.hive;view=$entry.view;key=$entry.key}
}
if(@(RegistrySnapshot|Where-Object exists).Count){throw 'QA registry remains'}
foreach($file in $shortcuts){if(Test-Path -LiteralPath $file){throw 'QA shortcut remains'}}
Save 'setup-cleanup.json' @{status='PASS';removedQAOnlyKeys=$removed;deletedUserFiles=0;at=(Get-Date).ToUniversalTime().ToString('o')}
'PASS exact QA registration cleanup'
