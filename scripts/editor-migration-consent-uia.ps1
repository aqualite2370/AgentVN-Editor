param(
    [Parameter(Mandatory=$true)][int]$OwnerPid,
    [Parameter(Mandatory=$true)][string]$Created,
    [Parameter(Mandatory=$true)][string]$ExpectedSource,
    [Parameter(Mandatory=$true)][string]$ReportPath
)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $ReportPath){throw 'Fresh native evidence required'}
if(![IO.Path]::GetFullPath($ReportPath).StartsWith('F:\AgentVN\QA\',[StringComparison]::OrdinalIgnoreCase)){
    throw 'Evidence must stay inside F AgentVN QA'
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MigrationConsentNative {
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr parent,int id);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window,uint message,IntPtr wParam,IntPtr lParam);
}
'@
function Own {
    $item=Get-CimInstance Win32_Process -Filter "ProcessId=$OwnerPid"
    if(!$item -or $item.CreationDate.ToUniversalTime().ToString('o') -cne $Created){throw 'Native owner identity changed'}
}
function Normalize([string]$value){$value.Replace('/','\').Replace('\\?\','').ToLowerInvariant()}
$record=@{status='RUNNING';method='Windows UI Automation owned migration Yes';ownerPid=$OwnerPid
    created=$Created;expectedSource=$ExpectedSource;physicalInput=$false}
try{
    Own
    $root=[System.Windows.Automation.AutomationElement]::RootElement
    $deadline=[DateTime]::UtcNow.AddSeconds(35);$dialog=$null
    while(!$dialog -and [DateTime]::UtcNow -lt $deadline){
        $windows=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
        $matches=@($windows|Where-Object {$_.Current.ProcessId -eq $OwnerPid -and $_.Current.Name -ceq '迁移 AgentVN 项目数据'})
        if($matches.Count -gt 1){throw 'Ambiguous migration dialogs'}
        if($matches.Count -eq 1){$dialog=$matches[0]}else{Start-Sleep -Milliseconds 150}
    }
    if(!$dialog){throw 'Owned native migration confirmation not found'}
    $record.title=$dialog.Current.Name;$record.handle=$dialog.Current.NativeWindowHandle
    $controls=$dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
    $record.controls=@($controls|ForEach-Object {@{name=$_.Current.Name;id=$_.Current.AutomationId
        type=$_.Current.ControlType.ProgrammaticName;className=$_.Current.ClassName;enabled=$_.Current.IsEnabled}})
    $record.text=($record.controls|ForEach-Object {$_.name}) -join "`n"
    if(!(Normalize $record.text).Contains((Normalize $ExpectedSource))){throw 'Dialog does not identify the exact old database'}
    if($record.text -notmatch '来源数据库' -or $record.text -notmatch '目标共享数据库' -or $record.text -notmatch '是否现在迁移'){
        throw 'Unexpected native migration question'
    }
    $buttons=@($controls|Where-Object {$_.Current.IsEnabled -and
        ($_.Current.AutomationId -ceq '6' -or $_.Current.Name -match '^(是|Yes)(\s|\(|$)') -and
        ($_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -or $_.Current.ClassName -eq 'Button')})
    if($buttons.Count -ne 1){throw 'Exactly one affirmative migration button required'}
    Own
    $record.button=@{name=$buttons[0].Current.Name;id=$buttons[0].Current.AutomationId}
    $record.inputAt=[DateTime]::UtcNow.ToString('o')
    $pattern=$null
    if($buttons[0].TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){
        $pattern.Invoke();$record.inputMethod='InvokePattern'
    }else{
        $handle=[MigrationConsentNative]::GetDlgItem([IntPtr]$record.handle,6)
        if($handle -eq [IntPtr]::Zero -or ![MigrationConsentNative]::PostMessage($handle,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)){
            throw 'Affirmative native button invocation failed'
        }
        $record.inputMethod='Owned button BM_CLICK'
    }
    $record.status='PASS'
}catch{$record.status='FAILED';$record.error=$_.Exception.ToString()}
finally{
    $record.finishedAt=[DateTime]::UtcNow.ToString('o')
    [IO.File]::WriteAllText($ReportPath,($record|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
}
if($record.status -cne 'PASS'){throw $record.error}
