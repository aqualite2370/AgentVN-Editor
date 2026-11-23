param(
    [Parameter(Mandatory = $true)]
    [string[]]$Path
)

$ErrorActionPreference = "Stop"

foreach ($Candidate in $Path) {
    $Resolved = Resolve-Path -LiteralPath $Candidate -ErrorAction Stop
    $Bytes = [System.IO.File]::ReadAllBytes($Resolved.Path)
    if ($Bytes.Length -lt 64 -or $Bytes[0] -ne 0x4D -or $Bytes[1] -ne 0x5A) {
        throw "Not a Windows PE executable: $($Resolved.Path)"
    }

    $PeOffset = [System.BitConverter]::ToInt32($Bytes, 0x3C)
    if (
        $PeOffset -lt 0 -or
        $PeOffset + 96 -ge $Bytes.Length -or
        $Bytes[$PeOffset] -ne 0x50 -or
        $Bytes[$PeOffset + 1] -ne 0x45 -or
        $Bytes[$PeOffset + 2] -ne 0x00 -or
        $Bytes[$PeOffset + 3] -ne 0x00
    ) {
        throw "Invalid Windows PE signature: $($Resolved.Path)"
    }

    $OptionalHeaderOffset = $PeOffset + 24
    $Subsystem = [System.BitConverter]::ToUInt16($Bytes, $OptionalHeaderOffset + 68)
    if ($Subsystem -ne 2) {
        throw "Executable uses PE subsystem $Subsystem instead of WINDOWS_GUI (2): $($Resolved.Path)"
    }

    Write-Host "[AgentVN] WINDOWS_GUI verified: $($Resolved.Path)" -ForegroundColor Green
}
