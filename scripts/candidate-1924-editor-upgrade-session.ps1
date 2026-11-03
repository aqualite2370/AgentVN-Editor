param(
    [ValidateSet('SelfTest','Prepare','InstallOld','InstallNew','Uninstall','Restore')][string]$Action='SelfTest'
)
# QA only: real NSIS operations, blank physical default profiles, no product edits.
$ErrorActionPreference='Stop'
$run='F:\AgentVN\QA\Editor-Upgrade-1924-20261025-05'
$install=Join-Path $run 'installed-editor'
$checkpoint='F:\AgentVN\Checkpoints\Editor-Upgrade-1924-20261025-05'
$keys=@('Software\agentvn\AgentVN Editor','Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor')
$roots=@('C:\Users\1\AppData\Roaming\com.agentvn.editor',
         'C:\Users\1\AppData\Local\com.agentvn.editor',
         'C:\Users\1\AppData\Local\AgentVN\environment-cache')
$old='D:\AgentVN\releases\editor\AgentVN_Editor_v1.9.22_20261022_122816.exe'
$sealed='F:\AgentVN\QA\Editor-1.9.24-20261024-01\installation.json'
$originalInstall='F:\AgentVN\QA\AgentVN-QA-HostUpgrade-20261018-02\installed-editor'
function Read($file){Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($file){
    $stream=[IO.File]::OpenRead($file);$hash=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
    finally{$stream.Dispose();$hash.Dispose()}
}
function Save($file,$value){
    if(Test-Path -LiteralPath $file){throw "Existing evidence: $file"}
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 24),[Text.UTF8Encoding]::new($false))
}
function Id($directory){
    if(!(Test-Path -LiteralPath $directory)){return $null}
    $text=(& fsutil.exe file queryfileid $directory|Out-String)
    if($LASTEXITCODE -ne 0 -or $text -notmatch '0x[0-9a-fA-F]+'){throw 'Missing NTFS identity'}
    $Matches[0].ToLowerInvariant()
}
function Boundary($target){
    if([IO.Path]::GetFullPath($target) -cne $install){throw 'Exact scratch installation required'}
}
function Idle{
    if(@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match
        '^(agentvn-editor|AgentVN Dev|agentvn-player|creator-backend)\.exe$'}).Count){throw 'AgentVN still running'}
}
function Files($directory){
    $entries=@(Get-Item -LiteralPath $directory -Force)+@(Get-ChildItem -LiteralPath $directory -Recurse -Force)
    if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Linked tree'}
    @(foreach($file in $entries|Where-Object {!$_.PSIsContainer}){
        @{relative=$file.FullName.Substring($directory.Length+1);bytes=$file.Length;sha256=(Sha $file.FullName)}
    })
}
function Verify($directory,$expected){
    $actual=@(Files $directory);if($actual.Count -ne @($expected).Count){throw 'Inventory count differs'}
    $lookup=@{};foreach($file in $actual){$lookup[$file.relative]=$file}
    foreach($file in $expected){
        $other=$lookup[$file.relative]
        if(!$other -or $other.sha256 -cne $file.sha256 -or $other.bytes -ne $file.bytes){
            throw "Inventory differs: $($file.relative)"
        }
    }
}
function Registry{
    @(foreach($relative in $keys){
        $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($relative)
        if(!$key){@{path=$relative;exists=$false;values=@()};continue}
        try{
            if($key.GetSubKeyNames().Count){throw 'Nested registration'}
            @{path=$relative;exists=$true;values=@(foreach($name in $key.GetValueNames()){
                @{name=$name;kind=$key.GetValueKind($name).ToString()
                  value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}
            })}
        }finally{$key.Dispose()}
    })
}
function Links{
    $shell=New-Object -ComObject WScript.Shell
    @(foreach($folder in @('C:\Users\1\Desktop','C:\Users\Public\Desktop',
        'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs','C:\ProgramData\Microsoft\Windows\Start Menu\Programs')){
        foreach($file in Get-ChildItem -LiteralPath $folder -Filter '*AgentVN*.lnk' -File){
            @{path=$file.FullName;sha256=(Sha $file.FullName);target=$shell.CreateShortcut($file.FullName).TargetPath}
        }
    })
}
Boundary $install
if($Action -ceq 'SelfTest'){
    foreach($bad in @('F:\','F:\AgentVN','D:\AgentVN',$run,$checkpoint,($install+'\nested'),($install+'\..'),($install+'-other'))){
        $accepted=$true;try{Boundary $bad}catch{$accepted=$false};if($accepted){throw 'Unsafe boundary accepted'}
    }
    if((Read $sealed).executable.version -cne '1.9.24'){throw 'Wrong frozen candidate'}
    'PASS: exact installation and eight invalid boundary cases; no mutation';exit
}
Idle
$candidate=Read $sealed
if($candidate.status -cne 'PASS' -or $candidate.executable.version -cne '1.9.24'){throw 'Wrong sealed candidate'}
foreach($file in @($candidate.package,$candidate.executable)+@($candidate.resources)){
    if((Sha $file.path) -cne $file.sha256){throw 'Candidate bytes changed'}
}
if($Action -ceq 'Prepare'){
    if((Test-Path -LiteralPath $run) -or (Test-Path -LiteralPath $checkpoint)){throw 'Fresh session required'}
    if((Get-PSDrive F).Free -lt 2GB){throw 'Insufficient F space'}
    $null=New-Item -ItemType Directory -Path $run,$checkpoint
    foreach($file in @($PSCommandPath,(Join-Path $PSScriptRoot 'candidate-1924-editor-upgrade.cjs'),'D:\AgentVN\plans\ACTIVE_TASKS.md')){
        Copy-Item -LiteralPath $file -Destination (Join-Path $checkpoint ([IO.Path]::GetFileName($file)))
    }
    $records=@()
    foreach($original in $roots){
        $held=$original+'.qa-hold-editor-upgrade-1924-20261025-05'
        $retained=$original+'.qa-tested-editor-upgrade-1924-20261025-05'
        if((Test-Path -LiteralPath $held) -or (Test-Path -LiteralPath $retained)){throw 'Profile collision'}
        $exists=Test-Path -LiteralPath $original
        $files=if($exists -and $original -cne $roots[1]){@(Files $original)}else{@()}
        $records+=@{original=$original;held=$held;retained=$retained;existed=$exists;directoryId=(Id $original)
          byteInventory=($original -cne $roots[1]);files=$files}
    }
    # Verify MSIX views before moving either alias; never protect one physical directory twice.
    foreach($i in 0..1){
        $alias='C:\Users\1\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\'+
            $(if($i -eq 0){'Roaming'}else{'Local'})+'\com.agentvn.editor'
        if((Id $alias) -cne $records[$i].directoryId){throw 'MSIX alias requires separate protection'}
    }
    $state=@{status='JOURNALED';at=(Get-Date).ToUniversalTime().ToString('o');records=$records
      registry=@(Registry);links=@(Links);old=@{path=$old;sha256=(Sha $old)};candidate=$candidate
      protectedFiles=@($candidate.protectedFiles);originalInstallation=$originalInstall
      originalInstallationFiles=@(Files $originalInstall)}
    $originalBackup=Join-Path $checkpoint 'original-installation'
    Copy-Item -LiteralPath $originalInstall -Destination $originalBackup -Recurse
    Verify $originalBackup $state.originalInstallationFiles
    foreach($link in $state.links){
        $link.backup=Join-Path $checkpoint ('shortcut-'+[Array]::IndexOf($state.links,$link)+'.lnk')
        Copy-Item -LiteralPath $link.path -Destination $link.backup
    }
    Save (Join-Path $run 'protection.json') $state
    foreach($record in $records){
        if($record.existed){[IO.Directory]::Move($record.original,$record.held)}
        $null=New-Item -ItemType Directory -Path $record.original -Force
        Save (Join-Path $run ('created-'+[Array]::IndexOf($records,$record)+'.json')) @{
            original=$record.original;directoryId=(Id $record.original)}
    }
    Save (Join-Path $run 'prepared.json') @{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o')}
    'PASS: physical default Editor/WebView and external cache isolated; user directories held';exit
}
$state=Read (Join-Path $run 'protection.json')
$result=@{status='RUNNING';action=$Action;at=(Get-Date).ToUniversalTime().ToString('o');installRoot=$install;error=$null}
try{
    if($Action -ceq 'Restore'){
        if(Test-Path -LiteralPath (Join-Path $install 'agentvn-editor.exe')){throw 'Uninstall owned product first'}
        if($state.originalInstallation -cne $originalInstall){throw 'Original installation target differs'}
        $originalSame=$true;try{Verify $originalInstall $state.originalInstallationFiles}catch{$originalSame=$false}
        if(!$originalSame){
            $originalBackup=Join-Path $checkpoint 'original-installation'
            Verify $originalBackup $state.originalInstallationFiles
            $changed=Join-Path $run 'altered-original-installation'
            if(Test-Path -LiteralPath $changed){throw 'Original recovery collision'}
            if(Test-Path -LiteralPath $originalInstall){[IO.Directory]::Move($originalInstall,$changed)}
            Copy-Item -LiteralPath $originalBackup -Destination $originalInstall -Recurse
            Verify $originalInstall $state.originalInstallationFiles
        }
        $result.originalInstallationWasUnchanged=$originalSame
        $result.profiles=@()
        foreach($record in $state.records){
            if($record.original -cnotin $roots){throw 'Unknown profile'}
            $index=[Array]::IndexOf($roots,[string]$record.original)
            $created=Read (Join-Path $run ('created-'+$index+'.json'))
            if((Id $record.original) -cne $created.directoryId -or (Test-Path -LiteralPath $record.retained)){
                throw 'QA profile identity/collision'
            }
            if($record.existed -and (Id $record.held) -cne $record.directoryId){throw 'Original directory identity differs'}
            [IO.Directory]::Move($record.original,$record.retained)
            if($record.existed){[IO.Directory]::Move($record.held,$record.original)}
            if($record.existed -and (Id $record.original) -cne $record.directoryId){throw 'Restored identity differs'}
            $result.profiles+=@{original=$record.original;retained=$record.retained;identity=$record.directoryId
                originalFiles=@($record.files).Count;restored=$true}
        }
        # Restore all directory identities first. A merged filesystem view can
        # leave original-only entries in the retained QA view after a move.
        # Recover only recorded, absent files with matching original bytes.
        $result.recoveredViewEntries=@()
        foreach($record in $state.records|Where-Object {$_.existed -and $_.byteInventory}){
            foreach($file in @($record.files)){
                $target=Join-Path $record.original $file.relative
                if(!(Test-Path -LiteralPath $target)){
                    $source=Join-Path $record.retained $file.relative
                    if((Sha $source) -cne $file.sha256){throw 'Missing original entry has no exact source'}
                    $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
                    Copy-Item -LiteralPath $source -Destination $target
                    $result.recoveredViewEntries+=@{path=$target;sha256=$file.sha256;source=$source}
                }
            }
            Verify $record.original $record.files
        }
        foreach($row in $state.registry){
            if(!$row.exists){throw 'Unexpected absent baseline registration; explicit recovery needed'}
            $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($row.path)
            try{
                foreach($name in $key.GetValueNames()){
                    if($name -cnotin @($row.values.name)){throw 'Unknown registration value'}
                }
                foreach($value in $row.values){$key.SetValue($value.name,$value.value,[Microsoft.Win32.RegistryValueKind]$value.kind)}
            }finally{$key.Dispose()}
        }
        foreach($link in $state.links){
            if((Sha $link.backup) -cne $link.sha256){throw 'Shortcut backup changed'}
            Copy-Item -LiteralPath $link.backup -Destination $link.path -Force
            if((Sha $link.path) -cne $link.sha256){throw 'Shortcut restore failed'}
        }
        foreach($file in $state.protectedFiles){if((Sha $file.path) -cne $file.sha256){throw 'Protected artifact differs'}}
        $result.registryAfter=@(Registry);$result.linksAfter=@(Links);$result.deletedUserFiles=0
    }else{
        if((Read (Join-Path $run 'prepared.json')).status -cne 'PASS'){throw 'Protection not ready'}
        $version=if($Action -ceq 'InstallOld'){'1.9.22'}else{'1.9.24'}
        if($Action -ceq 'InstallOld' -and (Test-Path -LiteralPath $install)){throw 'Fresh install required'}
        if($Action -ceq 'InstallNew'){
            if((Get-Item -LiteralPath (Join-Path $install 'agentvn-editor.exe')).VersionInfo.ProductVersion -cne '1.9.22'){
                throw 'Actual old installation required'
            }
            if((Read (Join-Path $run 'old-baseline.json')).status -cne 'PASS'){throw 'Old UI baseline required'}
            $result.persistenceBefore=@(Files (Join-Path $roots[0] 'backend'))
        }
        $package=if($Action -ceq 'InstallOld'){$state.old}else{$candidate.package}
        if((Sha $package.path) -cne $package.sha256){throw 'Installer source changed'}
        $exe=if($Action -ceq 'Uninstall'){Join-Path $install 'uninstall.exe'}else{$package.path}
        $installerArgs=if($Action -ceq 'Uninstall'){@('/S',('_?='+$install))}else{@('/S',('/D='+$install))}
        $result.version=$version;$result.executable=$exe;$result.sha256=Sha $exe;$result.arguments=$installerArgs
        $result.registryBefore=@(Registry)
        Save (Join-Path $run ($Action+'-starting.json')) $result
        $process=Start-Process -FilePath $exe -ArgumentList $installerArgs -WindowStyle Hidden -PassThru
        $result.pid=$process.Id;$result.created=$process.StartTime.ToUniversalTime().ToString('o')
        $process.WaitForExit();$result.exitCode=$process.ExitCode
        if($result.exitCode -ne 0){throw 'Real NSIS operation failed'}
        $result.registryAfter=@(Registry)
        if($Action -ceq 'Uninstall'){
            if(Test-Path -LiteralPath (Join-Path $install 'agentvn-editor.exe')){throw 'Uninstall incomplete'}
        }else{
            $actual=Join-Path $install 'agentvn-editor.exe'
            $result.actualVersion=(Get-Item -LiteralPath $actual).VersionInfo.ProductVersion
            $result.actualSha256=Sha $actual
            if($result.actualVersion -cne $version){throw 'Actual installed PE differs'}
            if($Action -ceq 'InstallNew' -and $result.actualSha256 -cne $candidate.executable.sha256){throw 'Wrong candidate PE'}
            $reg=@($result.registryAfter|Where-Object path -CEQ $keys[1])[0]
            if(@($reg.values|Where-Object {$_.name -ceq 'DisplayVersion' -and $_.value -ceq $version}).Count -ne 1){
                throw 'Actual NSIS registration differs'
            }
        }
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{Save (Join-Path $run ($Action+'.json')) $result}
$result|Select-Object status,action,actualVersion|ConvertTo-Json -Compress
