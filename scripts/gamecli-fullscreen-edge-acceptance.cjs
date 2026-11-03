const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const playerExe = process.env.AGENTVN_PLAYER_EXE || path.join(root, "editor", "src-tauri", "binaries", "agentvn-player.exe");
const previewRoot = process.env.AGENTVN_PREVIEW_ROOT || path.join(process.env.LOCALAPPDATA || "", "com.agentvn.editor", "gamecli-preview", "current");
const outDir = process.env.AGENTVN_ACCEPTANCE_OUT || path.join(root, "output", "automated", "gamecli-fullscreen-edge");
const screenshotPath = path.join(outDir, "fullscreen-edge.png");
const resultPath = path.join(outDir, "result.json");

function fail(message, details = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(resultPath, JSON.stringify({ ok: false, message, ...details }, null, 2));
  throw new Error(message);
}

function psString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(playerExe)) fail(`GameCLI player exe not found: ${playerExe}`);
  if (!fs.existsSync(path.join(previewRoot, "manifest.json"))) fail(`Preview root missing manifest.json: ${previewRoot}`);

  const ps = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32EdgeAudit {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$playerExe = ${psString(playerExe)}
$previewRoot = ${psString(previewRoot)}
$outDir = ${psString(outDir)}
$screenshotPath = ${psString(screenshotPath)}
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$p = Start-Process -FilePath $playerExe -ArgumentList @("--mode", "preview", "--preview-root", $previewRoot) -WorkingDirectory (Split-Path -Parent $playerExe) -PassThru
try {
  Start-Sleep -Seconds 8
  $windows = New-Object System.Collections.Generic.List[object]
  $callback = [Win32EdgeAudit+EnumWindowsProc]{ param([IntPtr]$hwnd, [IntPtr]$lparam)
    [uint32]$windowPid = 0
    [void][Win32EdgeAudit]::GetWindowThreadProcessId($hwnd, [ref]$windowPid)
    if ($windowPid -eq [uint32]$p.Id -and [Win32EdgeAudit]::IsWindowVisible($hwnd)) {
      $rect = New-Object Win32EdgeAudit+RECT
      [void][Win32EdgeAudit]::GetWindowRect($hwnd, [ref]$rect)
      $windows.Add([pscustomobject]@{ hwnd = $hwnd.ToInt64(); left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top }) | Out-Null
    }
    return $true
  }
  [void][Win32EdgeAudit]::EnumWindows($callback, [IntPtr]::Zero)
  $screenWidth = [Win32EdgeAudit]::GetSystemMetrics(0)
  $screenHeight = [Win32EdgeAudit]::GetSystemMetrics(1)
  $primary = $windows | Where-Object { $_.width -ge ($screenWidth * 0.8) -and $_.height -ge ($screenHeight * 0.8) } | Sort-Object width,height -Descending | Select-Object -First 1
  if (-not $primary) { throw "No visible GameCLI window covering most of the screen. Windows: $($windows | ConvertTo-Json -Compress)" }
  [void][Win32EdgeAudit]::ShowWindowAsync([IntPtr]$primary.hwnd, 5)
  [void][Win32EdgeAudit]::SetForegroundWindow([IntPtr]$primary.hwnd)
  Start-Sleep -Milliseconds 800

  $bmp = New-Object System.Drawing.Bitmap $screenWidth, $screenHeight
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  $graphics.CopyFromScreen(0, 0, 0, 0, $bmp.Size)
  $bmp.Save($screenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)

  function PixelInfo([int]$x, [int]$y) {
    $c = $bmp.GetPixel($x, $y)
    return [pscustomobject]@{ x = $x; y = $y; r = $c.R; g = $c.G; b = $c.B; avg = (($c.R + $c.G + $c.B) / 3.0); white = ($c.R -ge 245 -and $c.G -ge 245 -and $c.B -ge 245) }
  }
  $bottom = New-Object System.Collections.Generic.List[object]
  foreach ($x in @(0, 10, 100, [int]($screenWidth / 2), ($screenWidth - 100), ($screenWidth - 10), ($screenWidth - 1))) { $bottom.Add((PixelInfo $x ($screenHeight - 1))) | Out-Null }
  $right = New-Object System.Collections.Generic.List[object]
  foreach ($y in @(0, 10, 100, [int]($screenHeight / 2), ($screenHeight - 100), ($screenHeight - 10), ($screenHeight - 1))) { $right.Add((PixelInfo ($screenWidth - 1) $y)) | Out-Null }

  $bottomWhiteCount = ($bottom | Where-Object { $_.white }).Count
  $rightWhiteCount = ($right | Where-Object { $_.white }).Count
  $lastNonWhiteRow = -1
  for ($y = $screenHeight - 1; $y -ge 0; $y--) {
    $sum = 0; $count = 0
    for ($x = 0; $x -lt $screenWidth; $x += 80) { $c = $bmp.GetPixel($x, $y); $sum += $c.R + $c.G + $c.B; $count += 3 }
    if (($sum / $count) -lt 230) { $lastNonWhiteRow = $y; break }
  }
  $lastNonWhiteCol = -1
  for ($x = $screenWidth - 1; $x -ge 0; $x--) {
    $sum = 0; $count = 0
    for ($y = 0; $y -lt $screenHeight; $y += 80) { $c = $bmp.GetPixel($x, $y); $sum += $c.R + $c.G + $c.B; $count += 3 }
    if (($sum / $count) -lt 230) { $lastNonWhiteCol = $x; break }
  }

  $result = [pscustomobject]@{
    ok = $true
    playerExe = $playerExe
    previewRoot = $previewRoot
    screenshotPath = $screenshotPath
    screen = [pscustomobject]@{ width = $screenWidth; height = $screenHeight }
    windows = $windows
    primaryWindow = $primary
    bottom = $bottom
    right = $right
    bottomWhiteCount = $bottomWhiteCount
    rightWhiteCount = $rightWhiteCount
    lastNonWhiteRow = $lastNonWhiteRow
    lastNonWhiteCol = $lastNonWhiteCol
  }
  if ($primary.left -ne 0 -or $primary.top -ne 0 -or $primary.right -ne $screenWidth -or $primary.bottom -ne $screenHeight) {
    $result.ok = $false
    $result | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 ${psString(resultPath)}
    throw "GameCLI window is not exact fullscreen: $($primary | ConvertTo-Json -Compress), screen $($screenWidth)x$($screenHeight)"
  }
  if ($bottomWhiteCount -gt 0 -or $rightWhiteCount -gt 0 -or $lastNonWhiteRow -ne ($screenHeight - 1) -or $lastNonWhiteCol -ne ($screenWidth - 1)) {
    $result.ok = $false
    $result | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 ${psString(resultPath)}
    throw "Detected white/blank edge: bottomWhite=$bottomWhiteCount rightWhite=$rightWhiteCount lastNonWhiteRow=$lastNonWhiteRow lastNonWhiteCol=$lastNonWhiteCol"
  }
  $result | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 ${psString(resultPath)}
  Write-Output ($result | ConvertTo-Json -Depth 8)
}
finally {
  if ($graphics) { $graphics.Dispose() }
  if ($bmp) { $bmp.Dispose() }
  if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}
`;

  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; process.stdout.write(chunk); });
  child.stderr.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
  const code = await new Promise((resolve) => child.on("close", resolve));
  if (code !== 0) fail(`Fullscreen edge acceptance failed with exit code ${code}`, { stdout, stderr, resultPath, screenshotPath });
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8").replace(/^\uFEFF/, ""));
  if (!result.ok) fail("Fullscreen edge acceptance result was not ok", result);
  console.log(`GameCLI fullscreen edge acceptance passed. Screenshot: ${screenshotPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
