param(
    [Parameter(Mandatory=$true)][ValidateSet("deny","restore")][string]$Mode,
    [Parameter(Mandatory=$true)][string]$Directory,
    [Parameter(Mandatory=$true)][string]$Receipt
)
$ErrorActionPreference="Stop"
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$target=[IO.Path]::GetFullPath($Directory)
$receiptPath=[IO.Path]::GetFullPath($Receipt)
$prefix="F:\AgentVN\QA\Project-Directory-Write-20261024-01\"
$originalScope=$target.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -and
    $receiptPath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)
$installedScope=$target -match '^F:\\AgentVN\\QA\\Editor-Repair-Release-20261024-01\\directory\\green-\d{2}\\owned-save-directory$' -and
    [IO.Path]::GetFileName($receiptPath) -eq "acl-before.json"
if ((-not $originalScope -and -not $installedScope) -or
    [IO.Path]::GetFileName($target) -ne "owned-save-directory" -or
    [IO.Path]::GetDirectoryName($target) -ne [IO.Path]::GetDirectoryName($receiptPath)) {
    throw "Only the owned regression directory and its sibling receipt may be used."
}
$item=Get-Item -LiteralPath $target -Force
if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "Target must be an existing physical regression directory."
}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$sections=[Security.AccessControl.AccessControlSections]::All
if ($Mode -eq "deny") {
    if (Test-Path -LiteralPath $receiptPath) {throw "Never overwrite an ACL receipt."}
    $acl=[IO.Directory]::GetAccessControl($target)
    $proof=[ordered]@{directory=$target;sid=$sid.Value;before=$acl.GetSecurityDescriptorSddlForm($sections);status="PREPARED"}
    $proof | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    $rule=New-Object Security.AccessControl.FileSystemAccessRule(
        $sid,[Security.AccessControl.FileSystemRights]::Write,
        [Security.AccessControl.InheritanceFlags]"ContainerInherit,ObjectInherit",
        [Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Deny)
    $acl.AddAccessRule($rule)
    [IO.Directory]::SetAccessControl($target,$acl)
    $proof.after=([IO.Directory]::GetAccessControl($target)).GetSecurityDescriptorSddlForm($sections)
    if ($proof.after -eq $proof.before) {throw "Deny ACL did not change."}
    $proof.status="DENIED"
    $proof | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    $proof | ConvertTo-Json -Compress
} else {
    $proof=Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    if ($proof.directory -ne $target -or $proof.sid -ne $sid.Value -or -not $proof.before) {throw "Wrong ACL receipt."}
    $acl=New-Object Security.AccessControl.DirectorySecurity
    $acl.SetSecurityDescriptorSddlForm($proof.before,[Security.AccessControl.AccessControlSections]::Access)
    [IO.Directory]::SetAccessControl($target,$acl)
    $actual=([IO.Directory]::GetAccessControl($target)).GetSecurityDescriptorSddlForm($sections)
    if (($actual -replace 'D:AI(?=\(|$)','D:') -ne ($proof.before -replace 'D:AI(?=\(|$)','D:')) {throw "ACL not restored."}
    [ordered]@{status="RESTORED";before=$proof.before;sddl=$actual;directory=$target} | ConvertTo-Json -Compress
}
