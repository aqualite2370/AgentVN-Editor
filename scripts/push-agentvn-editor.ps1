[CmdletBinding()]
param(
  [string]$Message = "Update AgentVN Editor",
  [switch]$CheckOnly,
  [switch]$StageAll,
  [ValidateRange(1, 100)]
  [int]$MaxFileMiB = 50
)

$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

$approvedTestProjectFixtures = @{
  "scripts/fixtures/dialog-presentation-isolated.vnproj" = "a5b6cbf71be0e84bc138ea3cc283868937c5b28f76231573eb62270436b97461"
  "scripts/fixtures/editor-isolated-small.vnproj" = "1d26c92ff9de6d5923512cf415b18eec7c012567beed4fac75f5bbc0b6332f78"
  "scripts/fixtures/installed-preview-isolated.vnproj" = "3ce769b80431882f6986dbff73269bf6e7624a980c888b192bc330801531dc73"
}

function Invoke-GitText {
  param([string[]]$GitArguments)
  $lines = @(& git -c core.quotepath=false @GitArguments)
  if ($LASTEXITCODE -ne 0) {
    throw "Git command failed: git $($GitArguments -join ' ')"
  }
  return ($lines -join "`n")
}

function Get-GitPaths {
  param([string[]]$GitArguments)
  $text = Invoke-GitText $GitArguments
  return @($text.Split([char]0) | Where-Object { $_.Length -gt 0 })
}

function Get-FileSha256Hex {
  param([string]$Path)
  $stream = [System.IO.File]::OpenRead($Path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  }
  finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

function Get-ForbiddenReason {
  param([string]$Relative)
  # These local author-project helpers embed literary material or depend on it.
  # Keep this boundary even if ignore rules are removed or files force-staged.
  if ($Relative -match '^scripts/(?:[^/]*(?:angle-owl|night-king)[^/]*|fixtures/night-king-opening\.json)$' -or
      $Relative -in @(
        'scripts/agentvn-test-matrix.cjs',
        'scripts/agentvn-test-matrix-contract-test.cjs',
        'scripts/editor-horizontal-preview-layout-contract.cjs',
        'scripts/full-real-agentvn-acceptance.cjs',
        'scripts/gamecli-choice-nameplate-layout-acceptance.cjs',
        'scripts/gamecli-preview-tauri-cdp-playwright.cjs',
        'scripts/project-settings-and-opening-contract.cjs',
        'scripts/provider-timeout-contract-test.cjs',
        'scripts/release-asset-optimizer-test.cjs',
        'scripts/runtime-fix-engineering-acceptance.cjs',
        'scripts/sprite-scale-display-name-contract.cjs'
      )) {
    return "local author-project content or dependent workflow"
  }
  if ($Relative -match '(^|/)(\.agents|\.claude|\.codex|\.playwright-cli|\.tmp|\.venv|venv|env|virtualenv|node_modules|data|output|releases|releases_test_contract|test_AgentVN|dist|target|gitpush)(/|$)' -or
      $Relative -match '^(\$out|--help|artifacts|plans)/' -or
      $Relative -eq 'AGENTS.md' -or
      $Relative -match '^(--help|--apk)\.inspection\.json$' -or
      $Relative -match '^backend/(build|temp|tempbuild|tempdist)/' -or
      $Relative -eq 'backend/creator-backend.spec' -or
      $Relative -match '^editor/src-tauri/(binaries|bundle-workspace|gen|android-offline-pack)/' -or
      $Relative -match '^GameCli_framework/src-tauri/gen/' -or
      $Relative -eq 'GameCli_framework/public/release-package.json' -or
      ($Relative -match '^GameCli_framework/src-tauri/resources/embedded-cartridge/' -and
       $Relative -ne 'GameCli_framework/src-tauri/resources/embedded-cartridge/.gitkeep')) {
    return "local or generated payload"
  }
  if (($Relative -match '(^|/)\.env($|\.)' -and $Relative -notmatch '(^|/)\.env\.example$') -or
      $Relative -match '\.(jks|keystore|p12|pfx|key|pem)$') {
    return "credential or signing file"
  }
  $offlineTool = $Relative -match '^windows-offline-tools/NSIS/.+\.(exe|dll)$'
  if ($Relative -match '\.vnproj$') {
    if (-not $approvedTestProjectFixtures.ContainsKey($Relative)) {
      return "unreviewed project archive"
    }
    $fixturePath = Join-Path $workspaceRoot $Relative
    if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) {
      return "approved regression fixture is missing"
    }
    $actualHash = Get-FileSha256Hex -Path $fixturePath
    if ($actualHash -ne $approvedTestProjectFixtures[$Relative]) {
      return "approved regression fixture bytes changed; review before publishing"
    }
    return $null
  }
  if (-not $offlineTool -and $Relative -match '\.(exe|dll|so|dylib|pdb|msi|apk|aab|avnenv|zip|7z|vnproj|vncart|agentvn|db|db-shm|db-wal|sqlite|sqlite3|log|tmp|bak)$') {
    return "binary, project, database or archive payload"
  }
  return $null
}

function Get-GitObjectInfo {
  param([string[]]$ObjectIds)
  # Do not pipe PS5 text into Git: under cmd's UTF-8 code page this can add an
  # input BOM and make the first valid object ID appear "missing".
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = "git"
  $start.Arguments = "cat-file --batch-check"
  $start.WorkingDirectory = $workspaceRoot
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $start
  try {
    if (-not $process.Start()) { throw "Unable to start Git blob inspection." }
    $errorRead = $process.StandardError.ReadToEndAsync()
    $outputRead = $process.StandardOutput.ReadToEndAsync()
    $inputBytes = [System.Text.Encoding]::ASCII.GetBytes(($ObjectIds -join "`n") + "`n")
    $process.StandardInput.BaseStream.Write($inputBytes, 0, $inputBytes.Length)
    $process.StandardInput.BaseStream.Close()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Unable to inspect indexed Git objects." }
    return @($outputRead.Result.Split("`n") | ForEach-Object { $_.TrimEnd("`r") } |
      Where-Object { $_.Length -gt 0 })
  }
  finally { $process.Dispose() }
}

function Get-IndexedBlobSha256Hex {
  param([string]$ObjectId)
  if ($ObjectId -notmatch '^[0-9a-f]{40,64}$') { throw "Invalid indexed object ID." }
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = "git"
  $start.Arguments = "cat-file blob $ObjectId"
  $start.WorkingDirectory = $workspaceRoot
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $start
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    if (-not $process.Start()) { throw "Unable to inspect indexed fixture." }
    $errorRead = $process.StandardError.ReadToEndAsync()
    # Hash raw Git bytes, without PowerShell text decoding or line conversion.
    $digest = $sha256.ComputeHash($process.StandardOutput.BaseStream)
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Unable to inspect indexed fixture." }
    return ([System.BitConverter]::ToString($digest)).Replace("-", "").ToLowerInvariant()
  }
  finally {
    $sha256.Dispose()
    $process.Dispose()
  }
}

function Assert-PublishableFiles {
  # Include untracked candidates before StageAll; never trust .gitignore alone.
  $tracked = @(Get-GitPaths @("ls-files", "-z", "--cached"))
  $candidates = @($tracked + @(Get-GitPaths @("ls-files", "-z", "--others", "--exclude-standard")) |
    Sort-Object -Unique)
  $ignoredTracked = @(Get-GitPaths @("ls-files", "-z", "-ci", "--exclude-standard"))
  $blocked = @{}
  foreach ($relative in $candidates) {
    $reason = Get-ForbiddenReason $relative
    if ($reason) {
      $blocked[$relative] = $reason
      continue
    }
    if ($relative -in $ignoredTracked) {
      $blocked[$relative] = "tracked despite .gitignore"
      continue
    }
    $target = Join-Path $workspaceRoot $relative
    if (Test-Path -LiteralPath $target -PathType Leaf) {
      $item = Get-Item -LiteralPath $target -Force
      if ($item.Length -gt ($MaxFileMiB * 1MB)) {
        $blocked[$relative] = "file exceeds $MaxFileMiB MiB"
      }
    }
  }
  # Inspect the actual index, not just working-tree bytes. An unstaged shrink or
  # deletion must not conceal a large blob that would still enter the commit.
  $indexEntries = @(
    foreach ($entry in @(Get-GitPaths @("ls-files", "--stage", "-z"))) {
      if ($entry -notmatch '^(\d{6}) ([0-9a-f]+) ([0-3])\t([\s\S]+)$') {
        throw "Unable to parse the Git index."
      }
      [pscustomobject]@{ Mode = $Matches[1]; Object = $Matches[2]; Stage = $Matches[3]; Path = $Matches[4] }
    }
  )
  $sizes = @{}
  if ($indexEntries.Count -gt 0) {
    $objectIds = @($indexEntries.Object | Sort-Object -Unique)
    $objectInfo = @(Get-GitObjectInfo $objectIds)
    if ($objectInfo.Count -ne $objectIds.Count) {
      throw "Unable to inspect indexed Git objects."
    }
    foreach ($line in $objectInfo) {
      if ($line -notmatch '^([0-9a-f]+) blob (\d+)$') {
        throw "Expected indexed blob metadata (ID/type/size), received: $line"
      }
      $sizes[$Matches[1]] = [long]$Matches[2]
    }
    foreach ($entry in $indexEntries) {
      if ($entry.Stage -ne "0" -or $entry.Mode -notin @("100644", "100755")) {
        $blocked[$entry.Path] = "unmerged index, symlink or submodule"
      } elseif ($sizes[$entry.Object] -gt ($MaxFileMiB * 1MB)) {
        $blocked[$entry.Path] = "indexed blob exceeds $MaxFileMiB MiB"
      } elseif ($approvedTestProjectFixtures.ContainsKey($entry.Path) -and
                (Get-IndexedBlobSha256Hex -ObjectId $entry.Object) -ne $approvedTestProjectFixtures[$entry.Path]) {
        $blocked[$entry.Path] = "indexed regression fixture bytes changed; review before publishing"
      }
    }
  }
  if ($blocked.Count -gt 0) {
    $blocked.GetEnumerator() | Sort-Object Name | ForEach-Object {
      Write-Host "BLOCKED $($_.Key) [$($_.Value)]"
    }
    throw "Publish preflight rejected files. No commit or push was performed."
  }
  Write-Host "[AgentVN] Checked $($candidates.Count) candidate paths."
}

Push-Location $workspaceRoot
try {
  if ((Invoke-GitText @("rev-parse", "--show-toplevel")).Trim() -ne $workspaceRoot.Replace("\", "/")) {
    throw "The script must be inside its own repository root."
  }
  Assert-PublishableFiles
  if ($CheckOnly) {
    # Deliberately before fetch/add/commit: works offline, preserves index bytes.
    Write-Host "[AgentVN] CHECK_ONLY_PASS - no fetch, staging, commit or push."
    exit 0
  }
  # Read-only validation also serves Codex worktrees and feature branches.
  # Publishing retains the existing main-only contract before any remote I/O.
  if ((Invoke-GitText @("branch", "--show-current")).Trim() -ne "main") {
    throw "Expected branch 'main'."
  }

  # Staged-only by default. Bulk staging requires the user's explicit -StageAll.
  Invoke-GitText @("fetch", "origin", "main") | Write-Host
  $localHead = (Invoke-GitText @("rev-parse", "HEAD")).Trim()
  $remoteHead = (Invoke-GitText @("rev-parse", "refs/remotes/origin/main")).Trim()
  $mergeBase = (Invoke-GitText @("merge-base", "HEAD", "refs/remotes/origin/main")).Trim()
  if ($localHead -ne $remoteHead -and $mergeBase -ne $remoteHead) {
    throw "origin/main is newer or diverged. Sync it explicitly before publishing."
  }
  if ($StageAll) {
    Invoke-GitText @("add", "--all", "--", ".") | Write-Host
  }
  Assert-PublishableFiles
  $staged = @(Get-GitPaths @("diff", "--cached", "--name-only", "-z"))
  if ($staged.Count -gt 0) {
    Write-Host "[AgentVN] Committing $($staged.Count) explicitly staged changes."
    Invoke-GitText @("diff", "--cached", "--check") | Write-Host
    Invoke-GitText @("commit", "-m", $Message) | Write-Host
  } else {
    Write-Host "[AgentVN] No staged changes. Use git add for selected files, or explicitly pass -StageAll."
  }
  if ([int](Invoke-GitText @("rev-list", "--count", "origin/main..HEAD")).Trim() -gt 0) {
    Invoke-GitText @("push", "origin", "HEAD:refs/heads/main") | Write-Host
  }
  Write-Host "[AgentVN] Publish finished."
}
finally {
  Pop-Location
}
