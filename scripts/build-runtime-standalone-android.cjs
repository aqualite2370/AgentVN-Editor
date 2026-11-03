const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const elevatedRequestPath = process.env.AGENTVN_ANDROID_BUILD_REQUEST;
let elevatedRequest;
if (elevatedRequestPath) {
  const requestText = fs.readFileSync(elevatedRequestPath, "utf8").replace(/^\uFEFF/, "");
  elevatedRequest = JSON.parse(requestText);
}
const requestArgs = elevatedRequest
  ? [
      "--OutputDir", elevatedRequest.outputDir,
      "--DiagnosticsDir", elevatedRequest.diagnosticsDir,
      "--CartridgePath", elevatedRequest.cartridgePath,
      ...(elevatedRequest.offlinePackRoot
        ? ["--OfflinePackRoot", elevatedRequest.offlinePackRoot]
        : []),
      ...(elevatedRequest.iconPath ? ["--IconPath", elevatedRequest.iconPath] : []),
      "--ReleaseIdentity", `base64:${Buffer.from(JSON.stringify(elevatedRequest.releaseIdentity), "utf8").toString("base64")}`,
      "--IconSource", elevatedRequest.iconSource || "default",
      "--OptimizationProfile", elevatedRequest.optimizationProfile || "balanced",
      ...(elevatedRequest.runId ? ["--RunId", elevatedRequest.runId] : []),
      ...(elevatedRequest.skipEnvironmentCheck ? ["--SkipEnvironmentCheck"] : []),
    ]
  : process.argv.slice(2);
const args = requestArgs;

function option(name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")
    ? args[index + 1]
    : fallback;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
}

const outputDir = requiredOption("--OutputDir");
const diagnosticsDir = requiredOption("--DiagnosticsDir");
const cartridgePath = requiredOption("--CartridgePath");
const iconPath = option("--IconPath");
const releaseIdentityRaw = requiredOption("--ReleaseIdentity");
const iconSource = option("--IconSource", iconPath ? "project" : "default");
const optimizationProfile = option("--OptimizationProfile", "balanced");
const runId = option("--RunId");
const offlinePackRoot = option("--OfflinePackRoot");
const skipEnvironmentCheck = args.includes("--SkipEnvironmentCheck");
const skipSymlinkProbe = args.includes("--SkipSymlinkProbe");
const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
const script = path.join(root, "scripts", "build-runtime-standalone-android.ps1");
const commandLog = path.join(path.resolve(diagnosticsDir), "standalone-package-command.log");
const manifestPath = path.join(path.resolve(diagnosticsDir), "package-build-manifest.json");

function appendUtf8(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, value, "utf8");
}

function stripAnsi(value) {
  return String(value).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function parseJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function formatCommand(program, commandArgs) {
  return [program, ...commandArgs]
    .map((value) => /\s/.test(value) ? JSON.stringify(value) : value)
    .join(" ");
}

const releaseIdentityTransport = releaseIdentityRaw.startsWith("base64:")
  ? releaseIdentityRaw
  : `base64:${Buffer.from(releaseIdentityRaw, "utf8").toString("base64")}`;
const childArgs = [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  script,
  "-CartridgePath",
  path.resolve(cartridgePath),
  "-OutputDir",
  path.resolve(outputDir),
  "-DiagnosticsDir",
  path.resolve(diagnosticsDir),
  "-OptimizationProfile",
  optimizationProfile,
  "-ReleaseIdentity",
  // PowerShell 5.1 also strips JSON quote characters during command-line
  // parsing. Base64 keeps the versioned JSON transport both ASCII-only and
  // quote-safe; the helper decodes it before strict JSON validation.
  releaseIdentityTransport,
  "-IconSource",
  iconSource,
];
if (runId) childArgs.push("-RunId", runId);
if (offlinePackRoot) childArgs.push("-OfflinePackRoot", path.resolve(offlinePackRoot));
if (iconPath) childArgs.push("-IconPath", path.resolve(iconPath));
if (skipEnvironmentCheck) childArgs.push("-SkipEnvironmentCheck");
if (skipSymlinkProbe) childArgs.push("-SkipSymlinkProbe");

fs.mkdirSync(path.dirname(commandLog), { recursive: true });
appendUtf8(commandLog, `\n== android-runner ==\n$ ${formatCommand(powershell, childArgs)}\n`);

const child = spawn(powershell, childArgs, {
  cwd: root,
  windowsHide: true,
  env: {
    ...process.env,
    AGENTVN_ANDROID_ELEVATED_HELPER: elevatedRequest ? "1" : process.env.AGENTVN_ANDROID_ELEVATED_HELPER,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const stdout = [];
const stderr = [];
let spawnFailed = false;
function publishRunnerFailure(failureCode, message) {
  const failure = {
    ok: false, status: "FAILED", platform: "android", runId,
    failureCode, message, generatedAt: new Date().toISOString(),
    outputDir: path.resolve(outputDir), diagnosticsDir: path.resolve(diagnosticsDir),
    manifestPath, buildLogPath: commandLog, artifacts: [], warnings: [],
  };
  try {
    fs.writeFileSync(manifestPath, JSON.stringify(failure, null, 2), "utf8");
  } catch (error) {
    process.stderr.write(`Failed to write runner failure manifest: ${error.message}\n`);
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));

child.on("error", (error) => {
  spawnFailed = true;
  const message = error instanceof Error ? error.message : String(error);
  appendUtf8(commandLog, `\n-- spawn error --\n${message}\n`);
  publishRunnerFailure("ANDROID_RUNNER_START_FAILED", message);
});

child.on("close", (code, signal) => {
  if (spawnFailed) return;
  const out = stripAnsi(Buffer.concat(stdout).toString("utf8"));
  const err = stripAnsi(Buffer.concat(stderr).toString("utf8"));
  if (out) appendUtf8(commandLog, `\n-- stdout --\n${out}`);
  if (err) appendUtf8(commandLog, `\n-- stderr --\n${err}`);

  let manifest;
  try {
    manifest = parseJsonFile(manifestPath);
  } catch (error) {
    const message = `Android package runner produced no readable UTF-8 manifest: ${error instanceof Error ? error.message : String(error)}`;
    appendUtf8(commandLog, `\n-- manifest error --\n${message}\n`);
    publishRunnerFailure("ANDROID_RUNNER_FAILED",
      err.trim() || `${message} (exit=${code}, signal=${signal || "none"})`);
    return;
  }

  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  process.exitCode = code ?? (manifest.status === "PASS" ? 0 : 1);
  if (signal && process.exitCode === 0) process.exitCode = 1;
});
