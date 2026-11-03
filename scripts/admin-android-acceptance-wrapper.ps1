$ErrorActionPreference = "Stop"
$root = "D:\AgentVN"
$log = Join-Path $root "output\hidden-growth\android\admin-acceptance.log"
$out = Join-Path $root "output\hidden-growth\android\admin-acceptance-output.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
$elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Set-Content -LiteralPath $log -Value ("isElevated=" + $elevated) -Encoding utf8
if (-not $elevated) { throw "管理员权限未生效" }
Remove-Item -LiteralPath $out -Force -ErrorAction SilentlyContinue
$node = (Get-Command node.exe -ErrorAction Stop).Source
& $node D:\AgentVN\scripts\hidden-growth-android-landscape-acceptance.cjs `
    --apk D:\AgentVN\output\hidden-growth\android\staging-hidden-growth-20260906.apk `
    --staging-apk D:\AgentVN\output\hidden-growth\android\staging-hidden-growth-20260906.apk `
    --package com.agentvn.hidden.growth `
    --serial emulator-5554 `
    --sdk D:\Android_dev\Sdk *> $out
$exitCode = $LASTEXITCODE
if (Test-Path -LiteralPath $out) { Get-Content -LiteralPath $out | Add-Content -LiteralPath $log }
Add-Content -LiteralPath $log -Value ("exitCode=" + $exitCode)
exit $exitCode

