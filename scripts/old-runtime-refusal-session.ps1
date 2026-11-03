param([ValidateSet('Prepare','Launch','CloseAudit','Restore')][string]$Action='Prepare',
    [ValidateSet('legacy-control','nvl-inheritance','advanced-layout')][string]$Case='legacy-control')
$ErrorActionPreference='Stop'
$reportRoot='D:\AgentVN\output\old-runtime-refusal-20261018-01'
$workspace='F:\AgentVN-QA-OldRuntime-20261018-01'
$fixtures=Get-Content -LiteralPath (Join-Path $reportRoot 'fixtures-02.json') -Raw -Encoding UTF8|ConvertFrom-Json
$utf8=New-Object Text.UTF8Encoding($false)
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Save($file,$data){[IO.File]::WriteAllText($file,($data|ConvertTo-Json -Depth 14),$utf8)}
function PlayerProcesses {
    @(Get-CimInstance Win32_Process|Where-Object {$_.Name -eq 'agentvn-player.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.player')})
}
function Assert-Idle {if(@(PlayerProcesses).Count){throw 'Player/profile WebView still active'}}
function Boundary($row){
    $parent='C:\Users\1\AppData\'+$row.kind
    if([IO.Path]::GetDirectoryName($row.original) -ne $parent -or
        [IO.Path]::GetDirectoryName($row.held) -ne $parent -or
        [IO.Path]::GetFileName($row.original) -ne 'com.agentvn.player' -or
        [IO.Path]::GetFileName($row.held) -ne 'com.agentvn.player.qa-hold-old-runtime-20261018-01'){
        throw 'Unexpected player profile boundary'
    }
}
function Copy-Store($source,$copy,$profileRoot){
    $rows=@()
    if(!(Test-Path -LiteralPath $source)){return $rows}
    foreach($file in (Get-ChildItem -LiteralPath $source -File -Recurse -Force)){
        if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked player store file'}
        $relative=$file.FullName.Substring($source.Length+1)
        $target=Join-Path $copy $relative
        $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
        Copy-Item -LiteralPath $file.FullName -Destination $target
        $hash=Sha $file.FullName
        if((Sha $target) -ne $hash){throw 'Player backup mismatch'}
        $rows+=@{relative=$file.FullName.Substring($profileRoot.Length+1);backup=$target;sha256=$hash;bytes=$file.Length}
    }
    return $rows
}
if($fixtures.status -ne 'PASS'){throw 'Valid capability fixtures required'}
if((Sha $fixtures.oldExecutable.path) -ne $fixtures.oldExecutable.sha256){throw 'Old executable changed'}
if($Action -eq 'Prepare'){
    Assert-Idle
    $destination=Join-Path $reportRoot 'profile-protection.json'
    if(Test-Path -LiteralPath $destination){throw 'Fresh player protection required'}
    $state=[ordered]@{status='PREPARING';at=(Get-Date).ToUniversalTime().ToString('o');profiles=@();error=$null}
    foreach($kind in @('Roaming','Local')){
        $parent='C:\Users\1\AppData\'+$kind
        $row=@{kind=$kind;original=(Join-Path $parent 'com.agentvn.player');
            held=(Join-Path $parent 'com.agentvn.player.qa-hold-old-runtime-20261018-01');
            backupFiles=@();moved=$false}
        Boundary $row
        if((Test-Path -LiteralPath $row.held) -or !(Test-Path -LiteralPath $row.original)){throw 'Player original profile missing/collision'}
        if((Get-Item -LiteralPath $row.original).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked player profile root'}
        $backup=Join-Path $workspace ('profile-backup\'+$kind)
        if(Test-Path -LiteralPath $backup){throw 'Player backup collision'}
        if($kind -eq 'Roaming'){
            $row.backupFiles=@(Copy-Store $row.original $backup $row.original)
        }else{
            foreach($relative in @('EBWebView\Default\Local Storage','EBWebView\Default\IndexedDB','EBWebView\Default\Session Storage')){
                $row.backupFiles+=@(Copy-Store (Join-Path $row.original $relative) (Join-Path $backup $relative) $row.original)
            }
            foreach($relative in @('EBWebView\Local State','EBWebView\Default\Preferences','EBWebView\Default\Secure Preferences')){
                $source=Join-Path $row.original $relative
                if(Test-Path -LiteralPath $source){
                    $target=Join-Path $backup $relative
                    $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
                    Copy-Item -LiteralPath $source -Destination $target
                    if((Sha $source) -ne (Sha $target)){throw 'Player preference backup mismatch'}
                    $row.backupFiles+=@{relative=$relative;backup=$target;sha256=(Sha $source);bytes=(Get-Item -LiteralPath $source).Length}
                }
            }
        }
        $state.profiles+=$row
    }
    Save $destination $state
    try{
        foreach($row in $state.profiles){
            Assert-Idle
            [IO.Directory]::Move($row.original,$row.held);$row.moved=$true
            Save $destination $state
        }
        $state.status='PASS'
    }catch{
        $state.status='FAILED';$state.error=$_.Exception.Message
        foreach($row in $state.profiles){
            if($row.moved -and !(Test-Path -LiteralPath $row.original)){
                [IO.Directory]::Move($row.held,$row.original);$row.moved=$false
            }
        }
        throw
    }finally{Save $destination $state}
    Write-Output 'PASS: original player library/saves/browser stores protected, whole profiles held'
    exit
}
$protection=Get-Content -LiteralPath (Join-Path $reportRoot 'profile-protection.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($protection.status -ne 'PASS'){throw 'Player profiles not protected'}
if($Action -eq 'Launch'){
    Assert-Idle
    $destination=Join-Path $reportRoot ($Case+'-launch.json')
    if(Test-Path -LiteralPath $destination){throw 'Do not repeat a native case launch'}
    $fixture=@($fixtures.fixtures|Where-Object {$_.id -eq $Case})
    if($fixture.Count -ne 1 -or (Sha $fixture[0].path) -ne $fixture[0].sha256){throw 'Fixture ownership/hash mismatch'}
    $removed=@(Get-ChildItem Env:|Where-Object {$_.Name -match '^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$'}|ForEach-Object {$_.Name})
    foreach($name in $removed){Remove-Item -LiteralPath ('Env:\'+$name)}
    $listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
    $listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port='+$port
    $player=Start-Process -FilePath $fixtures.oldExecutable.path -WorkingDirectory ([IO.Path]::GetDirectoryName($fixtures.oldExecutable.path)) `
        -ArgumentList @('--mode','fixed','--cartridge',('"'+$fixture[0].path+'"')) -PassThru
    $state=[ordered]@{status='WAITING';at=(Get-Date).ToUniversalTime().ToString('o');case=$Case;playerPid=$player.Id;
        executable=$fixtures.oldExecutable;fixture=$fixture[0];cdpPort=$port;removedOverrideNames=$removed;
        dataDirectoryOverride=$false;webviewDirectoryOverride=$false;
        isolatedByWholeProfileHold=$true;scope='REAL_OLD_RELEASE_BINARY_FIXED_CARTRIDGE_CLI_NOT_INSTALLATION';error=$null}
    try{
        $deadline=[DateTime]::UtcNow.AddSeconds(50)
        do{
            $ready=$false
            try{$null=Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 1;$ready=$true}catch{}
            if(!$ready){Start-Sleep -Milliseconds 150}
        }while(!$ready -and [DateTime]::UtcNow -lt $deadline)
        if(!$ready){throw 'Actual old player WebView CDP unavailable'}
        $processes=@(PlayerProcesses)
        $exeRows=@($processes|Where-Object {$_.ProcessId -eq $player.Id})
        if($exeRows.Count -ne 1 -or $exeRows[0].ExecutablePath -ne $fixtures.oldExecutable.path){throw 'Actual old player ownership mismatch'}
        $webviews=@($processes|Where-Object {$_.Name -eq 'msedgewebview2.exe'})
        if(!$webviews.Count){throw 'Expected actual com.agentvn.player profile process missing'}
        $state.processes=@($processes|Select-Object Name,ProcessId,ParentProcessId,ExecutablePath,CreationDate)
        $state.actualWebviewUserDataEvidence=@($webviews|ForEach-Object {
            @{pid=$_.ProcessId;isDefaultPlayerProfile=($_.CommandLine -match 'C:\\Users\\1\\AppData\\Local\\com\.agentvn\.player\\EBWebView')}
        })
        if(@($state.actualWebviewUserDataEvidence|Where-Object {!$_.isDefaultPlayerProfile}).Count){throw 'Player WebView profile differs from protected expected default'}
        $state.status='PASS'
    }catch{$state.status='FAILED';$state.error=$_.Exception.Message;throw}
    finally{Save $destination $state}
    Write-Output ($state|ConvertTo-Json -Depth 7)
    exit
}
if($Action -eq 'CloseAudit'){
    $destination=Join-Path $reportRoot ($Case+'-close.json')
    if(Test-Path -LiteralPath $destination){throw 'Fresh close evidence required'}
    $deadline=[DateTime]::UtcNow.AddSeconds(5)
    while(@(PlayerProcesses).Count -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 150}
    $launch=Get-Content -LiteralPath (Join-Path $reportRoot ($Case+'-launch.json')) -Raw -Encoding UTF8|ConvertFrom-Json
    $processes=@(PlayerProcesses|Select-Object Name,ProcessId,ParentProcessId,ExecutablePath,CreationDate)
    $ports=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -eq $launch.cdpPort}|Select-Object LocalPort,OwningProcess)
    $state=@{status=if($processes.Count -or $ports.Count){'FAILED'}else{'PASS'};at=(Get-Date).ToUniversalTime().ToString('o');
        remainingProcesses=$processes;remainingPorts=$ports}
    Save $destination $state
    if($state.status -ne 'PASS'){throw 'Old player did not exit cleanly; preserve attribution before cleanup'}
    Write-Output 'PASS: actual old player and owned WebView/port exited normally'
    exit
}
Assert-Idle
$destination=Join-Path $reportRoot 'profile-restoration.json'
if(Test-Path -LiteralPath $destination){throw 'Player restoration already recorded'}
foreach($row in $protection.profiles){
    Boundary $row
    $testHeld=Join-Path ('C:\Users\1\AppData\'+$row.kind) 'com.agentvn.player.qa-tested-old-runtime-20261018-01'
    if((Test-Path -LiteralPath $testHeld) -or !(Test-Path -LiteralPath $row.held)){throw 'Player restoration collision'}
}
$state=[ordered]@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');profiles=@();error=$null}
try{
    foreach($row in $protection.profiles){
        $testHeld=Join-Path ('C:\Users\1\AppData\'+$row.kind) 'com.agentvn.player.qa-tested-old-runtime-20261018-01'
        if(Test-Path -LiteralPath $row.original){[IO.Directory]::Move($row.original,$testHeld)}
        [IO.Directory]::Move($row.held,$row.original)
        $checks=@()
        foreach($file in $row.backupFiles){
            $actual=Sha (Join-Path $row.original $file.relative)
            if($actual -ne $file.sha256 -or $actual -ne (Sha $file.backup)){throw 'Original player store restore SHA mismatch'}
            $checks+=@{relative=$file.relative;sha256=$actual;match=$true}
        }
        $state.profiles+=@{kind=$row.kind;original=$row.original;testHeld=$testHeld;checks=$checks}
    }
    $state.status='PASS'
}catch{$state.status='FAILED';$state.error=$_.Exception.Message;throw}
finally{Save $destination $state}
Write-Output 'PASS: original player profiles and saved-game bytes restored'
