param([ValidateSet('old','new','restart')][string]$Phase='old')
$ErrorActionPreference='Stop'
$reportRoot='D:\AgentVN\output\host-upgrade-20261018-02'
$installRoot='F:\AgentVN-QA-HostUpgrade-20261018-02\installed-editor'
$report=Join-Path $reportRoot ($Phase+'-launch.json')
if(Test-Path -LiteralPath $report){throw 'Do not overwrite prior launch'}
$existing=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\.exe'})
if($existing.Count){throw 'A previous editor/backend is still alive'}
$listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
$listener.Start()
$port=$listener.LocalEndpoint.Port
$listener.Stop()
$removed=@(Get-ChildItem Env: | Where-Object {$_.Name -match '^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$'} | ForEach-Object {$_.Name})
foreach($name in $removed){Remove-Item -LiteralPath ('Env:\'+$name)}
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port='+$port
$shortcut='C:\Users\1\Desktop\AgentVN Editor.lnk'
$shell=New-Object -ComObject WScript.Shell
if($shell.CreateShortcut($shortcut).TargetPath -ne (Join-Path $installRoot 'agentvn-editor.exe')){throw 'Shortcut does not target tested install'}
Start-Process -FilePath $shortcut
$state=[ordered]@{status='WAITING';startedAt=(Get-Date).ToUniversalTime().ToString('o');phase=$Phase;
    shortcut=$shortcut;installRoot=$installRoot;cdpPort=$port;removedOverrideNames=$removed;
    databasePath='C:\Users\1\AppData\Roaming\com.agentvn.editor\backend\vn_engine.db';
    webviewRoot='C:\Users\1\AppData\Local\com.agentvn.editor\EBWebView';
    dataDirectoryOverride=$false;webviewDirectoryOverride=$false;manualBackendSpawn=$false}
try{
    $deadline=[DateTime]::UtcNow.AddSeconds(65)
    do{
        $ready=$false
        try{$null=Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 1;$ready=$true}catch{}
        if(!$ready){Start-Sleep -Milliseconds 200}
    }while(!$ready -and [DateTime]::UtcNow -lt $deadline)
    if(!$ready){throw 'Actual installed WebView did not expose CDP'}
    $processes=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\.exe'})
    if(@($processes | Where-Object {$_.ExecutablePath -ne (Join-Path $installRoot $_.Name)}).Count){throw 'Unowned AgentVN process'}
    $state.processes=@($processes | Select-Object Name,ProcessId,ParentProcessId,ExecutablePath,CreationDate)
    $state.executableSha256=(Get-FileHash -LiteralPath (Join-Path $installRoot 'agentvn-editor.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
    $state.actualVersion=(Get-Item -LiteralPath (Join-Path $installRoot 'agentvn-editor.exe')).VersionInfo.ProductVersion
    $state.status='PASS'
}catch{$state.status='FAILED';$state.error=$_.Exception.Message;throw}
finally{[IO.File]::WriteAllText($report,($state|ConvertTo-Json -Depth 7),(New-Object Text.UTF8Encoding($false)))}
$state | ConvertTo-Json -Depth 7
