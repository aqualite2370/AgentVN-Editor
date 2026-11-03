"use strict";
// Reuse the full native upgrade workflow with explicit, versioned inputs.
// This is QA only: it never rebuilds old packages or changes product code.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { ps, rows } = require("./lib/current-native-editor-session.cjs");
const previous = require("./candidate-1930-editor-upgrade.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const describe = f => ({ path: path.resolve(f), sha256: sha(f) });
const originals = {
  business: ["candidate-1924-editor-upgrade.cjs", "e1f4b9f0c040595d1e84dfc6117c7609d7c7e288308e9907ac67a1c64eb1fcb1"],
  session: ["candidate-1924-editor-upgrade-session.ps1", "46bbca490bcc316d467b97d34dd5ca3c5624db881caeddee9995aec23bc2dbd7"],
  audit: ["candidate-1924-editor-upgrade-audit.cjs", "ab1f654bf7f83f54083889a42a8f95b41538e8119b51b3da4096d054f032f6b4"],
};
function validateConfig(c) {
  assert.match(c.oldVersion, /^\d+\.\d+\.\d+$/);
  assert.match(c.version, /^\d+\.\d+\.\d+$/);
  const before = c.oldVersion.split(".").map(Number), after = c.version.split(".").map(Number);
  const differing = after.findIndex((n, i) => n !== before[i]);
  assert(differing >= 0 && after[differing] > before[differing], "Candidate version must increase");
  for (const key of ["out", "checkpoint", "preparation"]) {
    const prefix = key === "checkpoint" ? "F:/AgentVN/Checkpoints/" : "F:/AgentVN/QA/";
    assert(path.resolve(c[key]).startsWith(path.resolve(prefix) + path.sep), key);
    assert(!c[key].includes("'"));
  }
  assert.notEqual(path.resolve(c.out), path.resolve(c.preparation));
  assert.match(c.oldInstaller.sha256, /^[a-f0-9]{64}$/);
  assert.match(c.actualInstallation.sha256, /^[a-f0-9]{64}$/);
  assert.match(c.installerSHA256, /^[a-f0-9]{64}$/);
}
function original(kind) {
  const [name, hash] = originals[kind], file = path.join(__dirname, name);
  assert.equal(sha(file), hash, "Preserved full workflow source changed");
  return fs.readFileSync(file, "utf8");
}
function registration() {
  const r = JSON.parse(ps("$k=Get-ItemProperty -LiteralPath " +
    "'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentVN Editor';" +
    "[PSCustomObject]@{path=([string]$k.InstallLocation).Trim('\"');version=$k.DisplayVersion}|ConvertTo-Json -Compress"));
  assert(path.resolve(r.path).startsWith(path.resolve("F:/AgentVN/QA") + path.sep));
  assert(fs.existsSync(path.join(r.path, "agentvn-editor.exe")));
  assert(!r.path.includes("'"));
  return r;
}
function assertInstallationRestored(actual) {
  if (actual.registryRestored === true) return;
  assert.equal(actual.metadataRestoration, "PASS",
    "Installation receipt must prove registry/profile restoration");
  assert(actual.actualRegistration && Array.isArray(actual.actualRegistration.values),
    "Installation receipt must retain the actual registration snapshot");
}
function adapt(kind, input, c, registered) {
  const base = kind === "session" ? previous.buildSession(input, registered.path) : previous.build(kind, input);
  let source = base.source;
  const changes = [...base.changes], one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, `${kind}: missing/ambiguous ${before}`);
    source = source.replace(before, () => after); changes.push({ before, after });
  };
  if (kind === "session") {
    one("$run='F:\\AgentVN\\QA\\Editor-Upgrade-1930-20261026-01'", `$run='${c.out.replaceAll("/", "\\")}'`);
    one("$checkpoint='F:\\AgentVN\\Checkpoints\\Editor-Upgrade-1930-20261026-01'",
      `$checkpoint='${c.checkpoint.replaceAll("/", "\\")}'`);
    one("$old='D:\\AgentVN\\releases\\editor\\AgentVN_Editor_v1.9.29_20261026_080949.exe'",
      `$old='${c.oldInstaller.path.replaceAll("/", "\\")}'`);
    one("$sealed='F:\\AgentVN\\QA\\Editor-1.9.30-20261026-01\\upgrade-preparation-01\\candidate-installation.json'",
      `$sealed='${path.join(c.preparation, "candidate-installation.json")}'`);
    one("'D:\\AgentVN\\scripts\\candidate-1930-editor-upgrade.cjs'", `'${__filename}'`);
    assert.equal(source.split("editor-upgrade-1930-20261026-01").length - 1, 2);
    source = source.replaceAll("editor-upgrade-1930-20261026-01", path.basename(c.out).toLowerCase());
  } else {
    one("F:/AgentVN/QA/Editor-Upgrade-1930-20261026-01", c.out);
    if (kind === "business") {
      one(JSON.stringify(path.resolve("F:/AgentVN/QA/Editor-1.9.30-20261026-01/upgrade-preparation-01/session.ps1")),
        JSON.stringify(path.join(c.preparation, "session.ps1")));
      one('scope:"REAL_NSIS_1_9_29_TO_1_9_30_DEFAULT_PATHS_ON_DEVELOPMENT_HOST"',
        `scope:${JSON.stringify(`REAL_NSIS_${c.oldVersion.replaceAll(".", "_")}_TO_${c.version.replaceAll(".", "_")}_DEFAULT_PATHS_ON_DEVELOPMENT_HOST`)}`);
      one("Editor升级1930临时工程", `Editor升级${c.version}临时工程`);
    }
  }
  // Replace version tokens simultaneously so old→new does not remap twice.
  source = source.replace(/(?<![A-Za-z0-9])1\.9\.(?:29|30)/g, v => v === "1.9.29" ? c.oldVersion : c.version);
  if (kind !== "session") new vm.Script(Module.wrap(source));
  return { source, changes };
}
function prepare(c, configFile) {
  validateConfig(c);
  const bindingFile = path.join(c.preparation, "binding.json");
  if (fs.existsSync(bindingFile)) {
    const binding = read(bindingFile);
    assert.deepEqual(binding.config, c);
    for (const f of binding.files) assert.equal(sha(f.path), f.sha256, f.path);
    return binding;
  }
  assert.equal(sha(c.actualInstallation.path), c.actualInstallation.sha256);
  const actual = read(c.actualInstallation.path);
  assert.equal(actual.status, "PASS"); assert.equal(actual.exitCode, 0); assertInstallationRestored(actual);
  const packageReceipt = actual.installer ?? actual.package;
  assert(packageReceipt, "Installation receipt must retain the installer package receipt");
  assert.equal(packageReceipt.sha256, c.installerSHA256);
  assert.equal(sha(packageReceipt.path), c.installerSHA256);
  assert.equal(sha(actual.executable.path), actual.executable.sha256);
  assert.equal(ps(`(Get-Item -LiteralPath '${actual.executable.path}').VersionInfo.ProductVersion`), c.version);
  assert.equal(sha(c.oldInstaller.path), c.oldInstaller.sha256);
  const registered = registration();
  assert(!fs.existsSync(c.out) && !fs.existsSync(c.checkpoint) && !fs.existsSync(c.preparation));
  const generated = Object.fromEntries(["business", "session", "audit"].map(k => [k, adapt(k, original(k), c, registered)]));
  const resources = ["creator-backend.exe", "agentvn-player.exe", "build-versions.json"]
    .map(n => describe(path.join(actual.installRoot, n)));
  const candidate = { status: "PASS", executable: { ...actual.executable, version: c.version },
    resources, package: packageReceipt,
    protectedFiles: [describe(c.actualInstallation.path), packageReceipt, actual.executable, ...resources,
      ...(c.protectedFiles || [])] };
  for (const f of candidate.protectedFiles) assert.equal(sha(f.path), f.sha256, f.path);
  fs.mkdirSync(c.preparation);
  const sealed = path.join(c.preparation, "candidate-installation.json");
  fs.writeFileSync(sealed, JSON.stringify(candidate, null, 2), { flag: "wx" });
  for (const [kind, result] of Object.entries(generated))
    fs.writeFileSync(path.join(c.preparation, kind === "session" ? "session.ps1" : `${kind}.cjs`), result.source, { flag: "wx" });
  const cleanupSource = fs.readFileSync(path.join(__dirname, "editor-upgrade-1930-cleanup.ps1"), "utf8")
    .replaceAll("F:\\AgentVN\\QA\\Editor-Upgrade-1930-20261026-01", c.out.replaceAll("/", "\\"))
    .replaceAll("editor-upgrade-1930-20261026-01", path.basename(c.out).toLowerCase());
  fs.writeFileSync(path.join(c.preparation, "cleanup.ps1"), cleanupSource, { flag: "wx" });
  const binding = { status: "PREPARED_NOT_TESTED", config: c, registered, modelRequests: 0, productChanges: 0,
    files: [__filename, configFile, c.actualInstallation.path, c.oldInstaller.path, sealed,
      ...["business.cjs", "session.ps1", "audit.cjs", "cleanup.ps1"].map(n => path.join(c.preparation, n)),
      ...Object.values(originals).map(([n]) => path.join(__dirname, n)),
      path.join(__dirname, "candidate-1930-editor-upgrade.cjs")].map(describe),
    adaptations: Object.fromEntries(Object.entries(generated).map(([k, v]) => [k, v.changes])) };
  fs.writeFileSync(bindingFile, JSON.stringify(binding, null, 2), { flag: "wx" });
  return binding;
}
function main() {
  const [action, configFile] = process.argv.slice(2);
  assert(["--self-test", "run", "audit", "cleanup", "verify-cleanup"].includes(action) && configFile);
  const c = read(configFile), binding = prepare(c, path.resolve(configFile));
  assert(!rows().some(p => /^(AgentVN Dev|agentvn-editor|agentvn-player|creator-backend)\.exe$/i.test(p.Name)));
  if (action === "--self-test") {
    let rejected = 0;
    for (const key of ["out", "checkpoint", "preparation"])
      for (const bad of ["F:/", "F:/AgentVN", "D:/AgentVN", "C:/Users/1"]) {
        assert.throws(() => validateConfig({ ...c, [key]: bad })); rejected++;
      }
    for (const kind of ["business", "session", "audit"]) {
      const input = original(kind);
      for (const change of adapt(kind, input, c, binding.registered).changes.filter(x => !x.count && input.includes(x.before))) {
        assert.throws(() => adapt(kind, input.replace(change.before, ""), c, binding.registered)); rejected++;
      }
    }
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(c.preparation, "session.ps1"), "-Action", "SelfTest"], { windowsHide: true, encoding: "utf8", timeout: 30000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const result = { status: "PASS", rejectedInvalidInputs: rejected, exactNativeBoundariesRejected: 8,
      oldVersion: c.oldVersion, version: c.version, nativeApps: 0, modelRequests: 0 };
    fs.writeFileSync(path.join(c.preparation, "self-test.json"), JSON.stringify(result, null, 2), { flag: "wx" });
    console.log(JSON.stringify(result)); return;
  }
  if (action === "cleanup" || action === "verify-cleanup") {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(c.preparation, "cleanup.ps1"), ...(action === "verify-cleanup" ? ["-VerifyOnly"] : [])],
    { windowsHide: true, encoding: "utf8", timeout: 180000, maxBuffer: 5e6 });
    console.log(r.stdout); assert.equal(r.status, 0, r.stderr); return;
  }
  if (action === "run") assert.deepEqual(registration(), binding.registered);
  process.argv.splice(2, process.argv.length - 2, action === "run" ? "run" : "01");
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker._compile(fs.readFileSync(path.join(c.preparation, action === "run" ? "business.cjs" : "audit.cjs"), "utf8"), __filename);
}
if (require.main === module) main();
module.exports = { validateConfig, adapt };
