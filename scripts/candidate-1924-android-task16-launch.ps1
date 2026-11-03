param(
  [ValidateSet('SelfTest','Launch','Elevated','Task')][string]$Action='SelfTest',
  [ValidatePattern('^16$')][string]$Attempt='16',
  [switch]$UseTaskEngine,
  [switch]$NativeUpgrade
)
$ErrorActionPreference='Stop'
trap {
  $failure='F:\AgentVN\QA\Android-Package-20261021-01\administrator-16\startup-failure-'+$PID+'.json'
  if((Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($failure))) -and !(Test-Path -LiteralPath $failure)){
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -Force
    [IO.File]::WriteAllText($failure,(@{status='FAILED';action=$Action;at=[DateTime]::UtcNow.ToString('o');
      error=$_.Exception.ToString();stack=$_.ScriptStackTrace}|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
  }
  exit 2
}
$original=Join-Path $PSScriptRoot 'android-current-physical-host.ps1'
function Sha($file){
  $stream=[IO.File]::OpenRead($file);$hash=[Security.Cryptography.SHA256]::Create()
  try{([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
  finally{$stream.Dispose();$hash.Dispose()}
}
if((Sha $original) -cne '96ef23b6b92e0eae068f1d7b6801382488e3b58ae99a2756fad08889895fda5a'){throw 'Original task launcher changed'}
$source=[IO.File]::ReadAllText($original)
$source=$source.Replace('scripts\installed-android-package-current.cjs','scripts\candidate-1924-android-package-task16.cjs')
$source=$source.Replace('scripts\android-current-cache-session.ps1','scripts\candidate-1924-android-package-task16-cache.ps1')
$source=$source.Replace('F:\AgentVN\QA\Editor-1.9.22-20261022-01\baseline-01.json',
  'F:\AgentVN\QA\Editor-1.9.24-20261024-01\installation.json')
$source=$source.Replace('$PSCommandPath',("'"+$PSCommandPath+"'"))
$source=$source.Replace("if(`$file.path -cne 'C:\Users\1\AppData\Roaming\com.agentvn.editor\backend\vn_engine.db')",
  "if(`$file.path -cnotin @('C:\Users\1\AppData\Roaming\com.agentvn.editor\backend\vn_engine.db','C:\Users\1\AppData\Roaming\com.agentvn.editor\backend\vn_engine.db-wal','C:\Users\1\AppData\Roaming\com.agentvn.editor\backend\vn_engine.db-shm'))")
$source=$source.Replace('[DateTime]::Parse($taskState.at).ToUniversalTime()',
  '[DateTime]::Parse($taskState.at).ToUniversalTime().AddSeconds(-1)')
if($Action -ceq 'Launch'){
  $checkpoint='F:\AgentVN\Checkpoints\Android-Package-1924-20261025-04'
  if(Test-Path -LiteralPath $checkpoint){throw 'Fresh checkpoint required'}
  $null=New-Item -ItemType Directory -Path $checkpoint
  foreach($file in @($PSCommandPath,$original,(Join-Path $PSScriptRoot 'candidate-1924-android-package-task16.cjs'),
    (Join-Path $PSScriptRoot 'candidate-1924-android-package-task16-cache.ps1'),
    'D:\AgentVN\plans\ACTIVE_TASKS.md','D:\AgentVN\AGENTS.md')){
    Copy-Item -LiteralPath $file -Destination (Join-Path $checkpoint ([IO.Path]::GetFileName($file)))
  }
  [IO.File]::WriteAllText((Join-Path $checkpoint 'executed-business.ps1'),$source,[Text.UTF8Encoding]::new($false))
}
& ([ScriptBlock]::Create($source)) -Action $Action -Attempt $Attempt `
  -UseTaskEngine:($Action -cne 'Task') -NativeUpgrade
