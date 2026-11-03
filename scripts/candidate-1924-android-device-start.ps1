param(
  [string]$RequestPath,
  [switch]$Elevated,
  [switch]$SelfTest
)
$ErrorActionPreference='Stop'
$original=Join-Path $PSScriptRoot 'start-android-acceptance.ps1'
$hasher=[Security.Cryptography.SHA256]::Create()
try {
  $digest=([BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($original)))).Replace('-','').ToLowerInvariant()
} finally { $hasher.Dispose() }
if($digest -cne 'f41e5bb022c394435336130d95f42fe4cec818e2c36484c8697e78912c750c0e'){throw 'Original Android start script changed'}
$source=[IO.File]::ReadAllText($original)
$before='android-native-upgrade-device.cjs'
if(($source.Split([string[]]@($before),[StringSplitOptions]::None).Count-1) -ne 1){throw 'Unique upgrade runner expected'}
$source=$source.Replace($before,'candidate-1924-android-upgrade-device.cjs')
$source=$source.Replace('$PSCommandPath',("'"+$PSCommandPath+"'"))
$source=$source.Replace('$PSScriptRoot',("'"+$PSScriptRoot+"'"))
$tokens=$null;$errors=$null
$null=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors | Out-String)}
if($SelfTest){'PASS: one exact runner adaptation, genuine RunAs and finally preserved; no device launch';exit}
if(!$RequestPath){throw 'Explicit request required'}
& ([ScriptBlock]::Create($source)) -RequestPath $RequestPath -Elevated:$Elevated
