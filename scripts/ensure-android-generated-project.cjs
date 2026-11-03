#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

function isWindowsCommandShim(command) {
  return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(String(command));
}

function runCommand(command, args, options) {
  if (!isWindowsCommandShim(command)) {
    return childProcess.spawnSync(command, args, { ...options, encoding: null });
  }
  return childProcess.spawnSync(`"${command}"`, args, {
    ...options,
    shell: true,
    encoding: null,
  });
}

function decodeChildOutput(value) {
  if (value === undefined || value === null) return "";
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  for (const encoding of ["utf-8", "gb18030", "windows-1252"]) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      // Try the next compatible Windows encoding.
    }
  }
  return new TextDecoder("utf-8").decode(bytes).replace(/\uFFFD/g, "[undecodable-output]");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    options[key] = argv[index + 1] && !argv[index + 1].startsWith("--")
      ? argv[++index]
      : true;
  }
  return options;
}

function assertInsideRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(prefix)) {
    throw new Error(`Refusing to operate outside RuntimeRoot: ${resolvedTarget}`);
  }
  return resolvedTarget;
}

function fileEntry(name, relativePath) {
  return { name, relativePath, required: true };
}

const DEFERRED_FILES = [
  fileEntry("tauri.settings.gradle", "tauri.settings.gradle"),
  fileEntry("app/tauri.build.gradle.kts", "app/tauri.build.gradle.kts"),
  fileEntry("app/tauri.properties", "app/tauri.properties"),
];

const FULL_REQUIRED_FILES = [
  fileEntry("settings.gradle", "settings.gradle"),
  fileEntry("build.gradle.kts", "build.gradle.kts"),
  fileEntry("app/build.gradle.kts", "app/build.gradle.kts"),
  fileEntry("AndroidManifest.xml", "app/src/main/AndroidManifest.xml"),
  fileEntry("gradlew", "gradlew"),
  fileEntry("gradlew.bat", "gradlew.bat"),
  fileEntry("gradle/wrapper/gradle-wrapper.jar", "gradle/wrapper/gradle-wrapper.jar"),
  fileEntry("gradle/wrapper/gradle-wrapper.properties", "gradle/wrapper/gradle-wrapper.properties"),
  ...DEFERRED_FILES,
];

const TAURI_ANDROID_REQUIRED_API = "fun getPluginManager(): PluginManager";

function readUtf8IfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function readLockedTauriVersion(runtimeRoot) {
  const cargoLockPath = path.join(runtimeRoot, "src-tauri", "Cargo.lock");
  const text = readUtf8IfExists(cargoLockPath);
  if (!text) return { version: null, path: cargoLockPath, error: "Cargo.lock is missing or unreadable." };
  const packageBlocks = text.split(/\[\[package\]\]\s*/u);
  for (const block of packageBlocks) {
    if (/^name\s*=\s*"tauri"\s*$/mu.test(block)) {
      const match = block.match(/^version\s*=\s*"([^"]+)"/mu);
      return {
        version: match ? match[1] : null,
        path: cargoLockPath,
        error: match ? null : "Cargo.lock contains tauri but no version.",
      };
    }
  }
  return { version: null, path: cargoLockPath, error: "Cargo.lock does not contain the tauri package." };
}

function readTauriAndroidSource(runtimeRoot) {
  const settingsPath = path.join(runtimeRoot, "src-tauri", "gen", "android", "tauri.settings.gradle");
  const text = readUtf8IfExists(settingsPath);
  if (!text) {
    return {
      settingsPath,
      configuredVersion: null,
      sourcePath: null,
      error: "tauri.settings.gradle is not present yet; Tauri may generate it during build.",
    };
  }
  const match = text.match(
    /project\(['"]?:tauri-android['"]?\)\.projectDir\s*=\s*new File\("(?<source>[^"]+)"\)/u,
  );
  if (!match?.groups?.source) {
    return {
      settingsPath,
      configuredVersion: null,
      sourcePath: null,
      error: "tauri.settings.gradle does not contain a tauri-android projectDir.",
    };
  }
  const sourcePath = path.normalize(match.groups.source.replace(/\\\\/gu, "\\"));
  const versionMatch = sourcePath.match(/[\\/]tauri-(?<version>[^\\/]+)[\\/]mobile[\\/]android$/u);
  return {
    settingsPath,
    configuredVersion: versionMatch?.groups?.version ?? null,
    sourcePath,
    error: null,
  };
}

function inspectTauriAndroidCompatibility(androidRoot, runtimeRoot, requiredStage = "full") {
  const activityFiles = fs.existsSync(androidRoot)
    ? walkFiles(androidRoot).filter((filePath) => path.basename(filePath) === "TauriActivity.kt")
    : [];
  const generatedActivities = activityFiles.map((filePath) => ({
    path: path.relative(androidRoot, filePath),
    hasRequiredApi: readUtf8IfExists(filePath)?.includes(TAURI_ANDROID_REQUIRED_API) === true,
  }));
  const lock = readLockedTauriVersion(runtimeRoot);
  const source = readTauriAndroidSource(runtimeRoot);
  const reasons = [];
  if (generatedActivities.length === 0 && requiredStage === "full") {
    reasons.push("Generated TauriActivity.kt is missing.");
  } else if (generatedActivities.some((entry) => !entry.hasRequiredApi)) {
    reasons.push(`Generated TauriActivity.kt is missing ${TAURI_ANDROID_REQUIRED_API}.`);
  }
  if (lock.version && source.configuredVersion && lock.version !== source.configuredVersion) {
    reasons.push(`Cargo.lock tauri ${lock.version} does not match tauri.settings.gradle ${source.configuredVersion}.`);
  }
  if (source.sourcePath) {
    const sourceActivityPath = path.join(source.sourcePath, "..", "android-codegen", "TauriActivity.kt");
    const sourceActivityText = readUtf8IfExists(sourceActivityPath);
    if (!sourceActivityText) {
      reasons.push(`Tauri Android source template is missing: ${sourceActivityPath}`);
    } else if (!sourceActivityText.includes(TAURI_ANDROID_REQUIRED_API)) {
      reasons.push(`Tauri Android source template is missing ${TAURI_ANDROID_REQUIRED_API}.`);
    }
  }
  const status = reasons.length > 0
    ? "incompatible"
    : generatedActivities.length > 0
      ? "compatible"
      : "unknown";
  return {
    status,
    requiredApi: TAURI_ANDROID_REQUIRED_API,
    tauriVersion: lock.version,
    cargoLockPath: lock.path,
    cargoLockError: lock.error,
    configuredVersion: source.configuredVersion,
    tauriAndroidSourcePath: source.sourcePath,
    tauriSettingsPath: source.settingsPath,
    tauriSettingsError: source.error,
    generatedActivities,
    reasons,
  };
}

function inspectProject(androidRoot, requiredStage) {
  const requiredFiles = requiredStage === "bootstrap"
    ? FULL_REQUIRED_FILES.filter((entry) => !DEFERRED_FILES.includes(entry))
    : FULL_REQUIRED_FILES;
  const fullMissingFiles = FULL_REQUIRED_FILES
    .filter((entry) => !fs.existsSync(path.join(androidRoot, entry.relativePath)))
    .map((entry) => entry.name);
  const missingFiles = requiredFiles
    .filter((entry) => !fs.existsSync(path.join(androidRoot, entry.relativePath)))
    .map((entry) => entry.name);
  const mainActivityFiles = fs.existsSync(androidRoot)
    ? walkFiles(androidRoot).filter((filePath) => path.basename(filePath) === "MainActivity.kt")
    : [];
  if (mainActivityFiles.length === 0) {
    missingFiles.push("MainActivity.kt");
    fullMissingFiles.push("MainActivity.kt");
  }
  const tauriApiCompatibility = inspectTauriAndroidCompatibility(
    androidRoot,
    path.resolve(androidRoot, "..", "..", ".."),
    requiredStage,
  );
  return {
    androidRoot,
    exists: fs.existsSync(androidRoot),
    requiredStage,
    requiredFiles: requiredFiles.map((entry) => entry.name).concat("MainActivity.kt"),
    fullRequiredFiles: FULL_REQUIRED_FILES.map((entry) => entry.name).concat("MainActivity.kt"),
    deferredFiles: DEFERRED_FILES.map((entry) => entry.name),
    missingFiles: [...new Set(missingFiles)],
    fullMissingFiles: [...new Set(fullMissingFiles)],
    deferredMissingFiles: [...new Set(
      fullMissingFiles.filter((name) => DEFERRED_FILES.some((entry) => entry.name === name)),
    )],
    mainActivityFiles: mainActivityFiles.map((filePath) => path.relative(androidRoot, filePath)),
    tauriApiCompatibility,
    complete: missingFiles.length === 0,
    fullComplete: fullMissingFiles.length === 0,
  };
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(entryPath));
    else if (entry.isFile()) output.push(entryPath);
  }
  return output;
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options["runtime-root"] || !options.report || !options["init-command"]) {
    throw new Error("Usage: ensure-android-generated-project.cjs --runtime-root <path> --report <path> --init-command <path> [--init-args-base64 <base64>] [--required-stage bootstrap|full]");
  }
  const requiredStage = String(options["required-stage"] || "full").toLowerCase();
  if (!["bootstrap", "full"].includes(requiredStage)) {
    throw new Error(`Invalid --required-stage: ${requiredStage}. Expected bootstrap or full.`);
  }
  const runtimeRoot = path.resolve(String(options["runtime-root"]));
  const androidRoot = assertInsideRoot(
    runtimeRoot,
    path.join(runtimeRoot, "src-tauri", "gen", "android"),
  );
  const reportPath = path.resolve(String(options.report));
  const before = inspectProject(androidRoot, requiredStage);
  const compatibilityBefore = inspectTauriAndroidCompatibility(androidRoot, runtimeRoot, requiredStage);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    requiredStage,
    runtimeRoot,
    androidRoot,
    initialProjectExists: before.exists,
    missingFilesBefore: before.missingFiles,
    fullMissingFilesBefore: before.fullMissingFiles,
    deferredFiles: before.deferredFiles,
    deferredFilesBefore: before.deferredMissingFiles,
    initializationRequested: !before.complete || compatibilityBefore.status === "incompatible",
    reinitialized: false,
    initializationCommand: String(options["init-command"]),
    initializationExitCode: null,
    finalProjectComplete: false,
    fullProjectComplete: false,
    missingFilesAfter: [],
    fullMissingFilesAfter: [],
    deferredFilesAfter: [],
    requiredFiles: before.requiredFiles,
    fullRequiredFiles: before.fullRequiredFiles,
    mainActivityFilesBefore: before.mainActivityFiles,
    mainActivityFilesAfter: [],
    compatibilityBefore,
    compatibilityAfter: null,
    compatibilityFailureCode: null,
    status: "PASS",
    failureCode: null,
    message: requiredStage === "bootstrap"
      ? "Bootstrap Android project is complete; Tauri build will generate deferred files."
      : "Generated Android project is complete; initialization was not required.",
  };

  if (!before.complete || compatibilityBefore.status === "incompatible") {
    report.reinitialized = true;
    report.message = compatibilityBefore.status === "incompatible"
      ? "Generated Android project is stale or incompatible with the locked Tauri Android API and will be regenerated."
      : before.exists
        ? "Generated Android project was incomplete and will be regenerated."
      : "Generated Android project was missing and will be initialized.";
    fs.rmSync(androidRoot, { recursive: true, force: true });
    const initArgs = options["init-args-base64"]
      ? JSON.parse(Buffer.from(String(options["init-args-base64"]), "base64").toString("utf8"))
      : ["run", "tauri", "--", "android", "init", "--ci", "--skip-targets-install"];
    const result = runCommand(String(options["init-command"]), initArgs, {
      cwd: runtimeRoot,
      windowsHide: true,
    });
    report.initializationExitCode = result.status;
    report.initializationError = result.error?.message ?? null;
    report.initializationStdout = decodeChildOutput(result.stdout).slice(-4000);
    report.initializationStderr = decodeChildOutput(result.stderr).slice(-4000);
    if (result.error || result.status !== 0) {
      report.status = "FAIL";
      report.failureCode = "ANDROID_GENERATED_PROJECT_INIT_FAILED";
      report.message = `tauri android init failed: ${result.error?.message || `exit code ${result.status}`}`;
    }
  }

  const after = inspectProject(androidRoot, requiredStage);
  report.finalProjectComplete = after.complete;
  report.fullProjectComplete = after.fullComplete;
  report.missingFilesAfter = after.missingFiles;
  report.fullMissingFilesAfter = after.fullMissingFiles;
  report.deferredFilesAfter = after.deferredMissingFiles;
  report.mainActivityFilesAfter = after.mainActivityFiles;
  report.compatibilityAfter = after.tauriApiCompatibility;
  if (!after.complete) {
    report.status = "FAIL";
    report.failureCode = "ANDROID_GENERATED_PROJECT_INCOMPLETE";
    report.message = `Generated Android project is incomplete; missing: ${after.missingFiles.join(", ")}`;
  } else if (after.tauriApiCompatibility.status === "incompatible") {
    report.status = "FAIL";
    report.failureCode = "ANDROID_TAURI_ANDROID_API_INCOMPATIBLE";
    report.compatibilityFailureCode = "ANDROID_TAURI_ANDROID_API_INCOMPATIBLE";
    report.message = `Generated Android project is incompatible with the locked Tauri Android API; ${after.tauriApiCompatibility.reasons.join(" ")}`;
  } else if (report.status === "PASS" && report.reinitialized) {
    report.message = requiredStage === "bootstrap"
      ? "Bootstrap Android project was initialized or repaired successfully; Tauri build will generate deferred files."
      : "Generated Android project was initialized or repaired successfully.";
  } else if (report.status === "PASS" && requiredStage === "bootstrap") {
    report.message = after.fullComplete
      ? "Bootstrap Android project is complete; all deferred files are already present."
      : "Bootstrap Android project is complete; Tauri build will generate deferred files.";
  }
  writeReport(reportPath, report);
  if (report.status !== "PASS") process.exitCode = 2;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
