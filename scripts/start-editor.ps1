$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\\editor")
$env:VITE_BACKEND_URL = "http://127.0.0.1:8278"
npm run dev
