param(
    [Parameter(Mandatory=$true)][string]$ReportRoot,
    [ValidateSet('old','new','restart')][string]$Phase='old',
    [string]$Reason='Controlled termination after testing; not evidence of normal window close',
    [ValidatePattern('^(-[0-9]{2})?$')][string]$CaptureAttempt='',
    [ValidateRange(1,9)][int]$Attempt=1
)
$ErrorActionPreference='Stop'
$run=[IO.Path]::GetFullPath($ReportRoot)
if(!$run.StartsWith('D:\AgentVN\output\host-msi-next-20261018-01\',[StringComparison]::OrdinalIgnoreCase) -and
    $run -ne 'D:\AgentVN\output\host-nsis-cross-20261018-01\en-US'){
    throw 'Exact declared MSI-next or NSIS-cross report boundary required'
}
$attemptSuffix=if($Attempt -gt 1){'-attempt'+$Attempt.ToString('00')}else{''}
$destination=Join-Path $run ($Phase+'-owned-termination'+$attemptSuffix+'.json')
if(Test-Path -LiteralPath $destination){throw 'Fresh termination receipt required'}
$launch=Get-Content -LiteralPath (Join-Path $run ($Phase+'-launch.json')) -Raw -Encoding UTF8|ConvertFrom-Json
$captureFile=Join-Path $run ($Phase+'-capture-audit'+$CaptureAttempt+'.json')
$capture=Get-Content -LiteralPath $captureFile -Raw -Encoding UTF8|ConvertFrom-Json
if($capture.status -ne 'PASS'){throw 'Successful ownership capture required'}
$result=@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');
    method='Exact previously captured process termination, NOT normal close';reason=$Reason;captureFile=$captureFile;stopped=@();error=$null}
try{
    $all=@(Get-CimInstance Win32_Process)
    $active=@($all|Where-Object {
        $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.editor')
    })
    foreach($proc in $active){
        $known=@($capture.processes|Where-Object {$_.ProcessId -eq $proc.ProcessId})
        if($known.Count -ne 1 -or $known[0].ParentProcessId -ne $proc.ParentProcessId -or
            $known[0].ExecutablePath -ne $proc.ExecutablePath -or
            [math]::Floor($known[0].CreationDate.ToUniversalTime().Ticks/10000) -ne
            [math]::Floor($proc.CreationDate.ToUniversalTime().Ticks/10000)){
            throw 'Uncaptured or changed process; do not terminate'
        }
    }
    foreach($proc in $active|Sort-Object @{Expression={if($_.Name -eq 'agentvn-editor.exe'){0}else{1}}}){
        $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$proc.ProcessId)
        if($current){
            if($current.CreationDate -ne $proc.CreationDate -or $current.ExecutablePath -ne $proc.ExecutablePath){
                throw 'Process changed before termination'
            }
            Stop-Process -Id $proc.ProcessId
            $result.stopped+=@{pid=$proc.ProcessId;name=$proc.Name;path=$proc.ExecutablePath;creationDate=$proc.CreationDate}
        }
    }
    $deadline=[DateTime]::UtcNow.AddSeconds(10)
    do{
        $remaining=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -in @($active.ProcessId)})
        if($remaining.Count){Start-Sleep -Milliseconds 150}
    }while($remaining.Count -and [DateTime]::UtcNow -lt $deadline)
    if($remaining.Count){throw 'Owned process remains'}
    $result.ports=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(8278,$launch.cdpPort)}|
        Select-Object LocalPort,OwningProcess)
    if($result.ports.Count){throw 'Test port remains'}
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{
    [IO.File]::WriteAllText($destination,($result|ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding($false)))
}
Write-Output "PASS: exact owned termination, $($result.stopped.Count) processes; NOT normal close"
