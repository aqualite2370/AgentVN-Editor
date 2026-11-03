param(
    [ValidateSet('Prepare','Restore')][string]$Action,
    [Parameter(Mandatory=$true)][string]$RunDirectory,
    [switch]$ValidateOnly,
    [switch]$SelfTest
)
$ErrorActionPreference='Stop'
$sourceFile=Join-Path $PSScriptRoot 'native-dev-preview-profile.ps1'
$stream=[IO.File]::OpenRead($sourceFile)
$hasher=[Security.Cryptography.SHA256]::Create()
try{$sourceSha=([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
finally{$hasher.Dispose();$stream.Dispose()}
if($sourceSha -ne 'e20d360c7c7708fdbc0e6e77125cdc49cd8b77beac4f379331afae66942af77f'){
    throw 'Historical profile helper changed'
}
$source=[IO.File]::ReadAllText($sourceFile)
$before=@'
$roots=@('C:\Users\1\AppData\Roaming\com.agentvn.player',
         'C:\Users\1\AppData\Local\com.agentvn.player',
         'C:\Users\1\AppData\Local\com.agentvn.editor\gamecli-preview')
'@
$after=@'
$roots=@('C:\Users\1\AppData\Roaming\com.agentvn.player',
         'C:\Users\1\AppData\Local\com.agentvn.player',
         'C:\Users\1\AppData\Local\com.agentvn.editor\gamecli-preview',
         'C:\Users\1\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\com.agentvn.player',
         'C:\Users\1\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\com.agentvn.player',
         'C:\Users\1\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\com.agentvn.editor\gamecli-preview')
'@
function ReplaceExact($from,$to) {
    if(($script:source.Split([string[]]@($from),[StringSplitOptions]::None).Count-1) -ne 1){throw 'Expected exact single profile adaptation'}
    $script:source=$script:source.Replace($from,$to)
}
# Keep the original journal-before-move and restoration/NTFS-byte checks.
# Add only the six explicitly named profile views and distinct F targets.
ReplaceExact ($before.Replace("`r`n","`n")) ($after.Replace("`r`n","`n"))
ReplaceExact '$byteInventory=$original -ne $roots[1]' '$byteInventory=$original -notin @($roots[1],$roots[4])'
ReplaceExact "('player-'+(Split-Path (Split-Path `$original -Parent) -Leaf).ToLowerInvariant())" "('profile-'+[Array]::IndexOf(`$roots,`$original))"
if([IO.Path]::GetFullPath($RunDirectory) -ne 'F:\AgentVN\QA\Native-Dev-Preview-Repair-20261020-02\installed-03'){
    throw 'Only this candidate preview session is permitted'
}
if($SelfTest) {
    $null=[ScriptBlock]::Create($source)
    if(!$source.Contains("'profile-'+[Array]::IndexOf(`$roots,`$original)") -or
       !$source.Contains('$byteInventory=$original -notin @($roots[1],$roots[4])')){
        throw 'Profile isolation adaptation absent'
    }
    Write-Output 'PASS six exact profile views, unique targets, original journal and restoration retained; no mutation'
    return
}
& ([ScriptBlock]::Create($source)) -Action $Action -RunDirectory $RunDirectory -ValidateOnly:$ValidateOnly
