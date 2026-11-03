param([ValidateSet(1,2,3)][int]$Attempt=1,
    [ValidateSet('assets','media-video','components','components-use','gui','assistant')][string]$Suite='assets')
$ErrorActionPreference='Stop'
$run='D:\AgentVN\output\installed-assets-20261018-01'
if($Suite -eq 'media-video'){$run='D:\AgentVN\output\installed-video-20261018-01'}
if($Suite -eq 'components'){$run='D:\AgentVN\output\installed-components-20261018-01'}
if($Suite -eq 'components-use'){$run='D:\AgentVN\output\installed-components-use-20261018-01'}
if($Suite -eq 'gui'){$run='D:\AgentVN\output\installed-gui-session-20261018-01'}
if($Suite -eq 'assistant'){$run='D:\AgentVN\output\installed-assistant-session-20261018-01'}
$suffix=if($Attempt -eq 1){''}else{'-'+$Attempt.ToString('00')}
$launch=Get-Content -LiteralPath "$run\launch$suffix.json" -Raw -Encoding UTF8|ConvertFrom-Json
$ready=Get-Content -LiteralPath "$run\backend-ready$suffix.json" -Raw -Encoding UTF8|ConvertFrom-Json
$destination=Join-Path $run ('computer-use-import-blocked'+$suffix+'.json')
if(Test-Path -LiteralPath $destination){throw 'Fresh recovery evidence required'}
$report=@{status='BLOCKED';scope='NATIVE_IMPORT_COMPUTER_USE_TOOL_FAILURE_NOT_PRODUCT_FAILURE';
    at=(Get-Date).ToUniversalTime().ToString('o');normalClose='NOT_RUN_TOOL_UNAVAILABLE';
    errors=@('coordinate input geometry is unavailable',
        'point (450, 650) is outside window bounds { originX: 0, originY: 0, width: 16, height: 16 }',
        'element 71 is not available in cached app state for agentvn-editor.exe');
    kernelResetAttempted=$true;alternateKeyboardFocusChanged=$false;ownedStopped=@()}
if($Attempt -ne 1){
    $report.scope='CONTROLLED_TEST_RESTART_OR_TEARDOWN_NOT_PHYSICAL_WINDOW_CLOSE_ACCEPTANCE'
    $report.nativeCloseCommand='DENIED_BY_EXISTING_TAURI_ACL_NOT_BYPASSED'
}
if($Suite -in @('media-video','components','components-use','gui','assistant')){
    $report.scope='CONTROLLED_TEST_TEARDOWN_NOT_PHYSICAL_WINDOW_CLOSE_ACCEPTANCE'
    $report.errors=@()
    $report.kernelResetAttempted=$false
    $report.nativeCloseCommand='NOT_RUN_PREVIOUS_TOOL_AND_ACL_LIMITATION_NOT_RETRIED'
    $report.normalClose='NOT_RUN_CONTROLLED_TEST_TEARDOWN'
}
# This is an explicitly labelled forced test teardown, not successful normal close.
$live=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -in @($ready.processes.ProcessId)})
foreach($row in $live){
    $expected=@($ready.processes|Where-Object {$_.ProcessId -eq $row.ProcessId})
    if($expected.Count -ne 1 -or $row.ExecutablePath -ne $expected[0].ExecutablePath -or
        $row.ParentProcessId -ne $expected[0].ParentProcessId -or
        $row.CreationDate.ToUniversalTime().ToString('o') -ne $expected[0].createdUtc){throw 'Unexpected process ownership'}
}
foreach($row in ($live|Sort-Object @{Expression={if($_.Name -eq 'agentvn-editor.exe'){0}else{1}}})){
    if(Get-Process -Id $row.ProcessId -ErrorAction SilentlyContinue){Stop-Process -Id $row.ProcessId}
    $report.ownedStopped+=@{pid=$row.ProcessId;path=$row.ExecutablePath;created=$row.CreationDate.ToUniversalTime().ToString('o')}
}
$deadline=[DateTime]::UtcNow.AddSeconds(8)
do{
    $remaining=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')})
    if($remaining.Count){Start-Sleep -Milliseconds 150}
}while($remaining.Count -and [DateTime]::UtcNow -lt $deadline)
if($remaining.Count){throw 'Unexpected remaining process; no new session allowed'}
$report.cleanupStatus='PASS'
[IO.File]::WriteAllText($destination,($report|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
if($Suite -in @('media-video','components','components-use','gui','assistant')){
    Write-Output 'PASS: attributed controlled teardown; original profiles still held, normal close not accepted'
}else{
    Write-Output 'BLOCKED native import; attributed test processes stopped, original profiles still held'
}
