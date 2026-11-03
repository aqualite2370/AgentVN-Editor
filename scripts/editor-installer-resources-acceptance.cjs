// Inspect actual installer payloads. Never substitute source/bundle-workspace
// for missing installation files, and never alter a registered user installation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { captureRuntimeCandidate, verifyRuntimeCandidate } = require("./lib/installer-payload-provenance.cjs");
const root = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "editor/src-tauri/tauri.conf.json"), "utf8"));
// package-installers.ps1 restores development versions after packaging.
// An explicit release version selects the real installers and is still checked
// against every deployed build-versions.json (never synthesized or overwritten).
if (process.argv[3]) {
  assert.match(process.argv[3], /^\d+\.\d+\.\d+$/, "explicit release version must be semver");
  config.version = process.argv[3];
}
const runRoot = path.resolve(process.argv[2] || "");
assert.ok(process.argv[2], "pass an explicit fresh acceptance directory");
assert.ok(!fs.existsSync(runRoot), `refusing to overwrite acceptance evidence: ${runRoot}`);
fs.mkdirSync(runRoot, { recursive: true });
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const describe = file => ({ path: file, sha256: hash(file), modifiedAt: fs.statSync(file).mtime.toISOString(), bytes: fs.statSync(file).size });
const bundle = path.join(root, "editor/src-tauri/target/release/bundle");
// Packaging may clean target/bundle after copying the actual installers.
// Accept an explicit release directory, never guess the newest nearby build.
const releaseDirectory = process.argv[4] ? path.resolve(process.argv[4]) : null;
// Current releases are EXE-only. Historical three-package inspections must
// explicitly opt in, so an absent MSI cannot block a current NSIS candidate.
const includeLegacyMsi = process.argv.includes("--with-legacy-msi");
function installerFile(kind, language) {
  if (!releaseDirectory) return path.join(bundle, kind, kind === "nsis"
    ? `${config.productName}_${config.version}_x64-setup.exe`
    : `${config.productName}_${config.version}_x64_${language}.msi`);
  const stem = `${config.productName.replace(/[^A-Za-z0-9._-]/g, "_")}_v${config.version}_`;
  const suffix = kind === "nsis" ? ".exe" : `_${language}.msi`;
  const candidates = fs.readdirSync(releaseDirectory).filter(name => name.startsWith(stem) && name.endsWith(suffix));
  assert.equal(candidates.length, 1, `expected one explicit ${kind}/${language || ""} installer, not an inferred version`);
  return path.join(releaseDirectory, candidates[0]);
}
const sevenZip = "C:/Program Files/7-Zip/7z.exe";
const report = { status: "RUNNING", version: config.version, startedAt: new Date().toISOString(),
  installerFormat: includeLegacyMsi ? "legacy-nsis-and-msi" : "nsis", installers: [], deployments: [] };
const runtimeCandidate = captureRuntimeCandidate(path.join(root, "editor/src-tauri/binaries"));
report.runtimeCandidate = runtimeCandidate;
function run(command, args, log) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
  fs.writeFileSync(path.join(runRoot, log), `${result.stdout || ""}\n${result.stderr || ""}\n${result.error || ""}`, "utf8");
  assert.equal(result.status, 0, `${command} failed (${result.status}); inspect ${log}`);
}
function files(directory, basename) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...files(file, basename));
    else if (entry.name === basename) found.push(file);
  }
  return found;
}
function verifyDeployment(directory, kind) {
  const versions = files(directory, "build-versions.json");
  assert.equal(versions.length, 1, `${kind}: expected one installed root version resource`);
  const metadata = JSON.parse(fs.readFileSync(versions[0], "utf8"));
  assert.equal(metadata.editorVersion, config.version, `${kind}: installed version mismatch`);
  const installedRoot = path.dirname(versions[0]);
  const names = JSON.parse(fs.readFileSync(path.join(root, "scripts/standalone-build-scripts.json"), "utf8")).scripts;
  for (const name of names) {
    const installed = path.join(installedRoot, "scripts", name);
    assert.equal(hash(installed), hash(path.join(root, "scripts", name)), `${kind}: stale/missing helper ${name}`);
  }
  for (const relative of [
    "GameCli_framework/package.json", "shared/cartridge/types.ts",
    "GameCli_framework/node_modules/lucide-react/dist/cjs/lucide-react.js",
    "GameCli_framework/node_modules/sharp/dist/index.cjs",
    "windows-offline-tools/NSIS/Bin/makensis.exe", "agentvn-player.exe", "creator-backend.exe",
  ]) assert.ok(fs.statSync(path.join(installedRoot, relative)).size > 0, `${kind}: missing ${relative}`);
  const editors = files(installedRoot, "agentvn-editor.exe");
  const runtimeProvenance = verifyRuntimeCandidate(installedRoot, runtimeCandidate);
  assert.equal(editors.length, 1, `${kind}: installed editor not found`);
  // Tauri patches bundle-type information separately for NSIS and MSI, so
  // installer executables may legitimately differ from the final release EXE.
  assert.equal(fs.readFileSync(editors[0]).subarray(0, 2).toString("ascii"), "MZ");
  report.deployments.push({ kind, installedRoot, versionResource: describe(versions[0]), executable: describe(editors[0]), scriptCount: names.length, runtimeProvenance });
}
try {
  const nsis = installerFile("nsis");
  report.installers.push(describe(nsis));
  run(sevenZip, ["x", nsis, `-o${path.join(runRoot, "nsis-payload")}`, "-y"], "nsis-extraction.log");
  verifyDeployment(path.join(runRoot, "nsis-payload"), "NSIS actual payload");
  for (const language of includeLegacyMsi ? ["en-US", "zh-CN"] : []) {
    const msi = installerFile("msi", language);
    report.installers.push(describe(msi));
    // Windows Installer administrative deployment keeps existing registrations
    // and existing user installs intact while materializing the shipped tree.
    const target = path.join(runRoot, `msi-${language}`);
    run("msiexec.exe", ["/a", msi, "/qn", `TARGETDIR=${target}`, "/L*V", path.join(runRoot, `msi-${language}.log`)], `msi-${language}-process.log`);
    verifyDeployment(target, `MSI ${language} administrative deployment`);
  }
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED";
  report.error = String(error.stack || error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(runRoot, "installer-resource-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
