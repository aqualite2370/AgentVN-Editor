param([Parameter(Mandatory=$true)][string]$ManifestPath)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$manifestFile = (Resolve-Path -LiteralPath $ManifestPath).Path
$manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$expectedRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot 'output')).TrimEnd('\')
if ($manifest.root -ne $expectedRoot -or $manifest.status -ne 'INVENTORY_ONLY') { throw 'Manifest root/status mismatch' }
$reportFile = Join-Path ([IO.Path]::GetDirectoryName($manifestFile)) 'execution.json'
if (Test-Path -LiteralPath $reportFile) { throw 'Refusing to overwrite prior cleanup evidence' }
$protectedNames = @('checkpoints','continuation-checkpoints','renpy-checkpoint',
    'cleanup-preserved-20261012','final-hidden-growth-installed-20261017-01',
    'novel-card-position-release-20261017-01')
function Assert-SafeCache([string]$candidate) {
    $absolute = [IO.Path]::GetFullPath($candidate)
    if (-not $absolute.StartsWith($expectedRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw "Outside output: $absolute" }
    $relative = $absolute.Substring($expectedRoot.Length + 1)
    $parts = $relative.Split('\')
    foreach ($part in $parts) {
        if ($protectedNames -contains $part -or $part.StartsWith('cleanup-audit-')) { throw "Protected path: $absolute" }
    }
    if ($relative -notmatch '\\EBWebView\\(?:(?:Default|GPUPersistentCache)\\)?(?:Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|GrShaderCache|ShaderCache)$') {
        throw "Not an approved cache directory: $absolute"
    }
    $current = $expectedRoot
    foreach ($part in @('') + $parts) {
        if ($part) { $current = Join-Path $current $part }
        $item = Get-Item -LiteralPath $current -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point forbidden: $current" }
    }
    return $absolute
}
function Get-Owners {
    # Read process paths in memory; do not write command lines, tokens or credentials to reports.
    return @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match '(?i)agentvn|msedgewebview2|chrome|chromium'
    })
}
function Assert-CacheContents($target) {
    # Walk without following junctions and recheck immediately before removal.
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push([string]$target.path)
    [long]$bytes = 0
    [long]$files = 0
    while ($pending.Count -gt 0) {
        foreach ($entry in (Get-ChildItem -LiteralPath $pending.Pop() -Force)) {
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Link in cache: $($entry.FullName)" }
            if ($entry.PSIsContainer) { $pending.Push($entry.FullName) }
            else {
                if ($entry.Name -match '\.(png|jpe?g|webm|mp4|wav|mp3|apk|exe|msi|vnproj|vncart|zip|db|sqlite|xml|md|log)$' -or
                    $entry.Name -match '(report|acceptance|manifest|diagnostic|provenance).*\.json$') {
                    throw "Unexpected evidence/user file in cache: $($entry.FullName)"
                }
                $bytes += $entry.Length
                $files++
            }
        }
    }
    if ($bytes -ne [long]$target.bytes -or $files -ne [long]$target.files) { throw 'Cache changed since inventory; refusing this target' }
}
foreach ($p in $manifest.protectedFiles) {
    if ((Get-FileHash -LiteralPath $p.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $p.sha256) {
        throw "Protected source changed before cleanup: $($p.path)"
    }
}
$validated = @()
foreach ($target in $manifest.targets) {
    $absolute = Assert-SafeCache $target.path
    if (-not (Get-Item -LiteralPath $absolute -Force).PSIsContainer) { throw "Not directory: $absolute" }
    $validated += $absolute
}
$owners = Get-Owners
$before = (Get-PSDrive -Name D).Free
$result = [ordered]@{ status='RUNNING'; startedAt=(Get-Date).ToUniversalTime().ToString('o');
    manifest=$manifestFile; manifestSha256=(Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.ToLowerInvariant();
    rows=@(); protectedFiles=@(); freeBytesBefore=$before; freeBytesAfter=$null; observedFreeBytesDelta=$null;
    logicalBytesRemoved=0; recovery='Regenerable caches deleted directly; not sent to Recycle Bin';
    untouched='Reports, checkpoints, final delivery, databases, Local Storage, saves and unproven duplicate build copies' }
function Save-Report { [IO.File]::WriteAllText($reportFile,($result | ConvertTo-Json -Depth 10),$utf8) }
Save-Report
try {
    for ($i=0; $i -lt $manifest.targets.Count; $i++) {
        if ($i % 30 -eq 0) { $owners = Get-Owners }
        $target = $manifest.targets[$i]
        $absolute = Assert-SafeCache $target.path
        $profile = [IO.Path]::GetFullPath($target.profile)
        $userData = [IO.Path]::GetDirectoryName($profile)
        $active = @($owners | Where-Object {
            ($_.CommandLine -and $_.CommandLine.IndexOf($userData,[StringComparison]::OrdinalIgnoreCase) -ge 0) -or
            ($_.ExecutablePath -and $_.ExecutablePath.StartsWith(($userData + '\'),[StringComparison]::OrdinalIgnoreCase))
        })
        $row = [ordered]@{ path=$absolute; status='PENDING'; logicalBytes=$target.bytes; error=$null }
        $result.rows += $row
        if ($active.Count -gt 0) { $row.status='SKIPPED_ACTIVE_PROFILE'; Save-Report; continue }
        try {
            $null = Assert-SafeCache $absolute
            Assert-CacheContents $target
            Remove-Item -LiteralPath $absolute -Recurse -Force
            if (Test-Path -LiteralPath $absolute) { throw 'Target remains after cleanup' }
            $row.status='DELETED'
            $result.logicalBytesRemoved += [long]$target.bytes
        } catch { $row.status='FAILED'; $row.error=$_.Exception.Message }
        if ($i % 30 -eq 0) { Save-Report }
    }
    foreach ($p in $manifest.protectedFiles) {
        $actual = (Get-FileHash -LiteralPath $p.path -Algorithm SHA256).Hash.ToLowerInvariant()
        $result.protectedFiles += [ordered]@{path=$p.path; sha256=$actual; unchanged=($actual -eq $p.sha256)}
    }
    $failed = @($result.rows | Where-Object {$_.status -eq 'FAILED'})
    $changed = @($result.protectedFiles | Where-Object {-not $_.unchanged})
    if ($failed.Count -gt 0 -or $changed.Count -gt 0) { $result.status='FAILED' } else { $result.status='PASS' }
} finally {
    $result.freeBytesAfter=(Get-PSDrive -Name D).Free
    $result.observedFreeBytesDelta=[long]$result.freeBytesAfter - [long]$before
    $result.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
    Save-Report
}
$result.rows | Group-Object -Property { $_.status } | Select-Object Name,Count | ConvertTo-Json -Compress
Write-Output ("Report: " + $reportFile)
if ($result.status -ne 'PASS') { exit 1 }
