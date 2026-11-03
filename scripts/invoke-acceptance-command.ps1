function Invoke-AcceptanceNativeCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$LogPath
  )
  $resolvedCommand = (Get-Command $FilePath -ErrorAction Stop).Source
  $previousErrorActionPreference = $ErrorActionPreference
  $previousNativeExitCode = $global:LASTEXITCODE
  try {
    # Windows PowerShell promotes redirected stderr to NativeCommandError.
    # A failing test must still return its exit code so the caller can read
    # the authoritative report (including successful cleanup) before throwing.
    $ErrorActionPreference = "Continue"
    $global:LASTEXITCODE = $null
    & $resolvedCommand @Arguments *>> $LogPath
    if ($null -eq $global:LASTEXITCODE) { throw "NATIVE_COMMAND_DID_NOT_START: $FilePath" }
    return [int]$global:LASTEXITCODE
  } finally {
    $global:LASTEXITCODE = $previousNativeExitCode
    $ErrorActionPreference = $previousErrorActionPreference
  }
}
