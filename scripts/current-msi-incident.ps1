param(
    [ValidateSet('SelfTest','Checkpoint','HoldLegacy','RestoreLegacy','Repair','Uninstall','RestoreShortcuts','Elevated')]
    [string]$Action='SelfTest',
    [ValidateSet('Repair','Uninstall','RestoreShortcuts')][string]$Operation='Repair'
)
# QA only: contain the already recorded F -> D installation incident.
# Does not modify installer properties, remove remembered paths, or repair product code.
$ErrorActionPreference='Stop'
$run='F:\AgentVN\QA\Current-MSI-Upgrade-20261021-01\session-01'
$checkpointRoot='F:\AgentVN\Checkpoints\Current-MSI-Incident-20261021-01'
$install='D:\agentvntest\AgentVN Editor'
$legacy=Join-Path $install 'data'
$held=Join-Path $install 'data.qa-held-current-msi-20261021'
$product='{C1223FB9-5E27-4874-A3F6-B9CAB5F8585F}'
$exeSha='c16f1a71cf3e152456560e39a5d28b7c95ebbabc44d8bd50e69c9a3d9ea63f84'
function Read($file){Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json}
function Save($file,$value){
    if(Test-Path -LiteralPath $file){throw 'Never overwrite an incident receipt'}
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 16),[Text.UTF8Encoding]::new($false))
}
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Boundary($path,$expected){
    if([IO.Path]::GetFullPath($path) -cne $expected){throw 'Exact incident path required'}
}
function Idle {
    if(@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\.exe$' -or
        ($_.Name -ceq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')
    }).Count){throw 'AgentVN process still active; do not change installation or profiles'}
}
function Files($directory){
    $entries=@(Get-Item -LiteralPath $directory -Force)+@(Get-ChildItem -LiteralPath $directory -Recurse -Force)
    if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){
        throw 'Internal link: do not traverse or mutate'
    }
    @(foreach($file in $entries|Where-Object {!$_.PSIsContainer}){
        @{relative=$file.FullName.Substring($directory.Length+1);bytes=$file.Length;sha256=(Sha $file.FullName)}
    })
}
function Verify($directory,$expected){
    $actual=@(Files $directory)
    if($actual.Count -ne @($expected).Count){throw "File count mismatch in $directory"}
    $lookup=@{};foreach($file in $actual){$lookup[$file.relative]=$file}
    foreach($file in $expected){
        $other=$lookup[$file.relative]
        if(!$other -or $other.bytes -ne $file.bytes -or $other.sha256 -cne $file.sha256){throw 'Exact bytes differ'}
    }
}
function Registration {
    @(Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|
        Where-Object {$_.DisplayName -match 'AgentVN' -and $_.WindowsInstaller -eq 1})
}
function OwnedRegistration {
    $items=@(Registration)
    if($items.Count -ne 1 -or $items[0].PSChildName -cne $product -or
        $items[0].DisplayVersion -cne '1.9.16' -or
        $items[0].InstallLocation.TrimEnd('\') -cne $install){throw 'Not the exact incident-owned MSI'}
    $items[0]
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
Boundary $held 'D:\agentvntest\AgentVN Editor\data.qa-held-current-msi-20261021'
if($Action -ceq 'SelfTest'){
    foreach($candidate in @('D:\','D:\AgentVN','D:\agentvntest',($install+'\nested'),($install+'\..'),
        'F:\AgentVN','C:\Users\1','D:\agentvntest\Other Editor')){
        $accepted=$true;try{Boundary $candidate $install}catch{$accepted=$false}
        if($accepted){throw 'Incident boundary accepted unrelated target'}
    }
    Boundary $install $install;Boundary $legacy $legacy;Boundary $held $held
    'PASS: eleven exact incident boundaries; no mutation';exit
}
Idle
$incident=Read (Join-Path $run 'clean\en-US\Install-1.9.16-01.json')
if($incident.status -cne 'FAILED' -or $incident.exitCode -ne 0 -or !$incident.isElevated -or
    $incident.error -cne 'Actual MSI identity or target mismatch'){throw 'Original actual incident required'}
if($Action -ceq 'Checkpoint'){
    $null=OwnedRegistration
    if((Sha (Join-Path $install 'agentvn-editor.exe')) -cne $exeSha){throw 'Unexpected D installed bytes'}
    if(Test-Path -LiteralPath $checkpointRoot){throw 'Fresh complete D checkpoint required'}
    if((Get-PSDrive F).Free -lt 2GB){throw 'Insufficient checkpoint space'}
    $files=@(Files $install)
    $null=New-Item -ItemType Directory -Path $checkpointRoot
    $result=[ordered]@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o')
        source=$install;sourceStage='Post-incident 1.9.16, not a pre-incident reconstruction'
        files=$files;shortcuts=@(Links);error=$null}
    try{
        foreach($file in $files){
            $destination=Join-Path $checkpointRoot ('installation\'+$file.relative)
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force
            Copy-Item -LiteralPath (Join-Path $install $file.relative) -Destination $destination
        }
        Verify (Join-Path $checkpointRoot 'installation') $files
        Verify $install $files
        foreach($link in $result.shortcuts){
            $destination=Join-Path $checkpointRoot ('shortcuts\'+[array]::IndexOf($result.shortcuts,$link)+'.lnk')
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force
            Copy-Item -LiteralPath $link.path -Destination $destination
            if((Sha $destination) -cne $link.sha256){throw 'Incident shortcut backup mismatch'}
            $link.backup=$destination
        }
        $result.status='PASS';$result.fileCount=$files.Count
        $result.totalBytes=[long](($files|ForEach-Object {$_.bytes}|Measure-Object -Sum).Sum)
    }catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
    finally{Save (Join-Path $checkpointRoot 'checkpoint.json') $result}
    [pscustomobject]$result|Select-Object status,fileCount,totalBytes|ConvertTo-Json;exit
}
$checkpoint=Read (Join-Path $checkpointRoot 'checkpoint.json')
if($checkpoint.status -cne 'PASS' -or $checkpoint.source -cne $install -or !$checkpoint.fileCount){
    throw 'Verified full D checkpoint required'
}
if($Action -in @('HoldLegacy','RestoreLegacy')){
    $destination=Join-Path $run ($Action+'.json')
    if(Test-Path -LiteralPath $destination){throw 'Do not repeat a legacy stage'}
    $expected=@($checkpoint.files|Where-Object {$_.relative.StartsWith('data\', [StringComparison]::Ordinal)})
    $expected=@(foreach($file in $expected){@{relative=$file.relative.Substring(5);sha256=$file.sha256;bytes=$file.bytes}})
    if(!$expected.Count){throw 'Historical data evidence missing'}
    $result=[ordered]@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o')
        source=$legacy;held=$held;files=$expected;deletedUserFiles=0;error=$null}
    try{
        if($Action -ceq 'HoldLegacy'){
            if(Test-Path -LiteralPath $held){throw 'Legacy hold collision'}
            Verify $legacy $expected
            [IO.Directory]::Move($legacy,$held)
            Verify $held $expected
        }else{
            if(Test-Path -LiteralPath $legacy){throw 'Unexpected install-local data; inspect, do not overwrite'}
            Verify $held $expected
            [IO.Directory]::Move($held,$legacy)
            Verify $legacy $expected
        }
        $result.status='PASS'
    }catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
    finally{Save $destination $result}
    [pscustomobject]$result|Select-Object status,source,held,deletedUserFiles|ConvertTo-Json;exit
}
$phase=if($Action -ceq 'Elevated'){$Operation}else{$Action}
$destination=Join-Path $run ('incident-'+$phase+'.json')
if(Test-Path -LiteralPath $destination){throw 'Do not repeat an incident installer or restoration'}
$elevated=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($Action -cne 'Elevated'){
    if($elevated){throw 'Non-admin parent required for real elevation'}
    $wrapper=$destination -replace '\.json$','-elevation.json'
    if(Test-Path -LiteralPath $wrapper){throw 'Inspect existing elevation instead of repeating'}
    $result=[ordered]@{status='RUNNING';parentElevated=$false;at=(Get-Date).ToUniversalTime().ToString('o');error=$null}
    try{
        $helper=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
            '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),
            '-Action','Elevated','-Operation',$phase)
        $result.helperPid=$helper.Id;$result.helperCreated=$helper.StartTime.ToUniversalTime().ToString('o')
        $helper.WaitForExit();$result.exitCode=$helper.ExitCode
        $child=Read $destination
        if($child.status -cne 'PASS'){throw 'Incident helper did not pass'}
        $result.status='PASS'
    }catch{$result.status='BLOCKED';$result.error=$_.Exception.Message;throw}
    finally{Save $wrapper $result}
    [pscustomobject]$child|Select-Object status,phase,isElevated,exitCode|ConvertTo-Json;exit
}
if(!$elevated){throw 'Real administrator token required'}
$result=[ordered]@{status='RUNNING';phase=$phase;at=(Get-Date).ToUniversalTime().ToString('o')
    isElevated=$true;helperPid=$PID;error=$null}
try{
    Verify (Join-Path $checkpointRoot 'installation') $checkpoint.files
    if($phase -ceq 'RestoreShortcuts'){
        if(@(Registration).Count){throw 'Uninstall owned MSI before restoring original shortcuts'}
        $original=Read 'F:\AgentVN\Checkpoints\Current-MSI-Upgrade-20261021-01\checkpoint-verified-02.json'
        $result.restored=@();$result.retained=@()
        foreach($link in $original.shortcuts){
            if((Sha $link.backup) -cne $link.sha256){throw 'Pre-install shortcut backup changed'}
            $current=@(Links|Where-Object {$_.path -ceq $link.path})
            if($current.Count -and $current[0].sha256 -cne $link.sha256 -and
                $current[0].target -cne (Join-Path $install 'agentvn-editor.exe')){
                throw 'Unknown shortcut change: do not overwrite'
            }
            Copy-Item -LiteralPath $link.backup -Destination $link.path -Force
            if((Sha $link.path) -cne $link.sha256){throw 'Original shortcut restoration differs'}
            $result.restored+=@{path=$link.path;sha256=$link.sha256}
        }
        foreach($link in @(Links|Where-Object {$_.path -cnotin @($original.shortcuts.path)})){
            $owned=@($checkpoint.shortcuts|Where-Object {$_.path -ceq $link.path -and $_.sha256 -ceq $link.sha256})
            if($owned.Count -ne 1 -or $link.target -cne (Join-Path $install 'agentvn-editor.exe')){
                throw 'Unknown new shortcut: do not remove'
            }
            $retained=Join-Path $run ('retained-incident-shortcuts\'+$result.retained.Count+'.lnk')
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($retained)) -Force
            Move-Item -LiteralPath $link.path -Destination $retained
            $result.retained+=@{source=$link.path;retained=$retained;sha256=(Sha $retained)}
        }
    }else{
        $null=OwnedRegistration
        if((Sha $incident.package.path) -cne $incident.package.sha256){throw 'Source MSI changed'}
        if((Read (Join-Path $run 'HoldLegacy.json')).status -cne 'PASS' -or !(Test-Path -LiteralPath $held)){
            throw 'Original install-local data must remain held'
        }
        $verb=if($phase -ceq 'Repair'){'/fa'}else{'/x'}
        $log=$destination -replace '\.json$','.log'
        $result.arguments=@($verb,$product,'/qn','/norestart','/L*V',('"'+$log+'"'))
        $result.log=$log;$result.productCode=$product;$result.package=$incident.package
        $process=Start-Process msiexec.exe -ArgumentList $result.arguments -WindowStyle Hidden -PassThru
        $result.installerPid=$process.Id;$result.installerCreated=$process.StartTime.ToUniversalTime().ToString('o')
        $process.WaitForExit();$result.exitCode=$process.ExitCode
        if($process.ExitCode -notin @(0,3010)){throw 'Actual incident MSI operation failed'}
        if($phase -ceq 'Repair'){
            $null=OwnedRegistration
            if((Sha (Join-Path $install 'agentvn-editor.exe')) -cne $exeSha -or
                (Read (Join-Path $install 'build-versions.json')).editorVersion -cne '1.9.16'){
                throw 'Repaired payload/version differs'
            }
        }elseif(@(Registration).Count -or (Test-Path -LiteralPath (Join-Path $install 'agentvn-editor.exe'))){
            throw 'Owned MSI uninstall incomplete'
        }
        $legacyFiles=@(foreach($file in $checkpoint.files|Where-Object {$_.relative.StartsWith('data\')}){
            @{relative=$file.relative.Substring(5);sha256=$file.sha256;bytes=$file.bytes}
        })
        Verify $held $legacyFiles
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{Save $destination $result}
