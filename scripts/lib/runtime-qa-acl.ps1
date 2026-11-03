function Compare-QAAccessDescriptor([string]$Before,[string]$After){
    $qaA=New-Object Security.AccessControl.RawSecurityDescriptor($Before)
    $qaB=New-Object Security.AccessControl.RawSecurityDescriptor($After)
    # Windows may set only the bookkeeping "auto-inherited" bit when a DACL
    # is applied. Do not ignore ACE inheritance flags, protection, owner/group,
    # ACL bytes, or any other descriptor flag.
    $qaAuto=[int][Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherited
    $qaFlagsA=[int]$qaA.ControlFlags
    $qaFlagsB=[int]$qaB.ControlFlags
    $qaBytesA=New-Object byte[] $qaA.DiscretionaryAcl.BinaryLength
    $qaBytesB=New-Object byte[] $qaB.DiscretionaryAcl.BinaryLength
    $qaA.DiscretionaryAcl.GetBinaryForm($qaBytesA,0)
    $qaB.DiscretionaryAcl.GetBinaryForm($qaBytesB,0)
    $qaSameDacl=[Convert]::ToBase64String($qaBytesA) -ceq [Convert]::ToBase64String($qaBytesB)
    $qaSameIdentity=($qaA.Owner.Value -eq $qaB.Owner.Value -and $qaA.Group.Value -eq $qaB.Group.Value)
    $qaSameFlags=(($qaFlagsA -band (-bnot $qaAuto)) -eq ($qaFlagsB -band (-bnot $qaAuto)))
    return @{permissionsMatch=($qaSameDacl -and $qaSameIdentity -and $qaSameFlags);
        daclBytesMatch=$qaSameDacl;ownerGroupMatch=$qaSameIdentity;allOtherFlagsMatch=$qaSameFlags;
        exactSddlMatch=($Before -ceq $After);flagsBefore=$qaFlagsA;flagsAfter=$qaFlagsB;
        permittedMetadataBit=$qaAuto;daclBeforeBase64=[Convert]::ToBase64String($qaBytesA);
        daclAfterBase64=[Convert]::ToBase64String($qaBytesB)}
}
