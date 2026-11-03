param([ValidateSet('Capture','Close')][string]$Action='Capture',
    [ValidateSet('old','new','restart')][string]$Phase='new',
    [ValidatePattern('^(-[0-9]{2})?$')][string]$Attempt='',
    [string]$ReportRoot='D:\AgentVN\output\host-upgrade-20261018-02',
    [string]$InstallRoot='F:\AgentVN-QA-HostUpgrade-20261018-02\installed-editor')
$ErrorActionPreference='Stop'
$reportRoot=$ReportRoot
$installRoot=$InstallRoot
$launch=Get-Content -LiteralPath (Join-Path $reportRoot ($Phase+'-launch.json')) -Raw -Encoding UTF8|ConvertFrom-Json
$destination=Join-Path $reportRoot ($Phase+'-'+$Action.ToLowerInvariant()+'-audit'+$Attempt+'.json')
if(Test-Path -LiteralPath $destination){throw 'Fresh process audit required'}
function Sha($path){(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Processes {
    @(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.editor')
    })
}
$audit=[ordered]@{status='RUNNING';action=$Action;phase=$Phase;at=(Get-Date).ToUniversalTime().ToString('o');checks=@{};error=$null}
try{
    $processes=@(Processes)
    if($Action -eq 'Capture'){
        $editors=@($processes|Where-Object {$_.Name -eq 'agentvn-editor.exe'})
        if($editors.Count -ne 1 -or $editors[0].ExecutablePath -ne (Join-Path $installRoot 'agentvn-editor.exe')){throw 'Wrong editor process'}
        $rootPid=$editors[0].ProcessId
        $backend=@($processes|Where-Object {$_.Name -eq 'creator-backend.exe'})
        if($backend.Count -ne 2){throw 'Expected packaged backend parent and child'}
        foreach($p in $backend){
            if($p.ExecutablePath -ne (Join-Path $installRoot 'creator-backend.exe')){throw 'Wrong backend path'}
            if($p.ParentProcessId -ne $rootPid -and $p.ParentProcessId -notin @($backend.ProcessId)){throw 'Unowned backend parent'}
        }
        $port=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -eq 8278})
        if($port.Count -ne 1 -or $port[0].OwningProcess -notin @($backend.ProcessId)){throw 'Backend port ownership mismatch'}
        $audit.processes=@($processes|Select-Object Name,ProcessId,ParentProcessId,ExecutablePath,CreationDate)
        $audit.backendPort=@($port|Select-Object LocalAddress,LocalPort,OwningProcess)
        $audit.cdpPort=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -eq $launch.cdpPort}|Select-Object LocalAddress,LocalPort,OwningProcess)
        $backendPath=Join-Path $installRoot 'creator-backend.exe'
        $audit.backend=@{path=$backendPath;sha256=(Sha $backendPath)}
        $log=Join-Path $installRoot 'error_log\editor-desktop.log'
        $copy=Join-Path $reportRoot ($Phase+'-editor-desktop'+$Attempt+'.log')
        if(Test-Path -LiteralPath $copy){throw 'Log evidence collision'}
        Copy-Item -LiteralPath $log -Destination $copy
        $text=Get-Content -LiteralPath $copy -Raw -Encoding UTF8
        $databasePath=if($launch.actualVersion -eq '1.7.1'){
            Join-Path $installRoot 'data\backend\vn_engine.db'
        }else{$launch.databasePath}
        $expectedDataDirectory=[IO.Path]::GetDirectoryName($databasePath)
        $dataLines=@($text -split "`r?`n"|Where-Object {$_ -match 'Packaged backend data dir: '})
        if(!$dataLines.Count -or !$dataLines[-1].Contains('Packaged backend data dir: '+$expectedDataDirectory)){
            throw 'Latest actual backend data path provenance missing'}
        if(!$text.Contains('Using bundled editor frontend.')){throw 'Bundled frontend provenance missing'}
        $webviews=@($processes|Where-Object {$_.Name -eq 'msedgewebview2.exe'})
        if(!$webviews.Count){throw 'No default profile WebView found'}
        $audit.defaultDatabase=@{path=$databasePath;bytes=(Get-Item -LiteralPath $databasePath).Length;sha256=(Sha $databasePath);
            latestHostLogLine=$dataLines[-1];launchRecordedPath=$launch.databasePath}
        if($launch.actualVersion -eq '1.7.1' -and $launch.databasePath -ne $databasePath){
            $audit.launchPathCorrection='Old launch wrapper recorded modern DB path; latest native host log and real DB prove old install-local default. Original launch report retained unchanged.'
        }
        $audit.profile=@{webviewRoot=$launch.webviewRoot;exists=(Test-Path -LiteralPath $launch.webviewRoot)}
        $audit.checks=@{ownedBackend=$true;defaultDatabaseLog=$true;bundledFrontendLog=$true;
            backendFrozenHash=($audit.backend.sha256 -eq 'db44bd510997a73aee80ba5419d0c9c55e6f73f9a01ad65003915ea089eb5155');
            noDirectoryOverrides=(!$launch.dataDirectoryOverride -and !$launch.webviewDirectoryOverride -and !$launch.manualBackendSpawn)}
        if($Phase -eq 'old'){
            $audit.checks.Remove('backendFrozenHash')
            $audit.checks.oldSampleVersion=($launch.actualVersion -in @('1.7.1','1.9.8'))
            $audit.oldBackendScope='Actual old-install backend recorded; not compared to new candidate hash'
        }
        if(@($audit.checks.Values|Where-Object {!$_}).Count){throw 'Provenance assertion failed'}
        $audit.status='PASS'
    }else{
        $captured=Get-Content -LiteralPath (Join-Path $reportRoot ($Phase+'-capture-audit.json')) -Raw -Encoding UTF8|ConvertFrom-Json
        $deadline=[DateTime]::UtcNow.AddSeconds(5)
        while($processes.Count -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 200;$processes=@(Processes)}
        $audit.remainingAfterNormalClose=@($processes|Select-Object Name,ProcessId,ParentProcessId,ExecutablePath,CreationDate)
        $audit.status=if($processes.Count){'FAILED'}else{'PASS'}
        $audit.cleanup=if($processes.Count){'NOT_RUN'}else{'NOT_NEEDED'}
        if($processes.Count){
            foreach($p in $processes){
                $old=@($captured.processes|Where-Object {$_.ProcessId -eq $p.ProcessId})
                # ConvertTo-Json's /Date()/ format preserves milliseconds, while
                # live CIM DateTime includes sub-millisecond ticks.
                $sameCreation=$old.Count -eq 1 -and
                    [Math]::Floor($old[0].CreationDate.ToUniversalTime().Ticks / 10000) -eq
                    [Math]::Floor($p.CreationDate.ToUniversalTime().Ticks / 10000)
                if($p.Name -ne 'creator-backend.exe' -or $p.ExecutablePath -ne (Join-Path $installRoot 'creator-backend.exe') -or
                    $old.Count -ne 1 -or !$sameCreation -or $old[0].ParentProcessId -ne $p.ParentProcessId){
                    throw 'Refuse to stop process without exact prior ownership'
                }
                Stop-Process -Id $p.ProcessId
            }
            $deadline=[DateTime]::UtcNow.AddSeconds(5)
            while(@(Processes).Count -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 150}
            $audit.cleanup=if(@(Processes).Count){'FAILED'}else{'PASS'}
            $audit.defect='BACKEND_CHILD_SURVIVES_NORMAL_WINDOW_CLOSE'
        }
        $audit.remainingAfterCleanup=@(Processes|Select-Object Name,ProcessId,ParentProcessId,ExecutablePath)
        $audit.remainingPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(8278,$launch.cdpPort)}|Select-Object LocalAddress,LocalPort,OwningProcess)
    }
}catch{$audit.status='FAILED';$audit.error=$_.Exception.Message;throw}
finally{
    [IO.File]::WriteAllText($destination,($audit|ConvertTo-Json -Depth 12),(New-Object Text.UTF8Encoding($false)))
    Write-Output ($audit|ConvertTo-Json -Depth 5)
}
if($audit.status -ne 'PASS'){exit 1}
