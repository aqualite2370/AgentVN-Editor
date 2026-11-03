# Dot-sourced by the elevated acceptance entry. No device mutation on import.
function Write-AndroidBootEvidence($Context) {
  [IO.File]::WriteAllText((Join-Path $Context.outputDir 'cold-boot.json'), ($Context | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
}

function Invoke-AndroidBootAdb($Context, [string[]]$NativeArgs) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $text = & $Context.adb '-P' ([string]$Context.adbPort) '-s' $Context.serial @NativeArgs 2>&1
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { throw "ADB_EXIT_${code}: $($text -join [Environment]::NewLine)" }
  return ($text -join "`n").Trim()
}

function Test-AndroidOwnedProcess($Expected, $Actual) {
  $expectedCreated = if ($Expected.CreationDate -is [DateTime]) { $Expected.CreationDate.ToUniversalTime() } else { [Management.ManagementDateTimeConverter]::ToDateTime([string]$Expected.CreationDate).ToUniversalTime() }
  $actualCreated = if ($Actual.CreationDate -is [DateTime]) { $Actual.CreationDate.ToUniversalTime() } else { [Management.ManagementDateTimeConverter]::ToDateTime([string]$Actual.CreationDate).ToUniversalTime() }
  $expectedName = if ([string]$Expected.CommandLine -match '(?i)(emulator|qemu-system-x86_64)\.exe') { $Matches[1] + '.exe' } else { '' }
  $actualName = [string]$Actual.Name
  $commandMatches = [string]::IsNullOrWhiteSpace([string]$Actual.CommandLine) -or
    [string]::Equals(([string]$Expected.CommandLine).Trim(), ([string]$Actual.CommandLine).Trim(), [StringComparison]::Ordinal)
  return $null -ne $Actual -and $Expected.ProcessId -eq $Actual.ProcessId -and
    [Math]::Abs(($expectedCreated - $actualCreated).TotalMilliseconds) -lt 2 -and $commandMatches -and
    ($expectedName -eq '' -or [string]::Equals($expectedName, $actualName, [StringComparison]::OrdinalIgnoreCase))
}

function Assert-AndroidBootPorts([int[]]$Ports) {
  if (@($Ports | Select-Object -Unique).Count -ne $Ports.Count) { throw 'ANDROID_PORTS_MUST_BE_DISTINCT' }
  foreach ($port in $Ports) {
    if ($port -lt 1024 -or $port -gt 65535) { throw "INVALID_PORT:$port" }
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "PORT_OCCUPIED:$port" }
  }
}

function Get-AndroidAcceptanceMediaVolume($Context) {
  $audio = Invoke-AndroidBootAdb $Context @('shell','dumpsys','audio')
  $blockMatch = [regex]::Match($audio, '(?ms)- STREAM_MUSIC:(.*?)(?=\r?\n- STREAM_|\z)')
  $streamMatch = if ($blockMatch.Success) { [regex]::Match($blockMatch.Groups[1].Value, '(?m)^\s*streamVolume:\s*(\d+)\s*$') } else { $null }
  $speakerMatch = if ($blockMatch.Success) { [regex]::Match($blockMatch.Groups[1].Value, '\(speaker\):\s*(\d+)') } else { $null }
  if (-not $blockMatch.Success -or -not $streamMatch.Success -or -not $speakerMatch.Success) {
    $Context.audioVolumeParseFailure = $audio
    throw 'ANDROID_STREAM_MUSIC_VOLUME_UNAVAILABLE'
  }
  return [ordered]@{
    stream = 'STREAM_MUSIC'
    streamId = 3
    streamVolume = [int]$streamMatch.Groups[1].Value
    speakerVolume = [int]$speakerMatch.Groups[1].Value
    rawSha256 = [BitConverter]::ToString(
      [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($audio))
    ).Replace('-', '').ToLowerInvariant()
  }
}

function Set-AndroidAcceptanceMediaVolume($Context, [int]$Target = 15) {
  $before = Get-AndroidAcceptanceMediaVolume $Context
  $Context.audioVolumeBefore = $before
  $Context.audioVolumeTarget = $Target
  if ($Target -lt 0 -or $Target -gt 15) { throw "ANDROID_STREAM_MUSIC_VOLUME_TARGET_INVALID:$Target" }
  $commandOutput = Invoke-AndroidBootAdb $Context @('shell','cmd','media_session','volume','--stream','3','--set',[string]$Target)
  Start-Sleep -Milliseconds 750
  $after = Get-AndroidAcceptanceMediaVolume $Context
  if ($after.speakerVolume -ne $Target -or $after.streamVolume -ne $Target) {
    $settingsOutput = Invoke-AndroidBootAdb $Context @('shell','settings','put','system','volume_music',[string]$Target)
    $commandOutput = $commandOutput + "`nsettings put system volume_music $Target`n" + $settingsOutput
    Start-Sleep -Milliseconds 750
    $after = Get-AndroidAcceptanceMediaVolume $Context
    $Context.audioVolumeFallback = 'settings put system volume_music'
  }
  if ($after.speakerVolume -ne $Target -or $after.streamVolume -ne $Target) {
    for ($index = $after.speakerVolume; $index -lt $Target; $index += 1) {
      $keyOutput = Invoke-AndroidBootAdb $Context @('shell','input','keyevent','24')
      $commandOutput = $commandOutput + "`ninput keyevent 24`n" + $keyOutput
      Start-Sleep -Milliseconds 300
    }
    Start-Sleep -Milliseconds 750
    $after = Get-AndroidAcceptanceMediaVolume $Context
    $Context.audioVolumeFallback = 'input keyevent VOLUME_UP'
  }
  $Context.audioVolumeCommand = 'cmd media_session volume --stream 3 --set ' + $Target
  $Context.audioVolumeCommandOutput = $commandOutput
  $Context.audioVolumeAfter = $after
  if ($after.speakerVolume -ne $Target -or $after.streamVolume -ne $Target) {
    throw "ANDROID_STREAM_MUSIC_VOLUME_NOT_APPLIED:$($after.streamVolume)/$($after.speakerVolume)"
  }
}

function Start-AndroidAcceptanceBoot($Request, $Context) {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ANDROID_ADMIN_REQUIRED' }
  $Context.isElevated = $true
  $Context.status = 'STARTING'
  $Context.startedAt = (Get-Date).ToUniversalTime().ToString('o')
  $Context.outputDir = [IO.Path]::GetFullPath([string]$Request.outputDir)
  $Context.adb = Join-Path ([IO.Path]::GetFullPath([string]$Request.sdk)) 'platform-tools\adb.exe'
  $Context.adbPort = [int]$Request.coldBoot.adbPort
  $Context.serial = [string]$Request.serial
  $Context.avd = [string]$Request.coldBoot.avd
  $Context.coldBoot = $true
  $Context.audioEnabled = $true
  $Context.adbOwned = $false
  $Context.processes = @()
  $Context.emulatorCleanupStatus = 'NOT_RUN'
  if ($Context.serial -notmatch '^emulator-(\d+)$') { throw 'EMULATOR_SERIAL_REQUIRED' }
  $consolePort = [int]$Matches[1]
  if ($Context.avd -ne 'AgentVN_API35') { throw 'ANDROIDDEV_AVD_REQUIRED' }
  Assert-AndroidBootPorts @($consolePort, ($consolePort + 1), $Context.adbPort, [int]$Request.adbPort, [int]$Request.cdpPort, [int]$Request.coldBoot.grpcPort)
  # Protect all existing emulators; this entry creates an isolated owned boot.
  if (Get-Process -Name 'emulator','qemu-system-x86_64' -ErrorAction SilentlyContinue) { throw 'EXISTING_EMULATOR_PRESERVED' }
  $env:ANDROID_SDK_ROOT = [IO.Path]::GetFullPath([string]$Request.sdk)
  $env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
  $env:ANDROID_AVD_HOME = [IO.Path]::GetFullPath([string]$Request.coldBoot.avdHome)
  if (-not (Test-Path -LiteralPath $env:ANDROID_AVD_HOME -PathType Container)) { throw 'AVD_HOME_MISSING' }
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $acceleration = & (Join-Path $env:ANDROID_SDK_ROOT 'emulator\emulator-check.exe') accel 2>&1
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  $Context.acceleration = $acceleration -join "`n"
  if ($code -ne 0) { throw 'ANDROID_ACCELERATION_UNAVAILABLE' }
  $Context.arguments = @('-avd',$Context.avd,'-port',[string]$consolePort,'-no-snapshot','-no-boot-anim','-gpu','swiftshader_indirect','-accel','on','-grpc',[string]$Request.coldBoot.grpcPort,'-grpc-use-token')
  $launcher = Start-Process -FilePath (Join-Path $env:ANDROID_SDK_ROOT 'emulator\emulator.exe') -ArgumentList $Context.arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Context.outputDir 'emulator-stdout.log') -RedirectStandardError (Join-Path $Context.outputDir 'emulator-stderr.log')
  $Context.launcherPid = $launcher.Id
  $Context.processes = @(Get-CimInstance Win32_Process -Filter "ProcessId=$($launcher.Id)" | Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine)
  Write-AndroidBootEvidence $Context
  $Context.adbOwned = $true
  $deadline = (Get-Date).AddMinutes(5)
  do {
    $completed = ''
    try {
      $device = Invoke-AndroidBootAdb $Context @('get-state')
      $completed = Invoke-AndroidBootAdb $Context @('shell','getprop','sys.boot_completed')
    } catch { $Context.lastBootError = $_.Exception.Message }
    if ((Get-Date) -gt $deadline) { throw 'EMULATOR_BOOT_TIMEOUT' }
    if ($completed -ne '1') { Start-Sleep -Seconds 2 }
  } until ($device -eq 'device' -and $completed -eq '1')
  $Context.deviceState = $device
  $Context.bootId = Invoke-AndroidBootAdb $Context @('shell','cat','/proc/sys/kernel/random/boot_id')
  $Context.processes = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $launcher.Id -or ($_.ParentProcessId -eq $launcher.Id -and $_.Name -eq 'qemu-system-x86_64.exe') } | Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine)
  $discoveryRoot = [IO.Path]::GetFullPath([string]$Request.coldBoot.discoveryRoot)
  $discoveries = @(Get-ChildItem -LiteralPath $discoveryRoot -Filter 'pid_*.ini' | Where-Object {
    $content = [IO.File]::ReadAllText($_.FullName)
    $discoveryPid = [int]([regex]::Match($_.Name,'pid_(\d+)').Groups[1].Value)
    $content -match ('(?m)^avd.name=' + [regex]::Escape($Context.avd) + '\r?$') -and
      $content -match ('(?m)^port.serial=' + $consolePort + '\r?$') -and $discoveryPid -in @($Context.processes.ProcessId)
  })
  if ($discoveries.Count -ne 1) { throw 'EMULATOR_DISCOVERY_AMBIGUOUS' }
  $Context.emulatorDiscovery = $discoveries[0].FullName
  $targetMediaVolume = if ($Request.coldBoot.mediaVolumeTarget -ne $null) { [int]$Request.coldBoot.mediaVolumeTarget } else { 15 }
  Set-AndroidAcceptanceMediaVolume $Context $targetMediaVolume
  $Context.status = 'PASS'
  $Context.readyAt = (Get-Date).ToUniversalTime().ToString('o')
  Write-AndroidBootEvidence $Context
  # The runtime runner owns a different server. Release the diagnostic server.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Context.adb '-P' ([string]$Context.adbPort) kill-server 2>&1 | Out-Null; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { throw 'DIAGNOSTIC_ADB_STOP_FAILED' }
  $Context.adbOwned = $false
}

function Stop-AndroidAcceptanceBoot($Context) {
  if (-not $Context.outputDir) { return }
  try {
    $live = @($Context.processes | Where-Object {
      $actual = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ProcessId)"
      if ($actual -and -not (Test-AndroidOwnedProcess $_ $actual)) { throw 'OWNED_EMULATOR_IDENTITY_CHANGED' }
      $null -ne $actual
    })
    if ($live.Count) {
      $adbAvailable = $true
      if (-not $Context.adbOwned) {
        try { Assert-AndroidBootPorts @([int]$Context.adbPort); $Context.adbOwned = $true } catch { $adbAvailable = $false }
      }
      if ($adbAvailable) {
        try {
          if (-not $Context.bootId -or (Invoke-AndroidBootAdb $Context @('shell','cat','/proc/sys/kernel/random/boot_id')) -ne $Context.bootId) {
            throw 'OWNED_EMULATOR_BOOT_UNVERIFIED'
          }
          Invoke-AndroidBootAdb $Context @('emu','kill') | Out-Null
        } catch { $adbAvailable = $false; $Context.gracefulCleanupError = $_.Exception.Message }
      }
      $deadline = (Get-Date).AddSeconds($(if ($adbAvailable) { 60 } else { 0 }))
      do {
        # Re-query every process, including the qemu child. A stale Process object
        # or the launcher exiting first must not permit the next cold launch.
        $remaining = @($live | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
        if (-not $remaining.Count) { break }
        if ((Get-Date) -gt $deadline) {
          foreach ($owned in $remaining) {
            $actual = Get-CimInstance Win32_Process -Filter "ProcessId=$($owned.ProcessId)"
            if (-not (Test-AndroidOwnedProcess $owned $actual)) { throw 'OWNED_EMULATOR_IDENTITY_CHANGED' }
            Stop-Process -Id $owned.ProcessId -Force -ErrorAction Stop
          }
          $forceDeadline = (Get-Date).AddSeconds(15)
          while (@($remaining | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }).Count) {
            if ((Get-Date) -gt $forceDeadline) { throw 'OWNED_EMULATOR_FORCE_STOP_TIMEOUT' }
            Start-Sleep -Milliseconds 250
          }
          $Context.emulatorCleanupMode = if ($adbAvailable) { 'verified-force-stop-after-graceful-timeout' } else { 'verified-force-stop-after-adb-unavailable' }
          break
        }
        Start-Sleep -Milliseconds 500
      } while ($true)
    }
    $Context.emulatorCleanupStatus = 'PASS'
  } catch {
    $Context.emulatorCleanupStatus = 'FAILED'
    $Context.cleanupError = $_.Exception.Message
  } finally {
    if ($Context.adbOwned) {
      $previous = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try { & $Context.adb '-P' ([string]$Context.adbPort) kill-server 2>&1 | Out-Null; $code = $LASTEXITCODE }
      finally { $ErrorActionPreference = $previous }
      if ($code -ne 0) { $Context.emulatorCleanupStatus = 'FAILED'; $Context.cleanupError = 'DIAGNOSTIC_ADB_STOP_FAILED' }
      $Context.adbOwned = $false
    }
    Write-AndroidBootEvidence $Context
  }
}
