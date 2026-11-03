param(
    [Parameter(Mandatory=$true)][ValidateSet('Block','Restore')][string]$Action,
    [Parameter(Mandatory=$true)][string]$RunDirectory,
    [Parameter(Mandatory=$true)][string]$InstallId
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'lib\runtime-qa-acl.ps1')
$qaRun=[IO.Path]::GetFullPath($RunDirectory)
if([IO.Path]::GetDirectoryName($qaRun) -ne 'F:\AgentVN\QA\Native-Runtime-State-20261020-01' -or
    [IO.Path]::GetFileName($qaRun) -notmatch '^exit-(\d{2})$'){throw 'Unexpected exit QA root'}
$qaIteration=$Matches[1]
if($InstallId -notmatch ('^qa_native_exit_20261020_'+$qaIteration+'_(retry|discard|auto_on|auto_off)_(agentvn|renpy)$')){
    throw 'Unexpected isolated game identity'
}
$qaParent='C:\Users\1\AppData\Roaming\com.agentvn.player\saves'
$qaTarget=[IO.Path]::GetFullPath((Join-Path $qaParent $InstallId))
if([IO.Path]::GetDirectoryName($qaTarget) -ne $qaParent){throw 'ACL leaf boundary mismatch'}
$qaPrep=Get-Content -LiteralPath (Join-Path $qaRun 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($qaPrep.status -ne 'PASS' -or $qaPrep.defaultStorage -ne 'PHYSICAL_DEFAULT_PATH' -or
    $qaPrep.sessionRoot -ne $qaRun -or !$InstallId.StartsWith($qaPrep.installId+'_')){
    throw 'Protected physical default profile required'
}
foreach($qaProfile in $qaPrep.profiles){
    if(!(Test-Path -LiteralPath $qaProfile.held)){throw 'Original profile not protected'}
}
foreach($qaDir in @($qaParent,$qaTarget)){
    $qaItem=Get-Item -LiteralPath $qaDir
    if(!$qaItem.PSIsContainer -or ($qaItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){
        throw 'ACL target must be a real exact QA leaf'
    }
}
$qaReceipt=Join-Path $qaRun ('acl-'+$InstallId+'.json')
$qaProbe=Join-Path $qaTarget '.qa-acl-probe.tmp'
if(Test-Path -LiteralPath $qaProbe){throw 'Fresh probe required'}
function Save-QAReceipt($qaPath,$qaValue){
    if(Test-Path -LiteralPath $qaPath){throw 'Never overwrite ACL recovery metadata'}
    [IO.File]::WriteAllText($qaPath,($qaValue|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
}
function Probe-QAWrite {
    $qaStream=$null
    try{
        $qaStream=[IO.File]::Open($qaProbe,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        $qaStream.WriteByte(1);$qaStream.Flush();return @{allowed=$true}
    }catch{
        $qaCause=$_.Exception.GetBaseException()
        return @{allowed=$false;type=$qaCause.GetType().FullName;hresult=$qaCause.HResult;
            accessDenied=($qaCause.HResult -eq -2147024891);error=$qaCause.Message}
    }finally{
        if($qaStream){$qaStream.Dispose()}
        if(Test-Path -LiteralPath $qaProbe){[IO.File]::Delete($qaProbe)}
    }
}
if($Action -eq 'Restore'){
    $qaOld=Get-Content -LiteralPath $qaReceipt -Raw -Encoding UTF8|ConvertFrom-Json
    if($qaOld.target -ne $qaTarget -or $qaOld.installId -ne $InstallId){throw 'Recovery identity mismatch'}
    $qaAcl=[IO.Directory]::GetAccessControl($qaTarget)
    $qaAcl.SetSecurityDescriptorSddlForm($qaOld.originalSddl,[Security.AccessControl.AccessControlSections]::Access)
    [IO.Directory]::SetAccessControl($qaTarget,$qaAcl)
    $qaActual=[IO.Directory]::GetAccessControl($qaTarget).Sddl
    $qaComparison=Compare-QAAccessDescriptor $qaOld.originalSddl $qaActual
    if(!$qaComparison.permissionsMatch){throw 'ACL restoration differs'}
    $qaProbeResult=Probe-QAWrite
    if(!$qaProbeResult.allowed){throw 'Restored real write probe failed'}
    Save-QAReceipt ($qaReceipt+'.restore.json') @{status='RESTORED';target=$qaTarget;installId=$InstallId;
        comparison=$qaComparison;actualSddl=$qaActual;probe=$qaProbeResult;at=(Get-Date).ToUniversalTime().ToString('o')}
    Write-Output 'PASS exact QA ACL restored and real write probe succeeded'
    exit
}
$qaIdentity=[Security.Principal.WindowsIdentity]::GetCurrent()
$qaPrincipal=[Security.Principal.WindowsPrincipal]::new($qaIdentity)
if($qaPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
    throw 'Ordinary-player ACL test must not be elevated'
}
$qaBefore=[IO.Directory]::GetAccessControl($qaTarget)
$qaResult=@{status='JOURNALED';target=$qaTarget;installId=$InstallId;originalSddl=$qaBefore.Sddl;
    sid=$qaIdentity.User.Value;isElevated=$false;at=(Get-Date).ToUniversalTime().ToString('o')}
Save-QAReceipt $qaReceipt $qaResult
$qaRule=[Security.AccessControl.FileSystemAccessRule]::new($qaIdentity.User,
    [Security.AccessControl.FileSystemRights]::Write,
    ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),
    [Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Deny)
$qaBefore.AddAccessRule($qaRule)
[IO.Directory]::SetAccessControl($qaTarget,$qaBefore)
$qaResult.deniedSddl=[IO.Directory]::GetAccessControl($qaTarget).Sddl
$qaResult.probe=Probe-QAWrite
$qaResult.status=if($qaResult.probe.allowed){'FAILED_NOT_DENIED'}else{'WRITE_DENIED'}
Save-QAReceipt ($qaReceipt+'.block.json') $qaResult
if($qaResult.probe.allowed -or !$qaResult.probe.accessDenied){throw 'Real access-denied write probe required'}
Write-Output 'PASS ordinary user write denied on exact QA save leaf'
