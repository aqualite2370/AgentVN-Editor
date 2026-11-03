param([ValidateSet('SelfTest','Prepare','Restore')][string]$Action='SelfTest',[switch]$Continuation)
$ErrorActionPreference='Stop'
$qaRun='F:\AgentVN\QA\Android-Environment-1924-20261025-04'
$checkpoint='F:\AgentVN\Checkpoints\Android-Environment-1924-20261025-04'
if($Continuation){
  $qaRun='F:\AgentVN\QA\Android-Environment-1924-20261025-05'
  $checkpoint='F:\AgentVN\Checkpoints\Android-Environment-1924-20261025-05'
}
$roots=@('C:\Users\1\AppData\Local\com.agentvn.editor\windows-env',
  'C:\Users\1\AppData\Local\com.agentvn.editor\android-env',
  'C:\Users\1\AppData\Local\AgentVN\environment-cache')
function Sha($file){
  $stream=[IO.File]::OpenRead($file);$hash=[Security.Cryptography.SHA256]::Create()
  try{([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
  finally{$stream.Dispose();$hash.Dispose()}
}
function Id($directory){
  if(!(Test-Path -LiteralPath $directory)){return $null}
  $text=(& fsutil.exe file queryfileid $directory|Out-String)
  if($LASTEXITCODE -ne 0 -or $text -notmatch '0x[0-9a-fA-F]+'){throw 'No directory identity'}
  $Matches[0].ToLowerInvariant()
}
function Files($directory){
  $entries=@(Get-Item -LiteralPath $directory -Force)+@(Get-ChildItem -LiteralPath $directory -Recurse -Force)
  if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw "Linked cache: $directory"}
  @(foreach($file in $entries|Where-Object {!$_.PSIsContainer}){
    @{relative=$file.FullName.Substring($directory.Length+1);bytes=$file.Length;sha256=(Sha $file.FullName)}
  })
}
function Verify($directory,$expected){
  $actual=@(Files $directory)
  if($actual.Count -ne @($expected).Count){throw 'Cache inventory count changed'}
  $lookup=@{};foreach($file in $actual){$lookup[$file.relative]=$file}
  foreach($file in $expected){
    $other=$lookup[$file.relative]
    if(!$other -or $other.bytes -ne $file.bytes -or $other.sha256 -cne $file.sha256){throw "Cache bytes changed: $($file.relative)"}
  }
}
function Save($file,$value){[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))}
function Boundary($original,$target){
  if($roots -cnotcontains [IO.Path]::GetFullPath($original)){throw 'Exact named cache required'}
  $expected=Join-Path $qaRun ('cache-'+[Array]::IndexOf($roots,$original))
  if([IO.Path]::GetFullPath($target) -cne $expected){throw 'Exact F cache target required'}
}
if($Action -ceq 'SelfTest'){
  foreach($original in $roots){Boundary $original (Join-Path $qaRun ('cache-'+[Array]::IndexOf($roots,$original)))}
  foreach($bad in @('C:\','C:\Users\1\AppData\Local','D:\AgentVN',($roots[0]+'\nested'))){
    $accepted=$true;try{Boundary $bad (Join-Path $qaRun 'cache-0')}catch{$accepted=$false}
    if($accepted){throw 'Unsafe original accepted'}
  }
  foreach($bad in @('F:\','F:\AgentVN',$qaRun,($qaRun+'\cache-0\nested'))){
    $accepted=$true;try{Boundary $roots[0] $bad}catch{$accepted=$false}
    if($accepted){throw 'Unsafe target accepted'}
  }
  'PASS: three exact caches and eight invalid boundaries; no mutation';exit
}
if(@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\.exe$'}).Count){
  throw 'AgentVN must be stopped'
}
$journal=Join-Path $qaRun 'cache-protection.json'
if($Action -ceq 'Prepare'){
  if((Test-Path -LiteralPath $qaRun) -or (Test-Path -LiteralPath $checkpoint)){throw 'Fresh evidence and checkpoint required'}
  $records=@(foreach($original in $roots){
    $target=Join-Path $qaRun ('cache-'+[Array]::IndexOf($roots,$original))
    Boundary $original $target
    $held=$original+'.qa-hold-'+[IO.Path]::GetFileName($qaRun).ToLowerInvariant()
    if(Test-Path -LiteralPath $held){throw 'Held path collision'}
    $exists=Test-Path -LiteralPath $original
    $alias=$null
    if([Array]::IndexOf($roots,$original) -lt 2){
      $alias=$original.Replace('C:\Users\1\AppData\Local\','C:\Users\1\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\')
      if((Id $original) -cne (Id $alias)){throw "Alias is a separate directory: $alias"}
    }
    @{original=$original;held=$held;target=$target;alias=$alias;existed=$exists;directoryId=(Id $original);
      files=$(if($exists){@(Files $original)}else{@()});moved=$false;redirected=$false}
  })
  # MSIX may expose a fallback view of the normal cache without a separate
  # physical directory. Never create that view: inspect it in this child process.
  $externalVirtual='C:\Users\1\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\AgentVN\environment-cache'
  $externalId=Id $externalVirtual
  if($externalId){
    if($externalId -cne $records[2].directoryId){throw 'External virtual cache has a different identity'}
    $records[2].alias=$externalVirtual
  }
  $null=New-Item -ItemType Directory -Path $qaRun,$checkpoint
  foreach($file in @($PSCommandPath,(Join-Path $PSScriptRoot 'candidate-1924-android-environment.cjs'),
    'D:\AgentVN\plans\ACTIVE_TASKS.md','D:\AgentVN\AGENTS.md')){
    Copy-Item -LiteralPath $file -Destination (Join-Path $checkpoint ([IO.Path]::GetFileName($file)))
  }
  $state=@{status='JOURNALED';at=(Get-Date).ToUniversalTime().ToString('o');records=$records}
  Save $journal $state
  foreach($record in $records){
    Boundary $record.original $record.target
    if($record.existed){
      if((Id $record.original) -cne $record.directoryId){throw 'Source identity changed'}
      [IO.Directory]::Move($record.original,$record.held);$record.moved=$true;Save $journal $state
    }
    $null=New-Item -ItemType Directory -Path $record.original
    $record.testDirectoryId=Id $record.original
    $record.redirected=$true;Save $journal $state
    if($record.alias -and (Id $record.alias) -cne $record.testDirectoryId){throw 'Alias does not see the same physical QA directory'}
  }
  $state.status='PASS';Save $journal $state
  'PASS: original cache bytes held; aliases deduplicated; blank physical C caches ready';exit
}
$state=Get-Content -LiteralPath $journal -Raw -Encoding UTF8|ConvertFrom-Json
$errors=@();$restored=@()
foreach($record in $state.records){
  try{
    Boundary $record.original $record.target
    if($record.moved){
      if((Id $record.held) -cne $record.directoryId){throw 'Held identity changed'}
      Verify $record.held $record.files
    }
    if($record.redirected){
      $item=Get-Item -LiteralPath $record.original -Force
      if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        (Id $record.original) -cne $record.testDirectoryId){throw 'Refuse to archive/remove unowned physical QA directory'}
      $tested=@(Files $record.original)
      if(Test-Path -LiteralPath $record.target){throw 'Existing QA archive'}
      Copy-Item -LiteralPath $record.original -Destination $record.target -Recurse
      Verify $record.target $tested
      Save (Join-Path $qaRun ('archive-'+[Array]::IndexOf($roots,$record.original)+'.json')) @{
        status='PASS';source=$record.original;target=$record.target;files=$tested;directoryId=$record.testDirectoryId}
      # Exact named directory, matching creation ID, no linked descendants,
      # byte-for-byte archive verified above. Never recurse into a user tree.
      [IO.Directory]::Delete($record.original,$true)
    }
    if($record.moved){[IO.Directory]::Move($record.held,$record.original)}
    if($record.existed){
      if((Id $record.original) -cne $record.directoryId){throw 'Restored identity differs'}
      if($record.alias -and (Id $record.alias) -cne $record.directoryId){throw 'Restored alias differs'}
      Verify $record.original $record.files
    }
    $restored+=@{original=$record.original;status='PASS';directoryId=$record.directoryId;fileCount=@($record.files).Count}
  }catch{$errors+=$_.Exception.ToString()}
}
$result=@{status=$(if($errors.Count){'FAILED'}else{'PASS'});at=(Get-Date).ToUniversalTime().ToString('o');
  restored=$restored;errors=$errors;deletedUserFiles=0}
Save (Join-Path $qaRun 'cache-restoration.json') $result
if($errors.Count){throw ($errors -join "`n")}
'PASS: original cache identities and all bytes restored; QA logs retained on F'
