param([ValidateSet('Launch','Observe','Stop')][string]$Action,
      [ValidateSet('cancel','cancel-restart','accept','accept-restart','conflict')][string]$Case='cancel')
$ErrorActionPreference='Stop'
$run='D:\AgentVN\output\installed-database-migration-20261018-01'
$prep=Get-Content -LiteralPath (Join-Path $run 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
$fixture=Get-Content -LiteralPath (Join-Path $run 'fixtures.json') -Raw -Encoding UTF8|ConvertFrom-Json
$utf8=New-Object Text.UTF8Encoding($false)
foreach($p in $prep.profiles){if(!(Test-Path -LiteralPath $p.held)){throw 'Original profiles must remain held'}}
function Save($file,$state){
    if(Test-Path -LiteralPath $file){throw 'Evidence collision'}
    [IO.File]::WriteAllText($file,($state|ConvertTo-Json -Depth 14),$utf8)
}
function Sha($file){
    $stream=[IO.File]::OpenRead($file);$algorithm=[Security.Cryptography.SHA256]::Create()
    try{return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
    finally{$stream.Dispose();$algorithm.Dispose()}
}
function Processes{
    @(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\.exe'})
}
function Record($p){
    @{pid=$p.ProcessId;parent=$p.ParentProcessId;path=$p.ExecutablePath;name=$p.Name;
      createdUtc=$p.CreationDate.ToUniversalTime().ToString('o')}
}
$launchFile=Join-Path $run ($Case+'-launch.json')
if($Action -eq 'Launch'){
    if(@(Processes).Count){throw 'AgentVN still active'}
    if(@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -eq 8278}).Count){throw 'Default backend port occupied'}
    if((Sha $fixture.legacy) -ne $fixture.source.sha256){throw 'Legacy source bytes changed'}
    $exe=Join-Path $prep.installRoot 'agentvn-editor.exe'
    if((Sha $exe) -ne 'f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c'){throw 'Frozen candidate identity mismatch'}
    foreach($name in @(Get-ChildItem Env:|Where-Object {$_.Name -match '^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$'}|ForEach-Object {$_.Name})){
        Remove-Item -LiteralPath ('Env:\'+$name)
    }
    $probe=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
    $probe.Start();$port=$probe.LocalEndpoint.Port;$probe.Stop()
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port='+$port
    $proc=Start-Process -FilePath $exe -WorkingDirectory $prep.installRoot -WindowStyle Hidden -PassThru
    $live=Get-CimInstance Win32_Process -Filter ('ProcessId='+$proc.Id)
    $state=@{status='LAUNCHED_NATIVE_CONFIRMATION_MAY_BLOCK_BACKEND';at=(Get-Date).ToUniversalTime().ToString('o');case=$Case;
      editorPid=$proc.Id;editorIdentity=(Record $live);installRoot=$prep.installRoot;executableSha256=(Sha $exe);
      cdpPort=$port;backendPort=8278;dataDirectoryOverride=$false;webviewDirectoryOverride=$false;
      manualBackendSpawn=$false;consentInjected=$false;legacy=$fixture.legacy}
    Save $launchFile $state
    Write-Output ($state|ConvertTo-Json -Depth 6)
    exit
}
$launch=Get-Content -LiteralPath $launchFile -Raw -Encoding UTF8|ConvertFrom-Json
$live=@(Processes)
$root=@($live|Where-Object {$_.ProcessId -eq $launch.editorPid})
if($root.Count -ne 1){throw 'Expected this case Editor still alive'}
$id=Record $root[0]
if($id.path -ne $launch.editorIdentity.path -or $id.parent -ne $launch.editorIdentity.parent -or
    $id.createdUtc -ne $launch.editorIdentity.createdUtc){throw 'Editor identity differs'}
foreach($p in $live){
    if($p.ExecutablePath -ne (Join-Path $prep.installRoot $p.Name)){throw 'Unexpected AgentVN path'}
    if($p.ProcessId -ne $launch.editorPid -and $p.ParentProcessId -notin @($live.ProcessId)){throw 'Unowned backend parent chain'}
}
if($Action -eq 'Observe'){
    $null=Invoke-RestMethod -Uri 'http://127.0.0.1:8278/api/health' -TimeoutSec 3
    if(@($live|Where-Object {$_.Name -eq 'creator-backend.exe'}).Count -lt 1){throw 'No packaged backend after confirmation'}
    Save (Join-Path $run ($Case+'-backend.json')) @{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');
        case=$Case;processes=@($live|ForEach-Object {Record $_});defaultDatabasePath='C:\Users\1\AppData\Roaming\com.agentvn.editor\backend\vn_engine.db'}
    Write-Output 'PASS automatically launched installed backend identity; no manual source backend'
    exit
}
$before=@($live|ForEach-Object {Record $_})
foreach($p in @($live|Sort-Object @{Expression={if($_.Name -eq 'agentvn-editor.exe'){0}else{1}}})){
    $now=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.ProcessId)
    if($now){
        if($now.ExecutablePath -ne $p.ExecutablePath -or $now.ParentProcessId -ne $p.ParentProcessId -or
            $now.CreationDate -ne $p.CreationDate){throw 'Process identity changed before stop'}
        Stop-Process -Id $p.ProcessId
    }
}
$deadline=[DateTime]::UtcNow.AddSeconds(10)
do{
    $left=@(Processes)
    $web=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)'})
    if($left.Count -or $web.Count){Start-Sleep -Milliseconds 100}
}while(($left.Count -or $web.Count) -and [DateTime]::UtcNow -lt $deadline)
$ports=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @($launch.cdpPort,8278)}|Select-Object LocalPort,OwningProcess)
if($left.Count -or $web.Count -or $ports.Count){throw 'Owned process/port residue'}
Save (Join-Path $run ($Case+'-stop.json')) @{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');
    method='ATTRIBUTED_TERMINATION_NOT_NORMAL_WINDOW_CLOSE';before=$before;remainingProcesses=$left;remainingPorts=$ports}
Write-Output 'PASS attributed installed Editor/backend stop; no normal-close claim'
