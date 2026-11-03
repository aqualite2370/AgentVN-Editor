$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'lib\runtime-qa-acl.ps1')
$qaRoot='F:\AgentVN-QA-InstalledRuntimeExit-20261018-02'
$qaTarget=Join-Path $qaRoot 'acl-tool-selftest-03'
if(!(Test-Path -LiteralPath $qaRoot) -or (Test-Path -LiteralPath $qaTarget)){throw 'Fresh bounded test folder required'}
$null=[IO.Directory]::CreateDirectory($qaTarget)
$qaBefore=[IO.Directory]::GetAccessControl($qaTarget)
$qaOriginal=$qaBefore.Sddl
$qaProbe=Join-Path $qaTarget 'probe.tmp'
$qaSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$qaResult=@{status='RUNNING';target=$qaTarget;originalSddl=$qaOriginal}
$qaJournal=Join-Path $qaRoot 'acl-tool-selftest-03-recovery.json'
if(Test-Path -LiteralPath $qaJournal){throw 'Fresh ACL journal required'}
[IO.File]::WriteAllText($qaJournal,($qaResult|ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding($false)))
try{
    $qaDeny=New-Object Security.AccessControl.FileSystemAccessRule($qaSid,
        [Security.AccessControl.FileSystemRights]::Write,
        [Security.AccessControl.InheritanceFlags]::None,
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Deny)
    $qaBefore.AddAccessRule($qaDeny)
    [IO.Directory]::SetAccessControl($qaTarget,$qaBefore)
    $qaDenied=$false
    try{[IO.File]::WriteAllText($qaProbe,'probe')}
    catch{
        $qaCause=$_.Exception.GetBaseException()
        $qaResult.deniedHresult=$qaCause.HResult
        $qaDenied=($qaCause.HResult -eq -2147024891)
    }
    if(!$qaDenied){throw 'Actual access denial required'}
    $qaResult.accessDenied=$true
}finally{
    $qaAcl=[IO.Directory]::GetAccessControl($qaTarget)
    $qaAcl.SetSecurityDescriptorSddlForm($qaOriginal,[Security.AccessControl.AccessControlSections]::Access)
    [IO.Directory]::SetAccessControl($qaTarget,$qaAcl)
    $qaResult.comparison=Compare-QAAccessDescriptor $qaOriginal ([IO.Directory]::GetAccessControl($qaTarget).Sddl)
    if(!$qaResult.comparison.permissionsMatch){throw 'Tool selftest ACL rule restore mismatch'}
}
[IO.File]::WriteAllText($qaProbe,'restored')
if([IO.File]::ReadAllText($qaProbe) -ne 'restored'){throw 'Restored write probe bytes mismatch'}
[IO.File]::Delete($qaProbe)
$qaResult.status='PASS'
$qaResult.restoredSddl=[IO.Directory]::GetAccessControl($qaTarget).Sddl
$qaFile=Join-Path $qaRoot 'acl-tool-selftest-03.json'
if(Test-Path -LiteralPath $qaFile){throw 'No evidence overwrite'}
[IO.File]::WriteAllText($qaFile,($qaResult|ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding($false)))
Write-Output 'PASS: actual .NET ACL denial and exact restoration under ordinary user'
