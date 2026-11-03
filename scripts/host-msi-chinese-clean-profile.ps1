$ErrorActionPreference='Stop'
$root='D:\AgentVN\output\host-msi-continuation-20261018-02'
$receipt=Join-Path $root 'chinese-clean-profile.json'
if(Test-Path -LiteralPath $receipt){throw 'Fresh Chinese profile transition required'}
$active=@(Get-CimInstance Win32_Process|Where-Object {
    $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
    ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')
})
if($active.Count){throw 'AgentVN active'}
$prep=Get-Content -LiteralPath (Join-Path $root 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($prep.status -ne 'PASS'){throw 'Original profile protection missing'}
$rows=@()
foreach($profile in $prep.profiles|Where-Object {$_.app -eq 'editor'}){
    $expectedParent='C:\Users\1\AppData\'+$profile.kind
    $target=$profile.original+'.qa-tested-msi-continuation-en-20261018-02'
    if([IO.Path]::GetDirectoryName($target) -ne $expectedParent -or
        [IO.Path]::GetDirectoryName($profile.original) -ne $expectedParent -or
        [IO.Path]::GetFileName($profile.original) -ne 'com.agentvn.editor' -or
        !(Test-Path -LiteralPath $profile.held) -or !(Test-Path -LiteralPath $profile.original) -or
        (Test-Path -LiteralPath $target)){throw 'Unsafe exact QA archive boundary'}
    $rows+=@{source=$profile.original;target=$target;kind=$profile.kind;moved=$false}
}
if($rows.Count -ne 2){throw 'Expected both Editor QA profiles'}
$result=@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');rows=$rows;
    scope='Preserve English QA defaults; Chinese old MSI starts with no database or WebView seed';error=$null}
$utf8=New-Object Text.UTF8Encoding($false)
try{
    foreach($row in $rows){
        [IO.Directory]::Move($row.source,$row.target);$row.moved=$true
        [IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 8),$utf8)
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{[IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 8),$utf8)}
Write-Output 'PASS: English QA profiles preserved, Chinese default DB/WebView absent; original four profiles remain held'
