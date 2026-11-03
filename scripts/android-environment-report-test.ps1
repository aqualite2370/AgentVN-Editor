$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot 'build-runtime-standalone-android.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Build script does not parse.' }
$publish = $ast.Find({ param($node)
    $node -is [System.Management.Automation.Language.IfStatementAst] -and
    $node.Clauses[0].Item1.Extent.Text -eq '$SkipEnvironmentCheck' -and
    $node.Extent.Text.Contains('authoritative result')
}, $true)
if (-not $publish) { throw 'Authoritative environment report block missing.' }
$body = [scriptblock]::Create($publish.Clauses[0].Item2.Extent.Text.Trim().Substring(1).TrimEnd().TrimEnd('}'))
function Write-Utf8Atomic { param($Path, $Value) $script:published = $Value | ConvertTo-Json -Depth 20 | ConvertFrom-Json }
function Add-Utf8Log { param($Path, $Value) }
$EnvReport = 'test-only.json'
$BuildLog = 'test-only.log'
$SymlinkReportPath = 'actual-probe.json'
$SymlinkProbe = [pscustomobject]@{ isElevated = $true; success = $true; probeRoot = 'actual-build-workspace' }
foreach ($json in @(
    '{"ok":true,"status":"PASS","cacheEditorVersion":"1.8.0","sdkRoot":"test-sdk"}',
    '{"ok":true,"status":"PASS","isElevated":false,"symlinkCapability":{"isElevated":false},"symlinkElevation":{"status":"DEFERRED_TO_BUILD"},"sdkRoot":"test-sdk"}'
)) {
    $EnvResult = $json | ConvertFrom-Json
    & $body
    if ($published.isElevated -ne $true -or $published.symlinkCapability.probeRoot -ne 'actual-build-workspace' -or
        $published.symlinkElevation.status -ne 'PASS' -or $published.sdkRoot -ne 'test-sdk') {
        throw 'Authoritative report must insert/replace probe fields and preserve toolchain fields.'
    }
}
Write-Host 'PASS actual Android report publication with missing and existing cached fields (no APK build)'
