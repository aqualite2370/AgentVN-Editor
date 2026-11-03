param(
    [Parameter(Mandatory=$true)][ValidateSet("Block","Restore")][string]$Mode,
    [Parameter(Mandatory=$true)][string]$Target,
    [Parameter(Mandatory=$true)][string]$RunRoot,
    [Parameter(Mandatory=$true)][string]$ReportPath
)
$ErrorActionPreference = "Stop"
$PortableTestRoot = [IO.Path]::GetFullPath($RunRoot).TrimEnd('\')
$PortableTestTarget = [IO.Path]::GetFullPath($Target)
$PortableAclReport = [IO.Path]::GetFullPath($ReportPath)
foreach ($PortableCheckedPath in @($PortableTestTarget, $PortableAclReport)) {
    if (-not $PortableCheckedPath.StartsWith($PortableTestRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing ACL operation outside explicit test run: $PortableCheckedPath"
    }
}
if ($Mode -eq "Restore") {
    $PortableOriginal = Get-Content -LiteralPath $PortableAclReport -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($PortableOriginal.target -ne $PortableTestTarget) { throw "ACL restoration target mismatch" }
    $PortableRestoredAcl = Get-Acl -LiteralPath $PortableTestTarget
    $PortableRestoredAcl.SetSecurityDescriptorSddlForm($PortableOriginal.originalSddl)
    Set-Acl -LiteralPath $PortableTestTarget -AclObject $PortableRestoredAcl
    @{
        status = "RESTORED"
        target = $PortableTestTarget
        originalSddl = $PortableOriginal.originalSddl
        actualSddl = (Get-Acl -LiteralPath $PortableTestTarget).Sddl
    } | ConvertTo-Json | Set-Content -LiteralPath ($PortableAclReport + ".restore.json") -Encoding UTF8
    exit 0
}
if (Test-Path -LiteralPath $PortableAclReport) { throw "Never overwrite ACL evidence" }
$PortableCurrentAcl = Get-Acl -LiteralPath $PortableTestTarget
$PortableSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$PortableReceipt = @{
    status = "PREPARED"
    target = $PortableTestTarget
    originalSddl = $PortableCurrentAcl.Sddl
    sid = $PortableSid.Value
}
# Persist recovery information before changing the ACL.
$PortableReceipt | ConvertTo-Json | Set-Content -LiteralPath $PortableAclReport -Encoding UTF8
$PortableDeny = New-Object Security.AccessControl.FileSystemAccessRule(
    $PortableSid,
    [Security.AccessControl.FileSystemRights]::Write,
    ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Deny
)
$PortableCurrentAcl.AddAccessRule($PortableDeny)
Set-Acl -LiteralPath $PortableTestTarget -AclObject $PortableCurrentAcl
$PortableReceipt.status = "WRITE_DENIED"
$PortableReceipt | ConvertTo-Json | Set-Content -LiteralPath $PortableAclReport -Encoding UTF8
