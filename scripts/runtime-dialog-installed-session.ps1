param(
    [ValidateSet('SelfTest','Install')][string]$Action='SelfTest',
    [string]$QaRoot='F:\AgentVN\QA\Runtime-Dialog-Release-20261021-01',
    [ValidateSet('1.9.13','1.9.14','1.9.15','1.9.16','1.9.17','1.9.19','1.9.23')][string]$ExpectedVersion='1.9.14'
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -Force
$qa=[IO.Path]::GetFullPath($QaRoot)
$allowedRoots=@{
    'F:\AgentVN\QA\Runtime-Dialog-Release-20261021-01'='1.9.14'
    'F:\AgentVN\QA\Component-Preview-Release-20261021-01'='1.9.15'
    'F:\AgentVN\QA\Component-Preview-Release-20261021-02'='1.9.16'
    'F:\AgentVN\QA\Home-Resume-Release-20261021-01'='1.9.17'
    'F:\AgentVN\QA\Android-RunId-Release-20261021-01'='1.9.19'
    'F:\AgentVN\QA\Editor-1.9.13-20261021-01'='1.9.13'
    'F:\AgentVN\QA\Editor-Repair-Release-20261024-01'='1.9.23'
}
if(!$allowedRoots.ContainsKey($qa) -or $allowedRoots[$qa] -cne $ExpectedVersion){
    throw 'Exact candidate root and version pair required'
}
$install=Join-Path $qa 'installed-editor'
function Save($file,$value){[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))}
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function ExactChild($target,$parent){
    if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($target)) -cne [IO.Path]::GetFullPath($parent)){
        throw 'Exact named child required'
    }
}
function Idle {
    if(@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\.exe$'
    }).Count){throw 'Do not install while another Editor, Player or backend is active'}
}
function RegistrySnapshot($relative){
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($relative)
    if(!$key){throw "Missing original registration: $relative"}
    try{
        if($key.GetSubKeyNames().Count){throw 'Unexpected nested registration'}
        @{path=$relative;values=@(foreach($name in $key.GetValueNames()){
            @{name=$name;kind=$key.GetValueKind($name).ToString();
              value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}
        })}
    }finally{$key.Dispose()}
}
function RestoreRegistry($row){
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($row.path,$true)
    if(!$key){throw 'Installer unexpectedly removed original key'}
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
    if($after.values.Count -ne $row.values.Count){throw 'Registration value count mismatch'}
    foreach($v in $row.values){
        $actual=@($after.values|Where-Object name -CEQ $v.name)
        if($actual.Count -ne 1 -or $actual[0].kind -cne $v.kind -or
            ($actual[0].value|ConvertTo-Json -Compress) -cne ($v.value|ConvertTo-Json -Compress)){
            throw 'Original registration restoration mismatch'
        }
    }
}
if($Action -eq 'SelfTest'){
    $tests=@(@($install,$qa,$true),@($qa,$qa,$false),@('D:\AgentVN',$qa,$false),
        @(($install+'\nested'),$qa,$false),@(($qa+'\..\outside'),$qa,$false))
    foreach($case in $tests){
        $actual=$true;try{ExactChild $case[0] $case[1]}catch{$actual=$false}
        if($actual -ne $case[2]){throw 'Installation path selftest failed'}
    }
    'PASS: five install path boundaries, read-only';exit
}
Idle
ExactChild $install $qa
$receipt=Join-Path $qa 'installation.json'
if((Test-Path -LiteralPath $receipt) -or (Test-Path -LiteralPath $install)){throw 'Fresh installation and journal required'}
$payload=Get-Content -LiteralPath (Join-Path $qa 'payload-01\report.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($payload.status -cne 'PASS'){throw 'Sealed passing candidate payload required'}
if($payload.installerFormat -ceq 'nsis'){
    if($payload.archived.Count -ne 1 -or $payload.deployments.Count -ne 1){
        throw 'Exactly one sealed NSIS candidate and payload required'
    }
}elseif($payload.archived.Count -ne 3){throw 'Legacy candidate requires all three sealed packages'}
$exePackages=@($payload.archived|Where-Object {[IO.Path]::GetExtension($_.path) -ieq '.exe'})
if($exePackages.Count -ne 1){throw 'Exactly one EXE installer required; MSI cannot substitute it'}
$package=$exePackages[0]
if((Sha $package.path) -cne $package.sha256){throw 'Candidate installer changed'}
$expected=@($payload.deployments|Where-Object kind -CEQ 'NSIS actual payload')
if($expected.Count -ne 1){throw 'Exact NSIS payload required'}
$state=[ordered]@{status='RUNNING';startedAt=(Get-Date).ToUniversalTime().ToString('o');
    package=$package;installRoot=$install;arguments=@('/S',('/D='+$install));registry=@();shortcuts=@();
    cleanupError=$null;scope='ACTUAL_NSIS_NEW_DIRECTORY_NOT_UPGRADE_OR_CLEAN_MACHINE';
    silentInstall=$true;normalUiInstall=$false}
$baseline=Get-Content -LiteralPath (Join-Path $qa 'checkpoint-01\report.json') -Raw -Encoding UTF8|ConvertFrom-Json
$state.protectedFiles=if($ExpectedVersion -ceq '1.9.23'){@($baseline.frozenProducts)}else{@($baseline.frozen)+@($baseline.history)}
if($ExpectedVersion -ceq '1.9.23'){
    foreach($directory in (@($env:APPDATA,([Environment]::GetFolderPath('ApplicationData')))|Select-Object -Unique)){
        foreach($relative in @('com.agentvn.editor\backend\vn_engine.db','com.agentvn.editor\backend\vn_engine.db-wal','com.agentvn.editor\backend\vn_engine.db-shm')){
            $file=Join-Path $directory $relative
            if(Test-Path -LiteralPath $file -PathType Leaf){$state.protectedFiles+=@{path=$file;sha256=(Sha $file)}}
        }
    }
}
foreach($f in $state.protectedFiles){if((Sha $f.path) -cne $f.sha256){throw 'Protected file changed before install'}}
foreach($key in @('Software\agentvn\AgentVN Editor','Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor')){
    $state.registry+=RegistrySnapshot $key
}
$shell=New-Object -ComObject WScript.Shell
$links=@('C:\Users\1\Desktop\AgentVN Editor.lnk',
    'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\AgentVN Editor.lnk',
    'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\AgentVN Editor\AgentVN Editor.lnk')
foreach($file in $links){
    $row=@{path=$file;existed=(Test-Path -LiteralPath $file)}
    if($row.existed){
        $row.backup=Join-Path $qa ('pre-install-shortcut-'+$state.shortcuts.Count+'.lnk')
        $row.sha256=Sha $file
        Copy-Item -LiteralPath $file -Destination $row.backup
        if((Sha $row.backup) -cne $row.sha256){throw 'Shortcut backup mismatch'}
    }
    $state.shortcuts+=$row
}
Save $receipt $state
try{
    Idle
    $process=Start-Process -FilePath $package.path -ArgumentList $state.arguments -WindowStyle Hidden -PassThru
    $state.installerPid=$process.Id;Save $receipt $state
    if(!$process.WaitForExit(180000)){throw 'Installer still running; preserve journal and do not restart'}
    $state.exitCode=$process.ExitCode
    if($state.exitCode -ne 0){throw "Installer exit $($state.exitCode)"}
    $exe=Join-Path $install 'agentvn-editor.exe'
    $state.executable=@{path=$exe;sha256=(Sha $exe);version=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion}
    if($state.executable.sha256 -cne $expected[0].executable.sha256 -or $state.executable.version -cne $ExpectedVersion){
        throw 'Actual installed Editor differs from sealed payload'
    }
    $state.resources=@()
    foreach($name in @('agentvn-player.exe','creator-backend.exe','build-versions.json','GameCli_framework\src\styles\player.css')){
        $file=Join-Path $install $name
        if((Sha $file) -cne (Sha (Join-Path $expected[0].installedRoot $name))){throw "Installed resource mismatch: $name"}
        $state.resources+=@{path=$file;sha256=(Sha $file)}
    }
    $state.generatedShortcuts=@()
    foreach($row in $state.shortcuts){
        if((Test-Path -LiteralPath $row.path) -and $shell.CreateShortcut($row.path).TargetPath -ceq $exe){
            $copy=Join-Path $qa ('installed-shortcut-'+$state.generatedShortcuts.Count+'.lnk')
            Copy-Item -LiteralPath $row.path -Destination $copy
            $state.generatedShortcuts+=@{path=$row.path;copy=$copy;sha256=(Sha $copy);target=$exe}
        }
    }
    if($state.generatedShortcuts.Count -lt 2){throw 'Missing generated desktop/start-menu shortcuts'}
    $state.actualRegistration=RegistrySnapshot 'Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor'
    foreach($f in $state.protectedFiles){if((Sha $f.path) -cne $f.sha256){throw 'Protected file changed during install'}}
    $state.status='PASS'
}catch{$state.status='FAILED';$state.error=$_.Exception.Message;throw}
finally{
    try{
        if($process -and !$process.HasExited){throw 'Installer remains live: metadata restoration cannot race it'}
        foreach($row in $state.registry){RestoreRegistry $row}
        foreach($row in $state.shortcuts){
            if($row.existed){
                Copy-Item -LiteralPath $row.backup -Destination $row.path -Force
                if((Sha $row.path) -cne $row.sha256){throw 'Original shortcut not restored'}
            }elseif(Test-Path -LiteralPath $row.path){
                if($shell.CreateShortcut($row.path).TargetPath -cne (Join-Path $install 'agentvn-editor.exe')){throw 'Unknown shortcut'}
                Remove-Item -LiteralPath $row.path -Force
            }
        }
        $state.metadataRestoration='PASS'
    }catch{$state.status='FAILED';$state.cleanupError=$_.Exception.Message}
    $state.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save $receipt $state
}
if($state.status -cne 'PASS'){throw $state.cleanupError}
'PASS: actual isolated-directory NSIS install, sealed bytes and restored original metadata'
