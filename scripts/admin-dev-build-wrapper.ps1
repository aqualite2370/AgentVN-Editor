$ErrorActionPreference = "Stop"
$log = "D:\AgentVN\output\admin-dev-build.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
try {
    $elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Set-Content -LiteralPath $log -Value ("isElevated=" + $elevated) -Encoding utf8
    if (-not $elevated) { throw "管理员权限未生效" }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\AgentVN\scripts\build-dev-launcher.ps1 *> D:\AgentVN\output\admin-dev-build-output.log
    $exitCode = $LASTEXITCODE
    if (Test-Path -LiteralPath "D:\AgentVN\output\admin-dev-build-output.log") {
        Get-Content -LiteralPath "D:\AgentVN\output\admin-dev-build-output.log" | Add-Content -LiteralPath $log
    }
    Add-Content -LiteralPath $log -Value ("exitCode=" + $exitCode)
    if ($exitCode -ne 0) { exit $exitCode }
}
catch {
    Add-Content -LiteralPath $log -Value ("ERROR=" + $_.Exception.ToString())
    exit 1
}
