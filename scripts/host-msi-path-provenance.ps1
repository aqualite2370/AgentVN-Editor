param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
$root='D:\AgentVN\output\host-msi-next-20261018-01'
if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Destination)) -ne $root -or
    (Test-Path -LiteralPath $Destination)){throw 'Fresh evidence in exact MSI-next directory required'}
$source=Join-Path $root 'clean\en-US\Install-1.9.9-attempt03.json'
$log=Join-Path $root 'clean\en-US\Install-1.9.9-attempt03.log'
$original=Get-Content -LiteralPath $source -Raw -Encoding UTF8|ConvertFrom-Json
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
if((Sha $original.package) -ne $original.packageSha256){throw 'Trusted MSI source changed'}
$installer=New-Object -ComObject WindowsInstaller.Installer
$db=$installer.OpenDatabase($original.package,0)
function Query($table,$fields){
    $quoted=@($fields|ForEach-Object {([string][char]96)+$_+([string][char]96)})
    $view=$db.OpenView('SELECT '+($quoted -join ',')+' FROM '+([string][char]96)+$table+([string][char]96))
    $null=$view.Execute()
    $rows=@()
    while($record=$view.Fetch()){
        $row=[ordered]@{}
        for($field=0;$field -lt $fields.Count;$field++){$row[$fields[$field]]=$record.StringData($field+1)}
        $rows+=$row
    }
    $null=$view.Close()
    return $rows
}
$tables=@{
    AppSearch=@(Query 'AppSearch' @('Property','Signature_'));
    RegLocator=@(Query 'RegLocator' @('Signature_','Root','Key','Name','Type'));
    Directories=@(Query 'Directory' @('Directory','Directory_Parent','DefaultDir')|Where-Object {$_.Directory -eq 'INSTALLDIR'});
    ExecuteSequence=@(Query 'InstallExecuteSequence' @('Action','Condition','Sequence')|Where-Object {$_.Action -eq 'AppSearch'});
    UISequence=@(Query 'InstallUISequence' @('Action','Condition','Sequence')|Where-Object {$_.Action -eq 'AppSearch'})
}
$text=Get-Content -LiteralPath $log -Raw -Encoding UTF8
$lines=@($text -split "`r?`n"|Where-Object {
    $_ -match 'Command Line: .*INSTALLDIR=|PROPERTY CHANGE: .*INSTALLDIR property|Doing action: AppSearch|Dir \(target\): Key: INSTALLDIR|^Property\(S\): INSTALLDIR =|^Property\(S\): WIXUI_INSTALLDIR ='
})
$expectedChange="PROPERTY CHANGE: Modifying INSTALLDIR property. Its current value is 'F:\AgentVN-QA-HostUpgrade-20261018-02\installed-editor'. Its new value: 'D:\agentvntest\AgentVN Editor'."
if(!$text.Contains($expectedChange)){throw 'Actual override provenance missing'}
if(!@($tables.AppSearch|Where-Object {$_.Property -eq 'INSTALLDIR'}).Count -or $tables.Directories.Count -ne 1){
    throw 'Package INSTALLDIR table linkage missing'
}
$result=@{
    status='PASS';scope='READ_ONLY_ACTUAL_MSI_TARGET_OVERRIDE_PROVENANCE_NOT_INSTALLATION_PASS';
    at=(Get-Date).ToUniversalTime().ToString('o');
    sources=@(@{path=$source;sha256=(Sha $source)},@{path=$log;sha256=(Sha $log)},
        @{path=$original.package;sha256=(Sha $original.package)});
    originalOutcome=@{status=$original.status;error=$original.error;exitCode=$original.exitCode};
    requested='F:\AgentVN-QA-HostUpgrade-20261018-02\installed-editor';
    actual='D:\agentvntest\AgentVN Editor';tables=$tables;actualLogLines=$lines;
    conclusion='INSTALLDIR is a real package directory/property; actual AppSearch changed the caller-supplied F path to D before target path resolution. Not an unknown/unsupported INSTALLDIR parameter. Exact historical registry values are not recreated from current state.';
    limitations=@('Quiet installation only; interactive directory-picker precedence not tested',
        'Original FAILED directory assertion remains unchanged',
        'No MSI execution, registry mutation, product repair or rebuild in this audit')
}
[IO.File]::WriteAllText($Destination,($result|ConvertTo-Json -Depth 12),(New-Object Text.UTF8Encoding($false)))
Write-Output "PASS: actual AppSearch override established; original installation destination test remains FAILED"
