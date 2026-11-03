param(
    [ValidateSet('FrontendRestart','PeerLaunch','PeerStop','StopAll')][string]$Action,
    [ValidateSet('recovery','review','editor-motion','editor-loading','project-directory','windows-export','runtime-abilities','runtime-persistence','preview','layout-resources','novel-floating','real-model','resource-versions','layout-author-review','runtime-voice','runtime-voice-paged','runtime-voice-paged-4k','dialog-portrait','animation-asset')][string]$Suite='recovery',
    [ValidateRange(1,9)][int]$Attempt=1,
    [ValidateRange(1,9)][int]$SessionNumber=1,
    [ValidatePattern('^[a-z0-9-]+$')][string]$Evidence='operation-01'
)
$ErrorActionPreference='Stop'
$run='D:\AgentVN\output\installed-assistant-recovery-20261018-01'
$work='F:\AgentVN-QA-InstalledAssistantRecovery-20261018-01'
if($Suite -eq 'animation-asset'){
    $run='D:\AgentVN\output\installed-animation-asset-20261019-01'
    $work='F:\AgentVN\QA\Animation-Asset-20261019-01'
    if($Action -ne 'StopAll'){throw 'Animation asset probe uses attributed StopAll only'}
}
if($Suite -eq 'dialog-portrait'){
    $run='D:\AgentVN\output\installed-dialog-portrait-20261019-01'
    $work='F:\AgentVN\QA\Dialog-Portrait-20261019-01'
    if($Action -ne 'StopAll'){throw 'Portrait acceptance uses attributed whole-session StopAll only'}
}
if($Suite -eq 'runtime-voice-paged-4k'){
    $run='D:\AgentVN\output\installed-runtime-voice-paged-4k-20261019-01'
    $work='F:\AgentVN\QA\Runtime-Voice-Paged-4K-20261019-01'
    if($Action -ne 'StopAll'){throw '4K voiced pagination uses attributed whole-session StopAll only'}
}
if($Suite -eq 'runtime-voice-paged'){
    $run='D:\AgentVN\output\installed-runtime-voice-paged-20261019-01'
    $work='F:\AgentVN\QA\Runtime-Voice-Paged-20261019-01'
    if($Action -ne 'StopAll'){throw 'Runtime voiced pagination uses attributed whole-session StopAll only'}
}
if($Suite -eq 'runtime-voice'){
    $run='D:\AgentVN\output\installed-runtime-voice-20261019-01'
    $work='F:\AgentVN\QA\Runtime-Voice-20261019-01'
    if($Action -ne 'StopAll'){throw 'Runtime voice uses attributed whole-session StopAll only'}
}
if($Suite -eq 'layout-author-review'){
    $run='D:\AgentVN\output\installed-layout-author-review-20261019-01'
    $work='F:\AgentVN\QA\Layout-Author-20261019-01'
    if($Action -ne 'StopAll'){throw 'Layout author review uses attributed whole-session StopAll only'}
}
if($Suite -eq 'resource-versions'){
    $run='D:\AgentVN\output\installed-resource-versions-20261019-01'
    $work='F:\AgentVN\QA\Resource-Versions-20261019-01'
    if($Action -ne 'StopAll'){throw 'Resource version failures use only attributed whole-session StopAll'}
}
if($Suite -eq 'real-model'){
    $run='D:\AgentVN\output\installed-real-model-20261019-01'
    $work='F:\AgentVN-QA-InstalledRealModel-20261019-01'
    if($Action -ne 'StopAll'){throw 'Live model closeout uses only attributed whole-session StopAll'}
    $closeout=Get-Content -LiteralPath (Join-Path $run 'live-closeout.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($closeout.status -ne 'PASS' -or !$closeout.endpointRestored -or !$closeout.isolatedCredentialCleared){
        throw 'Restore endpoint and clear isolated credential through UI before stopping'
    }
}
if($Suite -eq 'layout-resources'){
    $run='D:\AgentVN\output\installed-layout-resources-20261018-01'
    $work='F:\AgentVN-QA-InstalledLayoutResources-20261018-01'
    if($Action -ne 'StopAll'){throw 'Layout resources uses only attributed whole-session StopAll'}
}
if($Suite -eq 'novel-floating'){
    $run='D:\AgentVN\output\installed-novel-session-20261018-01'
    $work='F:\AgentVN-QA-InstalledNovelSession-20261018-01'
    if($Action -ne 'StopAll'){throw 'Novel floating uses only attributed whole-session StopAll'}
}
if($Suite -eq 'preview'){
    $run='D:\AgentVN\output\installed-preview-20261018-01'
    $work='F:\AgentVN-QA-InstalledPreview-20261018-01'
    if($Action -ne 'StopAll'){throw 'Preview continuation uses only attributed StopAll'}
}
if($Suite -eq 'review'){
    $run='D:\AgentVN\output\installed-assistant-review-20261018-01'
    $work='F:\AgentVN-QA-InstalledAssistantReview-20261018-01'
    if($Action -in @('PeerLaunch','PeerStop')){throw 'Peer actions are outside the review slice'}
}
if($Suite -eq 'editor-motion'){
    $run='D:\AgentVN\output\installed-editor-motion-20261018-01'
    $work='F:\AgentVN-QA-InstalledEditorMotion-20261018-01'
    if($Action -ne 'StopAll'){throw 'Only attributed StopAll is used by the motion suite'}
}
if($Suite -eq 'editor-loading'){
    $run='D:\AgentVN\output\installed-editor-loading-20261018-01'
    $work='F:\AgentVN-QA-InstalledEditorLoading-20261018-01'
    if($Action -ne 'StopAll'){throw 'Editor loading uses only attributed whole-session StopAll'}
}
if($Suite -eq 'project-directory'){
    $run='D:\AgentVN\output\installed-project-directory-20261018-01'
    $work='F:\AgentVN-QA-InstalledProjectDirectory-20261018-01'
    if($Action -ne 'StopAll'){throw 'Directory acceptance uses whole Editor/backend restart; only StopAll is supported here'}
}
if($Suite -eq 'windows-export'){
    $run='D:\AgentVN\output\installed-windows-export-20261018-01'
    $work='F:\AgentVN-QA-InstalledWindowsExport-20261018-01'
    if($Action -ne 'StopAll'){throw 'Windows export uses whole sessions; only attributed StopAll is supported here'}
}
if($Suite -eq 'runtime-abilities'){
    $run='D:\AgentVN\output\installed-runtime-abilities-20261018-01'
    $work='F:\AgentVN-QA-InstalledRuntimeAbilities-20261018-01'
    if($Action -ne 'StopAll'){throw 'Runtime abilities uses Editor only for real UI cartridge export; only StopAll here'}
}
if($Suite -eq 'runtime-persistence'){
    $run='D:\AgentVN\output\installed-runtime-persistence-20261018-01'
    $work='F:\AgentVN-QA-InstalledRuntimePersistence-20261018-01'
    if($Action -ne 'StopAll'){throw 'Runtime persistence uses only attributed StopAll here'}
}
if($SessionNumber -gt 1){
    if($Suite -notin @('windows-export','preview','dialog-portrait','animation-asset')){throw 'Additional sessions require an explicitly supported suite'}
    $qaSessionTail=$SessionNumber.ToString('00')
    $run=$run -replace '-01$',('-'+$qaSessionTail)
    $work=$work -replace '-01$',('-'+$qaSessionTail)
}
$suffix=if($Attempt -eq 1){''}else{'-'+$Attempt.ToString('00')}
$launch=Get-Content -LiteralPath (Join-Path $run ('launch'+$suffix+'.json')) -Raw -Encoding UTF8|ConvertFrom-Json
$ready=Get-Content -LiteralPath (Join-Path $run ('backend-ready'+$suffix+'.json')) -Raw -Encoding UTF8|ConvertFrom-Json
$prep=Get-Content -LiteralPath (Join-Path $run 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
$destination=Join-Path $run ($Evidence+'.json')
if(Test-Path -LiteralPath $destination){throw 'Fresh recovery evidence required'}
foreach($p in $prep.profiles){if(!(Test-Path -LiteralPath $p.held)){throw 'Original profiles must remain held'}}
if($ready.status -ne 'PASS' -or $launch.status -ne 'PASS'){throw 'Verified initial session required'}
function Rows {
    @(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\.exe'})
}
function Record($p) {
    @{ProcessId=$p.ProcessId;Name=$p.Name;ParentProcessId=$p.ParentProcessId;ExecutablePath=$p.ExecutablePath;
        createdUtc=$p.CreationDate.ToUniversalTime().ToString('o')}
}
function Sha($file) {
    $stream=[IO.File]::OpenRead($file)
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try{return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
    finally{$algorithm.Dispose();$stream.Dispose()}
}
function Check($live,$expected){
    if($live.ExecutablePath -ne $expected.ExecutablePath -or $live.ParentProcessId -ne $expected.ParentProcessId -or
        $live.CreationDate.ToUniversalTime().ToString('o') -ne $expected.createdUtc){throw 'Process PID/path/parent/create-time identity mismatch'}
}
$known=@($ready.processes)
foreach($f in (Get-ChildItem -LiteralPath $run -File -Filter '*-identity.json')){
    $entry=Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8|ConvertFrom-Json
    $known+=@($entry.processes)
}
$live=@(Rows)
foreach($p in $live){
    $expected=@($known|Where-Object {$_.ProcessId -eq $p.ProcessId -and $_.createdUtc -eq $p.CreationDate.ToUniversalTime().ToString('o')})
    if(!$expected.Count){throw 'Unattributed AgentVN process; refuse mutation'}
    Check $p $expected[0]
}
$report=@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');action=$Action;
    controlledOperation=$true;normalWindowClose='NOT_RUN';error=$null;before=@($live|ForEach-Object {Record $_})}
function Save {
    [IO.File]::WriteAllText($destination,($report|ConvertTo-Json -Depth 12),(New-Object Text.UTF8Encoding($false)))
}
function StopRows($targets){
    foreach($p in $targets){
        $again=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$p.ProcessId)
        if($again){Check $again (Record $p);Stop-Process -Id $p.ProcessId}
    }
}
function WebViews {
    @(Get-CimInstance Win32_Process|Where-Object {$_.Name -eq 'msedgewebview2.exe' -and
        $_.CommandLine -match 'com\.agentvn\.(editor|player)|AgentVN-QA-InstalledAssistant(Recovery|Review)|AgentVN-QA-InstalledEditorMotion'})
}
function WaitEditorGone($targets){
    $deadline=[DateTime]::UtcNow.AddSeconds(10)
    do{
        $left=@(Rows|Where-Object {$_.ProcessId -in @($targets.ProcessId)})
        if($left.Count){Start-Sleep -Milliseconds 100}
    }while($left.Count -and [DateTime]::UtcNow -lt $deadline)
    if($left.Count){throw 'Owned Editor did not stop'}
}
try{
    $backend=@($live|Where-Object {$_.Name -eq 'creator-backend.exe'})
    if($Action -in @('FrontendRestart','PeerLaunch','PeerStop') -and !$backend.Count){throw 'Existing owned packaged backend required'}
    if($Action -eq 'StopAll'){
        StopRows @($live|Sort-Object @{Expression={if($_.Name -eq 'agentvn-editor.exe'){0}else{1}}})
        $deadline=[DateTime]::UtcNow.AddSeconds(10)
        do{$remaining=@(Rows);$web=@(WebViews);if($remaining.Count -or $web.Count){Start-Sleep -Milliseconds 100}}
        while(($remaining.Count -or $web.Count) -and [DateTime]::UtcNow -lt $deadline)
        if($remaining.Count -or $web.Count){throw 'Owned process residue remains'}
        $report.stopped=$report.before
    }elseif($Action -eq 'PeerStop'){
        $peer=Get-Content -LiteralPath (Join-Path $run 'peer-identity.json') -Raw -Encoding UTF8|ConvertFrom-Json
        $targets=@($live|Where-Object {$_.ProcessId -eq $peer.editorPid})
        if($targets.Count -ne 1){throw 'Exact peer must be alive'}
        StopRows $targets;WaitEditorGone $targets
        $report.stopped=@($targets|ForEach-Object {Record $_})
    }else{
        if($Action -eq 'FrontendRestart'){
            $targets=@($live|Where-Object {$_.Name -eq 'agentvn-editor.exe'})
            if($targets.Count -ne 1){throw 'Exactly one frontend required for restart'}
            StopRows $targets;WaitEditorGone $targets
            $deadline=[DateTime]::UtcNow.AddSeconds(10)
            do{$web=@(WebViews);if($web.Count){Start-Sleep -Milliseconds 100}}while($web.Count -and [DateTime]::UtcNow -lt $deadline)
            if($web.Count){throw 'Old frontend WebView still owns default profile'}
            $report.stoppedFrontend=@($targets|ForEach-Object {Record $_})
        }
        foreach($name in @(Get-ChildItem Env:|Where-Object {$_.Name -match '^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$'}|ForEach-Object {$_.Name})){
            Remove-Item -LiteralPath ('Env:\'+$name)
        }
        $probe=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
        $probe.Start();$cdpPort=$probe.LocalEndpoint.Port;$probe.Stop()
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port='+$cdpPort
        $report.webviewDirectoryOverride=$false
        if($Action -eq 'PeerLaunch'){
            $peerRoot=Join-Path $work 'peer-webview'
            if(Test-Path -LiteralPath $peerRoot){throw 'Fresh secondary WebView profile required'}
            $env:WEBVIEW2_USER_DATA_FOLDER=$peerRoot
            $report.webviewDirectoryOverride=$true;$report.peerWebviewRoot=$peerRoot
        }
        $exe=Join-Path $launch.installRoot 'agentvn-editor.exe'
        if((Sha $exe) -ne $launch.executableSha256){throw 'Installed candidate drift'}
        $identityName=if($Action -eq 'PeerLaunch'){'peer-identity.json'}else{'frontend-identity.json'}
        $identityFile=Join-Path $run $identityName
        if(Test-Path -LiteralPath $identityFile){throw 'Identity journal collision'}
        $next=Start-Process -FilePath $exe -WorkingDirectory $launch.installRoot -WindowStyle Hidden -PassThru
        # Record recoverable process identity before waiting on WebView readiness.
        $current=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$next.Id)
        $identity=@{editorPid=$next.Id;cdpPort=$cdpPort;processes=@((Record $current));action=$Action}
        [IO.File]::WriteAllText($identityFile,($identity|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
        $deadline=[DateTime]::UtcNow.AddSeconds(50);$online=$false
        do{try{$null=Invoke-RestMethod -Uri "http://127.0.0.1:$cdpPort/json/version" -TimeoutSec 1;$online=$true}catch{}
            if(!$online){Start-Sleep -Milliseconds 150}}
        while(!$online -and [DateTime]::UtcNow -lt $deadline)
        if(!$online){throw 'New installed frontend CDP did not become ready'}
        $now=@(Rows);$newBackend=@($now|Where-Object {$_.Name -eq 'creator-backend.exe'})
        if($newBackend.Count -ne $backend.Count){throw 'Frontend unexpectedly created/replaced backend'}
        foreach($p in $backend){$again=@($now|Where-Object {$_.ProcessId -eq $p.ProcessId});if($again.Count -ne 1){throw 'Owned backend changed'};Check $again[0] (Record $p)}
        $report.editorPid=$next.Id;$report.cdpPort=$cdpPort;$report.dataDirectoryOverride=$false
        $report.backendReusedWithoutManualSpawn=$true;$report.backendPids=@($backend.ProcessId)
        $report.executableSha256=$launch.executableSha256
    }
    $report.after=@(Rows|ForEach-Object {Record $_});$report.status='PASS'
}catch{$report.status='FAILED';$report.error=$_.Exception.Message;throw}
finally{Save}
Write-Output ($report|ConvertTo-Json -Depth 8)
