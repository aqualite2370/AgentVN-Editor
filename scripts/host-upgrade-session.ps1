param(
    [ValidateSet('SelfTest','Prepare','InstallOld','InstallNew')][string]$Action = 'SelfTest'
)
$ErrorActionPreference = 'Stop'
$runRoot = 'F:\AgentVN-QA-HostUpgrade-20261018-02'
$reportRoot = 'D:\AgentVN\output\host-upgrade-20261018-02'
$installRoot = Join-Path $runRoot 'installed-editor'
$oldPackage = 'D:\AgentVN\releases\editor\AgentVN_Editor_v1.9.8_20260925_101446.exe'
$newPackage = 'F:\AgentVN-QA-Preserved\cleanup-20261017-generated-01\full-regression-20261017-01\candidate-02\installers\AgentVN Editor_1.9.9_x64-setup.exe'
$utf8 = New-Object Text.UTF8Encoding($false)
function Save-Json($file, $value) {
    [IO.File]::WriteAllText($file, ($value | ConvertTo-Json -Depth 12), $utf8)
}
function Get-Sha($file) { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
function Assert-ExactChild($file, $parent) {
    $absolute = [IO.Path]::GetFullPath($file)
    if ([IO.Path]::GetDirectoryName($absolute) -ne [IO.Path]::GetFullPath($parent)) {
        throw "Not an exact child of named directory: $absolute"
    }
}
function Assert-NoAgentProcesses {
    $processes = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.editor')
    })
    if ($processes.Count) { throw 'AgentVN/editor WebView is running; refusing to change its profiles/install' }
}
function Get-Registration {
    $roots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
    @(foreach($root in $roots) {
        if(Test-Path -LiteralPath $root) {
            Get-ItemProperty -Path ($root + '\*') -ErrorAction SilentlyContinue |
                Where-Object {$_.DisplayName -match 'AgentVN'} |
                Select-Object DisplayName,DisplayVersion,InstallLocation,UninstallString,PSPath
        }
    })
}
function Copy-VerifiedTree($source, $destination) {
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($source)
    $files = @()
    while($pending.Count) {
        foreach($item in (Get-ChildItem -LiteralPath $pending.Pop() -Force)) {
            if($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked profile entry: $($item.FullName)" }
            if($item.PSIsContainer) { $pending.Push($item.FullName) }
            else {
                $relative = $item.FullName.Substring($source.Length + 1)
                $target = Join-Path $destination $relative
                $null = New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
                Copy-Item -LiteralPath $item.FullName -Destination $target
                $sha = Get-Sha $item.FullName
                if((Get-Sha $target) -ne $sha) { throw "Backup SHA mismatch: $relative" }
                $files += [ordered]@{relative=$relative; bytes=$item.Length; sha256=$sha}
            }
        }
    }
    return $files
}
if($Action -eq 'SelfTest') {
    $tests = @(
        @('C:\Users\1\AppData\Roaming\com.agentvn.editor','C:\Users\1\AppData\Roaming',$true),
        @('C:\Users\1\AppData\Local\com.agentvn.editor.qa-hold-20261018-01','C:\Users\1\AppData\Local',$true),
        @('C:\Users\1\AppData','C:\Users\1\AppData\Local',$false),
        @('C:\Users\1\AppData\Local\..\Roaming','C:\Users\1\AppData\Local',$false),
        @('F:\AgentVN-QA-HostUpgrade-20261018-01\installed-editor',$runRoot,$true),
        @('D:\AgentVN',$runRoot,$false)
    )
    foreach($test in $tests) {
        $allowed=$true
        try { Assert-ExactChild $test[0] $test[1] } catch {$allowed=$false}
        if($allowed -ne $test[2]) { throw "Boundary selftest failed: $($test[0])" }
    }
    Write-Output "PASS: $($tests.Count) path-boundary cases; no mutation"
    exit
}
$inheritedOverrideNames = @(Get-ChildItem Env: | Where-Object {
    $_.Name -match '^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$'
} | ForEach-Object {$_.Name})
# Remove overrides only in this child PowerShell, never the user's persistent environment.
foreach($overrideName in $inheritedOverrideNames) { Remove-Item -LiteralPath ('Env:\' + $overrideName) }
Assert-NoAgentProcesses
if($Action -eq 'Prepare') {
    if((Test-Path -LiteralPath $runRoot) -or (Test-Path -LiteralPath $reportRoot)) { throw 'Fresh run directories required' }
    if((Get-Sha $oldPackage) -ne 'f91118bf15d1f0f76e5628596e61bfd8d981c037d051f6cb6f59f8a5c92ccd42') {throw 'Old package changed'}
    if((Get-Sha $newPackage) -ne '14ce31f9fa026797a99c9bfea92ca3a41a449255d9a8a8946f21a8af0db2beb4') {throw 'Candidate changed'}
    $overrides = @(Get-ChildItem Env: | Where-Object {$_.Name -match '^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$'})
    if($overrides.Count) {throw 'Unexpected inherited application overrides; do not change default-path test semantics'}
    $null = New-Item -ItemType Directory -Path $runRoot,$reportRoot
    $state = [ordered]@{status='PREPARING'; startedAt=(Get-Date).ToUniversalTime().ToString('o');
        runRoot=$runRoot; reportRoot=$reportRoot; installRoot=$installRoot;
        originalRegistrations=(Get-Registration); profiles=@(); shortcuts=@(); packages=@(
            @{version='1.9.8';path=$oldPackage;sha256=(Get-Sha $oldPackage)},
            @{version='1.9.9';path=$newPackage;sha256=(Get-Sha $newPackage)}
        ); rootDevSha256=(Get-Sha 'D:\AgentVN\AgentVN Dev.exe');
        scope='HOST_NSIS_UPGRADE_NOT_CLEAN_MACHINE_OR_COMPLETE_REGRESSION';
        inheritedOverridesRemovedInChild=$inheritedOverrideNames; error=$null}
    Save-Json (Join-Path $reportRoot 'preparation.json') $state
    try {
        $regKey = 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor'
        if(Test-Path -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor') {
            & reg.exe export $regKey (Join-Path $runRoot 'original-uninstall-registration.reg') /y | Out-Null
            if($LASTEXITCODE) {throw 'Registration export failed'}
        }
        $shell = New-Object -ComObject WScript.Shell
        $shortcutPaths = @(
            'C:\Users\1\Desktop\AgentVN Editor.lnk',
            'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\AgentVN Editor.lnk',
            'C:\Users\1\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\AgentVN Editor\AgentVN Editor.lnk'
        )
        foreach($shortcut in $shortcutPaths) {
            if(Test-Path -LiteralPath $shortcut) {
                $link=$shell.CreateShortcut($shortcut)
                $target=Join-Path $runRoot ('original-shortcuts\' + $state.shortcuts.Count + '.lnk')
                $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
                Copy-Item -LiteralPath $shortcut -Destination $target
                if((Get-Sha $shortcut) -ne (Get-Sha $target)) {throw 'Shortcut backup mismatch'}
                $state.shortcuts += @{path=$shortcut;backup=$target;sha256=(Get-Sha $shortcut);target=$link.TargetPath}
            }
        }
        foreach($kind in @('Roaming','Local')) {
            $parent = 'C:\Users\1\AppData\' + $kind
            $original = Join-Path $parent 'com.agentvn.editor'
            $held = Join-Path $parent 'com.agentvn.editor.qa-hold-20261018-02'
            Assert-ExactChild $original $parent
            Assert-ExactChild $held $parent
            if(Test-Path -LiteralPath $held) {throw 'Refuse to overwrite existing held profile'}
            $row = [ordered]@{kind=$kind;original=$original;held=$held;existed=(Test-Path -LiteralPath $original);moved=$false;backupFiles=@()}
            $state.profiles += $row
            if($row.existed) {
                if((Get-Item -LiteralPath $original).Attributes -band [IO.FileAttributes]::ReparsePoint) {throw 'Linked profile root'}
                $backup=Join-Path $runRoot ('profile-backup\' + $kind)
                $row.backupRoot=$backup
                if($kind -eq 'Roaming') {
                    $row.backupFiles = @(Copy-VerifiedTree $original $backup)
                } else {
                    # Only persistent app stores/preferences need an independent byte backup.
                    # Browser-managed components/caches remain intact in the held whole profile;
                    # do not change their ACLs or traverse inaccessible browser component trees.
                    foreach($relativeStore in @('EBWebView\Default\Local Storage',
                        'EBWebView\Default\IndexedDB','EBWebView\Default\Session Storage')) {
                        $store=Join-Path $original $relativeStore
                        if(Test-Path -LiteralPath $store) {
                            $row.backupFiles += @(Copy-VerifiedTree $store (Join-Path $backup $relativeStore))
                        }
                    }
                    foreach($relativePreference in @('EBWebView\Local State',
                        'EBWebView\Default\Preferences','EBWebView\Default\Secure Preferences')) {
                        $preference=Join-Path $original $relativePreference
                        if(Test-Path -LiteralPath $preference) {
                            $copy=Join-Path $backup $relativePreference
                            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($copy)) -Force
                            Copy-Item -LiteralPath $preference -Destination $copy
                            $sha=Get-Sha $preference
                            if((Get-Sha $copy) -ne $sha){throw 'Preference backup mismatch'}
                            $row.backupFiles += @{relative=$relativePreference;sha256=$sha;bytes=(Get-Item -LiteralPath $copy).Length}
                        }
                    }
                    $row.excludedFromByteCopy='Browser components/caches retained intact in held profile; not ACL-modified'
                }
                # Same-parent rename preserves all local build dependencies without copying them.
                Assert-NoAgentProcesses
                [IO.Directory]::Move($original,$held)
                if(Test-Path -LiteralPath $original){throw 'Original profile remains after move; stop before installation'}
                $row.moved=$true
                Save-Json (Join-Path $reportRoot 'preparation.json') $state
            }
        }
        $state.status='PASS'
        $state.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
    } catch {
        $state.status='FAILED'; $state.error=$_.Exception.Message
        # Never delete a new profile during recovery. Restore only an unoccupied original path.
        foreach($row in @($state.profiles)) {
            if($row.moved -and !(Test-Path -LiteralPath $row.original) -and (Test-Path -LiteralPath $row.held)) {
                [IO.Directory]::Move($row.held,$row.original)
                $row.moved=$false
            }
        }
        throw
    } finally { Save-Json (Join-Path $reportRoot 'preparation.json') $state }
    Write-Output (@{status=$state.status;report=$reportRoot;profiles=@($state.profiles | ForEach-Object {@{kind=$_.kind;held=$_.held;backedUpFiles=$_.backupFiles.Count}})} | ConvertTo-Json -Depth 4)
    exit
}
$preparation = Get-Content -LiteralPath (Join-Path $reportRoot 'preparation.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if($preparation.status -ne 'PASS') {throw 'Preparation not complete'}
$version = if($Action -eq 'InstallOld') {'1.9.8'} else {'1.9.9'}
$package = if($Action -eq 'InstallOld') {$oldPackage} else {$newPackage}
$resultFile = Join-Path $reportRoot ('install-' + $version + '.json')
if(Test-Path -LiteralPath $resultFile) {throw 'Never overwrite an install attempt'}
if($Action -eq 'InstallOld' -and (Test-Path -LiteralPath $installRoot)) {throw 'Old installation target must be fresh'}
if($Action -eq 'InstallNew') {
    $existing = Join-Path $installRoot 'agentvn-editor.exe'
    if(!(Test-Path -LiteralPath $existing) -or (Get-Item -LiteralPath $existing).VersionInfo.ProductVersion -ne '1.9.8') {throw 'Upgrade requires actual old installation'}
    if(!(Test-Path -LiteralPath (Join-Path $reportRoot 'old-ui-data-created.json'))) {throw 'Old UI data must be verified before upgrade'}
}
Assert-ExactChild $installRoot $runRoot
$result = [ordered]@{status='RUNNING';version=$version;package=$package;sha256=(Get-Sha $package);
    startedAt=(Get-Date).ToUniversalTime().ToString('o');installRoot=$installRoot;
    arguments=@('/S',('/D=' + $installRoot));registrationsBefore=(Get-Registration)}
Save-Json $resultFile $result
try {
    $installer=Start-Process -FilePath $package -ArgumentList @('/S',('/D=' + $installRoot)) -WindowStyle Hidden -PassThru
    $result.installerPid=$installer.Id
    Save-Json $resultFile $result
    $installer.WaitForExit()
    $result.exitCode=$installer.ExitCode
    if($installer.ExitCode -ne 0) {throw "Installer exit code: $($installer.ExitCode)"}
    $exe=Join-Path $installRoot 'agentvn-editor.exe'
    $result.actualVersion=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
    $result.executableSha256=Get-Sha $exe
    $result.registrationsAfter=Get-Registration
    if($result.actualVersion -ne $version) {throw 'Actual installed executable version mismatch'}
    $result.status='PASS'
} catch {$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally {$result.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save-Json $resultFile $result}
Write-Output ($result | ConvertTo-Json -Depth 5)
