function Get-E2WprProfileSpec {
    [CmdletBinding()]
    param(
        [string]$ProfileName,
        [string]$ProfileFile
    )

    if ([string]::IsNullOrWhiteSpace($ProfileFile)) {
        if ([string]::IsNullOrWhiteSpace($ProfileName)) {
            return 'GPU'
        }
        return $ProfileName.Trim()
    }

    if ([string]::IsNullOrWhiteSpace($ProfileName)) {
        throw 'A profile name is required when a custom WPR profile file is supplied.'
    }

    $resolvedProfileFile = (Resolve-Path -LiteralPath $ProfileFile -ErrorAction Stop).Path
    return "$resolvedProfileFile!$($ProfileName.Trim())"
}

Export-ModuleMember -Function Get-E2WprProfileSpec
