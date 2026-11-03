param(
    [Parameter(Mandatory = $true)][string]$RuntimeRoot,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RuntimeRoot = [System.IO.Path]::GetFullPath($RuntimeRoot)
$LogPath = [System.IO.Path]::GetFullPath($LogPath)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null

function Write-Log {
    param([string]$Message)
    Add-Content -LiteralPath $LogPath -Value ("[{0}] {1}" -f (Get-Date -Format o), $Message) -Encoding UTF8
}

function Get-ProcessTree {
    param([int]$RootPid)
    $all = @(Get-CimInstance Win32_Process)
    $seen = [System.Collections.Generic.HashSet[int]]::new()
    $queue = [System.Collections.Generic.Queue[int]]::new()
    [void]$seen.Add($RootPid)
    $queue.Enqueue($RootPid)
    $rows = @()
    while ($queue.Count -gt 0) {
        $parent = $queue.Dequeue()
        foreach ($item in $all | Where-Object { $_.ParentProcessId -eq $parent }) {
            if ($seen.Add([int]$item.ProcessId)) {
                $queue.Enqueue([int]$item.ProcessId)
                $rows += [ordered]@{
                    pid = [int]$item.ProcessId
                    parentPid = [int]$item.ParentProcessId
                    name = [string]$item.Name
                    commandLine = [string]$item.CommandLine
                }
            }
        }
    }
    return $rows
}

$stdoutPath = "$LogPath.stdout"
$stderrPath = "$LogPath.stderr"
Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

$env:ANDROID_SDK_ROOT = "C:\Users\1\AppData\Local\AgentVN\AndroidToolchain\Sdk"
$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
$env:JAVA_HOME = "C:\Users\1\AppData\Local\AgentVN\AndroidToolchain\jdk-17"
$env:GRADLE_USER_HOME = "C:\Users\1\AppData\Local\AgentVN\GradleHome"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_SDK_ROOT\platform-tools;$env:Path"

$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = "C:\Program Files\nodejs\npm.cmd"
$startInfo.Arguments = "run tauri -- android build --apk --ci --verbose"
$startInfo.WorkingDirectory = $RuntimeRoot
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $startInfo
$process.Start() | Out-Null
Write-Log "started pid=$($process.Id) runtimeRoot=$RuntimeRoot elevated=$(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"

$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$lastTree = ""
while (-not $process.HasExited -and (Get-Date) -lt $deadline) {
    $tree = @(Get-ProcessTree -RootPid $process.Id)
    $treeJson = $tree | ConvertTo-Json -Compress -Depth 5
    if ($treeJson -ne $lastTree) {
        Write-Log "processTree=$treeJson"
        $lastTree = $treeJson
    }
    Start-Sleep -Seconds 2
}

$timedOut = -not $process.HasExited
if ($timedOut) {
    Write-Log "timeout=true"
    & taskkill.exe /PID $process.Id /T /F | Out-Null
    $process.WaitForExit()
}

$stdout = $stdoutTask.GetAwaiter().GetResult()
$stderr = $stderrTask.GetAwaiter().GetResult()
[System.IO.File]::WriteAllText($stdoutPath, $stdout, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($stderrPath, $stderr, [System.Text.UTF8Encoding]::new($false))
Write-Log "exitCode=$($process.ExitCode) timedOut=$timedOut stdoutBytes=$([Text.Encoding]::UTF8.GetByteCount($stdout)) stderrBytes=$([Text.Encoding]::UTF8.GetByteCount($stderr))"

if ($timedOut) {
    exit 124
}
exit $process.ExitCode
