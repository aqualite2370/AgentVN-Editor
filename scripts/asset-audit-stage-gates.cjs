"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const matrixPath = path.resolve(process.argv[2] || "");
const attempt = process.argv[3];
assert(attempt && /^gates-\d{2}$/.test(attempt), "Explicit fresh gates directory required");
const out = `F:/AgentVN/QA/Asset-Audit-20261021-01/${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const productFiles = [
  "editor/src/utils/assetAudit.ts", "editor/src/utils/editorAssetReferences.ts",
  "editor/src/components/editor/InspectorPanel.tsx", "editor/src/components/editor/SceneAssetAuditPanel.tsx",
  "editor/src/components/command-editors/CommandListEditor.tsx",
  "editor/src/components/command-editors/FloatingCommandWorkbench.tsx", "editor/src/styles/layout.css",
  "editor/src/types/assets.ts", "shared/cartridge/assetScanner.ts",
];
const report = { status: "RUNNING", scope: "SOURCE_BROWSER_AND_DEV_NOT_RELEASE_OR_DEVICE",
  startedAt: new Date().toISOString(), modelRequests: 0, steps: [] };
const persist = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function run(label, executable, args) {
  const step = { label, command: [executable, ...args], startedAt: new Date().toISOString(),
    log: path.join(out, `${report.steps.length + 1}-${label}.log`), status: "RUNNING" };
  report.steps.push(step); persist(); console.log(`START ${label}`);
  const log = fs.createWriteStream(step.log, { flags: "wx" });
  step.exitCode = await new Promise(resolve => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    step.pid = child.pid;
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    child.on("error", e => { step.error = String(e); });
    child.on("close", code => log.end(() => resolve(code)));
  });
  step.finishedAt = new Date().toISOString(); step.status = step.exitCode === 0 ? "PASS" : "FAILED";
  persist(); console.log(`${step.status} ${label}`);
  assert.equal(step.exitCode, 0, `${label} failed; do not proceed to Dev`);
}
(async () => {
  const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
  assert.equal(matrix.status, "PASS"); assert.equal(matrix.cleanup.status, "PASS");
  assert.equal(matrix.cases.length, 204);
  assert.deepEqual(matrix.errors, []);
  assert(!matrix.consoleErrors.some(e => /same key|unmounted|maximum update/i.test(e)));
  const combinations = new Map();
  for (const row of matrix.cases) {
    assert.equal(row.status, "PASS");
    assert([[1920,1080],[2560,1440],[3840,2160]].some(([w,h]) => w === row.width && h === row.height));
    assert([1,2].includes(row.dpr) && typeof row.reduced === "boolean");
    const key = [row.width,row.height,row.dpr,row.reduced].join(":");
    combinations.set(key, (combinations.get(key) || 0) + 1);
    if (row.screenshotPath) {
      const png = fs.readFileSync(row.screenshotPath);
      assert.equal(png.readUInt32BE(16), row.width * row.dpr);
      assert.equal(png.readUInt32BE(20), row.height * row.dpr);
      assert.equal(hash(row.packagePath), row.sha256);
    }
  }
  assert.equal(combinations.size, 12); assert([...combinations.values()].every(n => n === 17));
  report.matrix = { path: matrixPath, sha256: hash(matrixPath), cases: 204, combinations: 12 };
  report.sources = productFiles.map(file => {
    const full = path.join(root, file);
    assert(fs.statSync(full).mtimeMs <= Date.parse(matrix.startedAt), `Product changed after matrix began: ${file}`);
    return { file, sha256: hash(full) };
  });
  report.installer = { path: "D:/AgentVN/releases/editor/AgentVN_Editor_v1.9.21_20261022_005853.exe" };
  report.installer.sha256 = hash(report.installer.path);
  assert.equal(report.installer.sha256, "37832aec678c4dcb7f69f007407c823229539d5f23b82db2ea1f25348dd3a982");
  report.devBefore = { sha256: hash(path.join(root, "AgentVN Dev.exe")),
    modifiedAt: fs.statSync(path.join(root, "AgentVN Dev.exe")).mtime.toISOString() };
  const databasePath = path.join(process.env.APPDATA, "com.agentvn.editor/backend/vn_engine.db");
  if (fs.existsSync(databasePath)) report.defaultDatabase = { path: databasePath, beforeSha256: hash(databasePath) };
  persist();
  await run("asset-protocol", process.execPath, ["scripts/asset-audit-protocol-test.cjs", "green-04"]);
  await run("editor-typecheck", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run typecheck"]);
  await run("editor-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run build"]);
  await run("gamecli-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
  await run("asset-slot-guidance", process.execPath, ["scripts/asset-slot-guidance-contract.cjs"]);
  await run("project-save-payload", process.execPath, ["scripts/project-save-asset-payload-contract.cjs"]);
  for (const source of report.sources) assert.equal(hash(path.join(root, source.file)), source.sha256);
  if (process.argv.includes("--deliver-dev")) {
    const devBackup = path.join(out, "AgentVN Dev-before.exe");
    fs.copyFileSync(path.join(root, "AgentVN Dev.exe"), devBackup, fs.constants.COPYFILE_EXCL);
    assert.equal(hash(devBackup), report.devBefore.sha256);
    report.devBefore.backupPath = devBackup;
    await run("complete-dev", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
    const dev = path.join(root, "AgentVN Dev.exe");
    const debug = path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe");
    report.devAfter = { path: dev, sha256: hash(dev), modifiedAt: fs.statSync(dev).mtime.toISOString(), debugSha256: hash(debug) };
    assert.equal(report.devAfter.sha256, report.devAfter.debugSha256, "Root Dev must really be replaced");
    assert(fs.statSync(dev).mtimeMs >= Date.parse(report.steps.at(-1).startedAt), "Root Dev was not refreshed");
    assert(!fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")), "Pending is not successful replacement");
    for (const file of ["shared/cartridge/assetScanner.ts", "shared/cartridge/types.ts", "GameCli_framework/src/engine/validation.ts"]) {
      assert.equal(hash(path.join(root, file)), hash(path.join(root, "editor/src-tauri/bundle-workspace", file)));
    }
  }
  for (const source of report.sources) assert.equal(hash(path.join(root, source.file)), source.sha256);
  assert.equal(hash(report.installer.path), report.installer.sha256);
  if (report.defaultDatabase) {
    report.defaultDatabase.afterSha256 = hash(report.defaultDatabase.path);
    assert.equal(report.defaultDatabase.afterSha256, report.defaultDatabase.beforeSha256);
  }
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); persist(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); });
