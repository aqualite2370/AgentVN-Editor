param([Parameter(Mandatory=$true)][string]$SessionRoot)
$ErrorActionPreference='Stop'
$SessionRoot=[IO.Path]::GetFullPath($SessionRoot)
$expectedVersion = switch ($SessionRoot) {
    'F:\AgentVN\QA\Windows-Isolated-1944-20261105-05' { '1.9.45' }
    'F:\AgentVN\QA\Windows-Isolated-1944-20261105-19' { '1.9.46' }
    'F:\AgentVN\QA\Windows-Isolated-1944-20261105-20' { '1.9.47' }
    'F:\AgentVN\QA\Windows-Isolated-1944-20261105-21' { '1.9.48' }
    'F:\AgentVN\QA\Windows-Isolated-1944-20261106-16' { '1.9.49' }
    'F:\AgentVN\QA\Windows-Isolated-1944-20261106-17' { '1.9.49' }
    'F:\AgentVN\QA\Windows-Isolated-1944-20261107-06' { '1.9.50' }
    'F:\AgentVN\QA\Windows-Isolated-1944-20261107-07' { '1.9.50' }
    'F:\AgentVN\QA\Windows-Isolated-1944-20261107-20' { '1.9.51' }
    'F:\AgentVN\QA\Windows-Isolated-1944-20261107-31' { '1.9.52' }
    'F:\AgentVN\QA\Windows-Isolated-1944-20261107-32' { '1.9.52' }
    'F:\AgentVN\QA\Windows-Isolated-1944-20261107-41' { '1.9.53' }
    'F:\AgentVN\QA\Windows-Isolated-1944-20261107-42' { '1.9.53' }
    default { throw 'Exact owned session required' }
}
if ($expectedVersion -in @('1.9.49','1.9.50','1.9.51','1.9.52','1.9.53')) {
    $owner = Get-Content -LiteralPath "$SessionRoot\account-controller.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    if (!$owner.account.createdByThisRun -or $owner.account.name -notmatch '^AVNQA[0-9A-F]{8}$' -or
        [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne $owner.account.sid -or
        [Environment]::UserName -cne $owner.account.name) { throw 'Exact newly owned standard QA identity required' }
} elseif ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne 'S-1-5-21-2093805479-91935561-747405786-1006') { throw 'Dedicated QA identity required' }
$seal=Get-Content -LiteralPath "$SessionRoot\candidate.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$receipt="$SessionRoot\installation.json"
$install="$SessionRoot\installed-editor"
if ((Test-Path -LiteralPath $receipt) -or (Test-Path -LiteralPath $install)) { throw 'Fresh actual installation required' }
function Sha($file) { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
function Save($value) { [IO.File]::WriteAllText($receipt,($value|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false)) }
if ((Sha $seal.installer.path) -cne $seal.installer.sha256) { throw 'Installer bytes changed' }
if ($seal.version -cne $expectedVersion -or (Get-Item -LiteralPath $seal.installer.path).VersionInfo.ProductVersion -cne $expectedVersion) { throw 'Sealed candidate version required' }
if ($expectedVersion -in @('1.9.49','1.9.50','1.9.51','1.9.52','1.9.53')) {
    $payloadSeal = Get-Content -LiteralPath $seal.payloadReport.path -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($payloadSeal.status -cne 'PASS' -or $payloadSeal.version -cne $expectedVersion -or
        $payloadSeal.installers.Count -ne 1 -or $payloadSeal.installers[0].sha256 -cne $seal.installer.sha256) {
        throw 'Matching actual NSIS payload provenance report required'
    }
    $deployment = @($payloadSeal.deployments | Where-Object kind -CEQ 'NSIS actual payload')
    if ($deployment.Count -ne 1) { throw 'Unique NSIS installed-payload record required' }
    $seal.payload = @(@{relative='agentvn-editor.exe';sha256=$deployment[0].executable.sha256},
        @{relative='build-versions.json';sha256=$deployment[0].versionResource.sha256})
    foreach ($runtime in $deployment[0].runtimeProvenance) {
        $seal.payload += @{relative=$runtime.name;sha256=$runtime.sha256}
    }
}
$products = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(AgentVN Dev|agentvn-editor|agentvn-player|creator-backend)\.exe$' })
if ($expectedVersion -ceq '1.9.53') {
    foreach ($product in $products) {
        $productOwner = Invoke-CimMethod -InputObject $product -MethodName GetOwnerSid -ErrorAction Stop
        if ($productOwner.Sid -ceq $owner.account.sid) { throw 'Product already active in this QA account' }
    }
} elseif ($products.Count) { throw 'Product process already active' }
$state=[ordered]@{status='RUNNING';startedAt=[DateTime]::UtcNow.ToString('o');installRoot=$install;package=$seal.installer;
    identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name;scope='ACTUAL_NSIS_SEPARATE_DIRECTORY_STANDARD_QA_ACCOUNT_NOT_UPGRADE';
    registry=@();shortcuts=@();resources=@();metadataRestoration='NOT_RUN'}
$keys=@('Software\agentvn\AgentVN Editor','Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor')
foreach ($relative in $keys) {
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($relative)
    $values=@()
    if ($key) {
        try {
            if ($key.GetSubKeyNames().Count) { throw 'Unexpected nested registration' }
            $values=@(foreach ($name in $key.GetValueNames()) {
                @{name=$name;kind=$key.GetValueKind($name).ToString();value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}
            })
        } finally { $key.Dispose() }
    }
    $state.registry+=@{path=$relative;existed=($null -ne $key);values=$values}
}
$shell=New-Object -ComObject WScript.Shell
$desktop=[Environment]::GetFolderPath('Desktop')
$programs=[Environment]::GetFolderPath('Programs')
foreach ($file in @("$desktop\AgentVN Editor.lnk","$programs\AgentVN Editor.lnk","$programs\AgentVN Editor\AgentVN Editor.lnk")) {
    $row=@{path=$file;existed=(Test-Path -LiteralPath $file)}
    if ($row.existed) {
        $row.backup="$SessionRoot\qa-shortcut-$($state.shortcuts.Count).lnk"
        $row.sha256=Sha $file
        Copy-Item -LiteralPath $file -Destination $row.backup -ErrorAction Stop
    }
    $state.shortcuts+=$row
}
Save $state
$process=$null
try {
    $process=Start-Process -FilePath $seal.installer.path -ArgumentList @('/S',"/D=$install") -WindowStyle Hidden -PassThru
    $state.installerPid=$process.Id;Save $state
    if (!$process.WaitForExit(180000)) { throw 'Installer still running; do not restore metadata' }
    $process.Refresh()
    $state.exitCode=$process.ExitCode
    if ($state.exitCode -ne 0) { throw "Installer failed: $($state.exitCode)" }
    foreach ($entry in $seal.payload) {
        $file=Join-Path $install $entry.relative
        if ((Sha $file) -cne $entry.sha256 -and $entry.relative -ne 'agentvn-editor.exe') {
            throw "Installed bytes differ: $($entry.relative)"
        }
        if ($entry.relative -ceq 'agentvn-editor.exe' -and
            (Sha $file) -cne $entry.sha256) {
            $markerText=& node.exe (Join-Path $PSScriptRoot 'audit-installed-editor-marker.cjs') $file $entry.sha256
            if ($LASTEXITCODE -ne 0) { throw 'Installed editor has changes beyond the Tauri bundle marker' }
            $state.bundleMarker=$markerText|ConvertFrom-Json
            if ($state.bundleMarker.status -cne 'PASS' -or $state.bundleMarker.differentBytes -ne 3) {
                throw 'Exact Tauri marker verification missing'
            }
        }
        $state.resources+=@{path=$file;sha256=(Sha $file);relative=$entry.relative}
    }
    $exe=Join-Path $install 'agentvn-editor.exe'
    $state.executable=@{path=$exe;sha256=(Sha $exe);version=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion}
    if ($state.executable.version -cne $expectedVersion) { throw 'Installed PE version differs' }
    $state.status='PASS'
} catch { $state.status='FAILED';$state.error=$_.Exception.ToString() }
finally {
    try {
        if ($process -and !$process.HasExited) { throw 'Preserve live installer ownership' }
        foreach ($row in $state.registry) {
            if (!$row.existed) {
                $current=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($row.path)
                if ($current) {
                    try {
                        $location=$current.GetValue('InstallLocation',$current.GetValue('',$null))
                        if ([string]$location -and !([string]$location).Contains($install)) { throw 'Unexpected QA registration ownership' }
                    } finally { $current.Dispose() }
                    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($row.path,$false)
                }
            } else {
                $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($row.path)
                try {
                    foreach ($name in $key.GetValueNames()) { $key.DeleteValue($name) }
                    foreach ($value in $row.values) {
                        $key.SetValue([string]$value.name,$value.value,[Microsoft.Win32.RegistryValueKind]::$($value.kind))
                    }
                } finally { $key.Dispose() }
            }
            $check=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($row.path)
            try {
                if ([bool]$check -ne $row.existed) { throw 'QA registration existence changed' }
                if ($check) {
                    if ($check.GetValueNames().Count -ne $row.values.Count) { throw 'QA registry count mismatch' }
                    foreach ($value in $row.values) {
                        if ($check.GetValueKind($value.name).ToString() -cne $value.kind -or
                            ($check.GetValue($value.name)|ConvertTo-Json -Compress) -cne ($value.value|ConvertTo-Json -Compress)) {
                            throw 'QA registry restoration mismatch'
                        }
                    }
                }
            } finally { if ($check) { $check.Dispose() } }
        }
        foreach ($row in $state.shortcuts) {
            if ($row.existed) {
                Copy-Item -LiteralPath $row.backup -Destination $row.path -Force
                if ((Sha $row.path) -cne $row.sha256) { throw 'QA shortcut restoration mismatch' }
            } elseif (Test-Path -LiteralPath $row.path) {
                if ($shell.CreateShortcut($row.path).TargetPath -cne "$install\agentvn-editor.exe") { throw 'Unknown shortcut' }
                Remove-Item -LiteralPath $row.path -Force
            }
        }
        $state.metadataRestoration='PASS'
    } catch { $state.status='FAILED';$state.cleanupError=$_.Exception.ToString() }
    $state.finishedAt=[DateTime]::UtcNow.ToString('o');Save $state
}
if ($state.status -cne 'PASS') { throw ($state.error+' '+$state.cleanupError) }
'PASS: actual QA-account NSIS install and exact installed payload; prior QA metadata restored'
