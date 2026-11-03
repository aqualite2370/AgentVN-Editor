$ErrorActionPreference = "Stop"
$root = "D:\AgentVN"
$apk = Join-Path $root "output\hidden-growth\android\隐忍的成长-0.1.0.apk"
$log = Join-Path $root "output\hidden-growth\android\admin-start-androiddev.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
$elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Set-Content -LiteralPath $log -Value ("isElevated=" + $elevated) -Encoding utf8
if (-not $elevated) { throw "管理员权限未生效" }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$root\scripts\start-androiddev.ps1" `
    -ApkPath $apk `
    -SdkRoot "D:\Android_dev\Sdk" `
    -AvdName "AgentVN_API35" `
    -Serial "emulator-5554" *>> $log
$exitCode = $LASTEXITCODE
Add-Content -LiteralPath $log -Value ("exitCode=" + $exitCode)
exit $exitCode
