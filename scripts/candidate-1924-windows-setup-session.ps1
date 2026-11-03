param(
    [ValidateSet('SelfTest','ValidateSource','Install','Uninstall','Cleanup')][string]$Action='SelfTest',
    [Parameter(Mandatory=$true)][string]$RunDirectory
)
$ErrorActionPreference='Stop'
if([IO.Path]::GetFullPath($RunDirectory) -cne 'F:\AgentVN\QA\Windows-Package-20261021-01\runtime-18'){throw 'Exact candidate runtime-18 required'}
$qaOriginal=Join-Path $PSScriptRoot 'windows-setup-session.ps1'
$qaHasher=[Security.Cryptography.SHA256]::Create()
$qaStream=[IO.File]::OpenRead($qaOriginal)
try {$qaHash=[BitConverter]::ToString($qaHasher.ComputeHash($qaStream)).Replace('-','').ToLowerInvariant()}
finally {$qaHasher.Dispose();$qaStream.Dispose()}
if($qaHash -cne 'bc6b9c08fa30badd9227d035c2805bef3a1dc9eeffc7ef0b2c9c150f05c58431'){throw 'Original setup QA source drift'}
$qaText=[IO.File]::ReadAllText($qaOriginal)
$qaChanges=@(
    @("'editor-03\report.json'","'editor-05\report.json'"),
    @("'native-ui-audit-02\report.json'","'native-ui-audit-04\report.json'"),
    @("'setup-payload-audit-02\report.json'","'setup-payload-audit-04\report.json'"),
    @("`$qaSource.editorVersion -cne '1.9.22'","`$qaSource.editorVersion -cne '1.9.24'"),
    @("`$payload.product -cne 'AVN Native Windows 1922 03'","`$payload.product -cne 'AVN Windows QA 20261021'"),
    @("`$payload.gameId -cne 'qa_windows_native_1922_03'","`$payload.gameId -cne 'qa_windows_pkg_20261021_01'"),
    @("`$_.name -ceq 'DisplayVersion' -and `$_.value -ceq '1.0.0'","`$_.name -ceq 'DisplayVersion' -and `$_.value -ceq '1.0.2'")
)
foreach($qaChange in $qaChanges){
    if(([regex]::Matches($qaText,[regex]::Escape($qaChange[0]))).Count -ne 1){throw 'Exact setup adaptation drift'}
    $qaText=$qaText.Replace($qaChange[0],$qaChange[1])
}
$qaBlock=[scriptblock]::Create($qaText)
& $qaBlock -Action $Action -RunDirectory $RunDirectory
