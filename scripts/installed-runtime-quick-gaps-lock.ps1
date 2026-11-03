param(
    [Parameter(Mandatory=$true)][string]$Target,
    [Parameter(Mandatory=$true)][string]$Ready,
    [Parameter(Mandatory=$true)][string]$Release,
    [string]$RunDirectory='',
    [switch]$Current1922,
    [switch]$ValidateOnly
)
$ErrorActionPreference='Stop'
$qaResolved=[IO.Path]::GetFullPath($Target)
$qaDirectory=[IO.Path]::GetDirectoryName($qaResolved)
$qaBase='C:\Users\1\AppData\Roaming\com.agentvn.player\saves'
$qaNative=$RunDirectory -ne ''
$qaIdentityPattern=if($Current1922){'^qa_current_quick_1922_\d{2}_(0[1-9]|1[0-2])$'}
    elseif($qaNative){'^qa_native_quick_20261020_\d{2}_(0[1-9]|1[0-2])$'}
    else{'^qa_quick_gaps_20261019_(0[1-9]|1[0-2])$'}
$qaSignalRoot=if($qaNative){[IO.Path]::GetFullPath($RunDirectory)}
    else{'F:\AgentVN\QA\Runtime-Quick-Gaps-20261019-01'}
if($qaNative -and ([IO.Path]::GetDirectoryName($qaSignalRoot) -ne
    'F:\AgentVN\QA\Native-Runtime-State-20261020-01' -or
    [IO.Path]::GetFileName($qaSignalRoot) -notmatch $(if($Current1922){'^installed-quick-1922-\d{2}$'}else{'^quick-\d{2}$'}))){
    throw 'Native signals outside exact runtime quick session'
}
if($Current1922 -and (!$qaNative -or
    [IO.Path]::GetFileName($qaDirectory) -notmatch (
      '^qa_current_quick_1922_'+[regex]::Escape([IO.Path]::GetFileName($qaSignalRoot).Substring(21))+
      '_(0[1-9]|1[0-2])$'))){throw 'Current session and save identity differ'}
if([IO.Path]::GetDirectoryName($qaDirectory) -ne $qaBase -or
    [IO.Path]::GetFileName($qaDirectory) -notmatch $qaIdentityPattern -or
    [IO.Path]::GetFileName($qaResolved) -notmatch '^quick-0[1-6]\.json$'){
    throw 'Only this fresh suite exact quick-save files may be locked'
}
foreach($qaSignal in @($Ready,$Release)){
    if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($qaSignal)) -ne $qaSignalRoot){
        throw 'Signal outside exact session root'
    }
    if(Test-Path -LiteralPath $qaSignal){throw 'Fresh signals required'}
}
if($ValidateOnly){Write-Output 'PASS_VALIDATED_ONLY';return}
$qaStream=$null
try{
    $qaStream=[IO.File]::Open($qaResolved,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    [IO.File]::WriteAllText($Ready,'READ_SHARED_WRITE_DELETE_DENIED')
    $qaDeadline=[DateTime]::UtcNow.AddSeconds(45)
    while(!(Test-Path -LiteralPath $Release) -and [DateTime]::UtcNow -lt $qaDeadline){Start-Sleep -Milliseconds 50}
    if(!(Test-Path -LiteralPath $Release)){throw 'Lock release deadline expired'}
}finally{if($qaStream){$qaStream.Dispose()}}
