param(
    [ValidateSet('SelfTest','Prepare','Restore')][string]$Action='SelfTest',
    [Parameter(Mandatory=$true)][string]$RunDirectory,
    [ValidateRange(1025,65535)][int]$Port=9222
)
# Temporary, app-specific HKLM override. Elevated WebView2 ignores env/HKCU
# browser arguments. No sandbox switches or wildcard policies are installed.
$ErrorActionPreference='Stop'
$qa='F:\AgentVN\QA\Android-Package-20261021-01'
$run=[IO.Path]::GetFullPath($RunDirectory)
$subkey='SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'
$name='agentvn-editor.exe'
function Boundary($directory) {
    $full=[IO.Path]::GetFullPath($directory)
    if([IO.Path]::GetDirectoryName($full) -cne $qa -or
        [IO.Path]::GetFileName($full) -cnotmatch '^administrator-\d{2}$') {throw 'Exact administrator QA root required'}
}
Boundary $run
if($Action -ceq 'SelfTest') {
    foreach($case in @(@($run,$true),@($qa,$false),@(($run+'\child'),$false),
        @('F:\AgentVN',$false),@('D:\AgentVN',$false),@(($qa+'\administrator-1'),$false))) {
        $valid=$true;try {Boundary $case[0]}catch {$valid=$false}
        if($valid -ne $case[1]) {throw 'Policy path guard regression'}
    }
    'PASS: six exact policy boundaries; no registry writes'
    exit
}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if(!([Security.Principal.WindowsPrincipal]::new($identity)).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {throw 'Administrator policy operation required'}
if(!(Test-Path -LiteralPath $run -PathType Container)) {throw 'Existing owned QA root required'}
if(@(Get-CimInstance Win32_Process|Where-Object {$_.Name -ceq 'agentvn-editor.exe'}).Count) {
    throw 'Stop Editor hosts before any app-scoped policy change'
}
function Save($file,$value) {
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
}
$journal=Join-Path $run 'webview-policy.json'
$restoration=Join-Path $run 'webview-policy-restoration.json'
$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,
    [Microsoft.Win32.RegistryView]::Registry64)
try {
    if($Action -ceq 'Prepare') {
        if((Test-Path -LiteralPath $journal) -or (Test-Path -LiteralPath $restoration)) {throw 'Fresh policy journal required'}
        $missing=@()
        $prefix=''
        foreach($segment in $subkey.Split('\')) {
            $prefix=if($prefix){$prefix+'\'+$segment}else{$segment}
            $probe=$base.OpenSubKey($prefix)
            if($probe){$probe.Dispose()}else{$missing+=$prefix}
        }
        $key=$base.OpenSubKey($subkey)
        $existed=$false;$old=$null;$kind=$null
        if($key) {
            try {
                $existed=$name -cin $key.GetValueNames()
                if($existed){$old=$key.GetValue($name);$kind=$key.GetValueKind($name).ToString()}
            }finally {$key.Dispose()}
        }
        if($existed -and $kind -cne 'String') {throw 'Refuse unsupported existing policy value kind'}
        $state=@{status='JOURNALED';at=[DateTime]::UtcNow.ToString('o');registryView='Registry64'
            subkey=$subkey;name=$name;existed=$existed;oldValue=$old;oldKind=$kind;missingKeys=$missing
            ownedValue=('--remote-debugging-port='+$Port);port=$Port}
        Save $journal $state
        $key=$base.CreateSubKey($subkey)
        try {
            $key.SetValue($name,$state.ownedValue,[Microsoft.Win32.RegistryValueKind]::String)
            if($key.GetValue($name) -cne $state.ownedValue) {throw 'App policy write did not persist'}
        }finally {$key.Dispose()}
        $state.status='PASS';Save $journal $state
        'PASS: exact app-only debug policy journaled and installed'
        exit
    }
    if(Test-Path -LiteralPath $restoration) {throw 'Policy restoration already recorded'}
    $state=[IO.File]::ReadAllText($journal,[Text.Encoding]::UTF8)|ConvertFrom-Json
    if($state.subkey -cne $subkey -or $state.name -cne $name -or $state.registryView -cne 'Registry64' -or
        $state.ownedValue -cne ('--remote-debugging-port='+$state.port)) {throw 'Policy journal ownership mismatch'}
    foreach($missing in $state.missingKeys) {
        if(!$subkey.StartsWith($missing+'\',[StringComparison]::Ordinal) -and $missing -cne $subkey) {
            throw 'Policy key cleanup boundary mismatch'
        }
    }
    $key=$base.OpenSubKey($subkey,$true)
    if(!$key) {throw 'Owned policy disappeared'}
    try {
        if($key.GetValue($name) -cne $state.ownedValue) {throw 'Policy changed externally; do not overwrite'}
        if($state.existed) {$key.SetValue($name,[string]$state.oldValue,[Microsoft.Win32.RegistryValueKind]::String)}
        else {$key.DeleteValue($name,$true)}
        if($state.existed) {
            if($key.GetValue($name) -cne $state.oldValue) {throw 'Original policy value was not restored'}
        }elseif($name -cin $key.GetValueNames()) {throw 'Test policy value remains'}
    }finally {$key.Dispose()}
    $removed=@();$preserved=@()
    foreach($missing in @($state.missingKeys|Sort-Object Length -Descending)) {
        $key=$base.OpenSubKey($missing)
        if(!$key) {continue}
        try {$empty=$key.ValueCount -eq 0 -and $key.SubKeyCount -eq 0}finally {$key.Dispose()}
        if($empty){$base.DeleteSubKey($missing,$false);$removed+=$missing}else{$preserved+=$missing}
    }
    Save $restoration @{status='PASS';at=[DateTime]::UtcNow.ToString('o');originalValueRestored=$true
        removedOwnedEmptyKeys=$removed;preservedNonemptyKeys=$preserved;subkey=$subkey;name=$name}
    'PASS: original app policy restored; only owned empty keys removed'
}finally {$base.Dispose()}
