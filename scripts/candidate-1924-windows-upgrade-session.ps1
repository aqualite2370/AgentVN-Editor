param(
    [ValidateSet('SelfTest','ValidateSource','ValidateUpgrade','Install','Upgrade','Uninstall','Cleanup')][string]$Action='SelfTest',
    [Parameter(Mandatory=$true)][string]$RunDirectory
)
$ErrorActionPreference='Stop'
$qaRun=[IO.Path]::GetFullPath($RunDirectory)
if($qaRun -cnotin @('F:\AgentVN\QA\Windows-Package-20261021-01\runtime-20',
                    'F:\AgentVN\QA\Windows-Package-20261021-01\runtime-21',
                    'F:\AgentVN\QA\Windows-Package-20261021-01\runtime-22')){
    throw 'Only exact candidate upgrade runtime20/21/22 allowed'
}
$qaRecent=$qaRun.EndsWith('\runtime-21') -or $qaRun.EndsWith('\runtime-22')
$qaOriginal=Join-Path $PSScriptRoot 'windows-setup-session.ps1'
$qaHasher=[Security.Cryptography.SHA256]::Create()
$qaStream=[IO.File]::OpenRead($qaOriginal)
try{$qaHash=[BitConverter]::ToString($qaHasher.ComputeHash($qaStream)).Replace('-','').ToLowerInvariant()}
finally{$qaHasher.Dispose();$qaStream.Dispose()}
if($qaHash -cne 'bc6b9c08fa30badd9227d035c2805bef3a1dc9eeffc7ef0b2c9c150f05c58431'){
    throw 'Frozen installation helper drift'
}
$qaText=[IO.File]::ReadAllText($qaOriginal)
$qaChanges=@(
    @("'editor-04\report.json'","'editor-05\report.json'"),
    @("'native-ui-audit-03\report.json'","'native-ui-audit-04\report.json'"),
    @("'setup-payload-audit-03\report.json'","'setup-payload-audit-04\report.json'"),
    @("if(`$source.editorVersion -cne '1.9.22'","if(`$source.editorVersion -cne '1.9.24'"),
    @("`$newPayload.pe.fileVersion -cne '1.0.1'","`$newPayload.pe.fileVersion -cne '1.0.2'"),
    @("`$_.name -ceq 'DisplayVersion' -and `$_.value -ceq '1.0.1'","`$_.name -ceq 'DisplayVersion' -and `$_.value -ceq '1.0.2'"),
    @("PASS: exact 1.9.16 to 1.9.22 same-game upgrade chain","PASS: retained old to 1.9.24 same-game upgrade chain"),
    @("if(`$qaNative){throw 'Retained old setup must be installed first; not another native product'}",
      "if(`$qaNative -and `$product -cne 'AVN Windows QA 20261021'){throw 'Exact same QA game required'}")
)
if($qaRecent){
    $qaChanges+=@(
        @("'editor-03\report.json'","'editor-04\report.json'"),
        @("'native-ui-audit-02\report.json'","'native-ui-audit-03\report.json'"),
        @("'setup-payload-audit-02\report.json'","'setup-payload-audit-03\report.json'"),
        @("`$payload.product -cne 'AVN Native Windows 1922 03'","`$payload.product -cne 'AVN Windows QA 20261021'"),
        @("`$payload.gameId -cne 'qa_windows_native_1922_03'","`$payload.gameId -cne 'qa_windows_pkg_20261021_01'"),
        @("`$_.name -ceq 'DisplayVersion' -and `$_.value -ceq '1.0.0'","`$_.name -ceq 'DisplayVersion' -and `$_.value -ceq '1.0.1'")
    )
}
foreach($qaChange in $qaChanges){
    if(([regex]::Matches($qaText,[regex]::Escape($qaChange[0]))).Count -ne 1){
        throw ('Exact upgrade adaptation drift: '+$qaChange[0])
    }
    $qaText=$qaText.Replace($qaChange[0],$qaChange[1])
}
$qaBlock=[scriptblock]::Create($qaText)
& $qaBlock -Action $Action -RunDirectory $qaRun
