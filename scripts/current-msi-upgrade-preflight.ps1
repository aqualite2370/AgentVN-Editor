param([ValidatePattern('^[0-9]{2}$')][string]$Attempt='01')
# QA only: read MSI databases and existing registration. Never invoke msiexec,
# change registry, move profiles, or replace an installed file.
$ErrorActionPreference='Stop'
$qaRoot='F:\AgentVN\QA\Current-MSI-Upgrade-20261021-01'
$out=Join-Path $qaRoot ('preflight-'+$Attempt)
if(Test-Path -LiteralPath $out){throw 'Fresh preflight directory required'}
$null=New-Item -ItemType Directory -Path $out
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Query($db,$table,$fields){
    $columns=@($fields|ForEach-Object {([string][char]96)+$_+([string][char]96)})
    $view=$db.OpenView(('SELECT '+($columns -join ',')+' FROM '+[char]96+$table+[char]96))
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
function RememberedLocation {
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\agentvn\AgentVN Editor')
    if(!$key){throw 'Previously recorded NSIS registration disappeared; re-evaluate safety'}
    try{
        @('','InstallDir')|ForEach-Object {
            @{hive='HKCU';key='Software\agentvn\AgentVN Editor';name=$_;value=$key.GetValue($_)}
        }
    }finally{$key.Dispose()}
}
$report=[ordered]@{
    status='RUNNING';scope='READ_ONLY_CURRENT_MSI_AND_OLD_SAMPLE_PREFLIGHT_NOT_INSTALLATION'
    startedAt=(Get-Date).ToUniversalTime().ToString('o')
    productChanges=0;installerInvocations=0;registryWrites=0;profileChanges=0;modelRequests=0
    packages=@();oldEditorSamples=@();rememberedBefore=@();rememberedAfter=@()
    installationStatus='NOT_RUN';upgradeStatus='NOT_RUN';repairStatus='NOT_RUN';uninstallStatus='NOT_RUN'
    limitation='AppSearch location is static evidence, not proof of an actual new installation redirection'
    error=$null
}
try{
    $report.rememberedBefore=@(RememberedLocation)
    $msi=New-Object -ComObject WindowsInstaller.Installer
    $expected=@{
        'en-US'=@{sha='a3420c8d293b9c0afd5137d905392b7369d98a8a89a9652d6192c0a17915f168';language='1033';product='{C1223FB9-5E27-4874-A3F6-B9CAB5F8585F}'}
        'zh-CN'=@{sha='b34a20b8cbfb0481dc2ee2e33b53bc13ff18e8a95704f8098fced9f34e98322b';language='2052';product='{D393E540-A9B3-49DB-9C13-8FCCF30E5B0C}'}
    }
    foreach($language in @('en-US','zh-CN')){
        $file='D:\AgentVN\releases\editor\AgentVN_Editor_v1.9.16_20261021_ComponentPreview_'+$language+'.msi'
        $hash=Sha $file
        if($hash -cne $expected[$language].sha){throw 'Current sealed MSI package changed'}
        $db=$msi.OpenDatabase($file,0)
        $properties=@(Query $db 'Property' @('Property','Value'))
        $identity=@{}
        foreach($p in $properties){$identity[$p.Property]=$p.Value}
        if($identity.ProductVersion -cne '1.9.16' -or $identity.ProductLanguage -cne $expected[$language].language -or
            $identity.ProductCode -cne $expected[$language].product -or
            $identity.UpgradeCode -cne '{ED480F63-9C97-53C7-AD35-DB9DB9088B9D}'){
            throw 'Current MSI identity differs from actual package evidence'
        }
        $search=@(Query $db 'AppSearch' @('Property','Signature_')|Where-Object {$_.Property -ceq 'INSTALLDIR'})
        $locators=@(Query $db 'RegLocator' @('Signature_','Root','Key','Name','Type')|
            Where-Object {$_.Signature_ -in @($search.Signature_)})
        if($search.Count -ne 2 -or $locators.Count -ne 2 -or
            @($locators|Where-Object {$_.Root -ne '1' -or $_.Key -cne 'Software\agentvn\AgentVN Editor'}).Count){
            throw 'Unexpected MSI location-search contract; do not predict its target'
        }
        $report.packages+=@{path=$file;sha256=$hash;bytes=(Get-Item -LiteralPath $file).Length
            language=$language;properties=$properties;locationSearch=$search;locationRegistry=$locators
            upgrades=@(Query $db 'Upgrade' @('UpgradeCode','VersionMin','VersionMax','Attributes','ActionProperty'))}
    }
    $samplesPath='D:\AgentVN\output\full-regression-20261017-01\old-editor-samples.json'
    $report.oldSampleManifest=@{path=$samplesPath;sha256=(Sha $samplesPath)}
    $samples=Get-Content -LiteralPath $samplesPath -Raw -Encoding UTF8|ConvertFrom-Json
    foreach($sample in $samples.samples){
        foreach($file in $sample.files){
            $hash=Sha $file.path
            if($hash -cne $file.sha256 -or (Get-Item -LiteralPath $file.path).Length -ne $file.bytes){
                throw 'Old Editor release package no longer matches its provenance manifest'
            }
            $report.oldEditorSamples+=@{path=$file.path;sha256=$hash;bytes=$file.bytes
                recordedActualPeVersion=$sample.actualPeVersion;purpose=$sample.purpose
                actualInstallationPerformed=$false;newPeExtractionPerformed=$false}
        }
    }
    if($report.oldEditorSamples.Count -ne 6){throw 'Incomplete old Editor sample set'}
    $remembered=@($report.rememberedBefore|Where-Object {$_.name -ceq ''})
    if($remembered.Count -ne 1 -or $remembered[0].value -cne 'F:\AgentVN-QA-HostUpgrade-20261018-02\installed-editor'){
        throw 'Remembered installation differs from prior authorized test branch; re-evaluate before mutation'
    }
    $exe=Join-Path $remembered[0].value 'agentvn-editor.exe'
    $report.rememberedExecutable=@{path=$exe;sha256=(Sha $exe);version=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion}
    if($report.rememberedExecutable.sha256 -cne 'f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c'){
        throw 'Original registered test Editor changed'
    }
    $report.registrations=@(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|
        Where-Object {$_.DisplayName -match 'AgentVN'}|
        Select-Object DisplayName,DisplayVersion,InstallLocation,WindowsInstaller,PSChildName)
    if(@($report.registrations|Where-Object {$_.WindowsInstaller -eq 1}).Count){
        throw 'An MSI product is currently installed; cannot assume a clean installation branch'
    }
    $report.rememberedAfter=@(RememberedLocation)
    if(($report.rememberedBefore|ConvertTo-Json -Depth 5 -Compress) -cne
        ($report.rememberedAfter|ConvertTo-Json -Depth 5 -Compress) -or (Sha $exe) -cne $report.rememberedExecutable.sha256){
        throw 'Read-only preflight did not preserve observed original state'
    }
    $report.nextPrerequisites=@(
        'Reuse the previously user-authorized replaceable F QA installation branch only after a fresh byte-verified installation/registration/shortcut checkpoint'
        'Protect original default database and WebView profiles again before any actual installed Editor launch'
        'Require real elevated installer execution and record its terminal state; no registry deletion or AppSearch bypass'
        'Keep game-upgrade missing-old-binary conditions separate from these six valid Editor samples'
    )
    $report.status='PASS'
}catch{$report.status='FAILED';$report.error=$_.Exception.Message;throw}
finally{
    $report.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
    [IO.File]::WriteAllText((Join-Path $out 'report.json'),($report|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
}
[pscustomobject]$report|Select-Object status,scope,installationStatus,upgradeStatus,repairStatus,uninstallStatus,
    @{n='currentMsiPackages';e={$_.packages.Count}},@{n='verifiedOldEditorInstallers';e={$_.oldEditorSamples.Count}},
    rememberedExecutable,nextPrerequisites|ConvertTo-Json -Depth 5
