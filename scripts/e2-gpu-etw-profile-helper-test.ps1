$ErrorActionPreference = 'Stop'
$modulePath = Join-Path $PSScriptRoot 'lib\E2GpuWprProfile.psm1'
Import-Module $modulePath -Force

if ((Get-E2WprProfileSpec) -cne 'GPU') {
    throw 'The collector must retain the built-in GPU profile as its default.'
}
if ((Get-E2WprProfileSpec -ProfileName 'GPU.light') -cne 'GPU.light') {
    throw 'A built-in WPR profile name must pass through unchanged.'
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("AgentVN WPR profile test " + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
    $profilePath = Join-Path $tempRoot 'custom profile.wprp'
    Set-Content -LiteralPath $profilePath -Value '<profile-fixture />' -Encoding utf8
    $expected = (Resolve-Path -LiteralPath $profilePath).Path + '!E2Gpu'
    $actual = Get-E2WprProfileSpec -ProfileName ' E2Gpu ' -ProfileFile $profilePath
    if ($actual -cne $expected) {
        throw "Custom WPR profile path was not preserved as one profile specification. Expected '$expected', got '$actual'."
    }

    $missingPath = Join-Path $tempRoot 'missing profile.wprp'
    $missingPathRejected = $false
    try {
        Get-E2WprProfileSpec -ProfileName 'E2Gpu' -ProfileFile $missingPath | Out-Null
    } catch {
        $missingPathRejected = $true
    }
    if (-not $missingPathRejected) {
        throw 'A missing custom WPR profile must be rejected before starting a recording.'
    }

    $missingNameRejected = $false
    try {
        Get-E2WprProfileSpec -ProfileFile $profilePath | Out-Null
    } catch {
        $missingNameRejected = $true
    }
    if (-not $missingNameRejected) {
        throw 'A custom WPR profile file without a profile name must be rejected.'
    }
} finally {
    $resolvedTempRoot = [System.IO.Path]::GetFullPath($tempRoot)
    $systemTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
    $actualParent = [System.IO.Path]::GetDirectoryName($resolvedTempRoot)
    $actualLeaf = [System.IO.Path]::GetFileName($resolvedTempRoot)
    $isOwnTempDirectory = $actualParent.Equals($systemTempRoot, [System.StringComparison]::OrdinalIgnoreCase)
    $hasExpectedPrefix = $actualLeaf.StartsWith('AgentVN WPR profile test ', [System.StringComparison]::Ordinal)
    if (-not $isOwnTempDirectory -or -not $hasExpectedPrefix) {
        throw "Refusing to clean a test directory outside its generated temp scope: $resolvedTempRoot"
    }
    Remove-Item -LiteralPath $resolvedTempRoot -Recurse -Force
}

Write-Output 'PASS E2 custom WPR profile argument contract'
