param([ValidateSet('SelfTest','Checkpoint','InstallOld','InstallNew','Uninstall','Restore')][string]$Action='SelfTest')
# QA-only current-candidate chain. No product changes or forced update switches.
$ErrorActionPreference='Stop'
$run='F:\AgentVN\QA\Current-NSIS-Upgrade-20261021-01'
$backup='F:\AgentVN\Checkpoints\Current-NSIS-Upgrade-20261021-01'
$target=Join-Path $run 'installed-editor'
$originalFile='F:\AgentVN\Checkpoints\Current-MSI-Upgrade-20261021-01\checkpoint-verified-02.json'
$originalPhysical='F:\AgentVN\QA\AgentVN-QA-HostUpgrade-20261018-02\installed-editor'
$keys=@('Software\agentvn\AgentVN Editor','Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor')
$packages=@(
    @{version='1.9.8';path='D:\AgentVN\releases\editor\AgentVN_Editor_v1.9.8_20260925_101446.exe'
      sha256='f91118bf15d1f0f76e5628596e61bfd8d981c037d051f6cb6f59f8a5c92ccd42'},
    @{version='1.9.16';path='D:\AgentVN\releases\editor\AgentVN_Editor_v1.9.16_20261021_ComponentPreview.exe'
      sha256='303a56b5c075bc9cebe1a60949a1ec6dd21b7a71b445f03364dd7a441f9dc571'}
)
function Read($file){Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Save($file,$value){
    if(Test-Path -LiteralPath $file){throw 'Fresh NSIS receipt required'}
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
}
function Boundary($directory){
    if([IO.Path]::GetFullPath($directory) -cnotin @($target,$originalPhysical)){
        throw 'Only the two exact declared NSIS installation directories allowed'
    }
}
function Files($directory){
    $entries=@(Get-Item -LiteralPath $directory -Force)+@(Get-ChildItem -LiteralPath $directory -Force -Recurse)
    if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Linked installation entry'}
    @(foreach($file in $entries|Where-Object {!$_.PSIsContainer}){
        @{relative=$file.FullName.Substring($directory.Length+1);bytes=$file.Length;sha256=(Sha $file.FullName)}
    })
}
function Verify($directory,$expected){
    $actual=@(Files $directory);if($actual.Count -ne @($expected).Count){throw 'Byte inventory file count differs'}
    $lookup=@{};foreach($row in $actual){$lookup[$row.relative]=$row}
    foreach($row in $expected){
        $other=$lookup[$row.relative]
        if(!$other -or $other.sha256 -cne $row.sha256 -or $other.bytes -ne $row.bytes){throw 'Byte inventory differs'}
    }
}
function Idle {
    if(@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\.exe$' -or
        ($_.Name -ceq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')
    }).Count){throw 'AgentVN processes active'}
}
function Registry {
    @(foreach($path in $keys){
        $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path)
        try{
            if(!$key){@{path=$path;exists=$false;values=@()};continue}
            if($key.GetSubKeyNames().Count){throw 'Unexpected nested registration'}
            @{path=$path;exists=$true;values=@(foreach($name in $key.GetValueNames()){
                @{name=$name;kind=$key.GetValueKind($name).ToString()
                  value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}
            })}
        }finally{if($key){$key.Dispose()}}
    })
}
function Registrations {
    @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|
        Where-Object {$_.DisplayName -match 'AgentVN'}|
        Select-Object DisplayName,DisplayVersion,InstallLocation,WindowsInstaller,PSChildName)
}
function Links {
    $shell=New-Object -ComObject WScript.Shell
    @(foreach($folder in @('C:\Users\1\Desktop','C:\Users\Public\Desktop',
        'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs','C:\ProgramData\Microsoft\Windows\Start Menu\Programs')){
        foreach($file in Get-ChildItem -LiteralPath $folder -Filter '*AgentVN*.lnk' -File){
            @{path=$file.FullName;sha256=(Sha $file.FullName);target=$shell.CreateShortcut($file.FullName).TargetPath}
        }
    })
}
if($Action -ceq 'SelfTest'){
    foreach($good in @($target,$originalPhysical)){Boundary $good}
    foreach($bad in @('F:\','F:\AgentVN','F:\AgentVN\QA',$run,$backup,'D:\AgentVN',
        ($target+'\nested'),($target+'\..'),($target+'-other'),'C:\Users\1')){
        $ok=$true;try{Boundary $bad}catch{$ok=$false};if($ok){throw 'Unrelated NSIS directory accepted'}
    }
    'PASS: two exact installation identities and ten rejected boundaries; no mutation';exit
}
Idle
if(([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Normal per-user NSIS session required'}
Boundary $target;Boundary $originalPhysical
if($Action -ceq 'Checkpoint'){
    if((Test-Path -LiteralPath $run) -or (Test-Path -LiteralPath (Join-Path $backup 'checkpoint.json'))){
        throw 'Fresh NSIS session required'
    }
    if(@(Registrations|Where-Object {$_.WindowsInstaller -eq 1}).Count){throw 'Registered MSI requires its own chain'}
    $original=Read $originalFile
    if($original.status -cne 'PASS' -or $original.physicalSource -cne $originalPhysical){throw 'Original installation identity differs'}
    Verify $originalPhysical $original.files
    Verify (Join-Path ([IO.Path]::GetDirectoryName($originalFile)) 'installation') $original.files
    foreach($protected in $original.protectedFiles){if((Sha $protected.path) -cne $protected.sha256){throw 'Protected artifact changed'}}
    foreach($package in $packages){if((Sha $package.path) -cne $package.sha256){throw 'Trusted source package differs'}}
    $null=New-Item -ItemType Directory -Path $run
    $result=[ordered]@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');installRoot=$target
        sourceCheckpoint=@{path=$originalFile;sha256=(Sha $originalFile)}
        originalPhysical=$originalPhysical;originalFiles=$original.files.Count
        registry=@(Registry);registrations=@(Registrations);shortcuts=@(Links);packages=$packages
        protectedFiles=$original.protectedFiles;error=$null}
    try{
        foreach($link in $result.shortcuts){
            $copy=Join-Path $backup ('shortcuts\'+[array]::IndexOf($result.shortcuts,$link)+'.lnk')
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($copy)) -Force
            Copy-Item -LiteralPath $link.path -Destination $copy
            if((Sha $copy) -cne $link.sha256){throw 'Shortcut checkpoint differs'}
            $link.backup=$copy
        }
        if($result.registry.Count -ne 2 -or @($result.registry|Where-Object {!$_.exists}).Count){
            throw 'Expected original NSIS keys; do not fabricate registration'
        }
        $result.status='PASS'
    }catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
    finally{Save (Join-Path $backup 'checkpoint.json') $result}
    [pscustomobject]$result|Select-Object status,installRoot,originalFiles|ConvertTo-Json;exit
}
$checkpoint=Read (Join-Path $backup 'checkpoint.json')
if($checkpoint.status -cne 'PASS' -or $checkpoint.installRoot -cne $target){throw 'Verified NSIS checkpoint required'}
$original=Read $checkpoint.sourceCheckpoint.path
if((Sha $checkpoint.sourceCheckpoint.path) -cne $checkpoint.sourceCheckpoint.sha256){throw 'Original checkpoint changed'}
$destination=Join-Path $run ($Action+'.json')
if(Test-Path -LiteralPath $destination){throw 'Never repeat an installer or restoration action'}
$result=[ordered]@{status='RUNNING';action=$Action;at=(Get-Date).ToUniversalTime().ToString('o')
    installerKind='NSIS';installRoot=$target;registrationsBefore=@(Registrations);registryBefore=@(Registry)
    error=$null}
try{
    if($Action -ceq 'Restore'){
        if(Test-Path -LiteralPath (Join-Path $target 'agentvn-editor.exe')){
            throw 'Uninstall tested NSIS before restoration'
        }
        if(Test-Path -LiteralPath (Join-Path $run 'Uninstall.json')){
            if((Read (Join-Path $run 'Uninstall.json')).status -cne 'PASS'){throw 'Actual uninstall was not successful'}
        }else{
            if(!(Test-Path -LiteralPath (Join-Path $run 'InstallOld.json'))){throw 'No installer operation to recover'}
            $result.recoveryWithoutInstalledExecutable=$true
        }
        $same=$true;try{Verify $originalPhysical $original.files}catch{$same=$false}
        if(!$same){
            $source=Join-Path ([IO.Path]::GetDirectoryName($checkpoint.sourceCheckpoint.path)) 'installation'
            Verify $source $original.files
            $retained=Join-Path $run 'changed-original-installation-retained'
            if(Test-Path -LiteralPath $retained){throw 'Original recovery collision'}
            # Exact child of the consolidated QA tree, never its compatibility Junction.
            Boundary $originalPhysical
            if(Test-Path -LiteralPath $originalPhysical){
                $null=Files $originalPhysical
                [IO.Directory]::Move($originalPhysical,$retained)
            }
            $null=New-Item -ItemType Directory -Path $originalPhysical
            foreach($row in $original.files){
                $copy=Join-Path $originalPhysical $row.relative
                $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($copy)) -Force
                Copy-Item -LiteralPath (Join-Path $source $row.relative) -Destination $copy
            }
            Verify $originalPhysical $original.files
        }
        $result.originalInstallationWasUnchanged=$same
        foreach($record in $checkpoint.registry){
            if($record.path -cnotin $keys -or !$record.exists){throw 'Unexpected registry restoration target'}
            $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($record.path)
            try{
                if($key.GetSubKeyNames().Count){throw 'Unexpected nested registration; preserve'}
                foreach($name in $key.GetValueNames()){
                    if($name -cnotin @($record.values.name)){throw 'Unknown registry value; preserve'}
                }
                foreach($value in $record.values){
                    $key.SetValue($value.name,$value.value,[Microsoft.Win32.RegistryValueKind]$value.kind)
                }
            }finally{$key.Dispose()}
        }
        foreach($link in $checkpoint.shortcuts){
            if((Sha $link.backup) -cne $link.sha256){throw 'Shortcut backup differs'}
            $current=@(Links|Where-Object {$_.path -ceq $link.path})
            if($current.Count -and $current[0].sha256 -cne $link.sha256 -and
                $current[0].target -cne (Join-Path $target 'agentvn-editor.exe')){throw 'Unknown shortcut change'}
            Copy-Item -LiteralPath $link.backup -Destination $link.path -Force
            if((Sha $link.path) -cne $link.sha256){throw 'Original shortcut restoration differs'}
        }
        if(@(Links|Where-Object {$_.path -cnotin @($checkpoint.shortcuts.path)}).Count){throw 'New shortcut remains; inspect'}
        $result.registryAfter=@(Registry)
    }else{
        $protection=Read (Join-Path $run 'profile-protection.json')
        if($protection.records.Count -ne 2){throw 'Two original profile records required'}
        foreach($record in $protection.records){if(!(Test-Path -LiteralPath $record.held)){throw 'Original profile not held'}}
        if($Action -ceq 'InstallOld'){
            if(Test-Path -LiteralPath $target){throw 'Fresh NSIS target required'}
            $version='1.9.8'
        }else{
            $version='1.9.16'
            $priorFile=if($Action -ceq 'InstallNew'){'InstallOld.json'}
                elseif(Test-Path -LiteralPath (Join-Path $run 'InstallNew.json')){'InstallNew.json'}else{'InstallOld.json'}
            $previous=Read (Join-Path $run $priorFile)
            if(($previous.status -cne 'PASS' -and !($Action -ceq 'Uninstall' -and $previous.executableSha256)) -or
                $previous.installRoot -cne $target){throw 'Exact owned NSIS baseline required'}
            if($Action -ceq 'Uninstall'){$version=$previous.actualVersion}
            if((Sha (Join-Path $target 'agentvn-editor.exe')) -cne $previous.executableSha256){throw 'Actual installed NSIS baseline differs'}
        }
        $package=@($checkpoint.packages|Where-Object {$_.version -ceq $version})[0]
        if((Sha $package.path) -cne $package.sha256){throw 'Trusted NSIS installer differs'}
        $result.package=$package.path;$result.packageSha256=$package.sha256;$result.version=$version
        if($Action -ceq 'InstallNew'){
            $ui=Read (Join-Path $run 'old-ui-01\report.json')
            if($ui.status -cne 'PASS' -or !$ui.project.metadata.projectId){throw 'Real old UI baseline required'}
            $result.persistenceBefore=@()
            foreach($label in @('Roaming','Local')){
                $folder='C:\Users\1\AppData\'+$label+'\com.agentvn.editor'
                $inventory=@(Files $folder);$copy=Join-Path $run ('old-persistence\'+$label.ToLowerInvariant())
                if(Test-Path -LiteralPath $copy){throw 'Persistence archive collision'}
                Copy-Item -LiteralPath $folder -Destination $copy -Recurse
                Verify $copy $inventory
                $result.persistenceBefore+=@{path=$folder;archive=$copy;files=$inventory}
            }
        }
        $executable=if($Action -ceq 'Uninstall'){Join-Path $target 'uninstall.exe'}else{$package.path}
        $result.arguments=if($Action -ceq 'Uninstall'){@('/S',('_?='+$target))}else{@('/S',('/D='+$target))}
        $result.executedSha256=Sha $executable
        Save (Join-Path $run ($Action+'-running.json')) @{
            status='STARTING';executable=$executable;sha256=$result.executedSha256
            arguments=$result.arguments;at=(Get-Date).ToUniversalTime().ToString('o')}
        $process=Start-Process -FilePath $executable -ArgumentList $result.arguments -WindowStyle Hidden -PassThru
        $result.installerPid=$process.Id;$result.installerCreated=$process.StartTime.ToUniversalTime().ToString('o')
        $process.WaitForExit();$result.exitCode=$process.ExitCode
        if($process.ExitCode -ne 0){throw 'Actual NSIS operation failed'}
        $result.registrationsAfter=@(Registrations)
        if($Action -ceq 'Uninstall'){
            if(Test-Path -LiteralPath (Join-Path $target 'agentvn-editor.exe')){throw 'Actual NSIS uninstall incomplete'}
            if(@($result.registrationsAfter|Where-Object {$_.InstallLocation.Trim('"').TrimEnd('\') -ceq $target}).Count){
                throw 'Owned NSIS uninstall registration remains'
            }
        }else{
            $exe=Join-Path $target 'agentvn-editor.exe'
            $result.actualVersion=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
            $result.executableSha256=Sha $exe
            if($result.actualVersion -cne $version){throw 'Actual NSIS installation version differs'}
            $registered=@($result.registrationsAfter|Where-Object {$_.DisplayVersion -ceq $version -and
                $_.InstallLocation.Trim('"').TrimEnd('\') -ceq $target -and $_.WindowsInstaller -ne 1})
            if($registered.Count -ne 1){throw 'Actual NSIS registration or install path differs'}
            if($version -ceq '1.9.16' -and $result.executableSha256 -cne
                '120b1ea9b577faa24172a8854ca752e1c1320772792cab04f33cfeedbf28914c'){throw 'Current sealed NSIS payload differs'}
        }
        if($Action -ceq 'InstallNew'){
            foreach($snapshot in $result.persistenceBefore){Verify $snapshot.path $snapshot.files}
            $result.persistenceUnchangedBeforeFirstNewLaunch=$true
        }
    }
    foreach($protected in $checkpoint.protectedFiles){if((Sha $protected.path) -cne $protected.sha256){throw 'Protected original changed'}}
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{Save $destination $result}
[pscustomobject]$result|Select-Object status,action,actualVersion,exitCode,installRoot,error|ConvertTo-Json
