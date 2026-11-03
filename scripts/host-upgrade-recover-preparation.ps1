$ErrorActionPreference='Stop'
$root='C:\Users\1\AppData\Roaming'
$original=Join-Path $root 'com.agentvn.editor'
$held=Join-Path $root 'com.agentvn.editor.qa-hold-20261018-01'
$other=Join-Path $root 'com.agentvn.editor.qa-observed-20261018-01'
$report='D:\AgentVN\output\host-upgrade-20261018-01\preparation-recovery.json'
if(Test-Path -LiteralPath $report) {throw 'Fresh recovery record required'}
foreach($target in @($original,$held,$other)){
    if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($target)) -ne $root){throw 'Outside named profile parent'}
}
if(@(Get-CimInstance Win32_Process | Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\.exe'}).Count){throw 'AgentVN running'}
if(Test-Path -LiteralPath $other){throw 'Do not overwrite another profile'}
$expected='984d7a62038312040b8d510312bb01ef0268e8d9c9987ea04181db531f4ab1e3'
if((Get-FileHash -LiteralPath (Join-Path $held 'backend\vn_engine.db') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Held original DB hash differs'}
$result=[ordered]@{startedAt=(Get-Date).ToUniversalTime().ToString('o');status='RUNNING';original=$original;held=$held;other=$other;before=@()}
foreach($folder in @($original,$held)){
    $db=Join-Path $folder 'backend\vn_engine.db'
    $result.before += @{path=$db;sha256=(Get-FileHash -LiteralPath $db -Algorithm SHA256).Hash.ToLowerInvariant()}
}
try{
    # Preserve the different profile observed at the original path; never merge or delete.
    Rename-Item -LiteralPath $original -NewName ([IO.Path]::GetFileName($other))
    if(Test-Path -LiteralPath $original){throw 'Original remains after rename; refusing overwrite'}
    Rename-Item -LiteralPath $held -NewName ([IO.Path]::GetFileName($original))
    $result.restoredSha256=(Get-FileHash -LiteralPath (Join-Path $original 'backend\vn_engine.db') -Algorithm SHA256).Hash.ToLowerInvariant()
    if($result.restoredSha256 -ne $expected){throw 'Original restoration SHA mismatch'}
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{
    $result.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
    [IO.File]::WriteAllText($report,($result | ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
}
$result | ConvertTo-Json -Depth 5
