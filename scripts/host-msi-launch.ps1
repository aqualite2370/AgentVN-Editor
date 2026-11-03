param([ValidateSet('old','new','restart')][string]$Phase='old',
    [ValidateSet('en-US','zh-CN')][string]$Language='en-US',
    [string]$ReportRoot='',
    [string]$InstallRoot='',
    [switch]$RecoverExistingLaunch,
    [ValidateSet('1.7.1','1.9.8','1.9.9','1.9.16')][string]$ExpectedVersion='',
    [ValidateSet('MSI','NSIS')][string]$InstallerKind='MSI')
$ErrorActionPreference='Stop'
$reportRoot=if($ReportRoot){$ReportRoot}else{'D:\AgentVN\output\host-msi-session-20261018-01\'+$Language}
$installRoot=if($InstallRoot){$InstallRoot}else{'F:\AgentVN-QA-HostMSI-20261018-01\'+$Language+'\installed-editor'}
$report=Join-Path $reportRoot ($Phase+'-launch.json')
if(Test-Path -LiteralPath $report){throw 'Fresh launch evidence required'}
$null=New-Item -ItemType Directory -Path $reportRoot -Force
$active=@(Get-CimInstance Win32_Process|Where-Object {
    $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
    ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.editor')
})
if($active.Count -and !$RecoverExistingLaunch){throw 'Editor/backend/WebView active'}
if($RecoverExistingLaunch){
    if($reportRoot -ne 'D:\AgentVN\output\host-msi-continuation-20261018-02\en-US' -or $Phase -ne 'old'){throw 'Recovery scoped to first known reporting failure'}
    $editors=@($active|Where-Object {$_.Name -eq 'agentvn-editor.exe'})
    if($editors.Count -ne 1 -or $editors[0].ProcessId -ne 129184 -or
        $editors[0].ExecutablePath -ne (Join-Path $installRoot 'agentvn-editor.exe')){throw 'Recovery editor ownership mismatch'}
}
$removed=@(Get-ChildItem Env:|Where-Object {$_.Name -match '^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$'}|ForEach-Object {$_.Name})
foreach($name in $removed){Remove-Item -LiteralPath ('Env:\'+$name)}
$listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
if($RecoverExistingLaunch){
    $webview=@($active|Where-Object {$_.Name -eq 'msedgewebview2.exe' -and $_.ParentProcessId -eq 129184})
    if($webview.Count -ne 1 -or $webview[0].CommandLine -notmatch '--remote-debugging-port=(\d+)'){throw 'Cannot recover actual debugger port'}
    $port=[int]$Matches[1]
}
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port='+$port
$shell=New-Object -ComObject WScript.Shell
$links=@()
foreach($directory in @('C:\Users\Public\Desktop','C:\ProgramData\Microsoft\Windows\Start Menu\Programs',
    'C:\Users\1\Desktop','C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs')){
    foreach($file in (Get-ChildItem -LiteralPath $directory -Filter '*AgentVN*.lnk' -File -ErrorAction SilentlyContinue)){
        $target=$shell.CreateShortcut($file.FullName).TargetPath
        $links+=@{path=$file.FullName;target=$target;matches=($target -eq (Join-Path $installRoot 'agentvn-editor.exe'))}
    }
}
$matching=@($links|Where-Object {$_.matches})
if(!$matching.Count){throw 'Actual installer-created default shortcut missing'}
$shortcut=$matching[0].path
$expectedVersion=if($ExpectedVersion){$ExpectedVersion}elseif($Phase -eq 'old'){'1.9.8'}else{'1.9.9'}
$actual=(Get-Item -LiteralPath (Join-Path $installRoot 'agentvn-editor.exe')).VersionInfo.ProductVersion
if($actual -ne $expectedVersion){throw 'Installed version mismatch'}
if(!$RecoverExistingLaunch){Start-Process -FilePath $shortcut -WindowStyle Hidden}
$state=[ordered]@{status='WAITING';startedAt=(Get-Date).ToUniversalTime().ToString('o');phase=$Phase;language=$Language;
    installerKind=$InstallerKind;
    shortcut=$shortcut;allDiscoveredShortcuts=$links;installRoot=$installRoot;cdpPort=$port;removedOverrideNames=$removed;
    actualVersion=$actual;executableSha256=(Get-FileHash -LiteralPath (Join-Path $installRoot 'agentvn-editor.exe') -Algorithm SHA256).Hash.ToLowerInvariant();
    databasePath=$(if($actual -eq '1.7.1'){Join-Path $installRoot 'data\backend\vn_engine.db'}else{'C:\Users\1\AppData\Roaming\com.agentvn.editor\backend\vn_engine.db'});
    webviewRoot='C:\Users\1\AppData\Local\com.agentvn.editor\EBWebView';
    dataDirectoryOverride=$false;webviewDirectoryOverride=$false;manualBackendSpawn=$false;error=$null}
if($RecoverExistingLaunch){
    $failure=@{status='FAILED';scope='TEST_WRAPPER_REPORT_DIRECTORY_MISSING_NOT_PRODUCT_FAILURE';
        at=(Get-Date).ToUniversalTime().ToString('o');editorPid=129184;cdpPort=$port;newLaunch=$false;
        error='Initial shortcut launch succeeded but WriteAllText failed because en-US report subdirectory was absent';
        recovery='Capture still-running first shortcut-launched process; do not relaunch or overwrite failure'}
    [IO.File]::WriteAllText((Join-Path $reportRoot 'old-launch-wrapper-failure.json'),($failure|ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding($false)))
    $state.recoveredFirstProcess=$true
}
try{
    $deadline=[DateTime]::UtcNow.AddSeconds(60)
    do{
        $ready=$false
        try{$null=Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 1;$ready=$true}catch{}
        if(!$ready){Start-Sleep -Milliseconds 150}
    }while(!$ready -and [DateTime]::UtcNow -lt $deadline)
    if(!$ready){throw 'Installed WebView CDP not ready'}
    $state.processes=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\.exe'}|
        Select-Object Name,ProcessId,ParentProcessId,ExecutablePath,CreationDate)
    if(@($state.processes|Where-Object {$_.ExecutablePath -ne (Join-Path $installRoot $_.Name)}).Count){throw 'Unowned editor/backend process'}
    $state.status='PASS'
}catch{$state.status='FAILED';$state.error=$_.Exception.Message;throw}
finally{[IO.File]::WriteAllText($report,($state|ConvertTo-Json -Depth 9),(New-Object Text.UTF8Encoding($false)))}
Write-Output ($state|ConvertTo-Json -Depth 6)
