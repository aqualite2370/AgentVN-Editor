param(
    [ValidateSet('Block','Restore','ValidateProvenance')][string]$Action='ValidateProvenance',
    [string]$RunDirectory,
    [switch]$SelfTest
)
$ErrorActionPreference='Stop'
$qaOriginal=Join-Path $PSScriptRoot 'native-portable-save-acl.ps1'
$qaHasher=[Security.Cryptography.SHA256]::Create()
$qaStream=[IO.File]::OpenRead($qaOriginal)
try {$qaHash=[BitConverter]::ToString($qaHasher.ComputeHash($qaStream)).Replace('-','').ToLowerInvariant()}
finally {$qaHasher.Dispose();$qaStream.Dispose()}
if($qaHash -cne 'eaa550a1252eb2746a464df2cff2e871eff66a063918ee74f2e8a0221e5dd1a6'){throw 'Original ACL QA source drift'}
$qaText=[IO.File]::ReadAllText($qaOriginal)
$qaAclLibrary="'"+(Join-Path $PSScriptRoot 'lib\runtime-qa-acl.ps1').Replace("'","''")+"'"
$qaChanges=@(
    @("Join-Path `$PSScriptRoot 'lib\runtime-qa-acl.ps1'",$qaAclLibrary),
    @("'1.9.22'","'1.9.24'"),
    @('\editor-03\report.json','\editor-05\report.json'),
    @('\native-ui-audit-02\report.json','\native-ui-audit-04\report.json')
)
foreach($qaChange in $qaChanges){
    if(([regex]::Matches($qaText,[regex]::Escape($qaChange[0]))).Count -ne 1){throw 'Exact ACL adaptation drift'}
    $qaText=$qaText.Replace($qaChange[0],$qaChange[1])
}
$qaBlock=[scriptblock]::Create($qaText)
if($SelfTest){'PASS: four exact ACL provenance adaptations; no ACL/profile mutation';exit}
if([IO.Path]::GetFullPath($RunDirectory) -cne 'F:\AgentVN\QA\Windows-Package-20261021-01\runtime-16'){throw 'Exact candidate runtime-16 required'}
& $qaBlock -Action $Action -RunDirectory $RunDirectory
