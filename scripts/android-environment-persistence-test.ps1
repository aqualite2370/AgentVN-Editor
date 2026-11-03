$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot 'setup-android-build-env.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Environment setup script does not parse.' }
$setter = $ast.Find({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Set-ToolEnv'
}, $true)
if (-not $setter) { throw 'Missing production Set-ToolEnv.' }
# Replace only the OS persistence boundary; execute the production control flow.
# Never write real user environment variables in this regression test.
Add-Type @'
public static class AgentVNEnvironmentPersistenceSpy {
    public static int Writes;
    public static void SetEnvironmentVariable(string name, string value, string target) {
        if (target != "User") throw new System.Exception("Unexpected persistence target");
        Writes++;
    }
}
'@
. ([scriptblock]::Create($setter.Extent.Text.Replace('[Environment]', '[AgentVNEnvironmentPersistenceSpy]')))
$testName = 'AGENTVN_ENV_PERSISTENCE_REGRESSION'
$previous = [Environment]::GetEnvironmentVariable($testName, 'Process')
$cases = @(
    @{ install=$false; noPersist=$false; expected=0 },
    @{ install=$false; noPersist=$true; expected=0 },
    @{ install=$true; noPersist=$false; expected=1 },
    @{ install=$true; noPersist=$true; expected=0 }
)
try {
    foreach ($case in $cases) {
        $Install = $case.install
        $NoPersistEnv = $case.noPersist
        [AgentVNEnvironmentPersistenceSpy]::Writes = 0
        Set-ToolEnv $testName 'toolchain-test'
        if ([Environment]::GetEnvironmentVariable($testName, 'Process') -ne 'toolchain-test') {
            throw 'Toolchain variables must remain available to the current process.'
        }
        if ([AgentVNEnvironmentPersistenceSpy]::Writes -ne $case.expected) {
            throw "Unexpected user environment write: Install=$Install NoPersistEnv=$NoPersistEnv expected=$($case.expected) actual=$([AgentVNEnvironmentPersistenceSpy]::Writes)"
        }
    }
    Write-Host 'PASS 4 production environment persistence cases; checks are process-local, explicit repair persists.'
} finally {
    [Environment]::SetEnvironmentVariable($testName, $previous, 'Process')
}
