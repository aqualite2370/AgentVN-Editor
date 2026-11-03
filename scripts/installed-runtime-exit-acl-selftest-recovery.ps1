$ErrorActionPreference='Stop'
$qaTarget='F:\AgentVN-QA-InstalledRuntimeExit-20261018-02\acl-tool-selftest'
$qaFile='F:\AgentVN-QA-InstalledRuntimeExit-20261018-02\acl-tool-selftest-initial-failure-recovery.json'
if(Test-Path -LiteralPath $qaFile){throw 'No recovery evidence overwrite'}
$qaItem=Get-Item -LiteralPath $qaTarget
if(!$qaItem.PSIsContainer -or ($qaItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Exact selftest directory required'}
$qaSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$qaAcl=[IO.Directory]::GetAccessControl($qaTarget)
$qaRules=@($qaAcl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier])|Where-Object {
    $_.IdentityReference -eq $qaSid -and $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Deny -and
    $_.FileSystemRights -eq [Security.AccessControl.FileSystemRights]::Write -and
    $_.InheritanceFlags -eq [Security.AccessControl.InheritanceFlags]::None -and
    $_.PropagationFlags -eq [Security.AccessControl.PropagationFlags]::None
})
if($qaRules.Count -ne 1){throw 'Only the one exact selftest-created deny rule may be removed'}
$qaReport=@{status='PREPARED';target=$qaTarget;beforeSddl=$qaAcl.Sddl;sid=$qaSid.Value;
    cause='Tool restored all SDDL sections; non-admin SACL privilege was unnecessarily required'}
[IO.File]::WriteAllText($qaFile,($qaReport|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
$null=$qaAcl.RemoveAccessRuleSpecific($qaRules[0])
[IO.Directory]::SetAccessControl($qaTarget,$qaAcl)
$qaProbe=Join-Path $qaTarget 'recovery-probe.tmp'
if(Test-Path -LiteralPath $qaProbe){throw 'Fresh recovery probe required'}
[IO.File]::WriteAllText($qaProbe,'restored')
if([IO.File]::ReadAllText($qaProbe) -ne 'restored'){throw 'Recovery write probe mismatch'}
[IO.File]::Delete($qaProbe)
$qaReport.status='RESTORED'
$qaReport.afterSddl=[IO.Directory]::GetAccessControl($qaTarget).Sddl
[IO.File]::WriteAllText(($qaFile+'.result.json'),($qaReport|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
Write-Output 'PASS: exact selftest-only deny rule removed, ordinary-user write probe restored'
