const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");

const args = parseArguments(process.argv.slice(2));
const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const publicDir = path.join(runtimeRoot, "public");
const packagedEmbeddedDir = path.join(runtimeRoot, "src-tauri", "resources", "embedded-cartridge");
const embeddedCartridge = path.join(publicDir, "embedded-cartridge", "game.vncart");
const runtimeModePath = path.join(publicDir, "runtime-mode.json");
const fixedOnlyPath = path.join(publicDir, "fixed-only.json");
const releasePackagePath = path.join(publicDir, "release-package.json");
const runtimeIconIcoPath = path.join(runtimeRoot, "src-tauri", "icons", "icon.ico");
const runtimeIconPngPath = path.join(runtimeRoot, "src-tauri", "icons", "icon.png");
const runtimeTauriConfigPath = path.join(runtimeRoot, "src-tauri", "tauri.conf.json");
const releaseIdentity = parseReleaseIdentity(args.ReleaseIdentity);
const iconSource = ["project", "default", "fallback"].includes(args.IconSource)
  ? args.IconSource
  : (args.IconPath ? "project" : "default");

const outputDir = resolveDirectory(args.OutputDir, path.join(root, "releases", "standalone-windows"));
const diagnosticsDir = resolveDirectory(
  args.DiagnosticsDir,
  path.join(os.tmpdir(), `agentvn-standalone-windows-${Date.now()}-${randomSuffix()}`),
);
const buildLogPath = path.join(diagnosticsDir, "standalone-windows-build.log");
const verifyReportPath = path.join(diagnosticsDir, "standalone-windows-verify.json");
const verifyStderrPath = path.join(diagnosticsDir, "standalone-windows-verify.stderr.log");
const manifestPath = path.join(diagnosticsDir, "package-build-manifest.json");
const commandLogPath = path.join(diagnosticsDir, "standalone-package-command.log");
const unpackLogPath = path.join(diagnosticsDir, "standalone-unpack.log");
const optimizationLogPath = path.join(diagnosticsDir, "release-optimization.log");
const optimizationReportPath = path.join(diagnosticsDir, "release-optimization-report.json");
const diagnosticsArchivePath = path.join(path.dirname(diagnosticsDir), "agentvn-standalone-diagnostics.zip");

const warnings = [];
let verifyReport = null;

main().catch((error) => {
  const message = `${error instanceof Error ? error.message : String(error)}${readBuildTail()}`;
  finish("FAIL", message, [], warnings, verifyReport);
});

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(diagnosticsDir, { recursive: true });
  writeText(buildLogPath, [
    "== AgentVN Windows standalone package build (direct runner) ==",
    `Runtime root: ${runtimeRoot}`,
    `Cartridge: ${formatInputPath(args.CartridgePath)}`,
    `Icon: ${args.IconPath ? formatInputPath(args.IconPath) : "default AgentVN Player icon"}`,
    `Output: ${outputDir}`,
    `Diagnostics: ${diagnosticsDir}`,
    `Node: ${process.execPath}`,
    `Node version: ${process.version}`,
  ].join("\n") + "\n");
  validateDirectory(outputDir, "OutputDir");
  validateDirectory(diagnosticsDir, "DiagnosticsDir");
  validateFile(args.CartridgePath, "CartridgePath");
  if (args.IconPath) validateFile(args.IconPath, "IconPath");
  if (!fs.existsSync(path.join(runtimeRoot, "package.json"))) {
    return finish("BLOCKED", `Bundled GameCLI runtime template was not found: ${runtimeRoot}`, [], [
      "Reinstall AgentVN Editor with the bundled standalone build workspace.",
    ]);
  }

  const msvcEnvironment = resolveMsvcBuildEnvironment();
  appendText(
    buildLogPath,
    `MSVC host linker environment loaded: ${msvcEnvironment.linkPath}\n`,
  );
  const nsisToolset = ensureOfflineNsisToolset();
  appendText(
    buildLogPath,
    `Tauri NSIS offline toolset ready: ${nsisToolset.path} (${nsisToolset.source})\n`,
  );

  if (!fs.existsSync(path.join(runtimeRoot, "node_modules"))) {
    const install = await runNpmCommand("npm install", ["install"], runtimeRoot, buildLogPath);
    if (install.code !== 0) throw new Error(`npm install failed with exit code ${install.code}. See ${buildLogPath}`);
  }

  const verify = await runLoggedCommand(
    "verify-vncart",
    process.execPath,
    [path.join(root, "scripts", "verify-vncart.cjs"), "--allow-placeholder-assets", path.resolve(args.CartridgePath)],
    root,
    verifyReportPath,
    verifyStderrPath,
  );
  if (verify.code !== 0) {
    throw new Error(`verify-vncart failed with exit code ${verify.code}. ${firstUsefulLine(verify.stderr || verify.stdout)} See ${verifyStderrPath}`);
  }
  verifyReport = parseJsonFile(verifyReportPath, "verify-vncart report");
  if (!verifyReport?.ok) {
    throw new Error(`verify-vncart returned a non-readable or failed report. See ${verifyReportPath}`);
  }

  const gameTitle = releaseIdentity.title;
  const fileStem = safeFileStem(`${gameTitle}-${releaseIdentity.versionName}`);
  const state = args.DisposableWorkspace ? null : captureRuntimeState();
  try {
    if (args.PreparedInPlace) {
      for (const required of ["manifest.json", "script.json", "checksum.json"]) {
        validateFile(path.join(packagedEmbeddedDir, required), `PreparedInPlace/${required}`);
      }
      writeText(unpackLogPath, `Rust cartridge preparation is already staged in place: ${packagedEmbeddedDir}\n`);
    } else if (args.PreparedCartridgeDir) {
      const prepared = path.resolve(args.PreparedCartridgeDir);
      validateDirectory(prepared, "PreparedCartridgeDir");
      for (const required of ["manifest.json", "script.json", "checksum.json"]) {
        validateFile(path.join(prepared, required), `PreparedCartridgeDir/${required}`);
      }
      fs.rmSync(packagedEmbeddedDir, { recursive: true, force: true });
      copyDirectorySafe(prepared, packagedEmbeddedDir);
      writeText(unpackLogPath, `Rust cartridge preparation reused: ${prepared}\nDestination: ${packagedEmbeddedDir}\n`);
    } else {
      fs.mkdirSync(packagedEmbeddedDir, { recursive: true });
      const unpack = await runLoggedCommand(
        "unpack-vncart",
        process.execPath,
        [path.join(root, "scripts", "unpack-vncart.cjs"), path.resolve(args.CartridgePath), packagedEmbeddedDir],
        root,
        unpackLogPath,
      );
      if (unpack.code !== 0) throw new Error(`vncart unpack failed with exit code ${unpack.code}. See ${unpackLogPath}`);
    }

    if (args.OptimizationProfile !== "off") {
      const optimization = await runLoggedCommand(
        "release-resource-optimization",
        process.execPath,
        [
          path.join(root, "scripts", "build-release-runtime-assets.cjs"),
          packagedEmbeddedDir,
          "--profile",
          args.OptimizationProfile || "balanced",
          "--report",
          optimizationReportPath,
        ],
        root,
        optimizationLogPath,
      );
      if (optimization.code !== 0) {
        throw new Error(`release resource optimization failed with exit code ${optimization.code}. See ${optimizationLogPath}`);
      }
    } else {
      writeJson(optimizationReportPath, { mode: "off", skipped: true });
    }

    writeJson(runtimeModePath, { mode: "fixed" });
    writeJson(fixedOnlyPath, { fixedOnly: true });
    writeJson(releasePackagePath, { schemaVersion: 1, presentationMode: "release" });
    process.env.VITE_AGENTVN_RUNTIME_MODE = "fixed";
    process.env.VITE_AGENTVN_FIXED_ONLY = "true";
    process.env.CARGO_BUILD_JOBS = "1";
    applyRuntimeIdentity(releaseIdentity);
    await applyRuntimeIcon(args.IconPath);

    const releaseBuildEnv = {
      ...process.env,
      CARGO_BUILD_JOBS: "1",
      VITE_AGENTVN_RUNTIME_MODE: "fixed",
      VITE_AGENTVN_FIXED_ONLY: "true",
      VITE_AGENTVN_RELEASE_PACKAGE: "true",
    };
    // Tauri's beforeBuildCommand is intentionally empty. Build the frontend
    // explicitly so an older library/dev dist can never be sealed into a
    // standalone game package.
    const frontendBuild = await runNpmCommand(
      "frontend runtime build",
      ["run", "build"],
      runtimeRoot,
      buildLogPath,
      releaseBuildEnv,
    );
    if (frontendBuild.code !== 0) {
      throw new Error(`npm run build failed with exit code ${frontendBuild.code}. See ${buildLogPath}`);
    }

    const buildStartedAt = Date.now();
    const build = await runNpmCommand(
      "tauri nsis build",
      ["run", "tauri", "--", "build", "--bundles", "nsis"],
      runtimeRoot,
      buildLogPath,
      releaseBuildEnv,
    );
    if (build.code !== 0) throw new Error(`npm run tauri -- build --bundles nsis failed with exit code ${build.code}. See ${buildLogPath}`);

    const artifacts = args.RustCollectArtifacts ? [] : collectArtifacts(fileStem, buildStartedAt);
    if (!args.RustCollectArtifacts && artifacts.length === 0) {
      throw new Error(`No Windows standalone artifacts were found under ${runtimeRoot}`);
    }
    finish("PASS", "Windows standalone package build completed.", artifacts, warnings, verifyReport);
  } finally {
    if (state) restoreRuntimeState(state);
  }
}

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) continue;
    result[key.slice(2)] = values[index + 1] && !values[index + 1].startsWith("--") ? values[++index] : true;
  }
  return result;
}

function parseReleaseIdentity(raw) {
  let value;
  try {
    const text = String(raw || "");
    const json = text.startsWith("base64:")
      ? Buffer.from(text.slice(7), "base64").toString("utf8")
      : text;
    value = JSON.parse(json);
  } catch {
    throw new Error("RELEASE_METADATA_INVALID: ReleaseIdentity is not valid JSON.");
  }
  if (
    value?.schemaVersion !== 1
    || typeof value.title !== "string"
    || !value.title.trim()
    || typeof value.gameId !== "string"
    || !value.gameId.trim()
    || !/^\d+\.\d+\.\d+$/.test(String(value.versionName || ""))
    || !Number.isInteger(value.versionCode)
    || value.versionCode <= 0
    || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}$/.test(String(value.androidApplicationId || ""))
  ) {
    throw new Error("RELEASE_METADATA_INVALID: ReleaseIdentity contains unsupported values.");
  }
  return {
    ...value,
    title: value.title.trim(),
    gameId: value.gameId.trim(),
  };
}

function resolveDirectory(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return path.resolve(fallback);
  const normalized = value.replace(/^\\\\\?\\UNC\\/, "\\\\").replace(/^\\\\\?\\/, "");
  return path.resolve(normalized);
}

function validateFile(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`${label} does not exist: ${resolved}`);
}

function validateDirectory(value, label) {
  if (value.includes("\0")) throw new Error(`${label} contains an invalid null character.`);
  if (path.parse(value).root === value) throw new Error(`${label} must not be a filesystem root: ${value}`);
  if (fs.existsSync(value) && !fs.statSync(value).isDirectory()) throw new Error(`${label} is not a directory: ${value}`);
}

function formatInputPath(value) {
  return typeof value === "string" && value.trim() ? path.resolve(value) : "(missing)";
}

function randomSuffix() {
  return Math.random().toString(16).slice(2, 10);
}

function resolveNpmCli() {
  const candidates = [
    process.env.NPM_CLI_JS,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    process.platform === "win32"
      ? path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node_modules", "npm", "bin", "npm-cli.js")
      : "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`npm-cli.js was not found next to ${process.execPath}. Checked: ${candidates.join(", ")}`);
}

function runNpmCommand(label, commandArgs, cwd, logPath, env = process.env) {
  return runLoggedCommand(label, process.execPath, [resolveNpmCli(), ...commandArgs], cwd, logPath, undefined, env);
}

function resolveMsvcBuildEnvironment() {
  if (process.platform !== "win32") {
    throw new Error("WINDOWS_MSVC_LINKER_MISSING: Windows MSVC resolution is only supported on Windows.");
  }
  const currentLinker = process.env.Path?.split(path.delimiter)
    .map(candidate => path.join(candidate, "link.exe"))
    .find(candidate => fs.existsSync(candidate));
  if (currentLinker && process.env.LIB) {
    return {
      schemaVersion: 1,
      status: "PASS",
      message: "MSVC linker environment is already active.",
      linkPath: currentLinker,
      vsDevCmdPath: "",
      environment: selectMsvcEnvironment(process.env),
    };
  }

  const vswhereCandidates = [
    process.env["ProgramFiles(x86)"],
    process.env.ProgramFiles,
  ].filter(Boolean).map(base => path.join(base, "Microsoft Visual Studio", "Installer", "vswhere.exe"));
  let vsDevCmdPath = process.env.AGENTVN_VSDEVCMD_PATH || "";
  if (!vsDevCmdPath || !fs.existsSync(vsDevCmdPath)) {
    for (const vswhere of [...new Set(vswhereCandidates)]) {
      if (!fs.existsSync(vswhere)) continue;
      const found = spawnSync(vswhere, [
        "-latest", "-products", "*",
        "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-property", "installationPath",
      ], { cwd: root, encoding: "utf8", windowsHide: true, env: process.env });
      if (found.status !== 0) continue;
      const installationPath = String(found.stdout || "").trim().split(/\r?\n/)[0];
      if (installationPath) {
        const candidate = path.join(installationPath, "Common7", "Tools", "VsDevCmd.bat");
        if (fs.existsSync(candidate)) {
          vsDevCmdPath = candidate;
          break;
        }
      }
    }
  }
  if (!vsDevCmdPath || !fs.existsSync(vsDevCmdPath)) {
    throw new Error("WINDOWS_MSVC_LINKER_MISSING: Visual Studio C++ Build Tools with a Windows SDK were not found.");
  }

  const captured = spawnSync(
    process.env.ComSpec || "cmd.exe",
    ["/d", "/s", "/c", "call", vsDevCmdPath, "-arch=x64", "-host_arch=x64", ">nul", "&&", "set"],
    { cwd: root, encoding: "utf8", windowsHide: true, env: process.env, maxBuffer: 16 * 1024 * 1024 },
  );
  if (captured.status !== 0) {
    throw new Error(`WINDOWS_MSVC_LINKER_MISSING: VsDevCmd failed with exit code ${captured.status}. ${String(captured.stderr || captured.stdout).trim()}`);
  }
  const environment = {};
  for (const line of String(captured.stdout || "").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0) environment[line.slice(0, separator)] = line.slice(separator + 1);
  }
  for (const [name, value] of Object.entries(environment)) {
    if (value) process.env[name] = value;
  }
  const resolvedLinker = process.env.Path?.split(path.delimiter)
    .map(candidate => path.join(candidate, "link.exe"))
    .find(candidate => fs.existsSync(candidate));
  if (!resolvedLinker || !process.env.LIB) {
    throw new Error("WINDOWS_MSVC_LINKER_MISSING: VsDevCmd completed, but link.exe or LIB is unavailable.");
  }
  return {
    schemaVersion: 1,
    status: "PASS",
    message: "Visual Studio C++ Build Tools environment is ready.",
    linkPath: resolvedLinker,
    vsDevCmdPath,
    environment: selectMsvcEnvironment(process.env),
  };
}

function selectMsvcEnvironment(environment) {
  const selected = {};
  for (const name of [
    "Path", "LIB", "INCLUDE", "LIBPATH", "VCToolsInstallDir",
    "VSINSTALLDIR", "VCINSTALLDIR", "WindowsSdkDir", "WindowsSDKVersion",
    "UniversalCRTSdkDir", "UCRTVersion", "ExtensionSdkDir", "FrameworkDir",
    "FrameworkVersion", "FrameworkVersion64",
  ]) {
    if (typeof environment[name] === "string" && environment[name]) selected[name] = environment[name];
  }
  return selected;
}

function requiredNsisToolsetFiles(rootPath) {
  return [
    path.join(rootPath, "makensis.exe"),
    path.join(rootPath, "Bin", "makensis.exe"),
    path.join(rootPath, "Include", "MUI2.nsh"),
    path.join(rootPath, "Plugins", "x86-unicode", "additional", "nsis_tauri_utils.dll"),
  ];
}

function isCompleteNsisToolset(rootPath) {
  return requiredNsisToolsetFiles(rootPath).every(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
}

function bundledNsisToolsetCandidates() {
  return [
    process.env.AGENTVN_WINDOWS_OFFLINE_TOOLS,
    path.join(root, "windows-offline-tools", "NSIS"),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "AgentVN Editor", "windows-offline-tools", "NSIS")
      : "",
  ]
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate));
}

function ensureOfflineNsisToolset() {
  const localAppData = String(process.env.LOCALAPPDATA || "").trim();
  if (!localAppData) {
    throw new Error(
      "TAURI_NSIS_OFFLINE_TOOLSET_MISSING: LOCALAPPDATA is unavailable, so the Tauri NSIS cache cannot be prepared.",
    );
  }
  const cachePath = path.join(localAppData, "tauri", "NSIS");
  if (isCompleteNsisToolset(cachePath)) {
    return { path: cachePath, source: "existing cache" };
  }
  const bundledNsisToolsetPath = bundledNsisToolsetCandidates()
    .find((candidate) => isCompleteNsisToolset(candidate));
  if (!bundledNsisToolsetPath) {
    const checked = bundledNsisToolsetCandidates().join(", ");
    throw new Error(
      `TAURI_NSIS_OFFLINE_TOOLSET_MISSING: Bundled NSIS files are incomplete. Checked: ${checked}. Reinstall AgentVN Editor with Windows offline build tools.`,
    );
  }
  copyDirectorySafe(bundledNsisToolsetPath, cachePath);
  if (!isCompleteNsisToolset(cachePath)) {
    throw new Error(
      `TAURI_NSIS_OFFLINE_TOOLSET_MISSING: Failed to deploy the bundled NSIS toolset to ${cachePath}.`,
    );
  }
  return { path: cachePath, source: "bundled offline toolset" };
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function appendText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, text, "utf8");
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`${label} is invalid: ${error instanceof Error ? error.message : String(error)}. See ${filePath}`);
  }
}

function formatCommand(file, commandArgs) {
  return [file, ...commandArgs].map((value) => /\s/.test(value) ? JSON.stringify(value) : value).join(" ");
}

function runLoggedCommand(label, file, commandArgs, cwd, logPath, stderrPath, env = process.env) {
  return new Promise((resolve) => {
    appendText(logPath, `\n== ${label} ==\n$ ${formatCommand(file, commandArgs)}\n`);
    const child = spawn(file, commandArgs, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const complete = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    const timer = setTimeout(() => {
      appendText(logPath, `\n-- timeout --\nCommand timed out after 1800 seconds.\n`);
      terminateChildTree(child);
      complete({ code: 124, stdout: "", stderr: "Command timed out after 1800 seconds." });
    }, 1800 * 1000);
    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      appendText(logPath, `\n-- spawn error --\n${message}\n`);
      if (stderrPath) writeText(stderrPath, message);
      complete({ code: 1, stdout: "", stderr: message });
    });
    child.on("close", (code) => {
      if (settled) return;
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (out) appendText(logPath, `\n-- stdout --\n${out}`);
      if (err) appendText(logPath, `\n-- stderr --\n${err}`);
      if (stderrPath) writeText(stderrPath, err);
      if (label === "verify-vncart") writeText(verifyReportPath, out);
      complete({ code: code ?? 1, stdout: out, stderr: err });
    });
  });
}

function terminateChildTree(child) {
  if (process.platform !== "win32" || !child.pid) {
    try { child.kill("SIGKILL"); } catch {}
    return;
  }
  const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  const fallback = () => {
    try { child.kill(); } catch {}
  };
  killer.once("error", fallback);
  killer.once("close", (code) => {
    if (code !== 0) fallback();
  });
}

function appendText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, text, "utf8");
}

function firstUsefulLine(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "No subprocess output was captured.";
}

function captureRuntimeState() {
  const files = [runtimeModePath, fixedOnlyPath, releasePackagePath, runtimeIconIcoPath, runtimeIconPngPath, runtimeTauriConfigPath];
  const directories = [path.join(publicDir, "embedded-cartridge"), packagedEmbeddedDir];
  const state = { files: new Map(), directories: new Map() };
  for (const file of files) state.files.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
  for (const directory of directories) {
    const backup = `${directory}.agentvn-backup`;
    fs.rmSync(backup, { recursive: true, force: true });
    if (fs.existsSync(directory)) {
      copyDirectorySafe(directory, backup);
      state.directories.set(directory, true);
    } else {
      state.directories.set(directory, false);
    }
  }
  return state;
}

function restoreRuntimeState(state) {
  for (const [file, contents] of state.files) {
    if (contents === null) fs.rmSync(file, { force: true });
    else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents); }
  }
  for (const [directory] of state.directories) {
    const backup = `${directory}.agentvn-backup`;
    fs.rmSync(directory, { recursive: true, force: true });
    if (fs.existsSync(backup)) { copyDirectorySafe(backup, directory); fs.rmSync(backup, { recursive: true, force: true }); }
  }
}

function applyRuntimeIdentity(identity) {
  const config = JSON.parse(fs.readFileSync(runtimeTauriConfigPath, "utf8").replace(/^\uFEFF/, ""));
  config.productName = identity.title;
  config.version = identity.versionName;
  // Other platform builds may leave this hook empty. A standalone package
  // must embed a fresh fixed-mode frontend, never the previous library dist.
  config.build ??= {};
  config.build.beforeBuildCommand = "npm run build";
  for (const window of Array.isArray(config.app?.windows) ? config.app.windows : []) window.title = identity.title;
  writeJson(runtimeTauriConfigPath, config);
}

async function applyRuntimeIcon(iconPath) {
  const source = path.resolve(iconPath || path.join(publicDir, "logo.png"));
  try {
    const sharp = require(path.join(runtimeRoot, "node_modules", "sharp"));
    const probe = await sharp(source, { failOn: "error" })
      .ensureAlpha()
      .resize(48, 48, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let opaque = 0;
    let difference = 0;
    const colors = new Set();
    for (let y = 0; y < probe.info.height; y += 1) {
      for (let x = 0; x < probe.info.width; x += 1) {
        const index = (y * probe.info.width + x) * probe.info.channels;
        const r = probe.data[index];
        const g = probe.data[index + 1];
        const b = probe.data[index + 2];
        const a = probe.data[index + 3];
        if (a > 8) opaque += 1;
        colors.add(`${r},${g},${b},${a}`);
        if (x + 1 < probe.info.width) {
          const next = index + probe.info.channels;
          difference += (Math.abs(r - probe.data[next]) + Math.abs(g - probe.data[next + 1]) + Math.abs(b - probe.data[next + 2])) / 3;
        }
      }
    }
    const pixels = probe.info.width * probe.info.height;
    const averageDifference = difference / (probe.info.height * (probe.info.width - 1));
    if (opaque / pixels < 0.05 || colors.size < 4 || (averageDifference > 58 && colors.size > pixels * 0.7)) {
      if (source !== path.join(publicDir, "logo.png")) {
        warnings.push("ICON_FALLBACK_USED: custom icon failed visual validation; default AgentVN logo was used.");
        return applyRuntimeIcon(path.join(publicDir, "logo.png"));
      }
      throw new Error("APK_ICON_INVALID: default AgentVN icon failed visual validation.");
    }
    if (source.toLowerCase().endsWith(".ico")) {
      fs.copyFileSync(source, runtimeIconIcoPath);
      return;
    }
    const png = await sharp(source, { failOn: "error" })
      .resize(512, 512, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();
    fs.writeFileSync(runtimeIconPngPath, png);
    fs.writeFileSync(runtimeIconIcoPath, pngToIco(png));
  } catch (error) {
    if (source !== path.join(publicDir, "logo.png")) {
      warnings.push(`ICON_FALLBACK_USED: custom icon conversion failed; default AgentVN logo was used. ${error instanceof Error ? error.message : String(error)}`);
      return applyRuntimeIcon(path.join(publicDir, "logo.png"));
    }
    throw error;
  }
}

function pngToIco(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6);
  header.writeUInt8(0, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

function assertWindowsGuiSubsystem(executable) {
  const bytes = fs.readFileSync(executable);
  if (bytes.length < 0x40 || bytes.toString("ascii", 0, 2) !== "MZ") {
    throw new Error(`Portable executable is not a valid PE image: ${executable}`);
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset + 96 > bytes.length || bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") {
    throw new Error(`Portable executable has an invalid PE header: ${executable}`);
  }
  const optionalHeaderOffset = peOffset + 24;
  const subsystemOffset = optionalHeaderOffset + 68;
  if (subsystemOffset + 2 > bytes.length || bytes.readUInt16LE(subsystemOffset) !== 2) {
    throw new Error(`Portable executable is not marked as a Windows GUI application: ${executable}`);
  }
}

function safeFileStem(value) {
  let result = String(value || "AgentVN-Game").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  if (!result) result = "AgentVN-Game";
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(result)) result = `_${result}`;
  return result.slice(0, 96).replace(/[. ]+$/g, "") || "AgentVN-Game";
}

function copyDirectorySafe(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing to copy symbolic link: ${sourcePath}`);
    if (entry.isDirectory()) copyDirectorySafe(sourcePath, targetPath);
    else if (entry.isFile()) fs.copyFileSync(sourcePath, targetPath);
  }
}

function assertInside(parent, candidate, label) {
  const parentPath = path.resolve(parent).replace(/[\\/]+$/, "") + path.sep;
  const candidatePath = path.resolve(candidate);
  if (!candidatePath.toLowerCase().startsWith(parentPath.toLowerCase())) {
    throw new Error(`${label} escaped the requested output directory: ${candidatePath}`);
  }
}

function collectArtifacts(fileStem, startedAt) {
  const artifacts = [];
  const releaseDir = path.join(runtimeRoot, "src-tauri", "target", "release");
  const runtimeExe = path.join(releaseDir, "agentvn-player.exe");
  const resourceSource = path.join(releaseDir, "embedded-cartridge");
  if (!fs.existsSync(runtimeExe)) throw new Error(`Portable runtime exe was not found: ${runtimeExe}`);
  if (!fs.existsSync(resourceSource)) throw new Error(`Portable runtime resources were not found: ${resourceSource}`);
  assertWindowsGuiSubsystem(runtimeExe);
  const portableRoot = path.join(outputDir, "portable");
  assertInside(outputDir, portableRoot, "Portable output");
  fs.rmSync(portableRoot, { recursive: true, force: true });
  fs.mkdirSync(portableRoot, { recursive: true });
  const portableExe = path.join(portableRoot, `${fileStem}.exe`);
  fs.copyFileSync(runtimeExe, portableExe);
  copyDirectorySafe(resourceSource, path.join(portableRoot, "embedded-cartridge"));
  artifacts.push({ kind: "windows_portable_exe", path: portableExe, bytes: fs.statSync(portableExe).size });

  const nsisDir = path.join(releaseDir, "bundle", "nsis");
  const nsisFiles = fs.existsSync(nsisDir)
    ? fs.readdirSync(nsisDir).filter((name) => name.toLowerCase().endsWith(".exe")).map((name) => path.join(nsisDir, name)).filter((file) => fs.statSync(file).mtimeMs >= startedAt - 5000)
    : [];
  if (nsisFiles.length === 0) throw new Error(`NSIS installer was not found under ${nsisDir}`);
  const installer = path.join(outputDir, `${fileStem}-setup.exe`);
  fs.copyFileSync(nsisFiles[0], installer);
  artifacts.push({ kind: "windows_nsis_installer", path: installer, bytes: fs.statSync(installer).size });
  if (fs.existsSync(optimizationReportPath)) {
    const reportTarget = path.join(outputDir, "release-optimization-report.json");
    fs.copyFileSync(optimizationReportPath, reportTarget);
    artifacts.push({ kind: "release_optimization_report", path: reportTarget, bytes: fs.statSync(reportTarget).size });
  }
  return artifacts;
}

function readBuildTail() {
  if (!fs.existsSync(buildLogPath)) return "";
  const lines = fs.readFileSync(buildLogPath, "utf8").split(/\r?\n/);
  return lines.length ? `\n${lines.slice(-60).join("\n")}` : "";
}

function finish(status, message, artifacts, packageWarnings, verify) {
  writeJson(manifestPath, {
    ok: status === "PASS",
    status,
    staticStatus: status === "PASS" ? "PASS" : "FAIL",
    runtimeStatus: "NOT_RUN",
    overallStatus: status === "PASS" ? "STATIC_ONLY" : "FAIL",
    runtimeSmokeReportPath: null,
    platform: "windows",
    message,
    outputDir,
    diagnosticsDir,
    diagnosticsArchivePath,
    artifacts,
    warnings: packageWarnings.filter(Boolean),
    verifyReportPath,
    buildLogPath,
    manifestPath,
    generatedAt: new Date().toISOString(),
    verify,
    releaseIdentity,
    iconSource,
  });
  if (args.Json) process.stdout.write(`${JSON.stringify(parseJsonFile(manifestPath), null, 2)}\n`);
  process.exitCode = status === "PASS" ? 0 : status === "BLOCKED" ? 2 : 1;
}
