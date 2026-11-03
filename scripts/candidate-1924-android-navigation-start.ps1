param([string]$RequestPath,[switch]$Elevated,[switch]$SelfTest)
$ErrorActionPreference='Stop'
$original=Join-Path $PSScriptRoot 'start-android-acceptance.ps1'
$hasher=[Security.Cryptography.SHA256]::Create()
try {$digest=([BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($original)))).Replace('-','').ToLowerInvariant()}
finally {$hasher.Dispose()}
if($digest -cne 'f41e5bb022c394435336130d95f42fe4cec818e2c36484c8697e78912c750c0e'){throw 'Android start source changed'}
$source=[IO.File]::ReadAllText($original)
$before='android-current-navigation.cjs'
if(($source.Split([string[]]@($before),[StringSplitOptions]::None).Count-1) -ne 1){throw 'Unique navigation runner required'}
$source=$source.Replace($before,'candidate-1924-android-navigation.cjs')
$source=$source.Replace('$PSCommandPath',("'"+$PSCommandPath+"'")).Replace('$PSScriptRoot',("'"+$PSScriptRoot+"'"))
$tokens=$null;$parseErrors=$null
$null=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw ($parseErrors | Out-String)}
if($SelfTest){'PASS: native navigation runner, genuine RunAs and finally preserved';exit}
if(!$RequestPath){throw 'Explicit request required'}
& ([ScriptBlock]::Create($source)) -RequestPath $RequestPath -Elevated:$Elevated
