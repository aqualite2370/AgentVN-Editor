param(
    [Parameter(Mandatory=$true)][string]$Package,
    [Parameter(Mandatory=$true)][string]$Output,
    [string]$RememberedKey='Software\agentvn\AgentVN Editor'
)
# Native MSI search/property actions only. Never run INSTALL, costing, file
# actions, an installer process, or registry modifications.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -Force
$qa='F:\AgentVN\QA\MSI-Location-Repair-20261021-01'
$destination=[IO.Path]::GetFullPath($Output)
if(!$destination.StartsWith($qa+'\',[StringComparison]::Ordinal) -or
   [IO.Path]::GetExtension($destination) -cne '.json' -or
   (Test-Path -LiteralPath $destination)){throw 'Fresh JSON under exact MSI repair QA root required'}
$packagePath=[IO.Path]::GetFullPath($Package)
if([IO.Path]::GetExtension($packagePath) -cne '.msi'){throw 'MSI required'}
if($RememberedKey -cne 'Software\agentvn\AgentVN Editor' -and
   $RememberedKey -cnotmatch '^Software\\agentvn\\AgentVN MSI Directory Probe Missing\\[a-f0-9-]{36}$'){
    throw 'Only the real remembered key or a unique missing fixture key can be read'
}
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Remembered {
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($RememberedKey)
    if(!$key){return @()}
    try{
        @(foreach($name in $key.GetValueNames()|Sort-Object){
            @{name=$name;kind=$key.GetValueKind($name).ToString();value=$key.GetValue($name)}
        })
    }finally{$key.Dispose()}
}
function Query($database,$table,$fields) {
    $columns=@($fields|ForEach-Object {([string][char]96)+$_+([string][char]96)})
    $view=$database.OpenView('SELECT '+($columns -join ',')+' FROM '+[char]96+$table+[char]96)
    try{
        $null=$view.Execute()
        @(while($record=$view.Fetch()){
            $row=[ordered]@{}
            for($i=0;$i -lt $fields.Count;$i++){$row[$fields[$i]]=$record.StringData($i+1)}
            [pscustomobject]$row
        })
    }finally{$null=$view.Close();$null=[Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)}
}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AgentVNMsiDirectoryProbe {
 [DllImport("msi.dll", CharSet=CharSet.Unicode)] public static extern uint MsiOpenPackageEx(string file, uint options, out uint handle);
 [DllImport("msi.dll", CharSet=CharSet.Unicode)] public static extern uint MsiSetProperty(uint handle, string name, string value);
 [DllImport("msi.dll", CharSet=CharSet.Unicode)] public static extern uint MsiGetProperty(uint handle, string name, StringBuilder value, ref uint size);
 [DllImport("msi.dll", CharSet=CharSet.Unicode)] public static extern uint MsiDoAction(uint handle, string action);
 [DllImport("msi.dll", CharSet=CharSet.Unicode)] public static extern int MsiEvaluateCondition(uint handle, string condition);
 [DllImport("msi.dll")] public static extern uint MsiSetInternalUI(uint level, IntPtr window);
 [DllImport("msi.dll")] public static extern uint MsiCloseHandle(uint handle);
 public static string Get(uint handle, string name) {
   var value=new StringBuilder(32768); uint size=32767;
   uint code=MsiGetProperty(handle,name,value,ref size);
   if(code!=0)throw new Exception("MsiGetProperty "+code);
   return value.ToString();
 }
}
'@
$null=[AgentVNMsiDirectoryProbe]::MsiSetInternalUI(2,[IntPtr]::Zero)
$report=[ordered]@{status='RUNNING';startedAt=[DateTime]::UtcNow.ToString('o')
    scope='NATIVE_MSI_DIRECTORY_SEARCH_AND_ALLOWLISTED_TYPE51_ACTIONS_NOT_INSTALLATION'
    package=@{path=$packagePath;sha256=(Sha $packagePath)};rememberedKey=$RememberedKey;rememberedBefore=@(Remembered)
    cases=@();tables=@{};installerInvocations=0;registryWrites=0;modelRequests=0;error=$null}
$protected=@('D:\AgentVN\AgentVN Dev.exe','D:\AgentVN\.git\index',
    'C:\Users\1\AppData\Roaming\com.agentvn.editor\backend\vn_engine.db')
$report.protectedFiles=@($protected|ForEach-Object {@{path=$_;sha256=(Sha $_)}})
$null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force
try{
    $installer=New-Object -ComObject WindowsInstaller.Installer
    $database=$installer.OpenDatabase($packagePath,0)
    try{
        foreach($table in @('InstallUISequence','InstallExecuteSequence')){
            $report.tables[$table]=@(Query $database $table @('Action','Condition','Sequence') |
                Where-Object {$_.Action -ceq 'AppSearch' -or $_.Action -match '^AgentVN(Preserve|Restore)InstallDirectory$'} |
                Sort-Object {[int]$_.Sequence})
        }
        $actions=@(Query $database 'CustomAction' @('Action','Type','Source','Target'))
        if(@($actions|Where-Object {$_.Action -ceq 'AppSearch'}).Count){throw 'Do not invoke a substituted standard action'}
        foreach($a in $actions|Where-Object {$_.Action -match '^AgentVN(Preserve|Restore)InstallDirectory$'}){
            if([int]$a.Type -ne 51){throw 'Only immediate property setters are allowed'}
        }
        $report.tables.CustomAction=@($actions|Where-Object {$_.Action -match '^AgentVN(Preserve|Restore)InstallDirectory$'})
        $report.tables.AppSearch=@(Query $database 'AppSearch' @('Property','Signature_'))
        $report.tables.RegLocator=@(Query $database 'RegLocator' @('Signature_','Root','Key','Name','Type'))
        $report.tables.Properties=@(Query $database 'Property' @('Property','Value')|
            Where-Object {$_.Property -in @('ProductName','ProductVersion','ProductLanguage','UpgradeCode','SecureCustomProperties')})
    }finally{
        $null=[Runtime.InteropServices.Marshal]::FinalReleaseComObject($database)
        $null=[Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer)
    }
    $named=@($report.rememberedBefore|Where-Object name -CEQ 'InstallDir')
    $unnamed=@($report.rememberedBefore|Where-Object name -CEQ '')
    $fallback=[string]$(if($named.Count -and $named[0].value){$named[0].value}elseif($unnamed.Count){$unnamed[0].value}else{''})
    $unicodeDirectory=[string][char]0x4e2d+[char]0x6587+' '+[char]0x76ee+[char]0x6807
    foreach($sequence in @('InstallUISequence','InstallExecuteSequence','UIToExecute')){
        $stages=if($sequence -ceq 'UIToExecute'){@('InstallUISequence','InstallExecuteSequence')}else{@($sequence)}
        foreach($stage in $stages){
            if(@($report.tables[$stage]|Where-Object Action -CEQ 'AppSearch').Count -ne 1){throw 'Native AppSearch sequence missing'}
        }
        foreach($requested in @('',($qa+'\requested target'),($qa+'\'+$unicodeDirectory))){
            [uint32]$handle=0
            try{
                $open=[AgentVNMsiDirectoryProbe]::MsiOpenPackageEx($packagePath,1,[ref]$handle)
                if($open -ne 0){throw "MsiOpenPackageEx $open"}
                $row=[ordered]@{sequence=$sequence;requested=$requested;initial=[AgentVNMsiDirectoryProbe]::Get($handle,'INSTALLDIR');actions=@()}
                if($requested){
                    if([AgentVNMsiDirectoryProbe]::MsiSetProperty($handle,'INSTALLDIR',$requested) -ne 0){throw 'Cannot set explicit directory'}
                }
                foreach($stage in $stages){
                    if($sequence -ceq 'UIToExecute' -and $stage -ceq 'InstallExecuteSequence'){
                        if([AgentVNMsiDirectoryProbe]::MsiSetProperty($handle,'INSTALLDIR',($qa+'\browse choice')) -ne 0){
                            throw 'Cannot emulate the directory selected after UI search'
                        }
                    }
                    foreach($action in $report.tables[$stage]){
                        $condition=[AgentVNMsiDirectoryProbe]::MsiEvaluateCondition($handle,[string]$action.Condition)
                        if($condition -eq 3){throw 'Invalid native MSI condition'}
                        if($condition -eq 0){continue}
                        $before=[AgentVNMsiDirectoryProbe]::Get($handle,'INSTALLDIR')
                        $code=[AgentVNMsiDirectoryProbe]::MsiDoAction($handle,$action.Action)
                        if($code -ne 0){throw "Native directory action $($action.Action) returned $code"}
                        $row.actions+=@{stage=$stage;action=$action.Action;before=$before;after=[AgentVNMsiDirectoryProbe]::Get($handle,'INSTALLDIR')}
                    }
                }
                $row.actual=[AgentVNMsiDirectoryProbe]::Get($handle,'INSTALLDIR')
                $row.expected=if($sequence -ceq 'UIToExecute'){$qa+'\browse choice'}elseif($requested){$requested}else{$fallback}
                $row.status=if($row.actual.TrimEnd('\') -ceq $row.expected.TrimEnd('\')){'PASS'}else{'FAILED'}
                $report.cases+=$row
            }finally{if($handle){$null=[AgentVNMsiDirectoryProbe]::MsiCloseHandle($handle)}}
        }
    }
    if($report.cases.Count -ne 9){throw 'Incomplete native search matrix'}
    $report.rememberedAfter=@(Remembered)
    if(($report.rememberedBefore|ConvertTo-Json -Depth 6 -Compress) -cne
       ($report.rememberedAfter|ConvertTo-Json -Depth 6 -Compress)){throw 'Registry changed in read-only probe'}
    foreach($f in $report.protectedFiles){if((Sha $f.path) -cne $f.sha256){throw 'Protected file changed'}}
    if((Sha $packagePath) -cne $report.package.sha256){throw 'Input package changed'}
    $report.status=if(@($report.cases|Where-Object status -CNE 'PASS').Count){'FAILED'}else{'PASS'}
}catch{$report.status='FAILED';$report.error=$_.Exception.ToString()}
finally{
    $report.finishedAt=[DateTime]::UtcNow.ToString('o')
    [IO.File]::WriteAllText($destination,($report|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
}
[pscustomobject]@{status=$report.status;scope=$report.scope;cases=$report.cases.Count
    failedCases=@($report.cases|Where-Object status -CNE 'PASS').Count;error=$report.error}|ConvertTo-Json -Depth 4
if($report.status -cne 'PASS'){exit 1}
