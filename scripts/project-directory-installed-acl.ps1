param(
    [Parameter(Mandatory=$true)][ValidateSet("deny", "restore")][string]$Mode,
    [Parameter(Mandatory=$true)][string]$Directory,
    [Parameter(Mandatory=$true)][string]$Receipt
)
$ErrorActionPreference = "Stop"
$target = [IO.Path]::GetFullPath($Directory)
$receiptPath = [IO.Path]::GetFullPath($Receipt)
$qaPrefix = "F:\AgentVN\QA\Project-Directory-Installed-20261022-"
$legacyBoundary = $target.StartsWith($qaPrefix, [StringComparison]::OrdinalIgnoreCase) -and
    $receiptPath.StartsWith($qaPrefix, [StringComparison]::OrdinalIgnoreCase)
$currentParent = [IO.Path]::GetDirectoryName($target)
$currentRoot = "F:\AgentVN\QA\Functional-Continuation-20261101"
$currentBoundary = [IO.Path]::GetDirectoryName($currentParent) -eq $currentRoot -and
    [IO.Path]::GetFileName($currentParent) -match '^session-\d{2}$' -and
    $receiptPath -eq [IO.Path]::Combine($currentParent, 'acl-before.json')
if ((-not $legacyBoundary -and -not $currentBoundary) -or
    [IO.Path]::GetFileName($target) -ne (-join [char[]]@(0x4e2d,0x6587,0x20,0x4fdd,0x5b58,0x76ee,0x5f55,0x4e59))) {
    throw "ACL target must be the explicitly owned project-B test directory."
}
$item = Get-Item -LiteralPath $target -Force
if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "ACL target must be an existing physical test directory."
}
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$sections = [Security.AccessControl.AccessControlSections]::All
if ($Mode -eq "deny") {
    if (Test-Path -LiteralPath $receiptPath) { throw "Never overwrite ACL evidence." }
    # .NET Framework filesystem ACL APIs avoid PS7/Windows PowerShell module
    # autoload conflicts inherited by a Node-hosted legacy PowerShell child.
    $acl = [IO.Directory]::GetAccessControl($target)
    $before = $acl.GetSecurityDescriptorSddlForm($sections)
    $proof = [ordered]@{ directory=$target; sid=$sid.Value; before=$before; at=[DateTime]::UtcNow.ToString("o"); status="PREPARED" }
    $proof | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
        $sid,
        [Security.AccessControl.FileSystemRights]::Write,
        [Security.AccessControl.InheritanceFlags]"ContainerInherit,ObjectInherit",
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Deny
    )
    $acl.AddAccessRule($rule)
    [IO.Directory]::SetAccessControl($target, $acl)
    $proof.after = ([IO.Directory]::GetAccessControl($target)).GetSecurityDescriptorSddlForm($sections)
    if ($proof.after -eq $before) { throw "Deny ACL did not change." }
    $proof.status = "DENIED"
    $proof | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    $proof | ConvertTo-Json -Compress
} else {
    $proof = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    if ($proof.directory -ne $target -or $proof.sid -ne $sid.Value -or -not $proof.before) {
        throw "ACL receipt does not identify this target and account."
    }
    $acl = New-Object Security.AccessControl.DirectorySecurity
    # Restore the DACL we changed; do not mark the SACL/owner/group as modified
    # (that would require SeSecurityPrivilege unrelated to this write test).
    $acl.SetSecurityDescriptorSddlForm($proof.before, [Security.AccessControl.AccessControlSections]::Access)
    [IO.Directory]::SetAccessControl($target, $acl)
    $restored = ([IO.Directory]::GetAccessControl($target)).GetSecurityDescriptorSddlForm($sections)
    # NTFS may add the auto-inherited descriptor marker when writing back an
    # inherited DACL. Accept only that marker difference, never changed ACEs,
    # protection, owner or group. Preserve both raw strings in the evidence.
    $normalizedBefore = $proof.before -replace 'D:AI(?=\(|$)', 'D:'
    $normalizedRestored = $restored -replace 'D:AI(?=\(|$)', 'D:'
    if ($normalizedRestored -ne $normalizedBefore) { throw "Original ACL permission entries were not restored." }
    [ordered]@{status="RESTORED"; directory=$target; before=$proof.before; sddl=$restored;
        autoInheritedMarkerNormalized=($restored -ne $proof.before);
        at=[DateTime]::UtcNow.ToString("o")} | ConvertTo-Json -Compress
}
