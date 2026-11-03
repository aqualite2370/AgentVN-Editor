param(
    [Parameter(Mandatory=$true)][ValidateSet('Block','Restore','ValidateProvenance')][string]$Action,
    [Parameter(Mandatory=$true)][string]$RunDirectory
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'lib\runtime-qa-acl.ps1')
function Get-QAFileSha256([string]$Path){
    $qaHash=[Security.Cryptography.SHA256]::Create()
    $qaInput=$null
    try{
        $qaInput=[IO.File]::OpenRead($Path)
        return [BitConverter]::ToString($qaHash.ComputeHash($qaInput)).Replace('-','').ToLowerInvariant()
    }finally{
        if($qaInput){$qaInput.Dispose()}
        $qaHash.Dispose()
    }
}
$qaRun=[IO.Path]::GetFullPath($RunDirectory)
$qaNative=([IO.Path]::GetDirectoryName($qaRun) -ceq 'F:\AgentVN\QA\Native-Runtime-State-20261020-01' -and
    [IO.Path]::GetFileName($qaRun) -match '^portable-\d{2}$')
$qaInstalled=([IO.Path]::GetDirectoryName($qaRun) -ceq 'F:\AgentVN\QA\Windows-Package-20261021-01' -and
    [IO.Path]::GetFileName($qaRun) -match '^runtime-\d{2}$')
if(!$qaNative -and !$qaInstalled){throw 'Unexpected QA root'}
$qaPrep=Get-Content -LiteralPath (Join-Path $qaRun 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($qaPrep.status -ne 'PASS' -or $qaPrep.defaultStorage -ne 'PHYSICAL_DEFAULT_PATH' -or
    $qaPrep.sessionRoot -ne $qaRun -or $qaPrep.gameId -notmatch '^[a-zA-Z0-9_-]+$'){throw 'Unexpected fixture'}
if($qaInstalled) {
    if($qaPrep.scope -cne 'ACTUAL_INSTALLED_EDITOR_GENERATED_WINDOWS_PORTABLE'){throw 'Installed portable provenance required'}
    if($qaPrep.nativeCandidateBinding) {
        & node.exe (Join-Path $PSScriptRoot 'lib\windows-current-native-source.cjs') 'portable-preparation' (Join-Path $qaRun 'preparation.json')
        if($LASTEXITCODE -ne 0){throw 'Current installed candidate portable provenance failed'}
    } elseif($qaPrep.editorVersion -ceq '1.9.22') {
        $qaSourceFile='F:\AgentVN\QA\Windows-Package-20261021-01\editor-03\report.json'
        $qaAuditFile='F:\AgentVN\QA\Windows-Package-20261021-01\native-ui-audit-02\report.json'
        if(!$qaPrep.nativeUIBuildSource -or $qaPrep.sourceReport.path -cne $qaSourceFile -or
          $qaPrep.sourceAudit.path -cne $qaAuditFile){throw 'Exact current native-UI build evidence required'}
        $qaHashSource=Get-QAFileSha256 $qaSourceFile
        $qaHashAudit=Get-QAFileSha256 $qaAuditFile
        if($qaHashSource -cne $qaPrep.sourceReport.sha256 -or $qaHashAudit -cne $qaPrep.sourceAudit.sha256){throw 'Current native build/audit bytes differ'}
        $qaCurrent=Get-Content -LiteralPath $qaSourceFile -Raw -Encoding UTF8|ConvertFrom-Json
        $qaAudit=Get-Content -LiteralPath $qaAuditFile -Raw -Encoding UTF8|ConvertFrom-Json
        if($qaCurrent.status -cne 'PASS' -or !$qaCurrent.nativeChooserClaim -or !$qaCurrent.normalCloseClaim -or
          $qaCurrent.builds -ne 1 -or $qaAudit.status -cne 'PASS' -or $qaAudit.source.sha256 -cne $qaHashSource -or
          $qaCurrent.windowsPortable.sha256 -cne $qaPrep.executable.sha256){throw 'Current native portable not proven'}
    } elseif($qaPrep.editorVersion -cne '1.9.16'){throw 'Unsupported installed portable provenance'}
}
if($Action -eq 'ValidateProvenance'){
    Write-Output 'PASS portable fixture and source provenance; no ACL or profile mutation performed'
    exit
}
$qaClient=[IO.Path]::GetDirectoryName($qaPrep.executable.path)
if([IO.Path]::GetDirectoryName($qaClient) -ne $qaRun){throw 'Client must be an exact QA child'}
$qaTarget=[IO.Path]::GetFullPath((Join-Path $qaClient ('saves\'+$qaPrep.gameId+'\preview_gamecli')))
if($qaTarget -ne $qaPrep.expectedTarget -or [IO.Path]::GetDirectoryName($qaPrep.executable.path) -ne $qaClient){
    throw 'Exact EXE-side QA leaf required'
}
foreach($qaProfile in $qaPrep.profiles){if(!(Test-Path -LiteralPath $qaProfile.held)){throw 'Original profile not protected'}}
foreach($qaDir in @($qaRun,$qaClient,(Join-Path $qaClient 'saves'),
    (Join-Path $qaClient ('saves\'+$qaPrep.gameId)),$qaTarget)){
    $qaItem=Get-Item -LiteralPath $qaDir
    if(!$qaItem.PSIsContainer -or ($qaItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Linked or absent QA path'}
}
$qaReceipt=Join-Path $qaRun 'portable-acl.json'
$qaProbe=Join-Path $qaTarget '.qa-write-probe.tmp'
if(Test-Path -LiteralPath $qaProbe){throw 'Fresh probe required'}
function Save-QA($qaPath,$qaValue){
    if(Test-Path -LiteralPath $qaPath){throw 'Never overwrite recovery metadata'}
    [IO.File]::WriteAllText($qaPath,($qaValue|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
}
function Probe-QA {
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
    if($qaOld.target -ne $qaTarget){throw 'Recovery identity mismatch'}
    $qaAcl=[IO.Directory]::GetAccessControl($qaTarget)
    $qaAcl.SetSecurityDescriptorSddlForm($qaOld.originalSddl,[Security.AccessControl.AccessControlSections]::Access)
    [IO.Directory]::SetAccessControl($qaTarget,$qaAcl)
    $qaActual=[IO.Directory]::GetAccessControl($qaTarget).Sddl
    $qaComparison=Compare-QAAccessDescriptor $qaOld.originalSddl $qaActual
    if(!$qaComparison.permissionsMatch){throw 'Restored permissions differ'}
    $qaProbeResult=Probe-QA
    if(!$qaProbeResult.allowed){throw 'Restored real write probe failed'}
    Save-QA ($qaReceipt+'.restore.json') @{status='RESTORED';target=$qaTarget;actualSddl=$qaActual;
        comparison=$qaComparison;probe=$qaProbeResult;at=(Get-Date).ToUniversalTime().ToString('o')}
    Write-Output 'PASS exact QA EXE-side ACL restored and write probe succeeded';exit
}
$qaIdentity=[Security.Principal.WindowsIdentity]::GetCurrent()
$qaPrincipal=[Security.Principal.WindowsPrincipal]::new($qaIdentity)
if($qaPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Ordinary non-admin player required'}
$qaBefore=[IO.Directory]::GetAccessControl($qaTarget)
$qaResult=@{status='JOURNALED';target=$qaTarget;originalSddl=$qaBefore.Sddl;isElevated=$false;
    sid=$qaIdentity.User.Value;at=(Get-Date).ToUniversalTime().ToString('o')}
Save-QA $qaReceipt $qaResult
$qaRule=[Security.AccessControl.FileSystemAccessRule]::new($qaIdentity.User,
    [Security.AccessControl.FileSystemRights]::Write,
    ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),
    [Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Deny)
$qaBefore.AddAccessRule($qaRule);[IO.Directory]::SetAccessControl($qaTarget,$qaBefore)
$qaResult.deniedSddl=[IO.Directory]::GetAccessControl($qaTarget).Sddl
$qaResult.probe=Probe-QA
$qaResult.status=if($qaResult.probe.allowed){'FAILED_NOT_DENIED'}else{'WRITE_DENIED'}
Save-QA ($qaReceipt+'.block.json') $qaResult
if($qaResult.probe.allowed -or !$qaResult.probe.accessDenied){throw 'True ACL access-denied probe required'}
Write-Output 'PASS ordinary user write denied on exact EXE-side QA save leaf'
