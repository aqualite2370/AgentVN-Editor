param([ValidateSet('Prepare','Restore')][string]$Action='Prepare')
$ErrorActionPreference='Stop'
$run='D:\AgentVN\output\installed-asset-consumers-20261018-01'
$work='F:\AgentVN-QA-InstalledAssetConsumers-20261018-01'
$utf8=New-Object Text.UTF8Encoding($false)
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Idle {
    $live=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')})
    if($live.Count){throw 'AgentVN process active; profile move refused'}
}
function Save($file,$data){
    if(Test-Path -LiteralPath $file){throw 'Evidence collision'}
    [IO.File]::WriteAllText($file,($data|ConvertTo-Json -Depth 15),$utf8)
}
function Boundary($p){
    if($p.original -ne ('C:\Users\1\AppData\'+$p.kind+'\com.agentvn.player') -or
        $p.held -ne ($p.original+'.qa-hold-asset-consumers-20261018-01') -or
        $p.testHeld -ne ($p.original+'.qa-tested-asset-consumers-20261018-01')){
        throw 'Unexpected exact profile boundary'
    }
}
Idle
if($Action -eq 'Prepare'){
    if((Test-Path -LiteralPath $run) -or (Test-Path -LiteralPath $work)){throw 'Fresh session required'}
    $prior=Get-Content -LiteralPath 'D:\AgentVN\output\old-runtime-refusal-20261018-01\profile-protection.json' -Raw -Encoding UTF8|ConvertFrom-Json
    $profiles=@()
    foreach($p in $prior.profiles){
        $profiles+=@{kind=$p.kind;original=$p.original;held=($p.original+'.qa-hold-asset-consumers-20261018-01');
            testHeld=($p.original+'.qa-tested-asset-consumers-20261018-01');files=$p.backupFiles}
    }
    $count=0
    foreach($p in $profiles){
        Boundary $p
        if(!(Test-Path -LiteralPath $p.original) -or (Test-Path -LiteralPath $p.held) -or
            (Test-Path -LiteralPath $p.testHeld)){throw 'Original missing or profile collision'}
        if((Get-Item -LiteralPath $p.original).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked profile'}
        foreach($f in $p.files){
            if((Sha (Join-Path $p.original $f.relative)) -ne $f.sha256 -or (Sha $f.backup) -ne $f.sha256){throw 'Independent backup mismatch'}
            $count++
        }
    }
    if($count -ne 24){throw 'Expected 24 independently protected Player files'}
    $null=New-Item -ItemType Directory -Path $run,$work
    $state=@{status='PREPARING';at=(Get-Date).ToUniversalTime().ToString('o');profiles=$profiles;
        verifiedFiles=$count;moved=@();originalDevSha256=(Sha 'D:\AgentVN\AgentVN Dev.exe');
        originalEditorDbSha256=(Sha 'C:\Users\1\AppData\Roaming\com.agentvn.editor\backend\vn_engine.db')}
    $journal=Join-Path $run 'preparation-journal.json'
    [IO.File]::WriteAllText($journal,($state|ConvertTo-Json -Depth 15),$utf8)
    foreach($p in $profiles){
        Idle
        [IO.Directory]::Move($p.original,$p.held)
        $state.moved+=$p.original
        [IO.File]::WriteAllText($journal,($state|ConvertTo-Json -Depth 15),$utf8)
    }
    $state.status='PASS';Save (Join-Path $run 'preparation.json') $state
    Write-Output 'PASS: two whole Player profiles held after 24 independent SHA checks; Editor profile untouched'
    exit
}
$prep=Get-Content -LiteralPath (Join-Path $run 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($prep.status -ne 'PASS'){throw 'Preparation not complete'}
foreach($p in $prep.profiles){
    Boundary $p
    if(!(Test-Path -LiteralPath $p.held) -or (Test-Path -LiteralPath $p.testHeld)){throw 'Restoration collision'}
}
$result=@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');profiles=@()}
foreach($p in $prep.profiles){
    if(Test-Path -LiteralPath $p.original){[IO.Directory]::Move($p.original,$p.testHeld)}
    [IO.Directory]::Move($p.held,$p.original)
    foreach($f in $p.files){
        if((Sha (Join-Path $p.original $f.relative)) -ne $f.sha256 -or (Sha $f.backup) -ne $f.sha256){throw 'Restored bytes mismatch'}
    }
    $result.profiles+=@{kind=$p.kind;original=$p.original;testHeld=$p.testHeld;filesVerified=$p.files.Count}
}
if((Sha 'D:\AgentVN\AgentVN Dev.exe') -ne $prep.originalDevSha256 -or
    (Sha 'C:\Users\1\AppData\Roaming\com.agentvn.editor\backend\vn_engine.db') -ne $prep.originalEditorDbSha256){throw 'Original Editor DB or Dev changed'}
$result.status='PASS';Save (Join-Path $run 'profile-restoration.json') $result
Write-Output 'PASS: both Player originals restored, 24 SHA files verified; original Editor DB and Dev unchanged'
