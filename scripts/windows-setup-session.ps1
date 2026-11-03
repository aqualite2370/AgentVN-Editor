param(
    [ValidateSet('SelfTest','ValidateSource','ValidateUpgrade','Install','Upgrade','Uninstall','Cleanup')][string]$Action='SelfTest',
    [Parameter(Mandatory=$true)][string]$RunDirectory
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$qa='F:\AgentVN\QA\Windows-Package-20261021-01'
$run=[IO.Path]::GetFullPath($RunDirectory)
function Boundary($directory) {
    $absolute=[IO.Path]::GetFullPath($directory)
    if([IO.Path]::GetDirectoryName($absolute) -cne $qa -or
      [IO.Path]::GetFileName($absolute) -notmatch '^runtime-\d{2}$'){throw 'Exact Windows setup QA session required'}
}
Boundary $run
if($Action -eq 'SelfTest') {
    $cases=@(@($run,$true),@(($qa+'\runtime-99'),$true),@($qa,$false),
      @(($qa+'\runtime-01\child'),$false),@(($qa+'\editor-01'),$false),
      @('C:\Users\1',$false),@('F:\AgentVN',$false),@('D:\AgentVN',$false))
    foreach($case in $cases) {
        $accepted=$true;try{Boundary $case[0]}catch{$accepted=$false}
        if($accepted -ne $case[1]){throw 'Setup boundary selftest failed'}
    }
    'PASS: eight setup path boundaries; no system changes';exit
}
if(!(Test-Path -LiteralPath $run -PathType Container)){throw 'Existing bounded QA run required'}
function Read($file){Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json}
function Save($file,$value) {
    if(Test-Path -LiteralPath $file){throw "Evidence already exists: $file"}
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 16),[Text.UTF8Encoding]::new($false))
}
function Sha($file) {
    $stream=[IO.File]::OpenRead($file);$hasher=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
    finally{$stream.Dispose();$hasher.Dispose()}
}
function Describe($file){@{path=$file;sha256=(Sha $file);bytes=(Get-Item -LiteralPath $file).Length}}
$qaNativeFile=Join-Path $run 'native-setup-source.json'
$qaNative=Test-Path -LiteralPath $qaNativeFile
$rawFile=Join-Path $qa 'editor-01\report.json'
$auditFile=Join-Path $qa 'build-audit-01\report.json'
$payloadFile=Join-Path $qa 'setup-payload-audit-01\report.json'
if($qaNative){
    $qaSource=Read $qaNativeFile
    if($qaSource.candidateBinding){
        $rawFile=[IO.Path]::GetFullPath($qaSource.source.path)
        $auditFile=[IO.Path]::GetFullPath($qaSource.audit.path)
        $payloadFile=[IO.Path]::GetFullPath($qaSource.payload.path)
        foreach($qaPair in @(@($rawFile,'editor-\d{2}'),@($auditFile,'native-ui-audit-\d{2}'),@($payloadFile,'setup-payload-audit-\d{2}'))){
            $qaParent=[IO.Path]::GetDirectoryName($qaPair[0])
            if([IO.Path]::GetDirectoryName($qaParent) -cne $qa -or
              [IO.Path]::GetFileName($qaParent) -cnotmatch ('^'+$qaPair[1]+'$') -or
              [IO.Path]::GetFileName($qaPair[0]) -cne 'report.json'){throw 'Bounded candidate source required'}
        }
        if((Sha $qaSource.candidateBinding.path) -cne $qaSource.candidateBinding.sha256){throw 'Candidate binding bytes differ'}
        $qaBinding=Read $qaSource.candidateBinding.path
        if($qaBinding.config.version -cne $qaSource.editorVersion -or
          [IO.Path]::GetFullPath($qaBinding.out) -cne [IO.Path]::GetDirectoryName($rawFile)){throw 'Candidate version or source differs'}
        foreach($qaBound in $qaBinding.sources){
            if((Sha $qaBound.path) -cne $qaBound.sha256){throw 'Candidate source bytes changed'}
        }
    }elseif($qaSource.retainedRelease -ceq 'EDITOR_1_9_24_GAME_1_0_2'){
        $rawFile=Join-Path $qa 'editor-05\report.json'
        $auditFile=Join-Path $qa 'native-ui-audit-04\report.json'
        $payloadFile=Join-Path $qa 'setup-payload-audit-04\report.json'
        if($qaSource.editorVersion -cne '1.9.24' -or !$qaSource.nativeUIBuildSource -or
          $qaSource.source.path -cne $rawFile -or $qaSource.audit.path -cne $auditFile -or
          $qaSource.payload.path -cne $payloadFile){throw 'Exact retained release paths required'}
    }else{
        $rawFile=Join-Path $qa 'editor-03\report.json'
        $auditFile=Join-Path $qa 'native-ui-audit-02\report.json'
        $payloadFile=Join-Path $qa 'setup-payload-audit-02\report.json'
        if($qaSource.editorVersion -cne '1.9.22' -or !$qaSource.nativeUIBuildSource -or
          $qaSource.source.path -cne $rawFile -or $qaSource.audit.path -cne $auditFile -or
          $qaSource.payload.path -cne $payloadFile){throw 'Exact native source paths required'}
    }
    foreach($qaRecord in @($qaSource.source,$qaSource.audit,$qaSource.payload)){
        if((Sha $qaRecord.path) -cne $qaRecord.sha256){throw 'Native source evidence hash differs'}
    }
}
$raw=Read $rawFile;$audit=Read $auditFile;$payload=Read $payloadFile
if($qaNative){
    if($raw.status -cne 'PASS' -or !$raw.nativeChooserClaim -or !$raw.normalCloseClaim -or $raw.builds -ne 1 -or
      $audit.status -cne 'PASS' -or $audit.source.sha256 -cne (Sha $rawFile) -or
      !$payload.nativeUIBuildSource -or $payload.source.sha256 -cne (Sha $rawFile) -or
      $payload.buildAudit.sha256 -cne (Sha $auditFile)){throw 'Native UI source chain not proven'}
    if($qaSource.candidateBinding){
        if($audit.candidateBinding.sha256 -cne $qaSource.candidateBinding.sha256 -or
          $payload.candidateBinding.sha256 -cne $qaSource.candidateBinding.sha256 -or
          $raw.scope -cne ('ACTUAL_INSTALLED_'+$qaSource.editorVersion.Replace('.','_')+'_NORMAL_PUBLISH_UI_NATIVE_PICKER_WINDOWS_BUILD')){
            throw 'Actual candidate audit, payload and version must agree'
        }
    }
    $installer=@($raw.windowsInstaller);$portable=@($raw.windowsPortable)
}else{
    if((Sha $rawFile) -cne '5bdc237d7e39a1670db235643c084cb3760f032c6b404e8f66243ffac9f104b4'){throw 'Frozen build evidence changed'}
    if($audit.status -cne 'PASS' -or $raw.nativeResult.result.status -cne 'PASS'){throw 'Actual build audit required'}
    $installer=@($raw.artifacts|Where-Object {$_.kind -ceq 'windows_nsis_installer'})
    $portable=@($raw.artifacts|Where-Object {$_.kind -ceq 'windows_portable_exe'})
}
if($installer.Count -ne 1 -or $portable.Count -ne 1 -or
  (Sha $installer[0].path) -cne $installer[0].sha256 -or
  (Sha $portable[0].path) -cne $portable[0].sha256){throw 'Actual setup artifact provenance differs'}
if($payload.status -cne 'PASS' -or $payload.installer.sha256 -cne $installer[0].sha256 -or
  !$payload.marker.allOtherBytesIdentical -or $payload.marker.differentBytes -ne 3 -or
  $payload.marker.portableSha256 -cne $portable[0].sha256 -or
  $payload.marker.nsisSha256 -cne $payload.executable.sha256 -or
  (Sha $payload.executable.path) -cne $payload.executable.sha256){throw 'Actual NSIS payload/marker audit required'}
if($Action -eq 'ValidateSource'){
    'PASS: exact setup provenance and payload hashes; no installation or profile mutation';exit
}
$product='AVN Windows QA 20261021'
if($qaNative){
    if($qaSource.candidateBinding){
        $qaProductAllowed=$payload.product -cmatch '^AVN Native Windows [a-zA-Z0-9. -]+$'
        if($qaBinding.upgradeFixture){
            $qaProductAllowed=($payload.product -ceq $qaBinding.upgradeFixture.project.title -and
              $payload.gameId -ceq $qaBinding.upgradeFixture.project.project_id -and
              $payload.pe.fileVersion -ceq $qaBinding.upgradeFixture.version)
        }
        if($payload.product -cne $payload.pe.productName -or $payload.gameId -cne $raw.projectId -or
          !$qaProductAllowed){throw 'Exact bound native QA product required'}
    }elseif($qaSource.retainedRelease){
        if($payload.product -cne 'AVN Windows QA 20261021' -or $payload.gameId -cne 'qa_windows_pkg_20261021_01' -or
          $payload.pe.fileVersion -cne '1.0.2'){throw 'Exact retained same-game release required'}
    }elseif($payload.product -cne 'AVN Native Windows 1922 03' -or
      $payload.gameId -cne 'qa_windows_native_1922_03'){throw 'Exact native QA product required'}
    $product=$payload.product
}
$client=Join-Path $run 'installed-client'
$exe=Join-Path $client 'agentvn-player.exe'
$uninstaller=Join-Path $client 'uninstall.exe'
$receipt=Join-Path $run 'installation.json'
$upgradeReceipt=Join-Path $run 'installation-upgrade.json'
$registryPaths=@(('Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$product),
                 ('Software\agentvn\'+$product))
function RegistrySnapshot {
    $result=@()
    foreach($hive in @('CurrentUser','LocalMachine')){foreach($view in @('Registry32','Registry64')){
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey(
            [Microsoft.Win32.RegistryHive]$hive,[Microsoft.Win32.RegistryView]$view)
        try{foreach($key in $registryPaths){
            $opened=$base.OpenSubKey($key)
            try{
                $values=@()
                if($opened){foreach($name in $opened.GetValueNames()){
                    $values+=@{name=$name;kind=[int]$opened.GetValueKind($name);
                      value=$opened.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}
                }}
                $result+=@{hive=$hive;view=$view;key=$key;exists=($null -ne $opened);values=$values}
            }finally{if($opened){$opened.Dispose()}}
        }}finally{$base.Dispose()}
    }}
    return $result
}
$shortcuts=@(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) ($product+'.lnk')),
    (Join-Path ([Environment]::GetFolderPath('Programs')) ($product+'.lnk'))
)
function ShortcutInfo($file) {
    if(!(Test-Path -LiteralPath $file)){return @{path=$file;exists=$false}}
    $shell=New-Object -ComObject WScript.Shell
    try{$link=$shell.CreateShortcut($file);return @{path=$file;exists=$true;sha256=(Sha $file);
      target=$link.TargetPath;arguments=$link.Arguments}}
    finally{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)}
}
function AssertStopped {
    if(@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -eq 'agentvn-player.exe' -or $_.ExecutablePath -eq $exe
    }).Count){throw 'Player still running; refuse installer operation'}
}
function RunInstaller($file,$arguments,$label) {
    $started=(Get-Date).ToUniversalTime().ToString('o')
    $process=Start-Process -FilePath $file -ArgumentList $arguments -WindowStyle Hidden -PassThru
    $identity=Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
    Save (Join-Path $run ($label+'-process.json')) @{pid=$process.Id;file=$file;arguments=$arguments;startedAt=$started;
      created=$(if($identity){$identity.CreationDate.ToUniversalTime().ToString('o')}else{$null})}
    $deadline=(Get-Date).AddSeconds(120)
    while(!$process.WaitForExit(1000)){
        if((Get-Date) -gt $deadline){throw 'Installer still live after observation limit; retain evidence, do not restart'}
    }
    $process.WaitForExit()
    if($process.ExitCode -ne 0){throw "$label exited $($process.ExitCode)"}
    return @{pid=$process.Id;exitCode=$process.ExitCode;startedAt=$started;finishedAt=(Get-Date).ToUniversalTime().ToString('o')}
}
function UpgradeSource {
    $file=Join-Path $run 'upgrade-source.json'
    $source=Read $file
    if($source.candidateBinding){
        if((Sha $source.candidateBinding.path) -cne $source.candidateBinding.sha256){throw 'Upgrade binding changed'}
        $qaNewBinding=Read $source.candidateBinding.path
        if($qaNewBinding.config.version -cne $source.editorVersion -or !$qaNewBinding.upgradeFixture){throw 'Declared upgrade candidate required'}
        foreach($qaBound in $qaNewBinding.sources){
            if((Sha $qaBound.path) -cne $qaBound.sha256){throw 'Upgrade source input changed'}
        }
        foreach($qaRecord in @($source.source,$source.audit,$source.payload)){
            $qaParent=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($qaRecord.path))
            if([IO.Path]::GetDirectoryName($qaParent) -cne $qa -or
              [IO.Path]::GetFileName($qaRecord.path) -cne 'report.json' -or
              (Sha $qaRecord.path) -cne $qaRecord.sha256){throw 'Exact bounded upgrade evidence required'}
        }
        $new=Read $source.source.path;$newAudit=Read $source.audit.path;$newPayload=Read $source.payload.path
        if([IO.Path]::GetFullPath($qaNewBinding.out) -cne [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($source.source.path)) -or
          $new.status -cne 'PASS' -or !$new.nativeChooserClaim -or !$new.normalCloseClaim -or $new.builds -ne 1 -or
          $newAudit.status -cne 'PASS' -or $newAudit.source.sha256 -cne $source.source.sha256 -or
          $newAudit.candidateBinding.sha256 -cne $source.candidateBinding.sha256 -or
          $newPayload.status -cne 'PASS' -or $newPayload.source.sha256 -cne $source.source.sha256 -or
          $newPayload.buildAudit.sha256 -cne $source.audit.sha256 -or
          $newPayload.candidateBinding.sha256 -cne $source.candidateBinding.sha256 -or
          $newPayload.product -cne $product -or
          $newPayload.gameId -cne $(if($qaNative){$raw.projectId}else{$raw.cartridge.manifest.game_id}) -or
          [version]$newPayload.pe.fileVersion -le [version]$payload.pe.fileVersion -or
          $newPayload.pe.fileVersion -cne $qaNewBinding.upgradeFixture.version -or
          $newPayload.installer.sha256 -cne $new.windowsInstaller.sha256 -or
          !$newPayload.marker.allOtherBytesIdentical -or $newPayload.marker.differentBytes -ne 3 -or
          $newPayload.marker.portableSha256 -cne $new.windowsPortable.sha256 -or
          $newPayload.marker.nsisSha256 -cne $newPayload.executable.sha256){throw 'Actual increasing same-game current upgrade chain required'}
        foreach($qaArtifact in @($new.windowsInstaller,$new.windowsPortable,$newPayload.executable)+@($newPayload.resources)){
            if((Sha $qaArtifact.path) -cne $qaArtifact.sha256){throw 'New upgrade payload bytes differ'}
        }
        return @{source=$source;raw=$new;payload=$newPayload}
    }
    if($qaNative){throw 'Retained old setup must be installed first; not another native product'}
    $paths=@(
      (Join-Path $qa 'editor-04\report.json'),
      (Join-Path $qa 'native-ui-audit-03\report.json'),
      (Join-Path $qa 'setup-payload-audit-03\report.json')
    )
    $records=@($source.source,$source.audit,$source.payload)
    for($i=0;$i -lt $paths.Count;$i++){
        if($records[$i].path -cne $paths[$i] -or
          (Sha $paths[$i]) -cne $records[$i].sha256){throw 'Exact retained-upgrade source evidence required'}
    }
    $new=Read $paths[0];$newAudit=Read $paths[1];$newPayload=Read $paths[2]
    if($source.editorVersion -cne '1.9.22' -or
      $new.status -cne 'PASS' -or !$new.nativeChooserClaim -or !$new.normalCloseClaim -or $new.builds -ne 1 -or
      $newAudit.status -cne 'PASS' -or $newAudit.source.sha256 -cne (Sha $paths[0]) -or
      $newPayload.status -cne 'PASS' -or !$newPayload.upgradeFromRetained -or
      $newPayload.source.sha256 -cne (Sha $paths[0]) -or
      $newPayload.buildAudit.sha256 -cne (Sha $paths[1]) -or
      $newPayload.product -cne $product -or $newPayload.gameId -cne 'qa_windows_pkg_20261021_01' -or
      $newPayload.pe.fileVersion -cne '1.0.1' -or
      $new.upgradeFixture.source.sha256 -cne '3cb8f244c60917d3115e8dcce015aa41cf14226c5825721a69966d176a207f63' -or
      $newPayload.installer.sha256 -cne $new.windowsInstaller.sha256 -or
      !$newPayload.marker.allOtherBytesIdentical -or $newPayload.marker.differentBytes -ne 3 -or
      $newPayload.marker.portableSha256 -cne $new.windowsPortable.sha256 -or
      $newPayload.marker.nsisSha256 -cne $newPayload.executable.sha256){throw 'New same-game/version/payload chain not proven'}
    foreach($artifact in @($new.windowsInstaller,$new.windowsPortable,$newPayload.executable)+@($newPayload.resources)){
        if((Sha $artifact.path) -cne $artifact.sha256){throw 'New payload bytes differ'}
    }
    return @{source=$source;raw=$new;payload=$newPayload}
}
if($Action -eq 'ValidateUpgrade'){
    $null=UpgradeSource
    'PASS: exact 1.9.16 to 1.9.22 same-game upgrade chain; no installation or profile mutation';exit
}
AssertStopped
if($Action -eq 'Install') {
    if((Test-Path -LiteralPath $client) -or (Test-Path -LiteralPath $receipt)){throw 'Fresh real install required'}
    $before=@(RegistrySnapshot)
    if(@($before|Where-Object {$_.exists}).Count){throw 'Existing product registration; no removal or upgrade bypass allowed'}
    foreach($link in $shortcuts){if(Test-Path -LiteralPath $link){throw 'Existing test-name shortcut; refuse overwrite'}}
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $principal=[Security.Principal.WindowsPrincipal]::new($identity)
    if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Ordinary-user install acceptance required'}
    $protection=Read (Join-Path $run 'profile-protection.json')
    if(@($protection.records).Count -ne 2){throw 'Both original profiles must be protected before installing'}
    foreach($record in $protection.records){if($record.existed -and !(Test-Path -LiteralPath $record.held)){throw 'Original profile hold missing'}}
    Save (Join-Path $run 'setup-protection.json') @{status='JOURNALED';registry=$before;
      shortcuts=$shortcuts;client=$client;product=$product;sourceReport=$rawFile;sourceReportSha256=(Sha $rawFile)}
    $result=@{status='RUNNING';installer=$installer[0];client=$client;isElevated=$false;
      installationMethod='ACTUAL_NSIS_SILENT_WITH_DEFAULT_SHORTCUTS_NO_UPDATE_OR_NS';startedAt=(Get-Date).ToUniversalTime().ToString('o')}
    try{
        $result.process=RunInstaller $installer[0].path @('/S',('/D='+$client)) 'install'
        $result.executable=Describe $exe;$result.uninstaller=Describe $uninstaller
        if($result.executable.sha256 -cne $payload.executable.sha256){throw 'Installed binary differs from exact NSIS payload'}
        $result.payloadEvidence=@{executable=$payload.executable;marker=$payload.marker}
        $result.registry=@(RegistrySnapshot)
        $installedKeys=@($result.registry|Where-Object {$_.exists})
        if(!$installedKeys.Count -or @($installedKeys|Where-Object {$_.hive -cne 'CurrentUser'}).Count){
            throw 'Actual ordinary install registration missing or in unexpected hive'
        }
        $uninstallKey=@($installedKeys|Where-Object {$_.key -ceq $registryPaths[0]})
        if(!$uninstallKey.Count){throw 'Actual uninstall registration absent'}
        foreach($key in $uninstallKey){
            if(@($key.values|Where-Object {$_.name -ceq 'DisplayVersion' -and $_.value -ceq $payload.pe.fileVersion}).Count -ne 1){
                throw 'Installed registration version differs'
            }
            $command=@($key.values|Where-Object {$_.name -ceq 'UninstallString'})[0].value
            if($command.Trim('"') -cne $uninstaller){throw 'Uninstall registration points outside owned installation'}
        }
        $result.shortcuts=@($shortcuts|ForEach-Object {ShortcutInfo $_})
        foreach($link in $result.shortcuts){
            if(!$link.exists -or $link.target -cne $exe -or $link.arguments){throw 'Default real shortcut target/arguments differ'}
        }
        $result.resources=@()
        $qaResources=if($qaNative){$payload.resources}else{$audit.embedded}
        foreach($item in $qaResources){
            $file=Join-Path $client ('embedded-cartridge\'+$item.name)
            if((Sha $file) -cne $item.sha256){throw 'Installed embedded bytes differ'}
            $result.resources+=Describe $file
        }
        $result.status='PASS'
    }catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
    finally{$result.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save $receipt $result}
    'PASS: actual ordinary NSIS installation, both default shortcuts, registered uninstall and all embedded resources';exit
}
if(!(Test-Path -LiteralPath (Join-Path $run 'setup-protection.json'))){throw 'Setup ownership journal missing'}
$journal=Read (Join-Path $run 'setup-protection.json')
if($journal.client -cne $client -or $journal.product -cne $product -or
  @($journal.registry|Where-Object {$_.exists}).Count){throw 'Exact absent-before setup boundary required'}
if($Action -eq 'Upgrade'){
    if(Test-Path -LiteralPath $upgradeReceipt){throw 'Do not retry an already attempted upgrade'}
    $new=UpgradeSource
    $old=Read $receipt
    if($old.status -cne 'PASS' -or (Sha $exe) -cne $old.executable.sha256 -or
      (Sha $uninstaller) -cne $old.uninstaller.sha256){throw 'Exact installed old version required'}
    $before=@(RegistrySnapshot)
    if(($before|ConvertTo-Json -Depth 16 -Compress) -cne ($old.registry|ConvertTo-Json -Depth 16 -Compress)){
        throw 'Old installation registration changed; no unregister bypass'
    }
    foreach($link in $shortcuts){if((ShortcutInfo $link).target -cne $exe){throw 'Old default shortcut missing'}}
    $result=@{status='RUNNING';client=$client;source=$new.source;oldExecutable=$old.executable;
      beforeRegistry=$before;method='ACTUAL_SAME_DIRECTORY_NSIS_NO_UNINSTALL_NO_DATA_CLEAR';
      startedAt=(Get-Date).ToUniversalTime().ToString('o')}
    try{
        $result.process=RunInstaller $new.raw.windowsInstaller.path @('/S',('/D='+$client)) 'upgrade'
        $result.executable=Describe $exe
        if($result.executable.sha256 -cne $new.payload.executable.sha256){throw 'Updated executable differs'}
        $result.registry=@(RegistrySnapshot)
        foreach($key in @($result.registry|Where-Object {$_.exists -and $_.key -ceq $registryPaths[0]})){
            if(@($key.values|Where-Object {$_.name -ceq 'DisplayVersion' -and $_.value -ceq $new.payload.pe.fileVersion}).Count -ne 1){
                throw 'Updated registration version differs from actual new payload'
            }
            if($key.hive -cne 'CurrentUser'){throw 'Upgrade changed installation hive'}
        }
        if(@($result.registry|Where-Object {$_.exists -and $_.key -ceq $registryPaths[0]}).Count -lt 1){
            throw 'Upgrade uninstall registration missing'
        }
        $result.shortcuts=@($shortcuts|ForEach-Object {ShortcutInfo $_})
        if(@($result.shortcuts|Where-Object {!$_.exists -or $_.target -cne $exe -or $_.arguments}).Count){
            throw 'Updated shortcut target/arguments differ'
        }
        $result.resources=@()
        foreach($item in $new.payload.resources){
            $file=Join-Path $client ('embedded-cartridge\'+$item.name)
            if((Sha $file) -cne $item.sha256){throw 'Updated installed resource differs'}
            $result.resources+=Describe $file
        }
        $result.status='PASS'
    }catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
    finally{
        if(Test-Path -LiteralPath $uninstaller){$result.uninstaller=Describe $uninstaller}
        $result.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save $upgradeReceipt $result
    }
    'PASS: real same-directory NSIS coverage upgrade and updated binary/resources/registration';exit
}
if($Action -eq 'Uninstall'){
    $installed=if(Test-Path -LiteralPath $upgradeReceipt){Read $upgradeReceipt}else{Read $receipt}
    if(!(Test-Path -LiteralPath $uninstaller) -or $installed.uninstaller.path -cne $uninstaller -or
      (Sha $uninstaller) -cne $installed.uninstaller.sha256){throw 'Exact owned uninstaller required'}
    $result=@{status='RUNNING';method='ACTUAL_INSTALLED_UNINSTALL_EXE_S';
      sourceUninstaller=(Describe $uninstaller);startedAt=(Get-Date).ToUniversalTime().ToString('o')}
    try{
        $result.process=RunInstaller $uninstaller @('/S') 'uninstall'
        $deadline=(Get-Date).AddSeconds(90)
        do{
            $active=@(Get-CimInstance Win32_Process|Where-Object {
                $_.ExecutablePath -and $_.ExecutablePath.StartsWith($run+'\',[StringComparison]::OrdinalIgnoreCase)
            })
            $after=@(RegistrySnapshot)
            $registered=@($after|Where-Object {$_.key -ceq $registryPaths[0] -and $_.exists})
            $done=!(Test-Path -LiteralPath $exe) -and !(Test-Path -LiteralPath $uninstaller) -and
              !$registered.Count -and !$active.Count
            if(!$done){Start-Sleep -Milliseconds 250}
        }while(!$done -and (Get-Date) -lt $deadline)
        $result.registry=$after;$result.active=$active|Select-Object ProcessId,ExecutablePath
        $result.shortcuts=@($shortcuts|ForEach-Object {ShortcutInfo $_})
        if(!$done){throw 'Actual uninstall has not removed owned binaries/registration or still runs'}
        if(@($result.shortcuts|Where-Object {$_.exists}).Count){throw 'Actual uninstall left default shortcuts'}
        $result.status='PASS'
    }catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
    finally{$result.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save (Join-Path $run 'uninstallation.json') $result}
    'PASS: actual installed uninstaller removed binaries, uninstall registration and both shortcuts';exit
}
# Only QA-created settings registration may remain after a normal uninstall.
# Preserve that observation; remove the exact new product child, never a
# manufacturer parent or a pre-existing installation registration.
$removed=@()
foreach($row in @(RegistrySnapshot)|Where-Object {$_.exists}){
    if($row.hive -cne 'CurrentUser' -or $row.key -cne $registryPaths[1]){throw 'Unexpected registration residue; no broad cleanup'}
    foreach($value in $row.values){
        if($value.name -notin @('','Installer Language') -or
          ($value.name -ceq '' -and $value.value -cne $client)){throw 'Unknown product value; refuse cleanup'}
    }
    $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,
        [Microsoft.Win32.RegistryView]$row.view)
    try{$base.DeleteSubKeyTree($row.key,$false)}finally{$base.Dispose()}
    $removed+=@{hive=$row.hive;view=$row.view;key=$row.key}
}
foreach($link in $shortcuts){if(Test-Path -LiteralPath $link){throw 'Shortcut residue not automatically removed'}}
$after=@(RegistrySnapshot)
if(@($after|Where-Object {$_.exists}).Count){throw 'Scoped QA registration remains'}
Save (Join-Path $run 'setup-cleanup.json') @{status='PASS';registry=$after;removedQAOnlyKeys=$removed;
  deletedUserFiles=0;at=(Get-Date).ToUniversalTime().ToString('o')}
'PASS: exact new QA product registry cleared; no old registration changed'
