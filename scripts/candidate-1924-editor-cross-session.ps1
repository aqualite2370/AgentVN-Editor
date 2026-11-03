param([ValidateSet('SelfTest','Prepare','InstallOld','InstallNew','Uninstall','Restore')][string]$Action='SelfTest')
# Reuse the verified physical-profile/NSIS protection implementation, adapting
# only this immutable cross-generation session and its actual legacy DB path.
$ErrorActionPreference='Stop'
$source=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'candidate-1924-editor-upgrade-session.ps1') -Raw -Encoding UTF8
foreach($pair in @(
    @('Editor-Upgrade-1924-20261025-05','Editor-Cross-1924-20261025-03'),
    @('editor-upgrade-1924-20261025-05','editor-cross-1924-20261025-03'),
    @('AgentVN_Editor_v1.9.22_20261022_122816.exe','AgentVN_Editor_v1.7.1_20260804_173759.exe'),
    @("'1.9.22'","'1.7.1'"),
    @("(Join-Path `$roots[0] 'backend')","(Join-Path `$install 'data\backend')")
)){
    if(!$source.Contains($pair[0])){throw 'Cross-generation session adaptation drift'}
    $source=$source.Replace($pair[0],$pair[1])
}
$source=$source.Replace('$PSScriptRoot',("'"+$PSScriptRoot.Replace("'","''")+"'"))
$source=$source.Replace('$PSCommandPath',("'"+$PSCommandPath.Replace("'","''")+"'"))
& ([scriptblock]::Create($source)) -Action $Action
