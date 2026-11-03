param([ValidateSet('Prepare','ResumeQA','Launch','Observe','CloseAudit','Restore')][string]$Action='Prepare',
    [ValidateSet('preview','assets','media-video','components','components-use','gui','assistant','assistant-recovery','assistant-review','editor-motion','editor-loading','runtime-motion','project-directory','windows-export','runtime-abilities','runtime-exceptions','runtime-persistence','runtime-settings','runtime-exit','layout-resources','novel-floating','environment-cache','database-migration','msi-continuation','msi-next','nsis-cross','real-model','resource-versions','layout-author-review','runtime-voice','runtime-voice-paged','runtime-voice-paged-4k','runtime-quick-gaps','runtime-quick-latest','dialog-portrait','animation-asset','choice-role-states','transient-role-states','authored-transient-role-states','navigation-role-states')][string]$Suite='preview',
    [ValidateRange(1,9)][int]$Attempt=1,
    [ValidateRange(1,9)][int]$SessionNumber=1,
    [ValidateSet('Computer Use Alt+F4','Native Tauri close command (not physical input)')][string]$CloseMethod='Computer Use Alt+F4')
$ErrorActionPreference='Stop'
$reportRoot='D:\AgentVN\output\installed-preview-20261018-01'
$workRoot='F:\AgentVN-QA-InstalledPreview-20261018-01'
$sessionSuffix='preview-20261018-01'
if($Suite -eq 'assets'){
    $reportRoot='D:\AgentVN\output\installed-assets-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledAssets-20261018-01'
    $sessionSuffix='assets-20261018-01'
}
if($Suite -eq 'media-video'){
    $reportRoot='D:\AgentVN\output\installed-video-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledVideo-20261018-01'
    $sessionSuffix='media-video-20261018-01'
}
if($Suite -eq 'components'){
    $reportRoot='D:\AgentVN\output\installed-components-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledComponents-20261018-01'
    $sessionSuffix='components-20261018-01'
}
if($Suite -eq 'components-use'){
    $reportRoot='D:\AgentVN\output\installed-components-use-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledComponentsUse-20261018-01'
    $sessionSuffix='components-use-20261018-01'
}
if($Suite -eq 'gui'){
    $reportRoot='D:\AgentVN\output\installed-gui-session-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledGuiSession-20261018-01'
    $sessionSuffix='gui-20261018-01'
}
if($Suite -eq 'assistant'){
    $reportRoot='D:\AgentVN\output\installed-assistant-session-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledAssistant-20261018-01'
    $sessionSuffix='assistant-20261018-01'
}
if($Suite -eq 'assistant-recovery'){
    $reportRoot='D:\AgentVN\output\installed-assistant-recovery-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledAssistantRecovery-20261018-01'
    $sessionSuffix='assistant-recovery-20261018-01'
}
if($Suite -eq 'assistant-review'){
    $reportRoot='D:\AgentVN\output\installed-assistant-review-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledAssistantReview-20261018-01'
    $sessionSuffix='assistant-review-20261018-01'
}
if($Suite -eq 'editor-motion'){
    $reportRoot='D:\AgentVN\output\installed-editor-motion-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledEditorMotion-20261018-01'
    $sessionSuffix='editor-motion-20261018-01'
}
if($Suite -eq 'editor-loading'){
    $reportRoot='D:\AgentVN\output\installed-editor-loading-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledEditorLoading-20261018-01'
    $sessionSuffix='editor-loading-20261018-01'
}
if($Suite -eq 'runtime-motion'){
    $reportRoot='D:\AgentVN\output\installed-runtime-motion-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledRuntimeMotion-20261018-01'
    $sessionSuffix='runtime-motion-20261018-01'
    if($Action -notin @('Prepare','Restore')){throw 'Runtime motion uses only profile protection, no Editor launch'}
}
if($Suite -eq 'project-directory'){
    $reportRoot='D:\AgentVN\output\installed-project-directory-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledProjectDirectory-20261018-01'
    $sessionSuffix='project-directory-20261018-01'
}
if($Suite -eq 'windows-export'){
    $reportRoot='D:\AgentVN\output\installed-windows-export-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledWindowsExport-20261018-01'
    $sessionSuffix='windows-export-20261018-01'
}
if($Suite -eq 'runtime-abilities'){
    $reportRoot='D:\AgentVN\output\installed-runtime-abilities-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledRuntimeAbilities-20261018-01'
    $sessionSuffix='runtime-abilities-20261018-01'
}
if($Suite -eq 'runtime-exceptions'){
    $reportRoot='D:\AgentVN\output\installed-runtime-exceptions-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledRuntimeExceptions-20261018-01'
    $sessionSuffix='runtime-exceptions-20261018-01'
    if($Action -notin @('Prepare','Restore')){throw 'Runtime exceptions uses only profile protection, no Editor launch'}
}
if($Suite -eq 'runtime-persistence'){
    $reportRoot='D:\AgentVN\output\installed-runtime-persistence-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledRuntimePersistence-20261018-01'
    $sessionSuffix='runtime-persistence-20261018-01'
}
if($Suite -eq 'runtime-settings'){
    $reportRoot='D:\AgentVN\output\installed-runtime-settings-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledRuntimeSettings-20261018-01'
    $sessionSuffix='runtime-settings-20261018-01'
    if($Action -notin @('Prepare','Restore')){throw 'Runtime settings uses only profile protection, no Editor launch'}
}
if($Suite -eq 'runtime-exit'){
    $reportRoot='D:\AgentVN\output\installed-runtime-exit-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledRuntimeExit-20261018-01'
    $sessionSuffix='runtime-exit-20261018-01'
    if($Action -notin @('Prepare','Restore')){throw 'Runtime exit uses only profile protection, no Editor launch'}
}
if($Suite -eq 'layout-resources'){
    $reportRoot='D:\AgentVN\output\installed-layout-resources-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledLayoutResources-20261018-01'
    $sessionSuffix='layout-resources-20261018-01'
}
if($Suite -eq 'novel-floating'){
    $reportRoot='D:\AgentVN\output\installed-novel-session-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledNovelSession-20261018-01'
    $sessionSuffix='novel-session-20261018-01'
}
if($Suite -eq 'environment-cache'){
    $reportRoot='D:\AgentVN\output\installed-environment-cache-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledEnvironmentCache-20261018-01'
    $sessionSuffix='environment-cache-20261018-01'
    if($Action -notin @('Prepare','Restore')){throw 'Environment acceptance manages actual old/new processes separately'}
}
if($Suite -eq 'database-migration'){
    $reportRoot='D:\AgentVN\output\installed-database-migration-20261018-01'
    $workRoot='F:\AgentVN-QA-InstalledDatabaseMigration-20261018-01'
    $sessionSuffix='database-migration-20261018-01'
    if($Action -notin @('Prepare','Restore')){throw 'Database migration manages native launch/confirmation separately'}
}
if($Suite -eq 'msi-continuation'){
    $reportRoot='D:\AgentVN\output\host-msi-continuation-20261018-02'
    $workRoot='F:\AgentVN-QA-HostMSI-20261018-02'
    $sessionSuffix='msi-continuation-20261018-02'
    if($Action -notin @('Prepare','Restore')){throw 'MSI continuation manages installer and shortcut launches separately'}
}
if($Suite -eq 'msi-next'){
    $reportRoot='D:\AgentVN\output\host-msi-next-20261018-01'
    $workRoot='F:\AgentVN-QA-HostMSINext-20261018-01'
    $sessionSuffix='msi-next-20261018-01'
    if($Action -notin @('Prepare','Restore')){throw 'MSI next uses profile protection only'}
}
if($Suite -eq 'nsis-cross'){
    $reportRoot='D:\AgentVN\output\host-nsis-cross-20261018-01'
    $workRoot='F:\AgentVN-QA-NSISCross-20261018-01'
    $sessionSuffix='nsis-cross-20261018-01'
    if($Action -notin @('Prepare','Restore')){throw 'NSIS cross uses profile protection only'}
}
if($Suite -eq 'real-model'){
    $reportRoot='D:\AgentVN\output\installed-real-model-20261019-01'
    $workRoot='F:\AgentVN-QA-InstalledRealModel-20261019-01'
    $sessionSuffix='real-model-20261019-01'
}
if($Suite -eq 'resource-versions'){
    $reportRoot='D:\AgentVN\output\installed-resource-versions-20261019-01'
    $workRoot='F:\AgentVN\QA\Resource-Versions-20261019-01'
    $sessionSuffix='resource-versions-20261019-01'
}
if($Suite -eq 'layout-author-review'){
    $reportRoot='D:\AgentVN\output\installed-layout-author-review-20261019-01'
    $workRoot='F:\AgentVN\QA\Layout-Author-20261019-01'
    $sessionSuffix='layout-author-review-20261019-01'
}
if($Suite -eq 'runtime-voice'){
    $reportRoot='D:\AgentVN\output\installed-runtime-voice-20261019-01'
    $workRoot='F:\AgentVN\QA\Runtime-Voice-20261019-01'
    $sessionSuffix='runtime-voice-20261019-01'
}
if($Suite -eq 'runtime-voice-paged'){
    $reportRoot='D:\AgentVN\output\installed-runtime-voice-paged-20261019-01'
    $workRoot='F:\AgentVN\QA\Runtime-Voice-Paged-20261019-01'
    $sessionSuffix='runtime-voice-paged-20261019-01'
}
if($Suite -eq 'runtime-voice-paged-4k'){
    $reportRoot='D:\AgentVN\output\installed-runtime-voice-paged-4k-20261019-01'
    $workRoot='F:\AgentVN\QA\Runtime-Voice-Paged-4K-20261019-01'
    $sessionSuffix='runtime-voice-paged-4k-20261019-01'
}
if($Suite -eq 'runtime-quick-gaps'){
    $reportRoot='D:\AgentVN\output\installed-runtime-quick-gaps-20261019-01'
    $workRoot='F:\AgentVN\QA\Runtime-Quick-Gaps-20261019-01'
    $sessionSuffix='runtime-quick-gaps-20261019-01'
    if($Action -notin @('Prepare','Restore')){throw 'Quick-gap supplement uses profile protection only; no Editor launch'}
}
if($Suite -eq 'runtime-quick-latest'){
    $reportRoot='D:\AgentVN\output\installed-runtime-quick-latest-20261019-01'
    $workRoot='F:\AgentVN\QA\Runtime-Quick-Latest-20261019-01'
    $sessionSuffix='runtime-quick-latest-20261019-01'
    if($Action -notin @('Prepare','Restore')){throw 'Latest-valid supplement uses profile protection only'}
}
if($Suite -eq 'dialog-portrait'){
    $reportRoot='D:\AgentVN\output\installed-dialog-portrait-20261019-01'
    $workRoot='F:\AgentVN\QA\Dialog-Portrait-20261019-01'
    $sessionSuffix='dialog-portrait-20261019-01'
}
if($Suite -eq 'animation-asset'){
    $reportRoot='D:\AgentVN\output\installed-animation-asset-20261019-01'
    $workRoot='F:\AgentVN\QA\Animation-Asset-20261019-01'
    $sessionSuffix='animation-asset-20261019-01'
}
if($Suite -eq 'choice-role-states'){
    $reportRoot='D:\AgentVN\output\installed-choice-role-states-20261019-01'
    $workRoot='F:\AgentVN\QA\Choice-Role-States-20261019-01'
    $sessionSuffix='choice-role-states-20261019-01'
    if($Action -notin @('Prepare','Restore')){throw 'Choice role supplement uses profile protection only'}
}
if($Suite -eq 'transient-role-states'){
    $reportRoot='D:\AgentVN\output\installed-transient-role-states-20261019-01'
    $workRoot='F:\AgentVN\QA\Transient-Role-States-20261019-01'
    $sessionSuffix='transient-role-states-20261019-01'
    if($Action -notin @('Prepare','Restore')){throw 'Transient role supplement uses profile protection only'}
}
if($Suite -eq 'authored-transient-role-states'){
    $reportRoot='D:\AgentVN\output\installed-authored-transient-role-states-20261019-01'
    $workRoot='F:\AgentVN\QA\Authored-Transient-Role-States-20261019-01'
    $sessionSuffix='authored-transient-role-states-20261019-01'
    if($Action -notin @('Prepare','Restore')){throw 'Authored transient role supplement uses profile protection only'}
}
if($Suite -eq 'navigation-role-states'){
    $reportRoot='D:\AgentVN\output\installed-navigation-role-states-20261019-01'
    $workRoot='F:\AgentVN\QA\Navigation-Role-States-20261019-01'
    $sessionSuffix='navigation-role-states-20261019-01'
    if($Action -notin @('Prepare','Restore')){throw 'Navigation role supplement uses profile protection only'}
}
if($SessionNumber -gt 1){
    if($Suite -notin @('windows-export','preview','runtime-exit','dialog-portrait','animation-asset')){throw 'Additional sessions require an explicitly supported suite'}
    $qaSessionTail=$SessionNumber.ToString('00')
    $reportRoot=$reportRoot -replace '-01$',('-'+$qaSessionTail)
    $workRoot=$workRoot -replace '-01$',('-'+$qaSessionTail)
    $sessionSuffix=$sessionSuffix -replace '-01$',('-'+$qaSessionTail)
}
$installRoot='F:\AgentVN-QA-HostUpgrade-20261018-02\installed-editor'
if($Suite -in @('resource-versions','layout-author-review','runtime-voice','runtime-voice-paged','runtime-voice-paged-4k','runtime-quick-gaps','runtime-quick-latest','dialog-portrait','animation-asset','choice-role-states','transient-role-states','authored-transient-role-states','navigation-role-states')){
    # New sessions use the consolidated physical root. An executable started
    # via a junction can report its child backend under the canonical path.
    $installRoot='F:\AgentVN\QA\AgentVN-QA-HostUpgrade-20261018-02\installed-editor'
}
$utf8=New-Object Text.UTF8Encoding($false)
$attemptSuffix=if($Attempt -eq 1){''}else{'-'+$Attempt.ToString('00')}
$launchFile=Join-Path $reportRoot ('launch'+$attemptSuffix+'.json')
$backendFile=Join-Path $reportRoot ('backend-ready'+$attemptSuffix+'.json')
function Sha($file){
    # Node-spawned Windows PowerShell may not expose Get-FileHash even when the
    # interactive shell does. Use the same SHA256 algorithm without a module.
    $stream=[IO.File]::OpenRead($file)
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try{return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
    finally{$algorithm.Dispose();$stream.Dispose()}
}
function Save($file,$value){
    if(Test-Path -LiteralPath $file){throw "Evidence collision: $file"}
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 16),$utf8)
}
function Processes {
    @(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')})
}
function Idle {
    if(@(Processes).Count){throw 'AgentVN or its WebView still active; refuse profile move'}
}
function Boundary($row){
    $parent='C:\Users\1\AppData\'+$row.kind
    if([IO.Path]::GetDirectoryName($row.original) -ne $parent -or
        [IO.Path]::GetDirectoryName($row.held) -ne $parent -or
        [IO.Path]::GetFileName($row.original) -ne ('com.agentvn.'+$row.app) -or
        [IO.Path]::GetFileName($row.held) -ne ('com.agentvn.'+$row.app+'.qa-hold-'+$sessionSuffix)){
        throw 'Unexpected exact profile boundary'
    }
}
if($Action -eq 'Prepare'){
    Idle
    if((Test-Path -LiteralPath $reportRoot) -or (Test-Path -LiteralPath $workRoot)){throw 'Fresh preview session required'}
    if((Sha (Join-Path $installRoot 'agentvn-editor.exe')) -ne 'f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c'){throw 'Installed frozen candidate differs'}
    $editor=Get-Content -LiteralPath 'D:\AgentVN\output\host-msi-session-20261018-01\preparation.json' -Raw -Encoding UTF8|ConvertFrom-Json
    $player=Get-Content -LiteralPath 'D:\AgentVN\output\old-runtime-refusal-20261018-01\profile-protection.json' -Raw -Encoding UTF8|ConvertFrom-Json
    $profiles=@()
    foreach($source in $editor.profiles){
        $profiles+=@{app='editor';kind=$source.kind;original=$source.original;
            held=($source.original+'.qa-hold-'+$sessionSuffix);
            files=@($source.verified|ForEach-Object {@{relative=$_.relative;sha256=$_.sha256;backup=(Join-Path $source.backupRoot $_.relative)}})}
    }
    foreach($source in $player.profiles){
        $profiles+=@{app='player';kind=$source.kind;original=$source.original;
            held=($source.original+'.qa-hold-'+$sessionSuffix);files=$source.backupFiles}
    }
    $count=0
    foreach($row in $profiles){
        Boundary $row
        if(!(Test-Path -LiteralPath $row.original) -or (Test-Path -LiteralPath $row.held)){throw 'Missing original/colliding held profile'}
        if((Get-Item -LiteralPath $row.original).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked original profile'}
        foreach($file in $row.files){
            if((Sha (Join-Path $row.original $file.relative)) -ne $file.sha256 -or (Sha $file.backup) -ne $file.sha256){throw 'Independent baseline backup mismatch'}
            $count++
        }
    }
    if($count -ne 55){throw 'Expected 31 Editor and 24 Player original file checks'}
    $null=New-Item -ItemType Directory -Path $reportRoot,$workRoot
    $state=@{status='PREPARING';at=(Get-Date).ToUniversalTime().ToString('o');profiles=$profiles;verifiedOriginalFiles=$count;
        installRoot=$installRoot;workRoot=$workRoot;moved=@();error=$null;
        projectSource='C:\Users\1\AppData\Roaming\com.agentvn.editor.qa-tested-20261018-02';
        originalDevSha256=(Sha 'D:\AgentVN\AgentVN Dev.exe')}
    # Write a recovery journal before moving anything.
    [IO.File]::WriteAllText((Join-Path $reportRoot 'preparation-journal.json'),($state|ConvertTo-Json -Depth 16),$utf8)
    try{
        foreach($row in $profiles){
            Idle
            [IO.Directory]::Move($row.original,$row.held)
            $state.moved+=@{app=$row.app;kind=$row.kind;original=$row.original;held=$row.held}
            [IO.File]::WriteAllText((Join-Path $reportRoot 'preparation-journal.json'),($state|ConvertTo-Json -Depth 16),$utf8)
        }
        # Copy only the known isolated QA project's small Roaming tree. Original
        # user data remains held; browser stores start fresh at the default path.
        if($Suite -in @('media-video','components','components-use','gui','assistant','assistant-recovery','assistant-review','editor-motion','project-directory','windows-export','runtime-abilities','runtime-persistence','layout-resources')){
            $state.projectSource='C:\Users\1\AppData\Roaming\com.agentvn.editor.qa-tested-assets-20261018-01'
        }
        $qaFiles=@()
        if($Suite -in @('nsis-cross','real-model','resource-versions','layout-author-review','runtime-voice','runtime-voice-paged','runtime-voice-paged-4k','runtime-quick-gaps','runtime-quick-latest','dialog-portrait','animation-asset','choice-role-states','transient-role-states','authored-transient-role-states','navigation-role-states')){
            $state.projectSource=$null
            $state.blankDefaultProfiles=$true
        }else{
            $qaSource=$state.projectSource
            $qaTarget='C:\Users\1\AppData\Roaming\com.agentvn.editor'
            $null=New-Item -ItemType Directory -Path $qaTarget
            foreach($file in (Get-ChildItem -LiteralPath $qaSource -Recurse -File -Force)){
                if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked QA seed'}
                $relative=$file.FullName.Substring($qaSource.Length+1)
                $target=Join-Path $qaTarget $relative
                $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
                Copy-Item -LiteralPath $file.FullName -Destination $target
                if((Sha $target) -ne (Sha $file.FullName)){throw 'QA project seed copy changed'}
                $qaFiles+=@{relative=$relative;sha256=(Sha $target);bytes=$file.Length}
            }
        }
        $state.qaSeed=$qaFiles
        $state.status='PASS'
    }catch{$state.status='FAILED';$state.error=$_.Exception.Message;throw}
    finally{Save (Join-Path $reportRoot 'preparation.json') $state}
    if($Suite -in @('nsis-cross','real-model','resource-versions','layout-author-review','runtime-voice','runtime-voice-paged','runtime-voice-paged-4k','runtime-quick-gaps','runtime-quick-latest','dialog-portrait','animation-asset','choice-role-states','transient-role-states','authored-transient-role-states','navigation-role-states')){
        Write-Output "PASS: four whole profiles held, $count independent SHA checks; blank defaults, no seed"
    }else{
        Write-Output "PASS: four whole profiles held, $count independent SHA checks; isolated small project copied"
    }
    exit
}
$prep=Get-Content -LiteralPath (Join-Path $reportRoot 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($prep.status -ne 'PASS'){throw 'Preview protection not complete'}
if($Action -eq 'ResumeQA'){
    if($Suite -notin @('layout-author-review','runtime-voice-paged') -or $Attempt -le 1){throw 'ResumeQA is limited to explicitly protected continuations'}
    Idle
    $previous=Get-Content -LiteralPath (Join-Path $reportRoot 'profile-restoration.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($previous.status -ne 'PASS'){throw 'Previous original-profile restoration must be complete'}
    $resumeFile=Join-Path $reportRoot ('profile-resumption'+$attemptSuffix+'.json')
    if(Test-Path -LiteralPath $resumeFile){throw 'Resumption evidence collision'}
    $count=0
    foreach($row in $prep.profiles){
        Boundary $row
        if(!(Test-Path -LiteralPath $row.original) -or (Test-Path -LiteralPath $row.held)){throw 'Original missing or still held'}
        $retained=$row.original+'.qa-tested-'+$sessionSuffix
        foreach($candidate in @($row.original,$retained)){
            if((Test-Path -LiteralPath $candidate) -and
                ((Get-Item -LiteralPath $candidate).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Linked profile refused'}
        }
        foreach($file in $row.files){
            if((Sha (Join-Path $row.original $file.relative)) -ne $file.sha256 -or (Sha $file.backup) -ne $file.sha256){
                throw 'Original profile/independent backup changed; no move'
            }
            $count++
        }
    }
    if($count -ne 55){throw 'Expected55 independent baseline files'}
    $resume=@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');moved=@();verifiedOriginalFiles=$count}
    [IO.File]::WriteAllText($resumeFile,($resume|ConvertTo-Json -Depth 8),$utf8)
    foreach($row in $prep.profiles){
        Idle
        $retained=$row.original+'.qa-tested-'+$sessionSuffix
        [IO.Directory]::Move($row.original,$row.held)
        $entry=@{original=$row.original;held=$row.held;qaSource=$retained;qaRestored=$false}
        $resume.moved+=$entry
        [IO.File]::WriteAllText($resumeFile,($resume|ConvertTo-Json -Depth 8),$utf8)
        if(Test-Path -LiteralPath $retained){[IO.Directory]::Move($retained,$row.original);$entry.qaRestored=$true}
        [IO.File]::WriteAllText($resumeFile,($resume|ConvertTo-Json -Depth 8),$utf8)
    }
    $resume.status='PASS'
    [IO.File]::WriteAllText($resumeFile,($resume|ConvertTo-Json -Depth 8),$utf8)
    Write-Output 'PASS: original profiles reprotected after55 independent hashes; retained QA profiles resumed, no copying'
    exit
}
if($Action -eq 'Launch'){
    Idle
    if(@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -eq 8278}).Count){throw 'Default backend port occupied'}
    foreach($name in @(Get-ChildItem Env:|Where-Object {$_.Name -match '^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$'}|ForEach-Object {$_.Name})){
        Remove-Item -LiteralPath ('Env:\'+$name)
    }
    function Port {
        $probe=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
        $probe.Start();$number=$probe.LocalEndpoint.Port;$probe.Stop();return $number
    }
    $editorPort=Port;$playerPort=Port
    if($editorPort -eq $playerPort){throw 'Distinct debugger ports required'}
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port='+$editorPort
    $env:AGENTVN_GAMECLI_PREVIEW_CDP_PORT=[string]$playerPort
    if($Suite -in @('media-video','components','components-use','gui','assistant','assistant-recovery','assistant-review','editor-motion','project-directory','windows-export','runtime-abilities','runtime-persistence','layout-resources')){
        $videoFixture=Get-Content -LiteralPath (Join-Path $reportRoot 'fixtures.json') -Raw -Encoding UTF8|ConvertFrom-Json
        if($videoFixture.status -ne 'PASS'){throw 'Video fixture preflight not complete'}
    }
    if($Suite -eq 'windows-export'){
        # Keep this run's temporary build inputs on F without changing the
        # default Editor database or WebView locations under test.
        $buildTemp=Join-Path $workRoot 'temp'
        $null=New-Item -ItemType Directory -Path $buildTemp -Force
        $env:TEMP=$buildTemp;$env:TMP=$buildTemp
        # The actual installed runner collects from its workspace-local target.
        # An external CARGO_TARGET_DIR would change the normal user workflow
        # and make artifact collection fail for a test-only reason.
        if(Test-Path -LiteralPath 'Env:\CARGO_TARGET_DIR'){Remove-Item -LiteralPath 'Env:\CARGO_TARGET_DIR'}
    }
    $hostProcess=Start-Process -FilePath (Join-Path $installRoot 'agentvn-editor.exe') -WorkingDirectory $installRoot -WindowStyle Hidden -PassThru
    $state=@{status='WAITING';at=(Get-Date).ToUniversalTime().ToString('o');editorPid=$hostProcess.Id;
        installRoot=$installRoot;executableSha256=(Sha (Join-Path $installRoot 'agentvn-editor.exe'));
        cdpPort=$editorPort;playerCdpPort=$playerPort;backendPort=8278;
        dataDirectoryOverride=$false;webviewDirectoryOverride=$false;manualBackendSpawn=$false;
        scope=('ACTUAL_NSIS_INSTALLED_RELEASE_'+$Suite.ToUpperInvariant()+'_WITH_WHOLE_DEFAULT_PROFILES_ISOLATED_NOT_CLEAN_MACHINE');
        projectId='project_mvcm7xeq_0_83813e8b36';realModelRequests=0;error=$null}
    if($Suite -in @('media-video','components','components-use','gui','assistant','assistant-recovery','assistant-review','editor-motion','project-directory','windows-export','runtime-abilities','runtime-persistence','layout-resources')){
        $state.projectId=$videoFixture.projectId
    }
    if($Suite -in @('real-model','resource-versions','layout-author-review','runtime-voice','runtime-voice-paged','runtime-voice-paged-4k','dialog-portrait','animation-asset')){
        # This fresh profile starts before fixture import. Do not attribute the
        # preview suite's historical project ID to this independent session.
        $state.projectId=$null
    }
    if($Suite -eq 'windows-export'){
        $state.buildStorage=@{TEMP=$env:TEMP;TMP=$env:TMP;CARGO_TARGET_DIR=$env:CARGO_TARGET_DIR;
            defaultDatabaseAndWebviewUnchanged=$true}
    }
    try{
        $deadline=[DateTime]::UtcNow.AddSeconds(60)
        do{
            $ready=$false
            try{$null=Invoke-RestMethod -Uri "http://127.0.0.1:$editorPort/json/version" -TimeoutSec 1;$ready=$true}catch{}
            if(!$ready){Start-Sleep -Milliseconds 150}
        }while(!$ready -and [DateTime]::UtcNow -lt $deadline)
        if(!$ready){throw 'Installed WebView unavailable'}
        $owned=@(Processes|Where-Object {$_.Name -ne 'msedgewebview2.exe'})
        if(@($owned|Where-Object {$_.ExecutablePath -ne (Join-Path $installRoot $_.Name)}).Count){throw 'Unowned AgentVN executable'}
        $state.processes=@($owned|ForEach-Object {@{Name=$_.Name;ProcessId=$_.ProcessId;ParentProcessId=$_.ParentProcessId;
            ExecutablePath=$_.ExecutablePath;createdUtc=$_.CreationDate.ToUniversalTime().ToString('o')}})
        $state.status='PASS'
    }catch{$state.status='FAILED';$state.error=$_.Exception.Message;throw}
    finally{Save $launchFile $state}
    Write-Output ($state|ConvertTo-Json -Depth 6)
    exit
}
if($Action -eq 'Observe'){
    $launch=Get-Content -LiteralPath $launchFile -Raw -Encoding UTF8|ConvertFrom-Json
    $response=Invoke-RestMethod -Uri 'http://127.0.0.1:8278/api/health' -TimeoutSec 3
    $owned=@(Processes|Where-Object {$_.Name -ne 'msedgewebview2.exe'})
    $backend=@($owned|Where-Object {$_.Name -eq 'creator-backend.exe'})
    $backendRoots=@($backend|Where-Object {$_.ParentProcessId -eq $launch.editorPid})
    if($backendRoots.Count -ne 1 -or @($backend|Where-Object {
        $_.ExecutablePath -ne (Join-Path $installRoot 'creator-backend.exe') -or
        ($_.ParentProcessId -ne $launch.editorPid -and $_.ParentProcessId -ne $backendRoots[0].ProcessId)
    }).Count){throw 'Backend path/parent ownership mismatch'}
    $state=@{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');scope='LATE_STARTUP_PROCESS_OBSERVATION_NOT_LAUNCH_REPORT_REWRITE';
        backendSha256=(Sha $backend[0].ExecutablePath);
        processes=@($owned|ForEach-Object {@{Name=$_.Name;ProcessId=$_.ProcessId;ParentProcessId=$_.ParentProcessId;
            ExecutablePath=$_.ExecutablePath;createdUtc=$_.CreationDate.ToUniversalTime().ToString('o')}})}
    Save $backendFile $state
    Write-Output 'PASS: real automatically started packaged backend path, parent, creation time and SHA recorded'
    exit
}
if($Action -eq 'CloseAudit'){
    $launch=Get-Content -LiteralPath $launchFile -Raw -Encoding UTF8|ConvertFrom-Json
    $remaining=@(Processes)
    $state=@{at=(Get-Date).ToUniversalTime().ToString('o');normalClose=$CloseMethod;
        status=if($remaining.Count){'FAILED'}else{'PASS'};residuals=@();ownedResidualCleanup='NOT_NEEDED'}
    foreach($row in $remaining){
        $observation=Get-Content -LiteralPath $backendFile -Raw -Encoding UTF8|ConvertFrom-Json
        $expected=@($observation.processes|Where-Object {$_.ProcessId -eq $row.ProcessId})
        if($row.Name -ne 'creator-backend.exe' -or $expected.Count -ne 1 -or
            $row.ExecutablePath -ne $expected[0].ExecutablePath -or
            $row.ParentProcessId -ne $expected[0].ParentProcessId -or
            $row.CreationDate.ToUniversalTime().ToString('o') -ne $expected[0].createdUtc){
            Save (Join-Path $reportRoot ('close-audit'+$attemptSuffix+'.json')) $state
            throw 'Unexpected residual; do not kill without attribution'
        }
        $state.residuals+=@{pid=$row.ProcessId;path=$row.ExecutablePath;parent=$row.ParentProcessId;
            createdUtc=$row.CreationDate.ToUniversalTime().ToString('o');defect='HOST-02_BACKEND_SURVIVES_NORMAL_CLOSE'}
        Stop-Process -Id $row.ProcessId
    }
    $deadline=[DateTime]::UtcNow.AddSeconds(5)
    while(@(Processes).Count -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 150}
    if($remaining.Count){$state.ownedResidualCleanup=if(@(Processes).Count){'FAILED'}else{'PASS'}}
    $state.remainingProcesses=@(Processes|Select-Object Name,ProcessId,ExecutablePath)
    $state.remainingPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @($launch.cdpPort,$launch.playerCdpPort,8278)}|Select-Object LocalPort,OwningProcess)
    Save (Join-Path $reportRoot ('close-audit'+$attemptSuffix+'.json')) $state
    if($state.remainingProcesses.Count -or $state.remainingPorts.Count){throw 'Remaining process or listener'}
    Write-Output "Normal-close status=$($state.status); residual cleanup=$($state.ownedResidualCleanup)"
    exit
}
Idle
$state=@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');profiles=@();error=$null}
foreach($row in $prep.profiles){
    Boundary $row
    if(!(Test-Path -LiteralPath $row.held) -or (Test-Path -LiteralPath ($row.original+'.qa-tested-'+$sessionSuffix))){throw 'Restoration collision'}
}
try{
    foreach($row in $prep.profiles){
        $test=$row.original+'.qa-tested-'+$sessionSuffix
        if(Test-Path -LiteralPath $row.original){[IO.Directory]::Move($row.original,$test)}
        [IO.Directory]::Move($row.held,$row.original)
        $checks=@()
        foreach($file in $row.files){
            if((Sha (Join-Path $row.original $file.relative)) -ne $file.sha256 -or (Sha $file.backup) -ne $file.sha256){throw 'Original profile restore byte mismatch'}
            $checks+=@{relative=$file.relative;sha256=$file.sha256;match=$true}
        }
        $state.profiles+=@{app=$row.app;kind=$row.kind;testHeld=$test;checks=$checks}
    }
    $state.status='PASS'
}catch{$state.status='FAILED';$state.error=$_.Exception.Message;throw}
finally{
    $restorationFile=if($Suite -in @('layout-author-review','runtime-voice-paged') -and $Attempt -gt 1){
        'profile-restoration'+$attemptSuffix+'.json'
    }else{'profile-restoration.json'}
    Save (Join-Path $reportRoot $restorationFile) $state
}
Write-Output 'PASS: all four original profiles restored; 55 file hashes match independent backups'
