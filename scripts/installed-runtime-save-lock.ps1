param(
    [Parameter(Mandatory=$true)][string]$Target,
    [Parameter(Mandatory=$true)][string]$Ready,
    [Parameter(Mandatory=$true)][string]$Release
)
$ErrorActionPreference='Stop'
$qaRoot='C:\Users\1\AppData\Roaming\com.agentvn.player\saves\qa_runtime_exceptions_20261018'
$qaWork='F:\AgentVN-QA-InstalledRuntimeExceptions-20261018-01'
$qaResolved=[IO.Path]::GetFullPath($Target)
if([IO.Path]::GetDirectoryName($qaResolved) -ne $qaRoot -or
    [IO.Path]::GetFileName($qaResolved) -notmatch '^quick-0[1-6]\.json$'){
    throw 'Only this session exact quick-save files may be locked'
}
foreach($qaSignal in @($Ready,$Release)){
    if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($qaSignal)) -ne $qaWork){throw 'Signal path outside session'}
    if(Test-Path -LiteralPath $qaSignal){throw 'Fresh lock signals required'}
}
$qaStream=$null
try{
    # Read sharing permits inspection; denying Delete/Write causes the actual
    # Rust atomic rename to fail without replacing or deleting the old save.
    $qaStream=[IO.File]::Open($qaResolved,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    [IO.File]::WriteAllText($Ready,'READ_SHARED_WRITE_DELETE_DENIED')
    $qaDeadline=[DateTime]::UtcNow.AddSeconds(45)
    while(!(Test-Path -LiteralPath $Release) -and [DateTime]::UtcNow -lt $qaDeadline){
        Start-Sleep -Milliseconds 50
    }
    if(!(Test-Path -LiteralPath $Release)){throw 'Lock release deadline expired'}
}finally{if($qaStream){$qaStream.Dispose()}}
