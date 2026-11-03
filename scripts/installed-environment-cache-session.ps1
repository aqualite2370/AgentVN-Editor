param([ValidateSet('Protect','Restore')][string]$Action)
$ErrorActionPreference='Stop'
$run='D:\AgentVN\output\installed-environment-cache-20261018-01'
$work='F:\AgentVN-QA-InstalledEnvironmentCache-20261018-01'
$original='C:\Users\1\AppData\Local\AgentVN\environment-cache'
$held='C:\Users\1\AppData\Local\AgentVN\environment-cache.qa-hold-20261018-01'
$tested='C:\Users\1\AppData\Local\AgentVN\environment-cache.qa-tested-20261018-01'
$utf8=New-Object Text.UTF8Encoding($false)
function Sha($p){
    $stream=[IO.File]::OpenRead($p);$algorithm=[Security.Cryptography.SHA256]::Create()
    try{return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
    finally{$algorithm.Dispose();$stream.Dispose()}
}
function Idle{
    $qaLive=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')})
    if($qaLive.Count){throw 'Refuse environment-cache move while any AgentVN process is live'}
}
function Save($p,$value){
    if(Test-Path -LiteralPath $p){throw 'Evidence collision'}
    [IO.File]::WriteAllText($p,($value|ConvertTo-Json -Depth 12),$utf8)
}
Idle
$prep=Get-Content -LiteralPath (Join-Path $run 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($prep.status -ne 'PASS'){throw 'Profile protection prerequisite failed'}
if($Action -eq 'Protect'){
    foreach($p in $prep.profiles){if(!(Test-Path -LiteralPath $p.held)){throw 'Original app profiles must be held'}}
    if(!(Test-Path -LiteralPath $original) -or (Test-Path -LiteralPath $held) -or (Test-Path -LiteralPath $tested)){throw 'Unexpected cache boundary/collision'}
    if((Get-Item -LiteralPath $original).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked original cache'}
    $backup=Join-Path $work 'original-environment-cache'
    $null=New-Item -ItemType Directory -Path $backup
    $files=@()
    foreach($f in Get-ChildItem -LiteralPath $original -Recurse -File -Force){
        if($f.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked original cache file'}
        $relative=$f.FullName.Substring($original.Length+1)
        $target=Join-Path $backup $relative
        $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
        Copy-Item -LiteralPath $f.FullName -Destination $target
        if((Sha $target) -ne (Sha $f.FullName)){throw 'Cache backup bytes differ'}
        $files+=@{relative=$relative;sha256=(Sha $target);backup=$target;bytes=$f.Length}
    }
    if($files.Count -ne 2){throw 'Expected exactly2 inventoried original PASS caches'}
    $state=@{status='PROTECTING';at=(Get-Date).ToUniversalTime().ToString('o');
        original=$original;held=$held;tested=$tested;files=$files}
    Save (Join-Path $run 'cache-protection-journal.json') $state
    # Exact named sibling directories, validated above; no recursive deletion.
    [IO.Directory]::Move($original,$held)
    $null=New-Item -ItemType Directory -Path $original
    $state.status='PASS'
    Save (Join-Path $run 'cache-protection.json') $state
    Write-Output 'PASS: original2 environment caches backed up, hashed and held; QA cache starts empty'
    exit
}
$state=Get-Content -LiteralPath (Join-Path $run 'cache-protection.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($state.status -ne 'PASS' -or $state.original -ne $original -or $state.held -ne $held -or $state.tested -ne $tested){throw 'Cache protection identity mismatch'}
if(!(Test-Path -LiteralPath $held) -or (Test-Path -LiteralPath $tested)){throw 'Cache restore collision/missing held directory'}
foreach($f in $state.files){
    if((Sha (Join-Path $held $f.relative)) -ne $f.sha256 -or (Sha $f.backup) -ne $f.sha256){throw 'Original held/backup changed'}
}
if(Test-Path -LiteralPath $original){[IO.Directory]::Move($original,$tested)}
[IO.Directory]::Move($held,$original)
foreach($f in $state.files){if((Sha (Join-Path $original $f.relative)) -ne $f.sha256){throw 'Restored original cache mismatch'}}
Save (Join-Path $run 'cache-restoration.json') @{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');
    original=$original;qaRetained=$tested;verifiedFiles=$state.files}
Write-Output 'PASS: original2 environment caches restored byte-for-byte; test cache retained separately'
