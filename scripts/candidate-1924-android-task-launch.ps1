param(
  [ValidateSet('SelfTest','Launch','Elevated','Task')][string]$Action='SelfTest',
  [ValidatePattern('^14$')][string]$Attempt='14',
  [switch]$UseTaskEngine,
  [switch]$NativeUpgrade
)
# Retain the audited RunAs -> interactive task -> finally-unregister path.
$ErrorActionPreference='Stop'
$original=Join-Path $PSScriptRoot 'android-current-physical-host.ps1'
function Sha($file){
  $stream=[IO.File]::OpenRead($file);$hash=[Security.Cryptography.SHA256]::Create()
  try{([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
  finally{$stream.Dispose();$hash.Dispose()}
}
if((Sha $original) -cne '96ef23b6b92e0eae068f1d7b6801382488e3b58ae99a2756fad08889895fda5a'){throw 'Original task launcher changed'}
$source=[IO.File]::ReadAllText($original)
$source=$source.Replace('scripts\installed-android-package-current.cjs','scripts\candidate-1924-android-package-task.cjs')
$source=$source.Replace('scripts\android-current-cache-session.ps1','scripts\candidate-1924-android-package-task-cache.ps1')
$source=$source.Replace('F:\AgentVN\QA\Editor-1.9.22-20261022-01\baseline-01.json',
  'F:\AgentVN\QA\Editor-1.9.24-20261024-01\installation.json')
$source=$source.Replace('$PSCommandPath',("'"+$PSCommandPath+"'"))
if($Action -ceq 'Launch'){
  $checkpoint='F:\AgentVN\Checkpoints\Android-Package-1924-20261025-02'
  if(Test-Path -LiteralPath $checkpoint){throw 'Fresh checkpoint required'}
  $null=New-Item -ItemType Directory -Path $checkpoint
  foreach($file in @($PSCommandPath,$original,(Join-Path $PSScriptRoot 'candidate-1924-android-package-task.cjs'),
    (Join-Path $PSScriptRoot 'candidate-1924-android-package-task-cache.ps1'),
    'D:\AgentVN\plans\ACTIVE_TASKS.md','D:\AgentVN\AGENTS.md')){
    Copy-Item -LiteralPath $file -Destination (Join-Path $checkpoint ([IO.Path]::GetFileName($file)))
  }
}
& ([ScriptBlock]::Create($source)) -Action $Action -Attempt $Attempt `
  -UseTaskEngine:($Action -cne 'Task') -NativeUpgrade
