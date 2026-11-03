param([ValidatePattern('^[0-9]{2}$')][string]$Attempt='03')
$ErrorActionPreference='Stop'
$reportRoot='D:\AgentVN\output\host-msi-20261018-'+$Attempt
if(Test-Path -LiteralPath $reportRoot){throw 'Fresh MSI preflight required'}
$null=New-Item -ItemType Directory -Path $reportRoot
$installer=New-Object -ComObject WindowsInstaller.Installer
function Query-Table($db,$table,$fields){
    $quoted=@($fields|ForEach-Object {([string][char]96)+$_+([string][char]96)})
    $sql='SELECT '+($quoted -join ',')+' FROM '+([string][char]96)+$table+([string][char]96)
    try{$view=$db.OpenView($sql)}catch{throw "MSI read-only SQL failed [$sql]: $($_.Exception.Message)"}
    $null=$view.Execute()
    $rows=@()
    while($record=$view.Fetch()){
        $row=[ordered]@{}
        for($i=0;$i -lt $fields.Count;$i++){$row[$fields[$i]]=$record.StringData($i+1)}
        $rows+=$row
    }
    $null=$view.Close()
    return $rows
}
$rows=@()
$candidate='F:\AgentVN-QA-Preserved\cleanup-20261017-generated-01\full-regression-20261017-01\candidate-02\installers'
foreach($language in @('en-US','zh-CN')){
    foreach($version in @('1.9.8','1.9.9')){
        $file=if($version -eq '1.9.8'){
            'D:\AgentVN\releases\editor\AgentVN_Editor_v1.9.8_20260925_101446_'+$language+'.msi'
        }else{Join-Path $candidate ('AgentVN Editor_1.9.9_x64_'+$language+'.msi')}
        $db=$installer.OpenDatabase($file,0)
        $tableView=$db.OpenView('SELECT * FROM `_Tables`')
        $tableView.Execute()
        $available=@()
        while($tableRecord=$tableView.Fetch()){$available+=$tableRecord.StringData(1)}
        $tableView.Close()
        $conditions=if('LaunchCondition' -in $available){
            @(Query-Table $db 'LaunchCondition' @('Condition','Description'))
        }else{@()}
        $rows+=@{path=$file;sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();
            bytes=(Get-Item -LiteralPath $file).Length;language=$language;expectedVersion=$version;
            properties=@(Query-Table $db 'Property' @('Property','Value'));
            directories=@(Query-Table $db 'Directory' @('Directory','Directory_Parent','DefaultDir'));
            upgrades=@(Query-Table $db 'Upgrade' @('UpgradeCode','VersionMin','VersionMax','Attributes','ActionProperty'));
            launchConditions=$conditions;availableTables=$available}
    }
}
$registrations=@(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|
    Where-Object {$_.DisplayName -match 'AgentVN'}|Select-Object DisplayName,DisplayVersion,InstallLocation,WindowsInstaller,PSPath)
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$report=@{status='PASS';scope='READ_ONLY_MSI_PROPERTIES_NOT_INSTALLATION_PASS';
    at=(Get-Date).ToUniversalTime().ToString('o');packages=$rows;registrations=$registrations;
    isElevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);
    freeDisk=@(Get-PSDrive C,D,F|Select-Object Name,Free)}
[IO.File]::WriteAllText((Join-Path $reportRoot 'preflight.json'),($report|ConvertTo-Json -Depth 14),(New-Object Text.UTF8Encoding($false)))
foreach($row in $rows){
    $identity=@{}
    foreach($property in $row.properties|Where-Object {$_.Property -in @('ProductName','ProductVersion','ProductCode','UpgradeCode','ALLUSERS','MSIINSTALLPERUSER','ProductLanguage')}){$identity[$property.Property]=$property.Value}
    @{path=$row.path;identity=$identity;installDirectory=@($row.directories|Where-Object {$_.Directory -eq 'INSTALLDIR'});
        upgradeRows=@($row.upgrades|Where-Object {$_});hasLaunchConditionTable=('LaunchCondition' -in $row.availableTables)}|ConvertTo-Json -Depth 7
}
