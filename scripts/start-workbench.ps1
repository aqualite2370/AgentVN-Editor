$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot ".."
Start-Process powershell -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File",(Join-Path $PSScriptRoot "start-backend.ps1")
Set-Location (Join-Path $root "editor")
$env:VITE_BACKEND_URL = "http://127.0.0.1:8278"
npm run dev
