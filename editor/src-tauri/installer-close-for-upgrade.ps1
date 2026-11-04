param([string]$InstallDirectory)
$ErrorActionPreference='Stop'

function ConvertTo-AgentVNUpgradePath([string]$Value){
    if([string]::IsNullOrWhiteSpace($Value)){throw 'UPGRADE_IDENTITY_UNAVAILABLE: Process path is unavailable. Close AgentVN Editor manually and retry.'}
    if($Value.StartsWith('\\?\')){$Value=$Value.Substring(4)}
    [IO.Path]::GetFullPath($Value).TrimEnd('\')
}

function Request-AgentVNUpgradeClose($Expected){
    $process=Get-Process -Id $Expected.ProcessId -ErrorAction SilentlyContinue
    if(!$process){return}
    try{
        $null=$process.Handle
        if($process.HasExited){return}
        $expectedTime=([DateTime]$Expected.CreationDate).ToUniversalTime()
        if([Math]::Abs(($process.StartTime.ToUniversalTime()-$expectedTime).Ticks) -ge 10){
            throw 'UPGRADE_IDENTITY_CHANGED: Process identity changed. Retry installation.'
        }
        if(!( $process.CloseMainWindow() )){
            if(!$process.HasExited){
                throw 'UPGRADE_CLOSE_UNAVAILABLE: Close AgentVN Editor manually, then retry installation.'
            }
        }
    }finally{$process.Dispose()}
}

function Wait-AgentVNUpgradeShutdown(
    [Parameter(Mandatory=$true)][string]$InstallDirectory,
    [ValidateRange(1,180)][int]$TimeoutSeconds=45,
    [scriptblock]$ReadProcesses={Get-CimInstance Win32_Process -Filter "Name='agentvn-editor.exe' OR Name='AgentVN Editor.exe' OR Name='creator-backend.exe'"},
    [scriptblock]$RequestClose={param($p) Request-AgentVNUpgradeClose $p},
    [scriptblock]$Delay={param($ms) Start-Sleep -Milliseconds $ms},
    [scriptblock]$Clock={[DateTime]::UtcNow}
){
    $directory=ConvertTo-AgentVNUpgradePath $InstallDirectory
    if($directory -eq [IO.Path]::GetPathRoot($directory).TrimEnd('\')){
        throw 'UPGRADE_DIRECTORY_INVALID: An application installation directory is required.'
    }
    $deadline=(& $Clock).AddSeconds($TimeoutSeconds)
    $requested=@{};$idle=0
    while($true){
        $owned=@(foreach($row in @(& $ReadProcesses)){
            if($row.Name -notin @('agentvn-editor.exe','AgentVN Editor.exe','creator-backend.exe')){continue}
            $processPath=ConvertTo-AgentVNUpgradePath $row.ExecutablePath
            if([IO.Path]::GetDirectoryName($processPath) -ieq $directory){$row}
        })
        if($owned.Count -eq 0){
            $idle++
            # Check again after process cleanup, so a replacement host is not
            # mistaken for a completed shutdown.
            if($idle -ge 2){return @{status='PASS';requested=@($requested.Keys);forced=0;directory=$directory}}
        }else{
            $idle=0
            foreach($row in $owned){
                if($row.Name -ieq 'creator-backend.exe'){continue}
                $identity=([string]$row.ProcessId)+':'+([DateTime]$row.CreationDate).ToUniversalTime().ToString('o')
                if(!$requested.ContainsKey($identity)){
                    & $RequestClose $row
                    $requested[$identity]=$true
                }
            }
        }
        if((& $Clock) -ge $deadline){
            throw 'UPGRADE_CLOSE_TIMEOUT: AgentVN Editor or its backend is still running. Finish any save or confirmation, close the application, then retry. No files have been overwritten.'
        }
        & $Delay 500
    }
}

if($MyInvocation.InvocationName -ne '.'){
    try{
        Wait-AgentVNUpgradeShutdown -InstallDirectory $InstallDirectory|ConvertTo-Json -Compress
        exit 0
    }catch{
        [Console]::Error.WriteLine($_.Exception.Message)
        exit 1
    }
}
