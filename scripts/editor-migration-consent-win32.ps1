param(
    [int]$OwnerPid,
    [string]$Created,
    [string]$ExpectedSource,
    [string]$ReportPath,
    [switch]$SelfTest
)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class MigrationDialogWin32 {
    public delegate bool Callback(IntPtr window,IntPtr state);
    [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback,IntPtr state);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent,Callback callback,IntPtr state);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window,StringBuilder value,int count);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder value,int count);
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window,uint message,IntPtr wParam,IntPtr lParam);
    public static string Text(IntPtr h) { var s=new StringBuilder(32768);GetWindowText(h,s,s.Capacity);return s.ToString(); }
    public static string Class(IntPtr h) { var s=new StringBuilder(256);GetClassName(h,s,s.Capacity);return s.ToString(); }
    public static IntPtr[] Windows(int pid) {
        var found=new List<IntPtr>();EnumWindows((h,s)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid)found.Add(h);return true;},IntPtr.Zero);
        return found.ToArray();
    }
    public static IntPtr[] Children(IntPtr parent) {
        var found=new List<IntPtr>();EnumChildWindows(parent,(h,s)=>{found.Add(h);return true;},IntPtr.Zero);return found.ToArray();
    }
}
'@
if($SelfTest){
    $windows=[MigrationDialogWin32]::Windows($PID)
    foreach($window in $windows){$null=[MigrationDialogWin32]::Text($window);$null=[MigrationDialogWin32]::Class($window)}
    if($ReportPath -or $OwnerPid -or $ExpectedSource){throw 'Self-test cannot target a product or write evidence'}
    'PASS: Win32 enumeration and text APIs; no product launch or click'
    exit
}
if(!$OwnerPid -or !$Created -or !$ExpectedSource -or !$ReportPath){throw 'Exact native inputs required'}
if(Test-Path -LiteralPath $ReportPath){throw 'Fresh evidence required'}
if(![IO.Path]::GetFullPath($ReportPath).StartsWith('F:\AgentVN\QA\',[StringComparison]::OrdinalIgnoreCase)){throw 'Wrong evidence root'}
function Own {
    $item=Get-CimInstance Win32_Process -Filter "ProcessId=$OwnerPid"
    if(!$item -or $item.CreationDate.ToUniversalTime().ToString('o') -cne $Created){throw 'Native owner identity changed'}
}
function Normalize([string]$value){$value.Replace('/','\').Replace('\\?\','').ToLowerInvariant()}
$record=@{status='RUNNING';method='Windows Win32 owned migration Yes BM_CLICK';ownerPid=$OwnerPid
    created=$Created;expectedSource=$ExpectedSource;physicalInput=$false}
try{
    Own
    $dialog=[IntPtr]::Zero;$deadline=[DateTime]::UtcNow.AddSeconds(20)
    while($dialog -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline){
        $matches=@([MigrationDialogWin32]::Windows($OwnerPid)|Where-Object{
            [MigrationDialogWin32]::Text($_) -ceq '迁移 AgentVN 项目数据' -and [MigrationDialogWin32]::Class($_) -ceq '#32770'})
        if($matches.Count -gt 1){throw 'Ambiguous migration dialog'}
        if($matches.Count -eq 1){$dialog=$matches[0]}else{Start-Sleep -Milliseconds 150}
    }
    if($dialog -eq [IntPtr]::Zero){throw 'Exact owned migration dialog missing'}
    $record.title=[MigrationDialogWin32]::Text($dialog);$record.handle=$dialog.ToInt64()
    $record.controls=@([MigrationDialogWin32]::Children($dialog)|ForEach-Object{
        @{name=[MigrationDialogWin32]::Text($_);id=[MigrationDialogWin32]::GetDlgCtrlID($_)
          className=[MigrationDialogWin32]::Class($_);handle=$_.ToInt64();enabled=[MigrationDialogWin32]::IsWindowEnabled($_)}})
    $record.text=($record.controls|ForEach-Object{$_.name}) -join "`n"
    if(!(Normalize $record.text).Contains((Normalize $ExpectedSource))){throw 'Exact old database path missing'}
    if($record.text -notmatch '来源数据库' -or $record.text -notmatch '目标共享数据库' -or $record.text -notmatch '是否现在迁移'){throw 'Unexpected migration question'}
    $buttons=@($record.controls|Where-Object{$_.id -eq 6 -and $_.className -ceq 'Button' -and $_.enabled})
    if($buttons.Count -ne 1 -or $buttons[0].name -notmatch '是|Yes'){throw 'Exact affirmative button missing'}
    Own
    $record.button=$buttons[0];$record.inputAt=[DateTime]::UtcNow.ToString('o')
    if(![MigrationDialogWin32]::PostMessage([IntPtr]$buttons[0].handle,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'BM_CLICK request rejected'}
    $deadline=[DateTime]::UtcNow.AddSeconds(10)
    while([MigrationDialogWin32]::IsWindow($dialog) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100}
    if([MigrationDialogWin32]::IsWindow($dialog)){throw 'Migration dialog did not close after affirmative click'}
    $record.inputMethod='Owned Win32 Button ID6 BM_CLICK';$record.status='PASS'
}catch{$record.status='FAILED';$record.error=$_.Exception.ToString()}
finally{
    $record.finishedAt=[DateTime]::UtcNow.ToString('o')
    [IO.File]::WriteAllText($ReportPath,($record|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
}
if($record.status -cne 'PASS'){throw $record.error}
