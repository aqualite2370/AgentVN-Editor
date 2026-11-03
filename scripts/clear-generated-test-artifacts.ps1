param([string]$ManifestPath, [switch]$SelfTest)
$ErrorActionPreference = 'Stop'
$outputRoot = 'D:\AgentVN\output'
$tempRoot = 'C:\Users\1\AppData\Local\Temp'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Test-AllowedTarget($target) {
    $absolute = [IO.Path]::GetFullPath([string]$target.path)
    if ($absolute.StartsWith($outputRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        $relative = $absolute.Substring($outputRoot.Length + 1)
        if ($relative -match '(^|\\)(cleanup-audit-[^\\]*|saves|Local Storage|IndexedDB|Session Storage)(\\|$)') { return $false }
        if ($target.kind -eq 'OUTPUT_CACHE_DIRECTORY') {
            return [IO.Path]::GetFileName($absolute) -in @('target', 'node_modules', '.gradle')
        }
        if ($target.kind -eq 'OUTPUT_ARCHIVED_EVIDENCE') {
            return ($target.archiveBeforeDelete -and [long]$target.bytes -ge 1MB -and
                $absolute -match '\.(png|jpe?g|webp|wav|mp3|mp4|webm|etl|vnproj)$' -and
                $relative -notmatch '(?i)checkpoint')
        }
        if ($target.kind -ne 'OUTPUT_GENERATED_FILE' -or [long]$target.bytes -lt 1MB) { return $false }
        if ($relative -match '(?i)checkpoint') {
            if (-not $relative.StartsWith('full-regression-20261017-01\checkpoint\artifacts\', [StringComparison]::OrdinalIgnoreCase)) { return $false }
            if (-not $target.archiveBeforeDelete) { return $false }
        }
        if ($absolute -match '\.(exe|msi|apk|aab|dll|pdb|rlib|rmeta|obj|o|a|lib|so|jar|dex|pak|avnenv|vncart)$') { return $true }
        if ($absolute -match '\.zip$' -and $absolute -notmatch '(diagnos|report|evidence|trace)') { return $true }
        return ($absolute -match '\.(mp4|webm)$' -and [long]$target.bytes -ge 16MB)
    }
    if ($target.kind -eq 'C_BACKEND_RUNTIME') {
        return ([IO.Path]::GetDirectoryName($absolute) -eq $tempRoot -and
            [IO.Path]::GetFileName($absolute) -match '^_MEI\d+$')
    }
    return $false
}
if ($SelfTest) {
    $cases = @(
        @('D:\AgentVN\output\x\game.exe', 'OUTPUT_GENERATED_FILE', 2MB, $true),
        @('D:\AgentVN\output\x\report.json', 'OUTPUT_GENERATED_FILE', 2MB, $false),
        @('D:\AgentVN\output\x\game.vnproj', 'OUTPUT_GENERATED_FILE', 2MB, $false),
        @('D:\AgentVN\output\x\vn_engine.db', 'OUTPUT_GENERATED_FILE', 2MB, $false),
        @('D:\AgentVN\output\x\saves\game.exe', 'OUTPUT_GENERATED_FILE', 2MB, $false),
        @('D:\AgentVN\output\x\node_modules', 'OUTPUT_CACHE_DIRECTORY', 2MB, $true),
        @('D:\AgentVN\output', 'OUTPUT_CACHE_DIRECTORY', 2MB, $false),
        @('D:\AgentVN\editor\src-tauri\target', 'OUTPUT_CACHE_DIRECTORY', 2MB, $false),
        @('D:\AgentVN\output\..\AgentVN Dev.exe', 'OUTPUT_GENERATED_FILE', 2MB, $false),
        @('D:\AgentVN\output\cleanup-audit-test\x.exe', 'OUTPUT_GENERATED_FILE', 2MB, $false),
        @('D:\AgentVN\output\x\diagnostics.zip', 'OUTPUT_GENERATED_FILE', 2MB, $false),
        @('D:\AgentVN\output\checkpoint\old.exe', 'OUTPUT_GENERATED_FILE', 2MB, $false),
        @('D:\AgentVN\output\x\report.json', 'OUTPUT_ARCHIVED_EVIDENCE', 2MB, $false),
        @('C:\Users\1\AppData\Local\Temp\_MEI903002', 'C_BACKEND_RUNTIME', 2MB, $true),
        @('C:\Users\1\AppData\Local\Temp', 'C_BACKEND_RUNTIME', 2MB, $false),
        @('C:\Users\1\AppData\Roaming\com.agentvn.editor', 'C_BACKEND_RUNTIME', 2MB, $false)
    )
    foreach ($case in $cases) {
        $target = [pscustomobject]@{ path=$case[0]; kind=$case[1]; bytes=$case[2]; archiveBeforeDelete=$false }
        if ((Test-AllowedTarget $target) -ne $case[3]) { throw "Safety test failed: $($case[0])" }
    }
    Write-Output "PASS: $($cases.Count) path/scope safety cases; no deletion"
    exit 0
}
$manifestFile = (Resolve-Path -LiteralPath $ManifestPath).Path
if (-not $manifestFile.StartsWith($outputRoot + '\cleanup-audit-', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected manifest location' }
$manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.status -ne 'INVENTORY_ONLY' -or $manifest.root -ne $outputRoot -or $manifest.targets.Count -eq 0) { throw 'Invalid/empty inventory' }
$reportFile = Join-Path ([IO.Path]::GetDirectoryName($manifestFile)) 'execution.json'
if (Test-Path -LiteralPath $reportFile) { throw 'Never overwrite a previous cleanup result' }
$archiveRoot = Join-Path 'F:\AgentVN-QA-Preserved' ([IO.Path]::GetFileName([IO.Path]::GetDirectoryName($manifestFile)))
$requiresArchive = @($manifest.targets | Where-Object { $_.archiveBeforeDelete }).Count -gt 0
if ($requiresArchive -and (Test-Path -LiteralPath $archiveRoot)) { throw 'Archive must be a fresh directory' }
if ($requiresArchive) {
    $archiveBytes = ($manifest.targets | Where-Object { $_.archiveBeforeDelete } | Measure-Object -Property bytes -Sum).Sum
    if ((Get-PSDrive -Name F).Free -lt ([long]$archiveBytes + 1GB)) { throw 'Not enough archive capacity on F' }
}
function Assert-NoLinks([string]$absolute) {
    $current = [IO.Path]::GetFullPath($absolute)
    while ($current) {
        $entry = Get-Item -LiteralPath $current -Force
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Link/redirect forbidden: $current" }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
}
function Measure-SafeTree([string]$dir) {
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($dir)
    [long]$bytes=0; [long]$files=0
    while ($pending.Count -gt 0) {
        foreach ($entry in (Get-ChildItem -LiteralPath $pending.Pop() -Force)) {
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Link inside target: $($entry.FullName)" }
            if ($entry.PSIsContainer) { $pending.Push($entry.FullName) }
            else { $bytes += $entry.Length; $files++ }
        }
    }
    return [pscustomobject]@{ bytes=$bytes; files=$files }
}
# Read ownership only; do not stop user processes or log credentials/command lines.
$owners = @(Get-CimInstance Win32_Process)
if (@($owners | Where-Object { $_.Name -match '(?i)creator-backend|agentvn.*\.exe' }).Count -gt 0) {
    throw 'An AgentVN process is active; refusing runtime cleanup'
}
foreach ($target in $manifest.targets) {
    if (-not (Test-AllowedTarget $target)) { throw "Target outside approved policy: $($target.path)" }
    Assert-NoLinks $target.path
    $active = @($owners | Where-Object {
        ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($target.path + '\',[StringComparison]::OrdinalIgnoreCase)) -or
        ($_.ExecutablePath -and $_.ExecutablePath -eq $target.path) -or
        ($_.CommandLine -and $_.CommandLine.IndexOf($target.path,[StringComparison]::OrdinalIgnoreCase) -ge 0)
    })
    if ($active.Count -gt 0) { throw "Active target; nothing deleted: $($target.path)" }
}
foreach ($p in $manifest.protectedFiles) {
    if ((Get-FileHash -LiteralPath $p.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $p.sha256) { throw "Protected file changed: $($p.path)" }
}
$result = [ordered]@{ status='RUNNING'; startedAt=(Get-Date).ToUniversalTime().ToString('o');
    manifest=$manifestFile; manifestSha256=(Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.ToLowerInvariant();
    archiveRoot=$archiveRoot; rows=@(); freeBefore=@{}; freeAfter=@{}; logicalBytesRemoved=@{ C=0L; D=0L };
    protectedFiles=@(); recovery='Archived current candidate/recovery files on F before deletion; other generated payloads require regeneration; not in Recycle Bin' }
foreach ($drive in @('C','D')) { $result.freeBefore[$drive] = (Get-PSDrive -Name $drive).Free }
function Save-Report { [IO.File]::WriteAllText($reportFile,($result | ConvertTo-Json -Depth 10),$utf8) }
Save-Report
try {
    $i=0
    $progressInterval = if ($manifest.targets.Count -gt 1000) { 100 } else { 25 }
    foreach ($target in $manifest.targets) {
        $row = [ordered]@{ path=$target.path; bytes=$target.bytes; kind=$target.kind; status='PENDING'; archive=$null; error=$null }
        $result.rows += $row
        try {
            Assert-NoLinks $target.path
            if (-not (Test-AllowedTarget $target)) { throw 'Target policy changed' }
            if ($target.kind -in @('OUTPUT_GENERATED_FILE','OUTPUT_ARCHIVED_EVIDENCE')) {
                $item = Get-Item -LiteralPath $target.path -Force
                if ($item.PSIsContainer -or $item.Length -ne [long]$target.bytes) { throw 'File changed since inventory' }
                if ($target.archiveBeforeDelete) {
                    $relative = $target.path.Substring($outputRoot.Length + 1)
                    $destination = [IO.Path]::GetFullPath((Join-Path $archiveRoot $relative))
                    if (-not $destination.StartsWith($archiveRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Archive escapes boundary' }
                    $null = New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force
                    Assert-NoLinks ([IO.Path]::GetDirectoryName($destination))
                    Copy-Item -LiteralPath $target.path -Destination $destination -ErrorAction Stop
                    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $target.sha256) { throw 'Archive byte verification failed' }
                    $row.archive = [ordered]@{path=$destination; sha256=$target.sha256}
                }
                Remove-Item -LiteralPath $target.path -Force -ErrorAction Stop
            } else {
                $measured = Measure-SafeTree $target.path
                if ($measured.bytes -ne [long]$target.bytes -or $measured.files -ne [long]$target.files) { throw 'Directory changed since inventory' }
                if ($target.kind -eq 'C_BACKEND_RUNTIME') {
                    $fingerprints = if ($target.runtimeFingerprint) { $target.runtimeFingerprint } else { $manifest.runtimeFingerprint }
                    foreach ($fingerprint in $fingerprints) {
                        $runtimeFile = Join-Path $target.path $fingerprint.rel
                        if ((Get-FileHash -LiteralPath $runtimeFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $fingerprint.sha256) { throw 'Backend runtime fingerprint changed' }
                    }
                }
                Remove-Item -LiteralPath $target.path -Recurse -Force -ErrorAction Stop
            }
            if (Test-Path -LiteralPath $target.path) { throw 'Target remains' }
            $row.status='DELETED'
            $result.logicalBytesRemoved[$target.path.Substring(0,1).ToUpperInvariant()] += [long]$target.bytes
        } catch { $row.status='FAILED'; $row.error=$_.Exception.Message }
        $i++
        if ($i % $progressInterval -eq 0) { Save-Report; Write-Output "Processed $i / $($manifest.targets.Count)" }
    }
    foreach ($p in $manifest.protectedFiles) {
        $actual = (Get-FileHash -LiteralPath $p.path -Algorithm SHA256).Hash.ToLowerInvariant()
        $result.protectedFiles += [ordered]@{path=$p.path; sha256=$actual; unchanged=($actual -eq $p.sha256)}
    }
    $failed = @($result.rows | Where-Object {$_.status -eq 'FAILED'})
    $changed = @($result.protectedFiles | Where-Object {-not $_.unchanged})
    $result.status = if ($failed.Count -eq 0 -and $changed.Count -eq 0) {'PASS'} else {'FAILED'}
} finally {
    foreach ($drive in @('C','D')) { $result.freeAfter[$drive] = (Get-PSDrive -Name $drive).Free }
    $result.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
    Save-Report
}
Write-Output ($result.rows | Group-Object -Property { $_.status } | Select-Object Name,Count | ConvertTo-Json -Compress)
Write-Output ("Report: " + $reportFile)
if ($result.status -ne 'PASS') { exit 1 }
