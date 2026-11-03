$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot 'build-runtime-standalone-android.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Android build script must parse successfully.' }
$guard = $ast.Find({ param($node)
    $node -is [System.Management.Automation.Language.IfStatementAst] -and
    $node.Clauses[0].Item1.Extent.Text -match '^\(?Get-ProcessElevationState'
}, $true)
if (-not $guard) { throw 'Actual process elevation guard was not found.' }
$condition = [scriptblock]::Create($guard.Clauses[0].Item1.Extent.Text)
foreach ($elevated in @($true, $false)) {
    # Evaluate the actual production condition with a deterministic token probe.
    # No APK build, token change or administrator request occurs in this test.
    function Get-ProcessElevationState { return $elevated }
    $blocked = [bool](& $condition)
    if ($blocked -ne (-not $elevated)) {
        throw "Elevation guard inverted: isElevated=$elevated blocked=$blocked"
    }
}
Write-Host 'PASS actual Android PowerShell elevation branch: elevated allowed, ordinary blocked'
