"use strict";

// Executes the actual shell build script in a temporary workspace. npm/Tauri
// are controlled at the native command seam; no user cartridge or build runs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const buildGameShell = fs.readFileSync(
  path.join(root, "scripts", "build-game-shell-windows.ps1"),
  "utf8",
);
assert.match(
  buildGameShell,
  /npm ci --no-audit --no-fund/,
  "GameCLI shell build must install the package-lock versions with npm ci.",
);
assert.doesNotMatch(
  buildGameShell,
  /^\s*npm install\b/m,
  "GameCLI shell build must not resolve compatible Tauri ranges with npm install.",
);
const output = process.env.AGENTVN_LIBRARY_BUILD_TEST_OUTPUT
  || path.join(root, "output", "gamecli-library-build-isolation", new Date().toISOString().replace(/[:.]/g, "-"));
assert(!fs.existsSync(output), `Refusing to overwrite evidence: ${output}`);
fs.mkdirSync(output, { recursive: true });
const fixture = fs.mkdtempSync(path.join(output, "AgentVN library 中文 space-"));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { scope: "library shell build configuration isolation; controlled native build, not compilation",
  status: "RUNNING", fixture, cases: [] };
fs.mkdirSync(path.join(fixture, "scripts"));
for (const file of ["build-game-shell-windows.ps1", "assert-windows-gui-subsystem.ps1"])
  fs.copyFileSync(path.join(root, "scripts", file), path.join(fixture, "scripts", file));
const runtime = path.join(fixture, "GameCli_framework");
fs.mkdirSync(path.join(runtime, "src-tauri", "resources", "embedded-cartridge"), { recursive: true });
fs.writeFileSync(path.join(runtime, "package.json"), '{"name":"test-only","version":"0.0.1"}');
fs.writeFileSync(path.join(runtime, "src-tauri", "Cargo.toml"),
  '[package]\nname = "agentvn-player"\nversion = "2.3.4"\n\n[dependencies]\nserde = "1"\n');
const baseFile = path.join(runtime, "src-tauri", "tauri.conf.json");
fs.writeFileSync(baseFile, JSON.stringify({ productName: "Existing user export", version: "0.0.1",
  identifier: "com.user.existing", build: { frontendDist: "../dist" },
  app: { windows: [{ title: "Existing user export" }] },
  bundle: { resources: { "resources/embedded-cartridge": "embedded-cartridge" } } }));
const sentinelFile = path.join(runtime, "src-tauri", "resources", "embedded-cartridge", "manifest.json");
fs.writeFileSync(sentinelFile, '{"title":"DO NOT READ OR CHANGE"}');
const originals = [baseFile, sentinelFile].map(file => ({ file, hash: sha(file) }));
// Minimal PE fixture accepted by the repository's real subsystem check.
const pe = Buffer.alloc(1024);
pe.write("MZ");
pe.writeInt32LE(128, 0x3c);
pe.write("PE\0\0", 128);
pe.writeUInt16LE(2, 128 + 24 + 68);
const peFile = path.join(fixture, "test-gui.exe");
fs.writeFileSync(peFile, pe);
const harness = path.join(fixture, "harness.ps1");
fs.writeFileSync(harness, `
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
function global:npm {
    $nativeArgs = @($args)
    [Console]::Error.WriteLine("npm normal diagnostic stderr")
    $global:LASTEXITCODE = 0
    if ($nativeArgs.Count -gt 2 -and $nativeArgs[1] -eq "tauri") {
        $configIndex = [Array]::IndexOf($nativeArgs, "--config")
        if ($configIndex -lt 0 -or $configIndex + 1 -ge $nativeArgs.Count) {
            throw "LIBRARY_CONFIG_MISSING: build would inherit user resources"
        }
        $configFile = [string]$nativeArgs[$configIndex + 1]
        $config = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
        @{ configPath = $configFile; config = $config; args = $nativeArgs } | ConvertTo-Json -Depth 20 |
            Set-Content -LiteralPath $env:LIBRARY_TEST_EVIDENCE -Encoding UTF8
        if ($config.bundle.resources -isnot [Array] -or $config.bundle.resources.Count -ne 0) {
            throw "LIBRARY_RESOURCES_NOT_REPLACED: an empty object cannot remove inherited mappings"
        }
        if ($env:LIBRARY_TEST_FAIL -eq "1") { $global:LASTEXITCODE = 17; return }
        $releaseDir = Join-Path $env:LIBRARY_TEST_ROOT "GameCli_framework\\src-tauri\\target\\release"
        New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
        Copy-Item -LiteralPath (Join-Path $env:LIBRARY_TEST_ROOT "test-gui.exe") -Destination (Join-Path $releaseDir "agentvn-player.exe")
    }
}
$modeMapping = $null
$modeView = $null
$modeStream = $null
try {
    if ($env:LIBRARY_TEST_MAPPED -eq "1") {
        Add-Type -AssemblyName System.Core
        $modeFile = Join-Path $env:LIBRARY_TEST_ROOT "GameCli_framework\\public\\runtime-mode.json"
        $modeStream = [IO.File]::Open($modeFile, [IO.FileMode]::Open, [IO.FileAccess]::Read,
            [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
        $modeMapping = [IO.MemoryMappedFiles.MemoryMappedFile]::CreateFromFile($modeStream, ("AgentVN-QA-" + [Guid]::NewGuid().ToString("N")), 0,
            [IO.MemoryMappedFiles.MemoryMappedFileAccess]::Read,
            [IO.HandleInheritability]::None, $true)
        $modeView = $modeMapping.CreateViewAccessor(0, 0, [IO.MemoryMappedFiles.MemoryMappedFileAccess]::Read)
        $modeStream.Dispose()
        $modeStream = $null
        $truncateRejected = $false
        try { [IO.File]::WriteAllText($modeFile, "{ \`"mode\`": \`"library\`" }\`n", [Text.UTF8Encoding]::new($false)) }
        catch {
            $truncateRejected = $true
            if (($_.Exception.InnerException.HResult -band 65535) -ne 1224) { throw }
        }
        if (-not $truncateRejected) { throw "MAPPED_FIXTURE_DID_NOT_REJECT_TRUNCATION" }
    }
    & (Join-Path $env:LIBRARY_TEST_ROOT "scripts\\build-game-shell-windows.ps1")
} finally {
    if ($modeView) { $modeView.Dispose() }
    if ($modeMapping) { $modeMapping.Dispose() }
    if ($modeStream) { $modeStream.Dispose() }
}
`, "utf8");
try {
  for (const [fail,mapped,mismatch] of [[false,false,false],[true,false,false],[false,true,false],[false,true,true]]) {
    const label=mismatch?"different-mapped-mode":mapped?"unchanged-mapped-mode":fail?"failed-build":"successful-build";
    if(mapped) fs.writeFileSync(path.join(runtime,"public/runtime-mode.json"),
      mismatch?'{ "mode": "fixed" }\n':'{ "mode": "library" }\n');
    const modeBefore=mapped?fs.statSync(path.join(runtime,"public/runtime-mode.json")).mtimeMs:undefined;
    const evidence = path.join(output, `${label}-config.json`);
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harness], {
      windowsHide: true, encoding: "utf8", timeout: 30000,
      env: { ...process.env, LIBRARY_TEST_ROOT: fixture, LIBRARY_TEST_EVIDENCE: evidence,
        LIBRARY_TEST_FAIL: fail ? "1" : "0", LIBRARY_TEST_MAPPED:mapped?"1":"0" },
    });
    fs.writeFileSync(path.join(output, `${label}.log`), result.stdout + result.stderr);
    assert.equal(result.status, fail||mismatch ? 1 : 0, `Shell build result:\n${result.stdout}\n${result.stderr}`);
    if(mismatch) {
      assert(!fs.existsSync(evidence),"Cannot build using a stale incompatible mapped mode");
      assert.equal(JSON.parse(fs.readFileSync(path.join(runtime,"public/runtime-mode.json"))).mode,"fixed");
      assert.match(result.stderr,/user-mapped|映射/);
      report.cases.push({name:"different-memory-mapped-mode-must-fail-instead-of-using-stale-mode",status:"PASS"});
      continue;
    }
    const observed = JSON.parse(fs.readFileSync(evidence, "utf8").replace(/^\uFEFF/, ""));
    assert.deepEqual(observed.config.bundle.resources, [],
      "RFC 7396 array replacement must discard the entire inherited resource map");
    assert.equal(observed.config.identifier, "com.agentvn.player");
    assert.equal(observed.config.productName, "AgentVN Player");
    assert.equal(observed.config.version, "2.3.4", "read this workspace's Cargo package version");
    assert.equal(observed.config.app.windows[0].title, "AgentVN Player");
    assert.equal(observed.config.build.beforeBuildCommand, "", "frontend already built once");
    assert(observed.args.includes("--no-bundle"));
    assert(!fs.existsSync(observed.configPath), "temporary config must be cleaned on success and failure");
    for (const original of originals) assert.equal(sha(original.file), original.hash,
      "source Tauri configuration and embedded user resources must remain unchanged");
    if (!fail) {
      assert.equal(sha(path.join(fixture, "editor/src-tauri/binaries/agentvn-player.exe")), sha(peFile));
      assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, "public/runtime-mode.json"))).mode, "library");
    }
    if(mapped) assert.equal(fs.statSync(path.join(runtime,"public/runtime-mode.json")).mtimeMs,modeBefore,
      "An identical mapped runtime mode must not be truncated or rewritten");
    report.cases.push({ name: mapped?"unchanged-memory-mapped-mode-builds-without-rewriting":fail ? "native-failure-preserves-source-and-cleans-config"
      : "library-build-uses-isolated-config-and-copies-output", status: "PASS", observed });
  }
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED";
  report.error = error.stack;
  process.exitCode = 1;
  console.error(error.stack);
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`${report.status}: ${path.join(output, "report.json")}`);
}
