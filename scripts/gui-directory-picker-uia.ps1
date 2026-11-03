param(
    [Parameter(Mandatory=$true)][int]$OwnerPid,
    [Parameter(Mandatory=$true)][string]$ReportPath,
    [string]$Directory,
    [string]$TitlePattern = 'GUI|资源目录',
    [switch]$File,
    [switch]$Cancel
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GuiPickerNative {
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr parent, int id);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, string text);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
'@
$record = @{ status='RUNNING'; ownerPid=$OwnerPid; method='Windows UI Automation'; titlePattern=$TitlePattern; cancel=[bool]$Cancel; file=[bool]$File }
try {
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    $dialog = $null
    while ([DateTime]::UtcNow -lt $deadline -and -not $dialog) {
        $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($candidate in $windows) {
            if ($candidate.Current.ProcessId -eq $OwnerPid -and
                $candidate.Current.ClassName -eq '#32770' -and
                $candidate.Current.Name -match $TitlePattern) {
                $dialog = $candidate
                break
            }
        }
        if (-not $dialog) { Start-Sleep -Milliseconds 150 }
    }
    if (-not $dialog) { throw 'Owned native GUI directory picker not found' }
    $record.title = $dialog.Current.Name
    $record.handle = $dialog.Current.NativeWindowHandle
    $controls = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
    $record.controls = @($controls | ForEach-Object { @{
        name=$_.Current.Name; id=$_.Current.AutomationId;
        type=$_.Current.ControlType.ProgrammaticName; enabled=$_.Current.IsEnabled;
        className=$_.Current.ClassName; handle=$_.Current.NativeWindowHandle
    } })
    $rect = $dialog.Current.BoundingRectangle
    $bitmap = New-Object System.Drawing.Bitmap ([int]$rect.Width),([int]$rect.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen([int]$rect.X,[int]$rect.Y,0,0,$bitmap.Size)
        $imagePath = [IO.Path]::ChangeExtension($ReportPath,'.png')
        $bitmap.Save($imagePath,[System.Drawing.Imaging.ImageFormat]::Png)
        $record.screenshot=$imagePath
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
    $buttonId = if ($Cancel) { '2' } else { '1' }
    if (-not $Cancel) {
        $resolved = (Resolve-Path -LiteralPath $Directory).Path
        $pathType = if ($File) { 'Leaf' } else { 'Container' }
        if (-not (Test-Path -LiteralPath $resolved -PathType $pathType)) { throw "Native source must be an existing $pathType" }
        $editId = if ($File) { '1148' } else { '1152' }
        $editCandidates = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition (
                [System.Windows.Automation.AutomationElement]::AutomationIdProperty,$editId)))
        $edit = @($editCandidates | Where-Object { $_.Current.ClassName -eq 'Edit' } | Select-Object -First 1)[0]
        if (-not $edit) { $edit = @($editCandidates | Select-Object -Last 1)[0] }
        if (-not $edit) { throw "Native input $editId not found; see recorded controls" }
        $value = $null
        if ($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$value)) {
            $value.SetValue($resolved)
        } else {
            $editHandle = [IntPtr]$edit.Current.NativeWindowHandle
            if ($editHandle -eq [IntPtr]::Zero) { $editHandle = [GuiPickerNative]::GetDlgItem([IntPtr]$record.handle,[int]$editId) }
            if ($editHandle -eq [IntPtr]::Zero) { throw 'Owned native folder edit handle missing' }
            [GuiPickerNative]::SendMessage($editHandle,0x000C,[IntPtr]::Zero,$resolved) | Out-Null
            $record.inputMethod='Owned native edit WM_SETTEXT'
        }
        $record.directory=$resolved
    }
    # Shell list items can reuse IDs 1/2. Native dialog buttons are exposed as
    # ControlType.Pane on some hosts, so match the actual Button window class.
    $button = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.AndCondition (
            (New-Object System.Windows.Automation.PropertyCondition (
                [System.Windows.Automation.AutomationElement]::AutomationIdProperty,$buttonId)),
            (New-Object System.Windows.Automation.PropertyCondition (
                [System.Windows.Automation.AutomationElement]::ClassNameProperty,'Button')))))
    if (-not $button) { throw "Native dialog button $buttonId not found" }
    $record.button=$button.Current.Name
    $invoke = $null
    if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)) {
        $invoke.Invoke()
    } else {
        $buttonHandle = [GuiPickerNative]::GetDlgItem([IntPtr]$record.handle,[int]$buttonId)
        if ($buttonHandle -eq [IntPtr]::Zero) { throw 'Owned native picker button handle missing' }
        if (-not [GuiPickerNative]::PostMessage($buttonHandle,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)) {
            throw 'Owned native picker button BM_CLICK failed'
        }
        $record.buttonMethod='Owned native button BM_CLICK'
    }
    $record.status='PASS'
} catch {
    $record.status='FAILED'
    $record.error=$_.Exception.ToString()
} finally {
    $record.finishedAt=[DateTime]::UtcNow.ToString('o')
    $json = $record | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($ReportPath,$json,(New-Object Text.UTF8Encoding $false))
}
if ($record.status -ne 'PASS') { throw $record.error }
