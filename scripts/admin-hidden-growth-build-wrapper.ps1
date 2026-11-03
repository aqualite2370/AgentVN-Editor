$ErrorActionPreference = "Stop"
$root = "D:\AgentVN"
$log = Join-Path $root "output\hidden-growth\android\admin-current-build.log"
$output = Join-Path $root "output\hidden-growth\android\admin-current-build-output.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
try {
    $elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Set-Content -LiteralPath $log -Value ("isElevated=" + $elevated) -Encoding utf8
    if (-not $elevated) { throw "管理员权限未生效" }
    Remove-Item -LiteralPath $output -Force -ErrorAction SilentlyContinue
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    & $node D:\AgentVN\scripts\hidden-growth-android-acceptance.cjs *> $output
    $exitCode = $LASTEXITCODE
    if (Test-Path -LiteralPath $output) { Get-Content -LiteralPath $output | Add-Content -LiteralPath $log }
    Add-Content -LiteralPath $log -Value ("exitCode=" + $exitCode)
    if ($exitCode -ne 0) { exit $exitCode }
} catch {
    Add-Content -LiteralPath $log -Value ("ERROR=" + $_.Exception.ToString())
    exit 1
}
