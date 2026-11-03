param([ValidateSet('Snapshot','VerifyInstalled','Restore')][string]$Action='Snapshot')
$ErrorActionPreference='Stop'
$reportRoot='D:\AgentVN\output\host-upgrade-20261018-02'
$runRoot='F:\AgentVN-QA-HostUpgrade-20261018-02'
$installRoot=Join-Path $runRoot 'installed-editor'
$utf8=New-Object Text.UTF8Encoding($false)
function Save-Json($path,$value) {
    if(Test-Path -LiteralPath $path){throw "Refuse to overwrite evidence: $path"}
    [IO.File]::WriteAllText($path,($value|ConvertTo-Json -Depth 16),$utf8)
}
function Sha($path){
    if(!(Test-Path -LiteralPath $path -PathType Leaf)){throw "Missing hash input: $path"}
    $result=Get-FileHash -LiteralPath $path -Algorithm SHA256
    if(!$result.Hash){throw "No hash returned: $path"}
    $result.Hash.ToLowerInvariant()
}
function AgentProcesses {
    @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.editor')
    })
}
function Assert-Idle {
    if(@(AgentProcesses).Count){throw 'Editor/backend/WebView still active; refuse profile mutation'}
}
function Copy-Tree($source,$target) {
    $rows=@()
    if(!(Test-Path -LiteralPath $source)){return $rows}
    foreach($file in (Get-ChildItem -LiteralPath $source -Recurse -Force -File)){
        if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked test file'}
        $relative=$file.FullName.Substring($source.Length+1)
        $destination=Join-Path $target $relative
        $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force
        if(Test-Path -LiteralPath $destination){throw 'Snapshot collision'}
        Copy-Item -LiteralPath $file.FullName -Destination $destination
        $hash=Sha $file.FullName
        if((Sha $destination) -ne $hash){throw 'Snapshot hash mismatch'}
        $rows+=@{source=$file.FullName;backup=$destination;sha256=$hash;bytes=$file.Length}
    }
    return $rows
}
if($Action -eq 'Snapshot'){
    $closeReport=Join-Path $reportRoot 'old-close-audit.json'
    if(Test-Path -LiteralPath $closeReport){
        $previousClose=Get-Content -LiteralPath $closeReport -Raw -Encoding UTF8|ConvertFrom-Json
        if($previousClose.ownedResidualCleanup -ne 'PASS'){throw 'Previous cleanup not complete'}
        Assert-Idle
    }
    $remaining=@(AgentProcesses)
    $close=[ordered]@{at=(Get-Date).ToUniversalTime().ToString('o');
        status='PASS';normalWindowClose='Computer Use Alt+F4';
        remaining=@($remaining|Select-Object Name,ProcessId,ParentProcessId,ExecutablePath,CreationDate);
        ownedResidualCleanup='NOT_NEEDED'}
    if($remaining.Count){
        # Never end another installation or the editor itself. This exact old child
        # was observed before and after the normal close in this test session.
        if($remaining.Count -ne 1 -or $remaining[0].ProcessId -ne 122368 -or
            $remaining[0].ParentProcessId -ne 122296 -or
            $remaining[0].ExecutablePath -ne (Join-Path $installRoot 'creator-backend.exe')){
            Save-Json $closeReport $close
            throw 'Unexpected live process; manual attribution required'
        }
        $close.status='FAILED'
        $close.defect='OLD_EDITOR_BACKEND_CHILD_SURVIVES_NORMAL_WINDOW_CLOSE'
        Stop-Process -Id $remaining[0].ProcessId
        $deadline=[DateTime]::UtcNow.AddSeconds(10)
        while(@(AgentProcesses).Count -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 150}
        $close.ownedResidualCleanup=if(@(AgentProcesses).Count){'FAILED'}else{'PASS'}
    }
    if(!(Test-Path -LiteralPath $closeReport)){Save-Json $closeReport $close}
    Assert-Idle
    $target=Join-Path $runRoot 'pre-upgrade-test-data-02'
    if(Test-Path -LiteralPath $target){throw 'Snapshot must be fresh'}
    $null=New-Item -ItemType Directory -Path $target
    $files=@(Copy-Tree 'C:\Users\1\AppData\Roaming\com.agentvn.editor' (Join-Path $target 'Roaming'))
    foreach($relative in @('EBWebView\Default\Local Storage','EBWebView\Default\IndexedDB','EBWebView\Default\Session Storage')){
        $files+=@(Copy-Tree (Join-Path 'C:\Users\1\AppData\Local\com.agentvn.editor' $relative) (Join-Path $target ('Local\'+$relative)))
    }
    foreach($relative in @('EBWebView\Local State','EBWebView\Default\Preferences','EBWebView\Default\Secure Preferences')){
        $source=Join-Path 'C:\Users\1\AppData\Local\com.agentvn.editor' $relative
        if(Test-Path -LiteralPath $source){
            $destination=Join-Path $target ('Local\'+$relative)
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force
            Copy-Item -LiteralPath $source -Destination $destination
            if((Sha $source) -ne (Sha $destination)){throw 'Preference snapshot mismatch'}
            $files+=@{source=$source;backup=$destination;sha256=(Sha $source);bytes=(Get-Item -LiteralPath $source).Length}
        }
    }
    # Windows PowerShell reads BOM-less scripts using the system code page.
    # Resolve the previously observed Unicode export by its unique ASCII suffix.
    $exports=@(Get-ChildItem -LiteralPath 'C:\Users\1\Downloads' -Filter '*20261018_003827.vnproj' -File)
    if($exports.Count -ne 1){throw 'Expected exactly one observed old project export'}
    $package=$exports[0].FullName
    $copy=Join-Path $target ([IO.Path]::GetFileName($package))
    Copy-Item -LiteralPath $package -Destination $copy
    if((Sha $package) -ne (Sha $copy)){throw 'Project export snapshot mismatch'}
    Save-Json (Join-Path $reportRoot 'pre-upgrade-snapshot.json') @{
        status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');files=$files;
        projectPackage=@{source=$package;backup=$copy;sha256=(Sha $package);bytes=(Get-Item -LiteralPath $package).Length};
        liveAgentProcessCount=@(AgentProcesses).Count
    }
    Write-Output "PASS: test snapshot verified, $($files.Count) persistent files; original user profiles untouched"
    exit
}
if($Action -eq 'VerifyInstalled'){
    Assert-Idle
    $before=Get-Content -LiteralPath (Join-Path $reportRoot 'pre-upgrade-snapshot.json') -Raw -Encoding UTF8|ConvertFrom-Json
    $rows=@(foreach($file in $before.files){
        $actual=Sha $file.source
        @{path=$file.source;expected=$file.sha256;actual=$actual;match=($actual -eq $file.sha256)}
    })
    $exe=Join-Path $installRoot 'agentvn-editor.exe'
    $versionFile=Join-Path $installRoot 'build-versions.json'
    $version=Get-Content -LiteralPath $versionFile -Raw -Encoding UTF8|ConvertFrom-Json
    $payloadAuditPath='D:\AgentVN\output\full-regression-20261017-01\candidate-payload-audit\installer-resource-report.json'
    $payloadAudit=Get-Content -LiteralPath $payloadAuditPath -Raw -Encoding UTF8|ConvertFrom-Json
    $payload=@($payloadAudit.deployments|Where-Object {$_.kind -eq 'NSIS actual payload'})
    if($payloadAudit.status -ne 'PASS' -or $payload.Count -ne 1){throw 'Frozen NSIS payload audit missing'}
    # Tauri stamps bundle identity into installer payloads. Compare the actual
    # NSIS payload, not the differently stamped standalone release target EXE.
    $checks=@{
        executableVersion=((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion -eq '1.9.9');
        frozenExecutable=((Sha $exe) -eq $payload[0].executable.sha256);
        versionResource=($version.editorVersion -eq '1.9.9');
        persistedBytesUnchanged=(@($rows|Where-Object {!$_.match}).Count -eq 0)
    }
    $status=if(@($checks.Values|Where-Object {!$_}).Count){'FAILED'}else{'PASS'}
    Save-Json (Join-Path $reportRoot 'installed-before-launch.json') @{
        status=$status;at=(Get-Date).ToUniversalTime().ToString('o');checks=$checks;
        files=$rows;payloadAudit=@{path=$payloadAuditPath;sha256=(Sha $payloadAuditPath)};
        executable=@{path=$exe;sha256=(Sha $exe)};versionResource=@{path=$versionFile;value=$version;sha256=(Sha $versionFile)}
    }
    if($status -ne 'PASS'){throw 'Installed candidate identity/data preservation failed'}
    Write-Output "PASS: frozen 1.9.9 executable, installed version resource, $($rows.Count) unchanged persistent files"
    exit
}
Assert-Idle
$preparation=Get-Content -LiteralPath (Join-Path $reportRoot 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
$restoreReport=Join-Path $reportRoot 'user-profile-restoration.json'
if(Test-Path -LiteralPath $restoreReport){throw 'Restoration already recorded'}
$restoration=[ordered]@{status='RUNNING';startedAt=(Get-Date).ToUniversalTime().ToString('o');profiles=@();error=$null;
    installationRetained=$installRoot;warning='Do not launch retained test installation against restored user profiles'}
try{
    # Validate BOTH destinations before moving either profile.
    foreach($row in $preparation.profiles){
        $expectedParent='C:\Users\1\AppData\'+$row.kind
        if([IO.Path]::GetDirectoryName($row.original) -ne $expectedParent -or
            [IO.Path]::GetDirectoryName($row.held) -ne $expectedParent -or
            [IO.Path]::GetFileName($row.original) -ne 'com.agentvn.editor' -or
            [IO.Path]::GetFileName($row.held) -ne 'com.agentvn.editor.qa-hold-20261018-02'){
            throw 'Unexpected exact profile boundary'
        }
        $testHeld=Join-Path $expectedParent 'com.agentvn.editor.qa-tested-20261018-02'
        if((Test-Path -LiteralPath $testHeld) -or !(Test-Path -LiteralPath $row.held)){throw 'Restoration collision/missing original held profile'}
    }
    foreach($row in $preparation.profiles){
        $testHeld=Join-Path ('C:\Users\1\AppData\'+$row.kind) 'com.agentvn.editor.qa-tested-20261018-02'
        Assert-Idle
        $entry=[ordered]@{kind=$row.kind;original=$row.original;userHeld=$row.held;testHeld=$testHeld;
            testStaged=$false;userRestored=$false;checks=@()}
        $restoration.profiles+=$entry
        if(Test-Path -LiteralPath $row.original){
            [IO.Directory]::Move($row.original,$testHeld)
            $entry.testStaged=$true
        }
        [IO.Directory]::Move($row.held,$row.original)
        $entry.userRestored=$true
        # Enumerate only independently backed-up application files. Do not traverse
        # browser component ACLs or alter ACLs to force access.
        foreach($backup in (Get-ChildItem -LiteralPath $row.backupRoot -Recurse -File -Force)){
            $relative=$backup.FullName.Substring($row.backupRoot.Length+1)
            $restored=Join-Path $row.original $relative
            $expected=Sha $backup.FullName
            $actual=Sha $restored
            $entry.checks+=@{relative=$relative;sha256=$actual;match=($expected -eq $actual)}
            if($expected -ne $actual){throw "Restored user byte mismatch: $relative"}
        }
    }
    $restoration.status='PASS'
}catch{$restoration.status='FAILED';$restoration.error=$_.Exception.Message;throw}
finally{
    $restoration.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
    Save-Json $restoreReport $restoration
}
Write-Output 'PASS: user profiles restored, test profiles separately retained, no deletion'
