param([ValidateSet('SelfTest','Install','ProtectProfiles','RestoreProfiles')][string]$Action='SelfTest')
$ErrorActionPreference='Stop'
$qa='F:\AgentVN\QA\Installed-Candidate-20261021-01'
$install=Join-Path $qa 'editor'
$utf8=[Text.UTF8Encoding]::new($false)
function Save($file,$value){[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 18),$utf8)}
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Idle {
    $rows=@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\.exe$' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.editor')
    })
    if($rows.Count){throw 'An Editor/Player/backend/profile is in use; refusing installation/profile mutation'}
}
function ExactChild($target,$parent) {
    if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($target)) -cne [IO.Path]::GetFullPath($parent)){
        throw "Not an exact named child: $target"
    }
}
function RegistrySnapshot($relative){
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($relative)
    if(!$key){throw "Expected original registration missing: $relative"}
    try{
        if($key.GetSubKeyNames().Count){throw 'Unexpected nested installation registration'}
        return @{path=$relative;values=@(foreach($name in $key.GetValueNames()){
            @{name=$name;kind=$key.GetValueKind($name).ToString();
              value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}
        })}
    }finally{$key.Dispose()}
}
function RestoreRegistry($row){
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($row.path,$true)
    if(!$key){throw 'Installer unexpectedly removed existing key'}
    try{
        foreach($name in $key.GetValueNames()){
            if($name -notin @($row.values|ForEach-Object {$_.name})){$key.DeleteValue($name)}
        }
        foreach($v in $row.values){
            $kind=[Microsoft.Win32.RegistryValueKind]::$($v.kind)
            $key.SetValue([string]$v.name,$v.value,$kind)
        }
    }finally{$key.Dispose()}
    $after=RegistrySnapshot $row.path
    if(($after|ConvertTo-Json -Depth 10 -Compress) -cne ($row|ConvertTo-Json -Depth 10 -Compress)){
        # Registry enumeration order is not a semantic difference.
        foreach($v in $row.values){
            $actual=@($after.values|Where-Object name -CEQ $v.name)
            if($actual.Count -ne 1 -or $actual[0].kind -cne $v.kind -or
               ($actual[0].value|ConvertTo-Json -Compress) -cne ($v.value|ConvertTo-Json -Compress)){
                throw "Registry restoration mismatch: $($row.path)/$($v.name)"
            }
        }
        if($after.values.Count -ne $row.values.Count){throw 'Extra registry values after restoration'}
    }
}
function FileId($directory){
    $text=(& fsutil.exe file queryfileid $directory|Out-String)
    if($LASTEXITCODE -ne 0 -or $text -notmatch '0x[0-9a-fA-F]+'){throw 'Cannot verify directory identity'}
    $Matches[0].ToLowerInvariant()
}
if($Action -eq 'SelfTest'){
    $cases=@(@($install,$qa,$true),@('D:\AgentVN',$qa,$false),
        @('C:\Users\1\AppData\Local\com.agentvn.editor','C:\Users\1\AppData\Local',$true),
        @('C:\Users\1\AppData\Local\..\Roaming','C:\Users\1\AppData\Local',$false))
    foreach($case in $cases){
        $valid=$true;try{ExactChild $case[0] $case[1]}catch{$valid=$false}
        if($valid -ne $case[2]){throw 'Path boundary selftest failed'}
    }
    Write-Output 'PASS: 4 exact-boundary cases, no mutation';exit
}
Idle
if($Action -eq 'Install'){
    if(Test-Path -LiteralPath $qa){throw 'Fresh installation evidence directory required'}
    $null=New-Item -ItemType Directory -Path $qa
    ExactChild $install $qa
    $package='D:\AgentVN\releases\editor\AgentVN_Editor_v1.9.13_20261021_011451.exe'
    if((Sha $package) -cne '22e833e5ef5634f1bd8e10ed26a899592d5dab05acfc67f12668a5d62f2fe19f'){throw 'Candidate identity changed'}
    $state=[ordered]@{status='RUNNING';startedAt=(Get-Date).ToUniversalTime().ToString('o');
        package=@{path=$package;sha256=(Sha $package)};installRoot=$install;
        arguments=@('/S',('/D='+$install));scope='HOST_ACTUAL_NSIS_CUSTOM_DIRECTORY_NOT_CLEAN_INSTALL_OR_UPGRADE';
        registry=@();shortcuts=@();frozen=@();cleanupError=$null;normalUiInstall=$false;silentInstall=$true}
    $file=Join-Path $qa 'installation.json'
    foreach($key in @('Software\agentvn\AgentVN Editor','Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor')){
        $state.registry+=RegistrySnapshot $key
    }
    $baselineDb='C:\Users\1\AppData\Roaming\com.agentvn.editor\backend\vn_engine.db'
    $state.originalDatabase=@{path=$baselineDb;sha256=(Sha $baselineDb)}
    foreach($name in @('agentvn-editor.exe','agentvn-player.exe','creator-backend.exe','build-versions.json','uninstall.exe')){
        $old='F:\AgentVN\QA\AgentVN-QA-HostUpgrade-20261018-02\installed-editor\'+$name
        $state.frozen+=@{path=$old;sha256=(Sha $old)}
    }
    $shell=New-Object -ComObject WScript.Shell
    $paths=@('C:\Users\1\Desktop\AgentVN Editor.lnk',
        'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\AgentVN Editor.lnk',
        'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\AgentVN Editor\AgentVN Editor.lnk')
    foreach($shortcut in $paths){
        $row=@{path=$shortcut;existed=(Test-Path -LiteralPath $shortcut)}
        if($row.existed){
            $row.backup=Join-Path $qa ('original-shortcut-'+$state.shortcuts.Count+'.lnk')
            Copy-Item -LiteralPath $shortcut -Destination $row.backup
            $row.sha256=Sha $shortcut
            if((Sha $row.backup) -cne $row.sha256){throw 'Shortcut backup mismatch'}
        }
        $state.shortcuts+=$row
    }
    Save $file $state
    try{
        Idle
        $process=Start-Process -FilePath $package -ArgumentList $state.arguments -WindowStyle Hidden -PassThru
        $state.installerPid=$process.Id;Save $file $state
        if(!$process.WaitForExit(180000)){throw 'Installer still live after observation deadline; do not restart'}
        $state.exitCode=$process.ExitCode
        if($process.ExitCode -ne 0){throw "Installer exit $($process.ExitCode)"}
        $exe=Join-Path $install 'agentvn-editor.exe'
        $state.executable=@{path=$exe;sha256=(Sha $exe);version=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion}
        $payload=Get-Content -LiteralPath 'F:\AgentVN\QA\Release-Candidate-20261021-01\payload-01\deployments\installer-resource-report.json' -Raw -Encoding UTF8|ConvertFrom-Json
        $expected=@($payload.deployments|Where-Object kind -CEQ 'NSIS actual payload')
        if($expected.Count -ne 1 -or $state.executable.sha256 -cne $expected[0].executable.sha256 -or $state.executable.version -cne '1.9.13'){
            throw 'Actual installed executable does not match sealed payload'
        }
        foreach($name in @('agentvn-player.exe','creator-backend.exe','build-versions.json')){
            if((Sha (Join-Path $install $name)) -cne (Sha (Join-Path $expected[0].installedRoot $name))){throw "Installed resource mismatch: $name"}
        }
        $state.actualRegistration=RegistrySnapshot 'Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor'
        $state.generatedShortcuts=@()
        foreach($row in $state.shortcuts){
            if(Test-Path -LiteralPath $row.path){
                $link=$shell.CreateShortcut($row.path)
                if($link.TargetPath -ceq $exe){
                    $copy=Join-Path $qa ('generated-shortcut-'+$state.generatedShortcuts.Count+'.lnk')
                    Copy-Item -LiteralPath $row.path -Destination $copy
                    $state.generatedShortcuts+=@{path=$row.path;copy=$copy;target=$link.TargetPath;sha256=(Sha $copy)}
                }
            }
        }
        if($state.generatedShortcuts.Count -lt 2){throw 'Installer did not generate expected desktop/start-menu shortcuts'}
        foreach($old in $state.frozen){if((Sha $old.path) -cne $old.sha256){throw 'Frozen installation changed'}}
        if((Sha $baselineDb) -cne $state.originalDatabase.sha256){throw 'Installer changed default database'}
        $state.status='PASS'
    }catch{$state.status='FAILED';$state.error=$_.Exception.Message;throw}
    finally{
        try{
            if($process -and !$process.HasExited){throw 'Installer remains live; defer metadata restoration until its real termination'}
            foreach($row in $state.registry){RestoreRegistry $row}
            foreach($row in $state.shortcuts){
                if($row.existed){
                    Copy-Item -LiteralPath $row.backup -Destination $row.path -Force
                    if((Sha $row.path) -cne $row.sha256){throw 'Original shortcut not restored'}
                }elseif(Test-Path -LiteralPath $row.path){
                    if($shell.CreateShortcut($row.path).TargetPath -cne (Join-Path $install 'agentvn-editor.exe')){throw 'Unknown shortcut replacement'}
                    Remove-Item -LiteralPath $row.path -Force
                }
            }
            $state.metadataRestoration='PASS'
        }catch{$state.cleanupError=$_.Exception.Message;$state.status='FAILED'}
        $state.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save $file $state
    }
    if($state.status -ne 'PASS'){throw $state.cleanupError}
    Write-Output 'PASS: actual NSIS install; sealed bytes, generated shortcuts, original registration/shortcuts/database/frozen installation preserved'
    exit
}
$protection=Join-Path $qa 'profile-protection.json'
if($Action -eq 'ProtectProfiles'){
    if(Test-Path -LiteralPath $protection){throw 'Fresh profile protection required'}
    $installation=Get-Content -LiteralPath (Join-Path $qa 'installation.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($installation.status -ne 'PASS'){throw 'Installation must be verified before profile protection'}
    $state=[ordered]@{status='RUNNING';profiles=@();startedAt=(Get-Date).ToUniversalTime().ToString('o')}
    foreach($kind in @('Roaming','Local')){
        $parent='C:\Users\1\AppData\'+$kind
        $original=Join-Path $parent 'com.agentvn.editor'
        $held=$original+'.qa-hold-installed-20261021-01'
        $retained=$original+'.qa-tested-installed-20261021-01'
        foreach($target in @($original,$held,$retained)){ExactChild $target $parent}
        if(!(Test-Path -LiteralPath $original) -or (Test-Path -LiteralPath $held) -or
           (Test-Path -LiteralPath $retained)){throw 'Original missing or profile destination collision'}
        if((Get-Item -LiteralPath $original).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Original profile must be physical'}
        $row=@{kind=$kind;original=$original;held=$held;retained=$retained;fileId=(FileId $original);moved=$false;files=@()}
        $patterns=if($kind -eq 'Roaming'){@('backend\vn_engine.db','backend\vn_engine.db-wal','backend\vn_engine.db-shm','backend\database-migration-record.json')}
          else{@('EBWebView\Local State','EBWebView\Default\Preferences','EBWebView\Default\Secure Preferences')}
        foreach($relative in $patterns){
            $p=Join-Path $original $relative
            if(Test-Path -LiteralPath $p -PathType Leaf){$row.files+=@{relative=$relative;sha256=(Sha $p)}}
        }
        $state.profiles+=$row;Save $protection $state
    }
    try{
        foreach($row in $state.profiles){
            Idle
            [IO.Directory]::Move($row.original,$row.held)
            $row.moved=$true;Save $protection $state
        }
        $state.status='PASS';Save $protection $state
    }catch{
        $state.status='FAILED';$state.error=$_.Exception.Message
        foreach($row in $state.profiles){
            if($row.moved -and !(Test-Path -LiteralPath $row.original)){[IO.Directory]::Move($row.held,$row.original);$row.moved=$false}
        }
        Save $protection $state;throw
    }
    Write-Output 'PASS: physical original default profiles held intact, no environment override or junction';exit
}
$restoration=Join-Path $qa 'profile-restoration.json'
if(Test-Path -LiteralPath $restoration){throw 'Do not overwrite restoration evidence'}
$state=Get-Content -LiteralPath $protection -Raw -Encoding UTF8|ConvertFrom-Json
$result=[ordered]@{status='RUNNING';deletedUserFiles=0;restored=@();error=$null}
try{
    foreach($row in $state.profiles){
        $parent='C:\Users\1\AppData\'+$row.kind
        foreach($target in @($row.original,$row.held,$row.retained)){ExactChild $target $parent}
        if(!(Test-Path -LiteralPath $row.held) -or (Test-Path -LiteralPath $row.retained)){throw 'Restoration source/destination invalid'}
        if((FileId $row.held) -cne $row.fileId){throw 'Original directory identity changed'}
        foreach($file in $row.files){if((Sha (Join-Path $row.held $file.relative)) -cne $file.sha256){throw 'Original persistent bytes changed'}}
    }
    foreach($row in $state.profiles){
        Idle
        if(Test-Path -LiteralPath $row.original){
            if((Get-Item -LiteralPath $row.original).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Unexpected linked test profile'}
            [IO.Directory]::Move($row.original,$row.retained)
        }
        [IO.Directory]::Move($row.held,$row.original)
        if((FileId $row.original) -cne $row.fileId){throw 'Restored directory identity mismatch'}
        foreach($file in $row.files){if((Sha (Join-Path $row.original $file.relative)) -cne $file.sha256){throw 'Restored persistent bytes mismatch'}}
        $result.restored+=@{original=$row.original;fileId=$row.fileId;persistentFiles=$row.files.Count;retainedTestProfile=$row.retained}
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{Save $restoration $result}
Write-Output 'PASS: original physical profiles and persistent bytes restored; no user file deleted'
