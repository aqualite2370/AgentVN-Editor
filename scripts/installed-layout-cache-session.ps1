param(
    [ValidateSet('SelfTest','Prepare','Restore')][string]$Action='SelfTest',
    [Parameter(Mandatory=$true)][string]$RunDirectory,
    [switch]$CodexCacheView,
    [switch]$PhysicalCache,
    [string]$AllowedRunRoot
)
$ErrorActionPreference='Stop'
$run=[IO.Path]::GetFullPath($RunDirectory)
$allowedRoot=if($AllowedRunRoot){[IO.Path]::GetFullPath($AllowedRunRoot)}else{$null}
$qa='F:\AgentVN\QA\Installed-Layout-20261021-01'
$guiQa='F:\AgentVN\QA\Installed-GUI-20261021-01'
$guiLibraryQa='F:\AgentVN\QA\Installed-GUI-Library-1922-20261022-01'
$portraitQa='F:\AgentVN\QA\Installed-Portrait-20261021-01'
$assistantExportQa='F:\AgentVN\QA\Installed-Assistant-Export-20261021-01'
$assetsQa='F:\AgentVN\QA\Installed-Assets-20261021-01'
$componentsQa='F:\AgentVN\QA\Installed-Components-20261021-01'
$projectDirectoryQa='F:\AgentVN\QA\Project-Directory-Installed-20261022-01'
$assistantLifecycleQa='F:\AgentVN\QA\Installed-Assistant-Lifecycle-1922-20261022-01'
$assistantReviewCurrentQa='F:\AgentVN\QA\Installed-Assistant-Review-1922-20261022-01'
$assistantExportCurrentQa='F:\AgentVN\QA\Installed-Assistant-Export-1922-20261022-01'
$assistantRecoveryCurrentQa='F:\AgentVN\QA\Installed-Assistant-Recovery-1922-20261022-01'
$novelCurrentQa='F:\AgentVN\QA\Installed-Novel-1922-20261022-01'
$novelDefaultQa='F:\AgentVN\QA\Installed-Novel-Default-1922-20261022-01'
$motionQa='F:\AgentVN\QA\Installed-Editor-Motion-20261021-01'
$repairQa='F:\AgentVN\QA\Editor-Repair-Release-20261024-01'
$packageQa='F:\AgentVN\QA\Windows-Package-20261021-01'
$homeQa='F:\AgentVN\QA\Home-Resume-Label-20261021-01'
$homeRepairQa='F:\AgentVN\QA\Home-Resume-Release-20261021-01'
$msiDirectoryQa='F:\AgentVN\QA\MSI-Location-Repair-20261021-01'
$candidateGuiQa=if($env:AGENTVN_INSTALLED_GUI_QA_ROOT){[IO.Path]::GetFullPath($env:AGENTVN_INSTALLED_GUI_QA_ROOT)}else{$null}
function Boundary($directory) {
    $parent=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($directory))
    $leaf=[IO.Path]::GetFileName($directory)
    $validEditor=($parent -ceq $qa -or $parent -ceq $guiQa -or $parent -ceq $guiLibraryQa -or $parent -ceq $portraitQa -or $parent -ceq $assistantExportQa -or $parent -ceq $assetsQa -or $parent -ceq $componentsQa -or $parent -ceq $projectDirectoryQa -or $parent -ceq $motionQa -or $parent -ceq $packageQa -or $parent -ceq $homeQa -or $parent -ceq $homeRepairQa -or $parent -ceq $msiDirectoryQa -or $parent -ceq $candidateGuiQa) -and $leaf -match '^editor-\d{2}$'
    $validDiagnostic=$parent -ceq $portraitQa -and $leaf -match '^diagnostic-\d{2}$'
    $validAssistantLifecycle=$parent -ceq $assistantLifecycleQa -and $leaf -match '^session-\d{2}$'
    $validAssistantReview=$parent -ceq $assistantReviewCurrentQa -and $leaf -match '^session-\d{2}$'
    $validAssistantExport=$parent -ceq $assistantExportCurrentQa -and $leaf -match '^editor-\d{2}$'
    $validAssistantRecovery=$parent -ceq $assistantRecoveryCurrentQa -and $leaf -match '^session-\d{2}$'
    $validCurrentAssistant=$allowedRoot -and $parent -ceq $allowedRoot -and $leaf -match '^session-\d{2}$'
    $validNovel=$parent -ceq $novelCurrentQa -and $leaf -match '^session-\d{2}$'
    $validNovelDefault=$parent -ceq $novelDefaultQa -and $leaf -match '^session-\d{2}$'
    $validRepairMotion=$parent -ceq $repairQa -and $leaf -match '^editor-motion-\d{2}$'
    if(!$validEditor -and !$validDiagnostic -and !$validAssistantLifecycle -and !$validAssistantReview -and !$validAssistantExport -and !$validAssistantRecovery -and !$validCurrentAssistant -and !$validNovel -and !$validNovelDefault -and !$validRepairMotion){
        throw 'Exact installed-layout run boundary required'
    }
}
Boundary $run
if($Action -eq 'SelfTest'){
    $tests=@(@($run,$true),@('D:\AgentVN',$false),@($qa,$false),@(($qa+'\editor-03\nested'),$false),
      @(($guiQa+'\editor-01'),$true),@($guiQa,$false),@(($guiQa+'\editor-01\nested'),$false),
      @(($guiLibraryQa+'\editor-01'),$true),@($guiLibraryQa,$false),@(($guiLibraryQa+'\editor-01\nested'),$false),
      @(($portraitQa+'\editor-01'),$true),@($portraitQa,$false),@(($portraitQa+'\editor-01\nested'),$false),
      @(($portraitQa+'\diagnostic-01'),$true),@(($portraitQa+'\diagnostic-01\nested'),$false),@(($qa+'\diagnostic-01'),$false),
      @(($assistantExportQa+'\editor-01'),$true),@($assistantExportQa,$false),@(($assistantExportQa+'\editor-01\nested'),$false),
      @(($assetsQa+'\editor-01'),$true),@($assetsQa,$false),@(($assetsQa+'\editor-01\nested'),$false),
      @(($componentsQa+'\editor-01'),$true),@($componentsQa,$false),@(($componentsQa+'\editor-01\nested'),$false),
      @(($projectDirectoryQa+'\editor-01'),$true),@($projectDirectoryQa,$false),@(($projectDirectoryQa+'\editor-01\nested'),$false),
      @(($assistantLifecycleQa+'\session-01'),$true),@($assistantLifecycleQa,$false),
      @(($assistantLifecycleQa+'\session-01\nested'),$false),@(($assistantLifecycleQa+'\editor-01'),$false),
      @(($assistantLifecycleQa+'\session-one'),$false),@(($assistantLifecycleQa+'-other\session-01'),$false),
      @(($assistantReviewCurrentQa+'\session-01'),$true),@($assistantReviewCurrentQa,$false),
      @(($assistantReviewCurrentQa+'\session-01\nested'),$false),@(($assistantReviewCurrentQa+'\editor-01'),$false),
      @(($assistantReviewCurrentQa+'-other\session-01'),$false),
      @(($assistantExportCurrentQa+'\editor-01'),$true),@($assistantExportCurrentQa,$false),
      @(($assistantExportCurrentQa+'\editor-01\nested'),$false),@(($assistantExportCurrentQa+'\session-01'),$false),
      @(($assistantExportCurrentQa+'-other\editor-01'),$false),
      @(($assistantRecoveryCurrentQa+'\session-01'),$true),@($assistantRecoveryCurrentQa,$false),
      @(($assistantRecoveryCurrentQa+'\session-01\nested'),$false),@(($assistantRecoveryCurrentQa+'\editor-01'),$false),
      @(($assistantRecoveryCurrentQa+'-other\session-01'),$false),
      @(($novelCurrentQa+'\session-01'),$true),@($novelCurrentQa,$false),
      @(($novelCurrentQa+'\session-01\nested'),$false),@(($novelCurrentQa+'\editor-01'),$false),
      @(($novelCurrentQa+'\session-one'),$false),@(($novelCurrentQa+'-other\session-01'),$false),
      @(($novelDefaultQa+'\session-01'),$true),@($novelDefaultQa,$false),
      @(($novelDefaultQa+'\session-01\nested'),$false),@(($novelDefaultQa+'\editor-01'),$false),
      @(($novelDefaultQa+'-other\session-01'),$false),
      @(($motionQa+'\editor-01'),$true),@($motionQa,$false),@(($motionQa+'\editor-01\nested'),$false),
      @(($packageQa+'\editor-01'),$true),@($packageQa,$false),@(($packageQa+'\editor-01\nested'),$false),
      @(($homeQa+'\editor-01'),$true),@($homeQa,$false),@(($homeQa+'\editor-01\nested'),$false),
      @(($homeRepairQa+'\editor-01'),$true),@($homeRepairQa,$false),@(($homeRepairQa+'\editor-01\nested'),$false),
      @(($msiDirectoryQa+'\editor-01'),$true),@($msiDirectoryQa,$false),@(($msiDirectoryQa+'\editor-01\nested'),$false),
      @(($repairQa+'\editor-motion-01'),$true),@($repairQa,$false),
      @(($repairQa+'\editor-motion-01\nested'),$false),@(($repairQa+'\editor-motion-one'),$false),
      @(($repairQa+'\editor-01'),$false),@(($repairQa+'-other\editor-motion-01'),$false))
    if($allowedRoot){$tests += @(@((Join-Path $allowedRoot 'session-01'),$true),@($allowedRoot,$false),@((Join-Path $allowedRoot 'session-01\nested'),$false))}
    foreach($test in $tests){
        $valid=$true;try{Boundary $test[0]}catch{$valid=$false}
        if($valid -ne $test[1]){throw 'Boundary selftest failed'}
    }
    "PASS: $($tests.Count) exact-path boundary cases, no mutation";exit
}
if(!(Test-Path -LiteralPath $run -PathType Container)){throw 'Existing exact QA run required'}
$original='C:\Users\1\AppData\Local\com.agentvn.editor\windows-env'
if($CodexCacheView){
    # Use an explicit physical path, so MSIX's unrelated lexical fallback is
    # neither overwritten by Junction creation nor mistaken for test output.
    $physical='C:\Users\1\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\com.agentvn.editor\windows-env'
    if(!(Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($physical)) -PathType Container)){throw 'Codex cache view absent'}
    $original=$physical
}
$held=$original+'.qa-hold-installed-layout-20261021'
$target=Join-Path $run 'native-windows-env'
$journal=Join-Path $run 'native-cache-protection.json'
function Save($file,$value){[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))}
function Sha($file){
    $stream=[IO.File]::OpenRead($file);$hasher=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
    finally{$stream.Dispose();$hasher.Dispose()}
}
function Id($directory){
    $text=(& fsutil.exe file queryfileid $directory|Out-String)
    if($LASTEXITCODE -ne 0 -or $text -notmatch '0x[0-9a-fA-F]+'){throw 'Directory identity unavailable'}
    $Matches[0].ToLowerInvariant()
}
function Files($directory){
    $entries=@(Get-Item -LiteralPath $directory -Force)+@(Get-ChildItem -LiteralPath $directory -Recurse -Force)
    if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Linked native cache source'}
    @(foreach($file in $entries|Where-Object {!$_.PSIsContainer}){
        @{relative=$file.FullName.Substring($directory.Length+1);sha256=(Sha $file.FullName)}
    })
}
$active=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend)\.exe$'})
if($active.Count){throw 'Editor/backend must be stopped before cache protection/restoration'}
if($Action -eq 'Prepare'){
    if((Test-Path -LiteralPath $journal) -or (Test-Path -LiteralPath $held) -or (Test-Path -LiteralPath $target)){throw 'Fresh native cache journal required'}
    $exists=Test-Path -LiteralPath $original
    $state=@{status='JOURNALED';original=$original;held=$held;target=$target;existed=$exists;files=@();physical=[bool]$PhysicalCache;at=(Get-Date).ToUniversalTime().ToString('o')}
    if($exists){$state.files=@(Files $original);$state.directoryId=Id $original}
    Save $journal $state
    try{
        if($exists){[IO.Directory]::Move($original,$held)}
        if($PhysicalCache){
            $null=New-Item -ItemType Directory -Path $original
            $state.testDirectoryId=Id $original
        }else{
            $null=New-Item -ItemType Directory -Path $target
            $null=New-Item -ItemType Junction -Path $original -Target $target
        }
        $state.status='PASS';Save $journal $state
    }catch{
        $state.status='FAILED';$state.error=$_.Exception.Message
        if($exists -and (Test-Path -LiteralPath $held) -and !(Test-Path -LiteralPath $original)){
            [IO.Directory]::Move($held,$original)
        }
        Save $journal $state;throw
    }
    if($PhysicalCache){'PASS: original cache held; owned physical test cache ready for later verified F archive'}
    else{'PASS: exact native Windows environment cache retained; only test cache redirected to F'}
    exit
}
$state=Get-Content -LiteralPath $journal -Raw -Encoding UTF8|ConvertFrom-Json
if($state.original -cne $original -or $state.held -cne $held -or $state.target -cne $target){throw 'Cache restore journal boundary mismatch'}
$item=Get-Item -LiteralPath $original -Force
if([bool]$state.physical -ne [bool]$PhysicalCache){throw 'Restore physical-cache mode differs from journal'}
if($PhysicalCache){
    if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or (Id $original) -cne $state.testDirectoryId){throw 'Only owned physical test cache may be archived'}
    if(Test-Path -LiteralPath $target){throw 'Refuse to overwrite test cache archive'}
}elseif(!($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or [IO.Path]::GetFullPath([string]$item.Target) -cne $target){throw 'Only owned exact Junction may be removed'}
if($state.existed){
    if((Id $held) -cne $state.directoryId){throw 'Held cache identity differs'}
    foreach($file in $state.files){if((Sha (Join-Path $held $file.relative)) -cne $file.sha256){throw 'Held cache bytes differ'}}
}
if($PhysicalCache){
    $testFiles=@(Files $original)
    Copy-Item -LiteralPath $original -Destination $target -Recurse
    $archived=@(Files $target)
    if($archived.Count -ne $testFiles.Count){throw 'Physical test archive count differs'}
    foreach($file in $testFiles){if((Sha (Join-Path $target $file.relative)) -cne $file.sha256){throw 'Physical test archive bytes differ'}}
    Save (Join-Path $run 'native-cache-archive.json') @{status='PASS';source=$original;directoryId=$state.testDirectoryId;files=$testFiles;target=$target}
    # Exact named QA directory, creation identity, no linked descendants, and
    # byte-for-byte F archive verified. Never delete the held original.
    if((Id $original) -cne $state.testDirectoryId){throw 'Test directory changed before removal'}
    [IO.Directory]::Delete($original,$true)
}else{
    # Delete just the validated owned junction, never recurse into its target.
    $item.Delete()
}
if($state.existed){
    [IO.Directory]::Move($held,$original)
    if((Id $original) -cne $state.directoryId){throw 'Restored cache identity differs'}
    foreach($file in $state.files){if((Sha (Join-Path $original $file.relative)) -cne $file.sha256){throw 'Restored cache bytes differ'}}
}
$result=@{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');deletedUserFiles=0;physical=[bool]$state.physical;retainedTestCache=$target;originalFiles=$state.files;originalDirectory=$original;originalDirectoryId=$state.directoryId}
Save (Join-Path $run 'native-cache-restoration.json') $result
'PASS: original native cache restored; owned test logs retained on F'
