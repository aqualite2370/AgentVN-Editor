param(
    [ValidateSet('SelfTest','Launch','Elevated','Task')][string]$Action='SelfTest',
    [ValidatePattern('^\d{2}$')][string]$Attempt='01'
)
# No APK, SDK changes or product changes. Test only fresh, exact marker paths.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -Force
$qa='F:\AgentVN\QA\Android-Package-20261021-01'
$run=Join-Path $qa ('path-probe-'+$Attempt)
function Boundary($directory) {
    $full=[IO.Path]::GetFullPath($directory)
    if([IO.Path]::GetDirectoryName($full) -cne $qa -or
        [IO.Path]::GetFileName($full) -cnotmatch '^path-probe-\d{2}$') {throw 'Exact native path-probe root required'}
}
Boundary $run
if($Action -ceq 'SelfTest') {
    foreach($case in @(@($run,$true),@($qa,$false),@(($run+'\child'),$false),
        @('C:\Users\1',$false),@('F:\AgentVN',$false),@(($qa+'\path-probe-1'),$false))) {
        $ok=$true;try {Boundary $case[0]}catch {$ok=$false}
        if($ok -ne $case[1]) {throw 'Native probe boundary regression'}
    }
    'PASS: six marker-only native probe boundaries; no filesystem writes';exit
}
function Save($file,$value) {
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 16),[Text.UTF8Encoding]::new($false))
}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$admin=([Security.Principal.WindowsPrincipal]::new($identity)).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($Action -ceq 'Launch') {
    if($admin) {throw 'Non-admin origin required'}
    if(Test-Path -LiteralPath $run) {throw 'Fresh immutable diagnostic root required'}
    $null=New-Item -ItemType Directory -Path $run
    Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $run 'executed.ps1')
    $origin=@{status='RUNNING';isElevated=$false;processId=$PID;userSid=$identity.User.Value
        at=[DateTime]::UtcNow.ToString('o')}
    Save (Join-Path $run 'origin.json') $origin
}else {
    if(!$admin) {throw 'Real administrator token required'}
    $origin=[IO.File]::ReadAllText((Join-Path $run 'origin.json'),[Text.Encoding]::UTF8)|ConvertFrom-Json
    if($origin.isElevated -or $origin.userSid -cne $identity.User.Value) {throw 'Origin identity mismatch'}
}
$mode=if($Action -ceq 'Task'){'scheduled'}elseif($admin){'administrator'}else{'normal'}
$resultFile=Join-Path $run ($mode+'.json')
if(Test-Path -LiteralPath $resultFile) {throw 'Never overwrite a probe result'}
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class AgentVNPathProbe {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool CreateSymbolicLinkW(string link, string target, int flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint count, uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
    public static extern int GetCurrentPackageFullName(ref int length, StringBuilder name);
}
'@
$packageLength=0
$packageCode=[AgentVNPathProbe]::GetCurrentPackageFullName([ref]$packageLength,$null)
$packageName=$null
if($packageLength -gt 0) {
    $packageBuffer=[Text.StringBuilder]::new($packageLength)
    $packageCode=[AgentVNPathProbe]::GetCurrentPackageFullName([ref]$packageLength,$packageBuffer)
    if($packageCode -eq 0){$packageName=$packageBuffer.ToString()}
}
$report=@{status='RUNNING';at=[DateTime]::UtcNow.ToString('o');isElevated=$admin;processId=$PID
    userSid=$identity.User.Value;packageIdentity=$packageName;packageApiCode=$packageCode
    apkBuilds=0;productChanges=0;cases=@();cleanup='RUNNING'}
$process=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
$report.parentProcessId=$process.ParentProcessId
$report.created=$process.CreationDate.ToUniversalTime().ToString('o')
$marker='qa-agentvn-path-probe-20261021-'+$Attempt+'-'+$mode
$cacheRoot='C:\Users\1\AppData\Local\com.agentvn.editor\standalone-package'
$tempRoot='C:\Users\1\AppData\Local\Temp'
$specs=@(
    @{name='f-control';parent=$run;canonical=$false},
    @{name='c-temp-lexical';parent=$tempRoot;canonical=$false},
    @{name='c-temp-canonical';parent=$tempRoot;canonical=$true},
    @{name='c-cache-lexical';parent=$cacheRoot;canonical=$false},
    @{name='c-cache-canonical';parent=$cacheRoot;canonical=$true}
)
try {
    foreach($spec in $specs) {
        $directory=Join-Path $spec.parent ($marker+'-'+$spec.name)
        if([IO.Path]::GetDirectoryName($directory) -cne $spec.parent -or
            (Test-Path -LiteralPath $directory)) {throw 'Fresh exact marker directory required'}
        $source=Join-Path $directory 'source.txt';$link=Join-Path $directory 'link.txt'
        $row=@{name=$spec.name;directory=$directory;status='RUNNING';stage='create-directory';cleanup='RUNNING'
            canonicalTarget=$spec.canonical;source=$source;link=$link}
        $report.cases+=$row;Save $resultFile $report
        try {
            $null=[IO.Directory]::CreateDirectory($directory)
            $row.stage='write-source';[IO.File]::WriteAllText($source,'agentvn-native-path-marker')
            $row.sourceExists=[IO.File]::Exists($source)
            $stream=[IO.File]::OpenRead($source)
            try {
                $buffer=[Text.StringBuilder]::new(4096)
                $length=[AgentVNPathProbe]::GetFinalPathNameByHandleW($stream.SafeFileHandle,$buffer,4096,0)
                if($length -eq 0 -or $length -ge 4096) {throw 'Cannot resolve actual source path'}
                $row.finalSource=$buffer.ToString()
            }finally {$stream.Dispose()}
            $target=if($spec.canonical){$row.finalSource}else{$source}
            $row.target=$target;$row.stage='create-symlink'
            $row.nativeSuccess=[AgentVNPathProbe]::CreateSymbolicLinkW($link,$target,2)
            $row.nativeError=if($row.nativeSuccess){0}else{[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
            if(!$row.nativeSuccess) {throw ('Native symlink error '+$row.nativeError)}
            $row.stage='read-symlink';$row.linkText=[IO.File]::ReadAllText($link)
            if($row.linkText -cne 'agentvn-native-path-marker') {throw 'Linked bytes mismatch'}
            $row.status='PASS';$row.stage='complete'
        }catch {$row.status='FAILED';$row.error=$_.Exception.ToString()}
        finally {
            try {
                # Delete only these two exact files and then the empty marker.
                # No recursive deletion and no mutation of any prior file.
                [IO.File]::Delete($link)
                if([IO.File]::Exists($source)) {
                    if([IO.File]::ReadAllText($source) -cne 'agentvn-native-path-marker') {throw 'Marker bytes changed externally'}
                    [IO.File]::Delete($source)
                }
                if([IO.Directory]::Exists($directory)) {[IO.Directory]::Delete($directory,$false)}
                $row.cleanup='PASS'
            }catch {$row.cleanup='FAILED';$row.cleanupError=$_.Exception.ToString();throw}
            Save $resultFile $report
        }
    }
    $report.status='OBSERVED';$report.cleanup='PASS'
}catch {$report.status='FAILED';$report.error=$_.Exception.ToString()}
finally {$report.finishedAt=[DateTime]::UtcNow.ToString('o');Save $resultFile $report}
if($Action -ceq 'Launch' -and $report.cleanup -ceq 'PASS') {
    $helper=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
        '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Action','Elevated','-Attempt',$Attempt)
    Save (Join-Path $run 'launch.json') @{status='HELPER_STARTED';originIsElevated=$false;originProcessId=$PID
        helperPid=$helper.Id;helperCreated=$helper.StartTime.ToUniversalTime().ToString('o')}
    'Administrator path diagnostic PID: '+$helper.Id
}
[pscustomobject]$report|Select-Object status,isElevated,packageIdentity,cleanup|ConvertTo-Json
