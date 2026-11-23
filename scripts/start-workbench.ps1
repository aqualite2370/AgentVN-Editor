$ErrorActionPreference = "Stop"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "..\start-dev.ps1") @args
exit $LASTEXITCODE
