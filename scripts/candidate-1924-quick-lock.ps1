param(
    [Parameter(Mandatory=$true)][string]$Target,
    [Parameter(Mandatory=$true)][string]$Ready,
    [Parameter(Mandatory=$true)][string]$Release,
    [Parameter(Mandatory=$true)][string]$RunDirectory,
    [switch]$ValidateOnly
)
$ErrorActionPreference='Stop'
$qaRun=[IO.Path]::GetFullPath($RunDirectory)
$qaSession=[IO.Path]::GetFileName($qaRun)
if([IO.Path]::GetDirectoryName($qaRun) -ne 'F:\AgentVN\QA\Native-Runtime-State-20261020-01' -or
    $qaSession -notmatch '^quick-installed-(1924|1930|1932|1933|1934)-(\d{2})$'){
    throw 'Lock signals require the exact current candidate QA session'
}
$qaCandidate=$Matches[1]
$qaAttempt=$Matches[2]
$qaResolved=[IO.Path]::GetFullPath($Target)
$qaDirectory=[IO.Path]::GetDirectoryName($qaResolved)
if([IO.Path]::GetDirectoryName($qaDirectory) -ne 'C:\Users\1\AppData\Roaming\com.agentvn.player\saves' -or
    [IO.Path]::GetFileName($qaDirectory) -notmatch ('^qa_quick_'+$qaCandidate+'_'+[regex]::Escape($qaAttempt)+'_(0[1-9]|1[0-2])$') -or
    [IO.Path]::GetFileName($qaResolved) -notmatch '^quick-0[1-6]\.json$'){
    throw 'Only this current candidate session exact quick-save files may be locked'
}
foreach($qaSignal in @($Ready,$Release)){
    if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($qaSignal)) -ne $qaRun){
        throw 'Lock signal outside the exact session'
    }
    if(Test-Path -LiteralPath $qaSignal){throw 'Fresh lock signals required'}
}
if([IO.Path]::GetFullPath($Ready) -eq [IO.Path]::GetFullPath($Release)){
    throw 'Ready and release signals must differ'
}
if($ValidateOnly){Write-Output 'PASS_VALIDATED_ONLY';return}
$qaStream=$null
try{
    $qaStream=[IO.File]::Open($qaResolved,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    [IO.File]::WriteAllText($Ready,'READ_SHARED_WRITE_DELETE_DENIED')
    $qaDeadline=[DateTime]::UtcNow.AddSeconds(45)
    while(!(Test-Path -LiteralPath $Release) -and [DateTime]::UtcNow -lt $qaDeadline){
        Start-Sleep -Milliseconds 50
    }
    if(!(Test-Path -LiteralPath $Release)){throw 'Lock release deadline expired'}
}finally{if($qaStream){$qaStream.Dispose()}}
