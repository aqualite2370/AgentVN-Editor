param(
    [ValidateSet('SelfTest','Checkpoint','Install','Repair','Uninstall','Elevated')][string]$Action='SelfTest',
    [ValidateSet('Install','Repair','Uninstall')][string]$Operation='Install',
    [ValidateSet('en-US','zh-CN')][string]$Language='en-US',
    [ValidateRange(1,3)][int]$Attempt=1
)
# Actual /i, /famus and /x, not administrative extraction. Explicit, fresh F paths;
# old NSIS discovery stays present. Never delete install registrations to pass.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -Force
$qa='F:\AgentVN\QA\MSI-Location-Repair-20261021-01'
$backup='F:\AgentVN\Checkpoints\MSI-Location-Repair-20261021-01\installation'
$keys=@('Software\agentvn\AgentVN Editor','Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor')
$unicode=[string][char]0x4e2d+[char]0x6587+' '+[char]0x5b89+[char]0x88c5
$attemptSuffix=if($Attempt -eq 1){''}else{'-'+$Attempt.ToString('00')}
$installSuffix=if($Attempt -eq 1){''}else{' '+$Attempt.ToString('00')}
$install=Join-Path $qa ($(if($Language -ceq 'en-US'){'installed en US'}else{$unicode})+$installSuffix)
$run=Join-Path $qa ('msi-'+$Language+$attemptSuffix)
function Read($file){Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json}
function Save($file,$value){[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 22),[Text.UTF8Encoding]::new($false))}
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Describe($file){@{path=$file;sha256=(Sha $file);bytes=(Get-Item -LiteralPath $file).Length}}
function Boundary($path){
    $full=[IO.Path]::GetFullPath($path)
    if($full -cnotin @((Join-Path $qa 'installed en US'),(Join-Path $qa $unicode),
        (Join-Path $qa 'installed en US 02'),(Join-Path $qa ($unicode+' 02')),
        (Join-Path $qa 'installed en US 03'),(Join-Path $qa ($unicode+' 03')))){
        throw 'Only six exact new installation paths accepted'
    }
}
function RegisteredDirectory($registration,$requested){
    $actual=[string]$registration.InstallLocation
    if(!$actual -or $actual.TrimEnd('\') -cne $requested.TrimEnd('\')){
        throw 'Actual Windows Installer uninstall-registration directory differs'
    }
    $actual
}
function Idle {
    if(@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\.exe$'
    }).Count){throw 'Another Editor, backend or Player is active'}
}
function Registrations {
    @(Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|
        Where-Object {$_.DisplayName -match 'AgentVN' -and $_.WindowsInstaller -eq 1}|
        Select-Object DisplayName,DisplayVersion,InstallLocation,PSChildName)
}
function Registry {
    @(foreach($relative in $keys){
        $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($relative)
        if(!$key){throw 'Original NSIS registration must remain present'}
        try{
            if($key.GetSubKeyNames().Count){throw 'Unexpected nested registration'}
            [pscustomobject][ordered]@{path=$relative;values=@(foreach($name in $key.GetValueNames()|Sort-Object){
                [pscustomobject][ordered]@{name=$name;kind=$key.GetValueKind($name).ToString()
                    value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}
            })}
        }finally{$key.Dispose()}
    })
}
function Links {
    $shell=New-Object -ComObject WScript.Shell
    @(foreach($folder in @('C:\Users\1\Desktop','C:\Users\Public\Desktop',
        'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs',
        'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\AgentVN Editor',
        'C:\ProgramData\Microsoft\Windows\Start Menu\Programs',
        'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\AgentVN Editor')){
        foreach($file in Get-ChildItem -LiteralPath $folder -Filter '*AgentVN*.lnk' -File -ErrorAction SilentlyContinue){
            $link=$shell.CreateShortcut($file.FullName)
            [pscustomobject]@{path=$file.FullName;sha256=(Sha $file.FullName);target=$link.TargetPath;arguments=$link.Arguments}
        }
    })|Sort-Object path
}
function VerifyInventory($directory,$expected){
    $files=@(Get-ChildItem -LiteralPath $directory -Recurse -Force -File)
    if($files.Count -ne @($expected).Count){throw 'Original installation file count changed'}
    foreach($f in $expected){
        $file=Join-Path $directory $f.relative
        if(!(Test-Path -LiteralPath $file) -or (Sha $file) -cne $f.sha256 -or
            (Get-Item -LiteralPath $file).Length -ne $f.bytes){throw 'Original installation bytes differ'}
    }
}
function VerifyProtected($state){
    foreach($f in $state.protectedFiles){if((Sha $f.path) -cne $f.sha256){throw 'Protected user/source/artifact changed'}}
}
Boundary $install
if($Action -ceq 'SelfTest'){
    $cases=@(@((Join-Path $qa 'installed en US'),$true),@((Join-Path $qa $unicode),$true),
        @((Join-Path $qa 'installed en US 02'),$true),@((Join-Path $qa ($unicode+' 02')),$true),
        @((Join-Path $qa 'installed en US 03'),$true),@((Join-Path $qa ($unicode+' 03')),$true),
        @('D:\AgentVN',$false),@($qa,$false),@('F:\AgentVN',$false),
        @(($install+'\nested'),$false),@(($install+'\..'),$false),@(($install+' other'),$false))
    foreach($case in $cases){
        $valid=$true;try{Boundary $case[0]}catch{$valid=$false}
        if($valid -ne $case[1]){throw 'Exact installation boundary regression'}
    }
    $null=RegisteredDirectory @{InstallLocation=($install+'\')} $install
    foreach($wrong in @($null,'D:\AgentVN',($install+' other'))){
        $valid=$true;try{$null=RegisteredDirectory @{InstallLocation=$wrong} $install}catch{$valid=$false}
        if($valid){throw 'Invalid/missing real uninstall-registration directory accepted'}
    }
    'PASS: twelve path boundaries and four actual-registration directory cases; no mutation';exit
}
Idle
if($Action -ceq 'Checkpoint'){
    if((Test-Path -LiteralPath $backup) -or @(Registrations).Count){throw 'Fresh checkpoint, no registered MSI required'}
    foreach($target in @((Join-Path $qa 'installed en US'),(Join-Path $qa $unicode))){
        if(Test-Path -LiteralPath $target){throw 'New installation directories must not exist'}
    }
    $payload=Read (Join-Path $qa 'payload-01\report.json')
    if($payload.status -cne 'PASS' -or $payload.archived.Count -ne 3){throw 'Three sealed candidate packages required'}
    $old=Read 'F:\AgentVN\Checkpoints\Current-MSI-Upgrade-20261021-01\checkpoint-verified-02.json'
    if($old.status -cne 'PASS' -or $old.fileCount -ne 12848){throw 'Existing full original-installation backup required'}
    VerifyInventory $old.source $old.files
    VerifyInventory 'F:\AgentVN\Checkpoints\Current-MSI-Upgrade-20261021-01\installation' $old.files
    $null=New-Item -ItemType Directory -Path $backup
    $result=[ordered]@{status='RUNNING';at=[DateTime]::UtcNow.ToString('o');registry=@(Registry);shortcuts=@()
        oldInstallation=@{receipt='F:\AgentVN\Checkpoints\Current-MSI-Upgrade-20261021-01\checkpoint-verified-02.json'
            sha256=(Sha 'F:\AgentVN\Checkpoints\Current-MSI-Upgrade-20261021-01\checkpoint-verified-02.json');source=$old.source
            fileCount=$old.fileCount};protectedFiles=@();userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value}
    foreach($link in @(Links)){
        $copy=Join-Path $backup ($result.shortcuts.Count.ToString()+'.lnk')
        Copy-Item -LiteralPath $link.path -Destination $copy
        if((Sha $copy) -cne $link.sha256){throw 'Shortcut backup mismatch'}
        $link|Add-Member -NotePropertyName backup -NotePropertyValue $copy
        $result.shortcuts+=$link
    }
    foreach($file in @('D:\AgentVN\.git\index','D:\AgentVN\AgentVN Dev.exe',
        'D:\AgentVN\backend\data\editor_state.json',
        'C:\Users\1\AppData\Roaming\com.agentvn.editor\backend\vn_engine.db')){
        $result.protectedFiles+=Describe $file
    }
    foreach($f in $payload.archived){if((Sha $f.path) -cne $f.sha256){throw 'Archived installer changed'}}
    Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $backup 'executed-session.ps1')
    $result.status='PASS';Save (Join-Path $backup 'checkpoint.json') $result
    [pscustomobject]$result|Select-Object status,oldInstallation,@{n='shortcuts';e={$_.shortcuts.Count}}|ConvertTo-Json
    exit
}
$checkpoint=Read (Join-Path $backup 'checkpoint.json')
if($checkpoint.status -cne 'PASS' -or
    $checkpoint.userSid -cne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value){throw 'Same user and complete checkpoint required'}
VerifyProtected $checkpoint
$phase=if($Action -ceq 'Elevated'){$Operation}else{$Action}
$destination=Join-Path $run ($phase+'.json')
if(Test-Path -LiteralPath $destination){throw 'Inspect existing operation; never rerun or overwrite it'}
$null=New-Item -ItemType Directory -Path $run -Force
$elevated=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($Action -cne 'Elevated'){
    if($elevated){throw 'Genuine non-admin parent required'}
    $wrapper=Join-Path $run ($phase+'-elevation.json')
    if(Test-Path -LiteralPath $wrapper){throw 'Elevation already requested'}
    $request=[ordered]@{status='RUNNING';parentElevated=$false;at=[DateTime]::UtcNow.ToString('o')}
    Save $wrapper $request
    try{
        $helper=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
            '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),
            '-Action','Elevated','-Operation',$phase,'-Language',$Language,'-Attempt',$Attempt)
        $request.helperPid=$helper.Id;$request.created=$helper.StartTime.ToUniversalTime().ToString('o');Save $wrapper $request
        $helper.WaitForExit()
        $request.exitCode=$helper.ExitCode
        $child=Read $destination
        if($child.status -cne 'PASS'){throw 'Actual operation failed; original receipt retained'}
        $request.status='PASS'
    }catch{$request.status='BLOCKED';$request.error=$_.Exception.Message;throw}
    finally{$request.finishedAt=[DateTime]::UtcNow.ToString('o');Save $wrapper $request}
    [pscustomobject]$child|Select-Object status,phase,isElevated,exitCode,installRoot,metadataRestoration|ConvertTo-Json
    exit
}
if(!$elevated){throw 'Administrator token missing'}
$payload=Read (Join-Path $qa 'payload-01\report.json')
$package=@($payload.archived|Where-Object {$_.path.EndsWith('_'+$Language+'.msi')})
if($package.Count -ne 1 -or (Sha $package[0].path) -cne $package[0].sha256){throw 'Exact sealed MSI required'}
$package=$package[0]
$expected=@($payload.deployments|Where-Object {$_.kind -ceq ('MSI '+$Language+' administrative deployment')})
if($expected.Count -ne 1){throw 'Exact verified payload required'}
$expected=$expected[0]
$installer=New-Object -ComObject WindowsInstaller.Installer
$db=$installer.OpenDatabase($package.path,0)
$view=$db.OpenView('SELECT `Value` FROM `Property` WHERE `Property` = ''ProductCode''')
$null=$view.Execute();$code=$view.Fetch().StringData(1);$null=$view.Close()
$null=[Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
$null=[Runtime.InteropServices.Marshal]::FinalReleaseComObject($db)
$null=[Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer)
if($code -cnotmatch '^\{[A-F0-9-]{36}\}$'){throw 'Invalid actual ProductCode'}
$result=[ordered]@{status='RUNNING';phase=$phase;language=$Language;at=[DateTime]::UtcNow.ToString('o')
    scope='ACTUAL_QUIET_MSI_DIRECTORY_REPAIR_NOT_WIZARD_DEFAULT_PROFILE_OR_CLEAN_MACHINE'
    isElevated=$true;helperPid=$PID;installRoot=$install;package=$package;productCode=$code
    metadataRestoration='NOT_RUN';error=$null;cleanupError=$null}
function RestoreMetadata {
    # Only repair the exact shared metadata touched by this MSI; never its
    # Windows Installer product registration or any unrelated shortcut.
    foreach($row in $checkpoint.registry){
        if($row.path -cnotin $keys){throw 'Registry checkpoint boundary'}
        $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($row.path,$true)
        if(!$key){throw 'Original registration key unexpectedly removed'}
        try{
            if($key.GetSubKeyNames().Count){throw 'Unexpected nested registration'}
            foreach($name in $key.GetValueNames()){
                if($name -cnotin @($row.values.name)){$key.DeleteValue($name)}
            }
            foreach($v in $row.values){$key.SetValue([string]$v.name,$v.value,[Microsoft.Win32.RegistryValueKind]$v.kind)}
        }finally{$key.Dispose()}
    }
    $result.retainedShortcuts=@()
    foreach($link in @(Links)){
        $original=@($checkpoint.shortcuts|Where-Object path -CEQ $link.path)
        if($original.Count -and $original[0].sha256 -ceq $link.sha256){continue}
        if($link.target -cne (Join-Path $install 'agentvn-editor.exe') -and
            !($link.target.EndsWith('\msiexec.exe',[StringComparison]::OrdinalIgnoreCase) -and $link.arguments.Contains($code))){
            throw 'Unknown shortcut change: preserve it for inspection'
        }
        $copy=Join-Path $run ($phase+'-shortcut-'+$result.retainedShortcuts.Count+'.lnk')
        Copy-Item -LiteralPath $link.path -Destination $copy
        if((Sha $copy) -cne $link.sha256){throw 'Changed shortcut preservation failed'}
        $result.retainedShortcuts+=Describe $copy
        if(!$original.Count){Remove-Item -LiteralPath $link.path}
    }
    foreach($link in $checkpoint.shortcuts){
        if((Sha $link.backup) -cne $link.sha256){throw 'Original shortcut backup changed'}
        $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($link.path)) -Force
        Copy-Item -LiteralPath $link.backup -Destination $link.path -Force
        if((Sha $link.path) -cne $link.sha256){throw 'Original shortcut restoration failed'}
    }
    if((@(Registry)|ConvertTo-Json -Depth 8 -Compress) -cne ($checkpoint.registry|ConvertTo-Json -Depth 8 -Compress)){
        throw 'Original registry restoration differs'
    }
    $after=@(Links)
    if($after.Count -ne $checkpoint.shortcuts.Count){throw 'Shortcut count differs'}
    foreach($link in $checkpoint.shortcuts){
        if(@($after|Where-Object {$_.path -ceq $link.path -and $_.sha256 -ceq $link.sha256}).Count -ne 1){
            throw 'Restored shortcut inventory differs'
        }
    }
    $result.metadataRestoration='PASS'
}
Save $destination $result
try{
    $before=@(Registrations);$result.registrationsBefore=$before
    if($phase -ceq 'Install'){
        if($before.Count -or (Test-Path -LiteralPath $install)){throw 'Fresh actual installation required'}
    }elseif($before.Count -ne 1 -or $before[0].PSChildName -cne $code -or $before[0].DisplayVersion -cne '1.9.18'){
        throw 'Only the owned actual candidate may be repaired/uninstalled'
    }
    if((@(Registry)|ConvertTo-Json -Depth 8 -Compress) -cne ($checkpoint.registry|ConvertTo-Json -Depth 8 -Compress)){
        throw 'Old NSIS directory discovery must be preserved before each operation'
    }
    $verb=switch($phase){'Repair'{'/famus'} 'Uninstall'{'/x'} default{'/i'}}
    $log=Join-Path $run ($phase+'.log')
    $result.arguments=@($verb,('"'+$package.path+'"'),'/qn','/norestart',
        ('INSTALLDIR="'+$install+'"'),'/L*V',('"'+$log+'"'))
    $process=Start-Process msiexec.exe -ArgumentList $result.arguments -WindowStyle Hidden -PassThru
    $result.installerPid=$process.Id;Save $destination $result
    $process.WaitForExit();$result.exitCode=$process.ExitCode
    if($result.exitCode -notin @(0,3010)){throw 'Actual MSI failed'}
    $result.log=Describe $log
    $bytes=[IO.File]::ReadAllBytes($log)
    $text=if($bytes.Length -ge 2 -and $bytes[0] -eq 255 -and $bytes[1] -eq 254){
        [Text.Encoding]::Unicode.GetString($bytes)
    }else{[Text.Encoding]::UTF8.GetString($bytes)}
    $result.registrationsAfter=@(Registrations)
    if($phase -ceq 'Uninstall'){
        if($result.registrationsAfter.Count -or (Test-Path -LiteralPath (Join-Path $install 'agentvn-editor.exe'))){
            throw 'Owned MSI registration or executable remains'
        }
    }else{
        if($result.registrationsAfter.Count -ne 1 -or $result.registrationsAfter[0].PSChildName -cne $code -or
            $result.registrationsAfter[0].DisplayVersion -cne '1.9.18'){throw 'Candidate registration mismatch'}
        $result.executable=Describe (Join-Path $install 'agentvn-editor.exe')
        if($result.executable.sha256 -cne $expected.executable.sha256 -or
            (Get-Item -LiteralPath $result.executable.path).VersionInfo.ProductVersion -cne '1.9.18'){throw 'Actual MSI executable differs'}
        $versions=Join-Path $install 'build-versions.json'
        if((Read $versions).editorVersion -cne '1.9.18' -or (Sha $versions) -cne $expected.versionResource.sha256){
            throw 'Installed build-version resource differs'
        }
        $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($keys[0])
        try{$result.observedHkcuInstallDir=$key.GetValue('InstallDir')}finally{$key.Dispose()}
        # The MSI's uninstall registration, not an assumed HKCU value, records
        # the installed product location. Keep HKCU observations diagnostic.
        $result.registeredDirectory=RegisteredDirectory $result.registrationsAfter[0] $install
        $result.finalDirectoryLogLines=@($text -split "`r?`n"|Where-Object {$_.StartsWith('Property(S): INSTALLDIR = ')})
        if($result.finalDirectoryLogLines.Count -ne 1 -or
            $result.finalDirectoryLogLines[0].Substring('Property(S): INSTALLDIR = '.Length).TrimEnd('\') -cne $install){
            throw 'Final actual MSI server INSTALLDIR differs'
        }
        if(!$text.Contains('AgentVNPreserveInstallDirectory') -or !$text.Contains('AgentVNRestoreInstallDirectory') -or
            !$text.Contains($install)){throw 'Actual installation log lacks directory policy/path'}
        if($phase -ceq 'Repair' -and !$text.Contains('REINSTALLMODE=amus')){
            throw 'Full file/registry/shortcut repair mode not observed in actual MSI log'
        }
        $result.shortcuts=@(Links|Where-Object target -CEQ (Join-Path $install 'agentvn-editor.exe'))
        if(!$result.shortcuts.Count){throw 'Installed shortcut does not target the actual new directory'}
        $result.resources=@(Describe $versions)
        foreach($f in $expected.runtimeProvenance){
            $file=Join-Path $install $f.name
            if((Sha $file) -cne $f.sha256){throw 'Installed backend/player payload differs'}
            $result.resources+=Describe $file
        }
        $result.resources+=Describe (Join-Path $install 'GameCli_framework\src\styles\player.css')
    }
    VerifyProtected $checkpoint
    $old=Read $checkpoint.oldInstallation.receipt
    VerifyInventory $old.source $old.files
    $result.originalInstallationUnchanged='PASS'
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.ToString()}
finally{
    try{RestoreMetadata}catch{
        $result.status='FAILED';$result.cleanupError=$_.Exception.ToString()
    }
    $result.finishedAt=[DateTime]::UtcNow.ToString('o');Save $destination $result
}
[pscustomobject]$result|Select-Object status,phase,isElevated,exitCode,installRoot,metadataRestoration,error,cleanupError|ConvertTo-Json
if($result.status -cne 'PASS'){exit 1}
