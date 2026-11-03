param(
  [Parameter(Mandatory = $true)]
  [string]$RuntimeRoot,
  [Parameter(Mandatory = $true)]
  [string]$DiagnosticsDir,
  [string]$ReleaseIdentityBase64 = "",
  [ValidateSet("prebuild", "postbuild", "failure")]
  [string]$Phase = "prebuild"
)

$ErrorActionPreference = "Stop"

function Write-Utf8JsonAtomic {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][object]$Value
  )
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $temporary = "$Path.tmp-$([guid]::NewGuid().ToString('N'))"
  $json = $Value | ConvertTo-Json -Depth 20
  [System.IO.File]::WriteAllText(
    $temporary,
    "$json`n",
    (New-Object System.Text.UTF8Encoding($false))
  )
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Read-StrictUtf8Text {
  param([Parameter(Mandatory = $true)][string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if (
    ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or
    ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF)
  ) {
    throw "ENCODING_INVALID: UTF-16 input is not allowed: $Path"
  }
  $encoding = New-Object System.Text.UTF8Encoding($false, $true)
  try {
    $text = $encoding.GetString($bytes)
  } catch {
    throw "ENCODING_INVALID: invalid UTF-8 input $Path / $($_.Exception.Message)"
  }
  if ($text.Contains([char]0xFFFD)) {
    throw "ENCODING_INVALID: replacement character found in $Path"
  }
  return $text.TrimStart([char]0xFEFF)
}

function Test-XmlFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  try {
    $settings = New-Object System.Xml.XmlReaderSettings
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [System.Xml.XmlReader]::Create($Path, $settings)
    try {
      while ($reader.Read()) {}
    } finally {
      $reader.Dispose()
    }
    return [ordered]@{
      ok = $true
      error = ""
      line = 0
      position = 0
    }
  } catch [System.Xml.XmlException] {
    return [ordered]@{
      ok = $false
      error = $_.Exception.Message
      line = [int]$_.Exception.LineNumber
      position = [int]$_.Exception.LinePosition
    }
  } catch {
    return [ordered]@{
      ok = $false
      error = $_.Exception.Message
      line = 0
      position = 0
    }
  }
}

function Get-Sha256Hex {
  param([Parameter(Mandatory = $true)][string]$Path)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $algorithm.Dispose()
  }
}

function Get-ReleaseIdentity {
  if ([string]::IsNullOrWhiteSpace($ReleaseIdentityBase64)) {
    return [ordered]@{}
  }
  try {
    $bytes = [Convert]::FromBase64String($ReleaseIdentityBase64)
    $text = (New-Object System.Text.UTF8Encoding($false, $true)).GetString($bytes)
    return ($text.TrimStart([char]0xFEFF) | ConvertFrom-Json)
  } catch {
    throw "RELEASE_METADATA_INVALID: release identity is not strict UTF-8 JSON: $($_.Exception.Message)"
  }
}

$reportPath = Join-Path $DiagnosticsDir "android-generated-project-diagnostics.json"
$healthPath = Join-Path $DiagnosticsDir "android-generated-project-health.json"
$runtimeRootResolved = [System.IO.Path]::GetFullPath($RuntimeRoot)
$diagnosticsResolved = [System.IO.Path]::GetFullPath($DiagnosticsDir)
$files = @(
  [ordered]@{
    name = "settings.gradle"
    path = Join-Path $runtimeRootResolved "src-tauri\gen\android\settings.gradle"
    kind = "text"
    required = $true
  },
  [ordered]@{
    name = "tauri.settings.gradle"
    path = Join-Path $runtimeRootResolved "src-tauri\gen\android\tauri.settings.gradle"
    kind = "text"
    required = $true
  },
  [ordered]@{
    name = "root-build.gradle.kts"
    path = Join-Path $runtimeRootResolved "src-tauri\gen\android\build.gradle.kts"
    kind = "text"
    required = $true
  },
  [ordered]@{
    name = "AndroidManifest.xml"
    path = Join-Path $runtimeRootResolved "src-tauri\gen\android\app\src\main\AndroidManifest.xml"
    kind = "xml"
    required = $true
  },
  [ordered]@{
    name = "tauri.build.gradle.kts"
    path = Join-Path $runtimeRootResolved "src-tauri\gen\android\app\tauri.build.gradle.kts"
    kind = "text"
    required = $true
  },
  [ordered]@{
    name = "strings.xml"
    path = Join-Path $runtimeRootResolved "src-tauri\gen\android\app\src\main\res\values\strings.xml"
    kind = "xml"
    required = $true
  },
  [ordered]@{
    name = "gradlew"
    path = Join-Path $runtimeRootResolved "src-tauri\gen\android\gradlew"
    kind = "text"
    required = $true
  },
  [ordered]@{
    name = "gradlew.bat"
    path = Join-Path $runtimeRootResolved "src-tauri\gen\android\gradlew.bat"
    kind = "text"
    required = $true
  },
  [ordered]@{
    name = "gradle-wrapper.jar"
    path = Join-Path $runtimeRootResolved "src-tauri\gen\android\gradle\wrapper\gradle-wrapper.jar"
    kind = "binary"
    required = $true
  },
  [ordered]@{
    name = "gradle-wrapper.properties"
    path = Join-Path $runtimeRootResolved "src-tauri\gen\android\gradle\wrapper\gradle-wrapper.properties"
    kind = "text"
    required = $true
  },
  [ordered]@{
    name = "build.gradle.kts"
    path = Join-Path $runtimeRootResolved "src-tauri\gen\android\app\build.gradle.kts"
    kind = "text"
    required = $true
  },
  [ordered]@{
    name = "tauri.properties"
    path = Join-Path $runtimeRootResolved "src-tauri\gen\android\app\tauri.properties"
    kind = "text"
    required = $true
  },
  [ordered]@{
    name = "tauri.conf.json"
    path = Join-Path $runtimeRootResolved "src-tauri\tauri.conf.json"
    kind = "json"
    required = $true
  },
  [ordered]@{
    name = "merged-AndroidManifest.xml"
    path = Join-Path $runtimeRootResolved "src-tauri\gen\android\app\build\intermediates\merged_manifests\universalRelease\processUniversalReleaseMainManifest\AndroidManifest.xml"
    kind = "xml"
    required = $false
  },
  [ordered]@{
    name = "manifest-merger-blame-file.txt"
    path = Join-Path $runtimeRootResolved "src-tauri\gen\android\app\build\intermediates\manifest_merge_blame_file\universalRelease\processUniversalReleaseMainManifest\manifest-merger-blame-file.txt"
    kind = "text"
    required = $false
  }
)

$deferredFiles = @(
  "tauri.settings.gradle",
  "tauri.build.gradle.kts",
  "tauri.properties"
)
$prebuildOptionalFiles = @(
  "tauri.settings.gradle",
  "tauri.build.gradle.kts"
)
$requiredStage = if ($Phase -eq "prebuild") { "bootstrap" } else { "full" }
foreach ($file in $files) {
  if ($Phase -eq "prebuild" -and $prebuildOptionalFiles -contains [string]$file.name) {
    $file.required = $false
  }
}

$copiedFiles = New-Object System.Collections.Generic.List[object]
$missingFiles = New-Object System.Collections.Generic.List[string]
$missingRequiredFiles = New-Object System.Collections.Generic.List[string]
$xmlValidation = [ordered]@{
  manifest = [ordered]@{ ok = $false; error = "not checked"; line = 0; position = 0 }
  strings = [ordered]@{ ok = $false; error = "not checked"; line = 0; position = 0 }
}
$status = "PASS"
$failureCode = $null
$message = "Android generated project metadata is valid."
$releaseIdentity = [ordered]@{}
$generatedProjectHealth = $null

try {
  New-Item -ItemType Directory -Force -Path $diagnosticsResolved | Out-Null
  $releaseIdentity = Get-ReleaseIdentity
  if (Test-Path -LiteralPath $healthPath -PathType Leaf) {
    try {
      $generatedProjectHealth = (Read-StrictUtf8Text -Path $healthPath) | ConvertFrom-Json
      if (-not [bool]$generatedProjectHealth.finalProjectComplete) {
        $status = "FAIL"
        $failureCode = [string]$generatedProjectHealth.failureCode
        $message = [string]$generatedProjectHealth.message
      }
    } catch {
      $status = "FAIL"
      $failureCode = "ANDROID_BUILD_DIAGNOSTICS_CAPTURE_FAILED"
      $message = "Generated Android project health report is invalid: $($_.Exception.Message)"
    }
  }
  $applicationId = [string]$releaseIdentity.androidApplicationId
  if ($applicationId -notmatch '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$') {
    throw "RELEASE_METADATA_INVALID: release identity contains an invalid Android application id."
  }
  $files += [ordered]@{
    name = "MainActivity.kt"
    path = Join-Path $runtimeRootResolved (
      "src-tauri\gen\android\app\src\main\java\" +
      ($applicationId -replace '\.', '\') +
      "\MainActivity.kt"
    )
    kind = "kotlin"
    required = $true
  }
  foreach ($file in $files) {
    $source = [System.IO.Path]::GetFullPath([string]$file.path)
    $destination = Join-Path $diagnosticsResolved ("android-generated-" + [string]$file.name)
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
      $missingFiles.Add([string]$file.name) | Out-Null
      if ([bool]$file.required) {
        $missingRequiredFiles.Add([string]$file.name) | Out-Null
        $status = "FAIL"
        if (-not $failureCode) {
          $failureCode = "ANDROID_GENERATED_PROJECT_INCOMPLETE"
          $message = "Generated Android project file is missing: $source"
        }
      }
      continue
    }
    $text = if ($file.kind -eq "binary") { $null } else { Read-StrictUtf8Text -Path $source }
    if ($file.kind -eq "json") {
      try {
        $null = $text | ConvertFrom-Json
      } catch {
        $status = "FAIL"
        $failureCode = "ANDROID_GENERATED_JSON_INVALID"
        $message = "Generated Android JSON is invalid: $source / $($_.Exception.Message)"
      }
    }
    if ($file.kind -eq "xml") {
      $validation = Test-XmlFile -Path $source
      if ($file.name -eq "AndroidManifest.xml") { $xmlValidation.manifest = $validation }
      if ($file.name -eq "strings.xml") { $xmlValidation.strings = $validation }
      if (-not $validation.ok) {
        $status = "FAIL"
        $failureCode = "ANDROID_MANIFEST_INVALID"
        $message = "Generated Android XML is invalid: $source / $($validation.error)"
      }
    }
    Copy-Item -LiteralPath $source -Destination $destination -Force
    $copiedFiles.Add([ordered]@{
      name = [string]$file.name
      kind = [string]$file.kind
      sourcePath = $source
      diagnosticPath = $destination
      bytes = [int64](Get-Item -LiteralPath $source).Length
      sha256 = Get-Sha256Hex -Path $source
    }) | Out-Null
  }
} catch {
  $status = "FAIL"
  if (-not $failureCode) {
    $failureCode = if ($_.Exception.Message -match "^([A-Z][A-Z0-9_]+):") {
      $Matches[1]
    } else {
      "ANDROID_BUILD_DIAGNOSTICS_CAPTURE_FAILED"
    }
  }
  $message = $_.Exception.Message
}

$report = [ordered]@{
  schemaVersion = 1
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  phase = $Phase
  requiredStage = $requiredStage
  status = $status
  failureCode = $failureCode
  message = $message
  runtimeRoot = $runtimeRootResolved
  diagnosticsDir = $diagnosticsResolved
  powershellVersion = $PSVersionTable.PSVersion.ToString()
  releaseIdentity = $releaseIdentity
  files = @($copiedFiles.ToArray())
  missingFiles = @($missingFiles.ToArray())
  missingRequiredFiles = @($missingRequiredFiles.ToArray())
  deferredFiles = $deferredFiles
  deferredFilesMissing = @(
    $missingFiles.ToArray() | Where-Object { $deferredFiles -contains $_ }
  )
  prebuildOptionalFiles = $prebuildOptionalFiles
  xmlValidation = $xmlValidation
  generatedProjectHealth = $generatedProjectHealth
}

try {
  Write-Utf8JsonAtomic -Path $reportPath -Value $report
} catch {
  Write-Error $_.Exception.Message
  exit 3
}

if ($status -eq "PASS") { exit 0 }
exit 2
