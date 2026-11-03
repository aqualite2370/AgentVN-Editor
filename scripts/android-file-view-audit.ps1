param([ValidatePattern('^\d{2}$')][string]$Attempt='01')
# Read-only file-view diagnosis. No elevation, launch, cache or DB modification.
$ErrorActionPreference='Stop'
$run='F:\AgentVN\QA\Android-Package-20261021-01\file-view-'+$Attempt
if(Test-Path -LiteralPath $run){throw 'Fresh evidence directory required'}
$null=New-Item -ItemType Directory -Path $run
Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $run 'executed.ps1')
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class AgentVNReadOnlyViews {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern uint QueryDosDeviceW(string device, StringBuilder target, int length);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint count, uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
    public static extern int GetCurrentPackageFullName(ref int length, StringBuilder name);
}
'@
$buffer=[Text.StringBuilder]::new(4096)
if(![AgentVNReadOnlyViews]::QueryDosDeviceW('C:',$buffer,4096)){throw 'Cannot resolve C device'}
$device=$buffer.ToString()
if($device -cnotmatch '^\\Device\\HarddiskVolume\d+$'){throw 'Unexpected C volume mapping'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
$length=0
$packageCode=[AgentVNReadOnlyViews]::GetCurrentPackageFullName([ref]$length,$null)
$package=$null
if($length -gt 0){
    $text=[Text.StringBuilder]::new($length)
    $packageCode=[AgentVNReadOnlyViews]::GetCurrentPackageFullName([ref]$length,$text)
    if($packageCode -eq 0){$package=$text.ToString()}
}
function Observe($file,$kind){
    $row=@{kind=$kind;path=$file;exists=[IO.File]::Exists($file);error=$null}
    if($row.exists){
        $stream=$null;$hasher=$null
        try{
            $stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
            $final=[Text.StringBuilder]::new(4096)
            $count=[AgentVNReadOnlyViews]::GetFinalPathNameByHandleW($stream.SafeFileHandle,$final,4096,0)
            if(!$count -or $count -ge 4096){throw 'Final path not available'}
            $row.finalPath=$final.ToString();$row.bytes=$stream.Length
            $hasher=[Security.Cryptography.SHA256]::Create()
            $row.sha256=([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant()
        }catch{$row.error=$_.Exception.Message}
        finally{if($stream){$stream.Dispose()};if($hasher){$hasher.Dispose()}}
    }
    return $row
}
$local='C:\Users\1\AppData\Local'
$roaming='C:\Users\1\AppData\Roaming'
$packageCache=$local+'\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache'
$specs=@(
    @{name='database';lexical=($roaming+'\com.agentvn.editor\backend\vn_engine.db')
        packaged=($packageCache+'\Roaming\com.agentvn.editor\backend\vn_engine.db')
        expected='b40147078aeea88661de5291e056999426dcfa8835a6de179999fd744aef26b2'},
    @{name='windows-cache';lexical=($local+'\com.agentvn.editor\windows-env\windows-env-check.json')
        packaged=($packageCache+'\Local\com.agentvn.editor\windows-env\windows-env-check.json')
        expected='61ee5c0ae52f718e8172b9ae55b4ffcab37b122ebe5df631fd6a8de716608af1'}
)
$r=@{status='OBSERVED_NOT_RESTORATION_PASS';at=[DateTime]::UtcNow.ToString('o')
    processId=$PID;isElevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    packageIdentity=$package;packageApiCode=$packageCode;device=$device
    productWrites=0;builds=0;cases=@()}
foreach($spec in $specs){
    $physical='\\?\GLOBALROOT'+$device+$spec.lexical.Substring(2)
    $r.cases+=@{name=$spec.name;expectedPhysicalSha256=$spec.expected;views=@(
        (Observe $spec.lexical 'lexical'),(Observe $spec.packaged 'explicit-package'),
        (Observe $physical 'volume-device')
    )}
}
$r.finishedAt=[DateTime]::UtcNow.ToString('o')
[IO.File]::WriteAllText((Join-Path $run 'report.json'),($r|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
$r|ConvertTo-Json -Depth 12
