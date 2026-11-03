"use strict";
// Independent evidence/cleanup audit; does not launch apps or call a model.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { gunzipSync } = require("node:zlib");
const { execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { sha256, inside } = require("./lib/installed-acceptance.cjs");
const rawArgs = process.argv.slice(2), installedOnly = rawArgs.includes("--installed-only");
const [rootArg, matrixArg, outputArg, installationArg] = rawArgs.filter(arg => arg !== "--installed-only");
assert(rootArg && matrixArg && outputArg);
const root = path.resolve(rootArg), matrix = path.resolve(matrixArg), out = path.resolve(outputArg);
assert(root.startsWith("F:\\AgentVN\\QA\\") && inside(root, matrix) && inside(root, out));
assert(!fs.existsSync(out), "Historical audit output must never be overwritten");
fs.mkdirSync(out);
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
function findInstallationReceipt(expectedExecutable) {
  const legacy = path.join(root, "release-install-01", "actual-installation.json");
  const candidates = installationArg ? [path.resolve(installationArg)] : [legacy];
  if (installationArg && !inside(root, path.resolve(installationArg))) {
    throw new Error(`Installation receipt is outside the evidence root: ${installationArg}`);
  }
  if (installationArg && !fs.existsSync(path.resolve(installationArg))) {
    throw new Error(`Installation receipt does not exist: ${installationArg}`);
  }
  if (installationArg) {
    const value = read(path.resolve(installationArg));
    if (path.resolve(value.executable?.path || "") !== path.resolve(expectedExecutable)) {
      throw new Error(`Installation receipt does not match ${expectedExecutable}`);
    }
    return { path: path.resolve(installationArg), value };
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name, "actual-installation.json");
    if (fs.existsSync(candidate)) candidates.push(candidate);
  }
  const expected = path.resolve(expectedExecutable);
  for (const candidate of candidates) {
    try {
      const value = read(candidate);
      if (path.resolve(value.executable?.path || "") === expected) return { path: candidate, value };
    } catch {
      // Keep searching; unrelated or incomplete receipts are not this run's
      // installation evidence.
    }
  }
  throw new Error(`No installation receipt matches ${expectedExecutable}`);
}
const report = {
  status: "RUNNING", startedAt: new Date().toISOString(), cases: [],
  scope: "INSTALLED_HIDE_MATRIX_EVIDENCE_AND_OWNED_CLEANUP_ONLY",
  nativePicker: "BLOCKED_NOT_EXERCISED", normalWindowClose: "NOT_EXERCISED",
  Android: "NOT_RUN", physical4K: false, newModelRequests: 0,
};
async function check(name, action) {
  const detail = await action();
  report.cases.push({ name, status: "PASS", detail });
}
(async () => {
  const result = read(path.join(matrix, "report.json"));
  await check("exact-nonempty-dual-layout-matrix-and-actual-PNG-parameters", () => {
    assert.equal(result.status, "PASS");
    assert.equal(result.cases.length, 24);
    assert.equal(result.screenshots.length, 24);
    const keys = new Set();
    for (let i = 0; i < result.cases.length; i++) {
      const row = result.cases[i], image = result.screenshots[i];
      assert.equal(row.status, "PASS");
      const key = `${row.layout}-${row.width}-${row.dpr}-${row.reduced}`;
      assert(!keys.has(key)); keys.add(key);
      assert(["agentvn", "renpy"].includes(row.layout));
      assert([[1920, 1080], [2560, 1440], [3840, 2160]]
        .some(([w, h]) => w === row.width && h === row.height));
      assert([1, 2].includes(row.dpr) && typeof row.reduced === "boolean");
      assert(inside(matrix, image.path));
      const expected = { width: row.width, height: row.height, dpr: row.dpr, reduced: row.reduced };
      assert.deepEqual(image.before, expected); assert.deepEqual(image.after, expected);
      const bytes = fs.readFileSync(image.path);
      assert.equal(sha256(bytes), image.sha256);
      assert.equal(bytes.readUInt32BE(16), row.width * row.dpr);
      assert.equal(bytes.readUInt32BE(20), row.height * row.dpr);
      const frames = JSON.parse(gunzipSync(fs.readFileSync(path.join(matrix, `${key}-frames.json.gz`))));
      assert.equal(frames.length, row.frameCount);
      assert(frames.length > 0 && frames.filter(f => f.opacity > .001 && f.opacity < .999).length >= 2);
      assert(frames.every(f => f.scenes === 1 && !f.invalidFocus && f.overflow <= 1));
    }
    return { combinations: keys.size, screenshots: result.screenshots.length };
  });
  await check("actual-installed-executables-and-two-real-exported-layouts", async () => {
    const installation = findInstallationReceipt(result.installedEditor);
    const install = installation.value;
    assert.equal(install.status, "PASS");
    assert.equal(path.resolve(result.installedEditor), path.resolve(install.executable.path));
    assert.equal(sha256(fs.readFileSync(result.installedEditor)), install.executable.sha256);
    assert.equal(sha256(fs.readFileSync(result.playerExecutable.path)), result.playerExecutable.sha256);
    assert.equal(result.artifacts.length, 2);
    assert.deepEqual(result.artifacts.map(a => a.layout).sort(), ["agentvn", "renpy"]);
    for (const artifact of result.artifacts) {
      assert(inside(matrix, artifact.path));
      const bytes = fs.readFileSync(artifact.path);
      assert.equal(sha256(bytes), artifact.sha256); assert.equal(bytes.length, artifact.bytes);
      const zip = await JSZip.loadAsync(bytes);
      const skin = JSON.parse(await zip.file("ui/layout.json").async("string"));
      const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      assert.equal(skin.layout_type || "agentvn", artifact.layout);
      assert.equal(manifest.runtime_version, "0.25.0");
    }
    return {
      installationReceipt: installation.path,
      editor: install.executable, player: result.playerExecutable, artifacts: result.artifacts,
    };
  });
  if (installedOnly) {
    report.cases.push({
      name: "dev-and-shared-database-frozen-check",
      status: "NOT_APPLICABLE",
      detail: "Installed-only audit intentionally does not assert a prior release-package receipt or shared database hash.",
    });
  } else await check("dev-still-matches-the-frozen-build-and-shared-database-unchanged", () => {
    const built = read(path.join(root, "release-package-01/report.json"));
    assert.equal(built.status, "PASS");
    const dev = "D:\\AgentVN\\AgentVN Dev.exe";
    assert.equal(sha256(fs.readFileSync(dev)), built.beforeDev.sha256);
    assert.equal(sha256(fs.readFileSync(dev)),
      sha256(fs.readFileSync("D:\\AgentVN\\editor\\src-tauri\\target\\debug\\agentvn-editor.exe")));
    const database = path.join(process.env.APPDATA, "com.agentvn.editor/backend/vn_engine.db");
    const dbHash = sha256(fs.readFileSync(database));
    assert.equal(dbHash, "984d7a62038312040b8d510312bb01ef0268e8d9c9987ea04181db531f4ab1e3");
    return { dev, devSha256: built.beforeDev.sha256, database, databaseSha256: dbHash };
  });
  await check("all-hide-attempt-owned-processes-and-ports-stopped", () => {
    const attempts = fs.readdirSync(root).filter(name => /^installed-hide-matrix-/.test(name));
    const pids = new Set(), ports = new Set(), runs = [];
    for (const name of attempts) {
      const file = path.join(root, name, "report.json");
      if (!fs.existsSync(file)) continue; // Precheck failed before launching anything.
      const attempt = read(file); assert.notEqual(attempt.status, "RUNNING");
      assert.equal(attempt.modelRequests, 0);
      if (attempt.cleanup.length === 0 && attempt.cases.length === 0) {
        continue; // Input/fixture precheck failure; no product process was launched.
      }
      assert(attempt.cleanup.length > 0);
      for (const entry of attempt.cleanup) {
        if (entry.kind === "player") assert.equal(entry.exitCode, 0);
        else {
          assert.equal(entry.editor.exitCode, 0); assert.equal(entry.backend.exitCode, 0);
        }
      }
      for (const launch of fs.readdirSync(path.join(root, name)).filter(n => /^owned-launch-\d+$/.test(n))) {
        const state = read(path.join(root, name, launch, "installed-processes.json"));
        pids.add(state.editorPid); pids.add(state.backendPid);
        ports.add(state.cdpPort); ports.add(state.backendPort);
      }
      for (const player of attempt.players || []) { pids.add(player.pid); ports.add(player.port); }
      runs.push({ name, status: attempt.status, completedCases: attempt.cases.length });
    }
    assert(runs.length > 0 && pids.size > 0 && ports.size > 0);
    const text = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `$hideAuditPids=@(${[...pids].join(",")}); $hideAuditPorts=@(${[...ports].join(",")}); ` +
      "[pscustomobject]@{processes=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in $hideAuditPids } | Select-Object ProcessId,ExecutablePath);" +
      "listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $hideAuditPorts } | Select-Object LocalPort,OwningProcess)} | ConvertTo-Json -Depth 4 -Compress"],
    { windowsHide: true, encoding: "utf8" });
    const actual = JSON.parse(text);
    assert.equal(actual.processes.length, 0); assert.equal(actual.listeners.length, 0);
    return { runs, pidCount: pids.size, portCount: ports.size, actual };
  });
  assert.equal(report.cases.length, installedOnly ? 4 : 4);
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
});
