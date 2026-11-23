param(
  [ValidateSet("ensure", "sign", "verify")][string]$Action = "ensure",
  [string]$KeystorePath = "",
  [string]$ApkPath = "",
  [string]$OutputPath = "",
  [string]$KeyAlias = "agentvn-release",
  [string]$ReportPath = "",
  [switch]$Json
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$securityModule = Join-Path $PSHOME "Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1"
if (-not (Test-Path -LiteralPath $securityModule -PathType Leaf)) {
  throw "ANDROID_SIGNING_SECURITY_MODULE_MISSING: Microsoft.PowerShell.Security was not found: $securityModule"
}
Import-Module -Name $securityModule -Force -ErrorAction Stop
$defaultSigningDir = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".agentvn\signing"
if ([string]::IsNullOrWhiteSpace($KeystorePath)) { $KeystorePath = Join-Path $defaultSigningDir "agentvn-release.jks" }
$KeystorePath = [System.IO.Path]::GetFullPath($KeystorePath)
$PasswordFile = "$KeystorePath.password.dpapi"

function Fail([string]$message) { throw $message }
function Resolve-Tool([string]$name) {
  $command = Get-Command $name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  if ($name -eq "keytool") {
    $candidate = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME "bin\keytool.exe" } else { "" }
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}
function Resolve-ApkSigner {
  $sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "" }
  if ($sdk) {
    $candidate = Get-ChildItem (Join-Path $sdk "build-tools") -Recurse -Filter "apksigner.bat" -File -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }
  return Resolve-Tool "apksigner"
}
function Protect-Secret([string]$secret) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $PasswordFile) | Out-Null
  $secure = ConvertTo-SecureString $secret -AsPlainText -Force
  $secure | ConvertFrom-SecureString | Set-Content -LiteralPath $PasswordFile -Encoding ASCII
  # DPAPI binds this file to the current Windows user. Avoid a localized
  # icacls invocation here: malformed ACL syntax must never abort packaging.
}
function Read-ProtectedSecret {
  if (-not (Test-Path -LiteralPath $PasswordFile)) { return $null }
  # Set-Content appends a line ending. ConvertTo-SecureString expects only the
  # DPAPI hexadecimal payload and rejects the trailing CRLF as malformed.
  $protectedText = (Get-Content -LiteralPath $PasswordFile -Raw).Trim()
  if ([string]::IsNullOrWhiteSpace($protectedText)) { return $null }
  try {
    $secure = $protectedText | ConvertTo-SecureString
  } catch {
    throw "ANDROID_SIGNING_PASSWORD_INVALID: The protected Android signing password could not be decrypted."
  }
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Get-Secret {
  $fromEnv = $env:AGENTVN_ANDROID_KEYSTORE_PASSWORD
  if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
    Protect-Secret $fromEnv
  } else {
    $fromEnv = Read-ProtectedSecret
  }
  if ([string]::IsNullOrWhiteSpace($fromEnv) -and $Action -eq "ensure") {
    $fromEnv = "AgentVN-" + [guid]::NewGuid().ToString("N") + "-" + [guid]::NewGuid().ToString("N")
    Protect-Secret $fromEnv
  }
  if ([string]::IsNullOrWhiteSpace($fromEnv)) { Fail "Android signing password is unavailable. Set AGENTVN_ANDROID_KEYSTORE_PASSWORD or restore the protected password file." }
  return $fromEnv
}
function Run-Tool([string]$tool, [string[]]$arguments) {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # keytool writes normal success details to stderr. Keep native stderr in
    # the captured output and decide success exclusively from its exit code.
    $ErrorActionPreference = "Continue"
    $output = @(& $tool @arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $text = ($output | Out-String)
  if ($exitCode -ne 0) { Fail "Android signing tool failed: $([System.IO.Path]::GetFileName($tool))" }
  return $text
}
function Find-CertificateSha256([string]$text) {
  $match = [regex]::Match($text, "(?im)certificate SHA-256 digest:[ ]*([0-9A-F:]+)")
  if ($match.Success) { return $match.Groups[1].Value.ToUpperInvariant() }
  return $null
}

$keytool = Resolve-Tool "keytool"
$secret = Get-Secret
if (-not (Test-Path -LiteralPath $KeystorePath)) {
  if (-not $keytool) { Fail "keytool is required to create the Android release keystore." }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $KeystorePath) | Out-Null
  $dname = "CN=AgentVN Player, OU=AgentVN, O=AgentVN, L=Local, ST=Local, C=CN"
  Run-Tool $keytool @("-genkeypair", "-v", "-keystore", $KeystorePath, "-storetype", "JKS", "-alias", $KeyAlias, "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-storepass", $secret, "-keypass", $secret, "-dname", $dname) | Out-Null
}
if (-not (Test-Path -LiteralPath $KeystorePath)) { Fail "Android release keystore was not created." }

$report = [ordered]@{ signed = $false; keystorePath = $KeystorePath; keyAlias = $KeyAlias; warnings = @(); checkedAt = (Get-Date).ToUniversalTime().ToString("o") }
if ($Action -eq "sign") {
  if ([string]::IsNullOrWhiteSpace($ApkPath) -or -not (Test-Path -LiteralPath $ApkPath)) { Fail "ApkPath does not exist." }
  if ([string]::IsNullOrWhiteSpace($OutputPath)) { Fail "OutputPath is required for signing." }
  $apksigner = Resolve-ApkSigner
  if (-not $apksigner) { Fail "apksigner is required to sign the Android release APK." }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
  Run-Tool $apksigner @("sign", "--ks", $KeystorePath, "--ks-key-alias", $KeyAlias, "--ks-pass", "pass:$secret", "--key-pass", "pass:$secret", "--out", $OutputPath, $ApkPath) | Out-Null
  $report.signed = $true
  $report.apkPath = [System.IO.Path]::GetFullPath($OutputPath)
}
if ($Action -eq "verify" -or $Action -eq "sign") {
  $verifyApk = if ($Action -eq "sign") { $OutputPath } else { $ApkPath }
  if ([string]::IsNullOrWhiteSpace($verifyApk) -or -not (Test-Path -LiteralPath $verifyApk)) { Fail "APK path does not exist for verification." }
  $apksigner = Resolve-ApkSigner
  if (-not $apksigner) { Fail "apksigner is required to verify the Android release APK." }
  $verification = Run-Tool $apksigner @("verify", "--verbose", "--print-certs", $verifyApk)
  if ($verification -notmatch "Verified using v[123] scheme") { Fail "Android APK signature verification did not report a v1/v2/v3 signature." }
  $report.signed = $true
  $report.apkPath = [System.IO.Path]::GetFullPath($verifyApk)
  $report.certificateSha256 = Find-CertificateSha256 $verification
  if (-not $report.certificateSha256) { $report.warnings += "Certificate SHA-256 fingerprint was not returned by apksigner." }
}

$jsonText = $report | ConvertTo-Json -Depth 6
if (-not [string]::IsNullOrWhiteSpace($ReportPath)) {
  $resolvedReportPath = [System.IO.Path]::GetFullPath($ReportPath)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedReportPath) | Out-Null
  $temporaryReportPath = "$resolvedReportPath.tmp-$([guid]::NewGuid().ToString('N'))"
  [System.IO.File]::WriteAllText($temporaryReportPath, "$jsonText`n", (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryReportPath -Destination $resolvedReportPath -Force
}
if ($Json) { Write-Output $jsonText } else { Write-Output $jsonText }
