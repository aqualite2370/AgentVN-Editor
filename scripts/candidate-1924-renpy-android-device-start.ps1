param([string]$RequestPath,[switch]$Elevated,[switch]$SelfTest)
$ErrorActionPreference='Stop'
$original=Join-Path $PSScriptRoot 'start-android-acceptance.ps1'
$hasher=[Security.Cryptography.SHA256]::Create()
try {$digest=([BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($original)))).Replace('-','').ToLowerInvariant()}
finally {$hasher.Dispose()}
if($digest -cne 'f41e5bb022c394435336130d95f42fe4cec818e2c36484c8697e78912c750c0e'){throw 'Android start source changed'}
$source=[IO.File]::ReadAllText($original)
foreach($pair in @(
  @("'installed-current-navigation'","'installed-renpy-resource-navigation'"),
  @('android-current-navigation.cjs','candidate-1924-renpy-android-device.cjs')
)){
  if(($source.Split([string[]]@($pair[0]),[StringSplitOptions]::None).Count-1) -ne 1){throw 'Unique Renpy runner branch required'}
  $source=$source.Replace($pair[0],$pair[1])
}
$source=$source.Replace('$PSCommandPath',("'"+$PSCommandPath+"'")).Replace('$PSScriptRoot',("'"+$PSScriptRoot+"'"))
$tokens=$null;$parseErrors=$null
$null=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw ($parseErrors | Out-String)}
if($SelfTest){'PASS: Renpy resource runner, genuine RunAs and original finally preserved';exit}
if(!$RequestPath){throw 'Explicit request required'}
$request=[IO.File]::ReadAllText([IO.Path]::GetFullPath($RequestPath)).TrimStart([char]0xFEFF)|ConvertFrom-Json
if($request.scope -cne 'installed-renpy-resource-navigation' -or $request.package -cne 'com.agentvn.qa.renpygui20261025'){
  throw 'Renpy request scope and package required before elevation'
}
& ([ScriptBlock]::Create($source)) -RequestPath $RequestPath -Elevated:$Elevated
