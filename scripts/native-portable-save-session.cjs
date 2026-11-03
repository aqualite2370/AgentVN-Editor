"use strict";
// Assembles a QA fixture from an unchanged current Player and historical tiny
// UI-exported cartridge. Not an Editor export, installer or upgrade.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawn } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const root = path.resolve(__dirname, ".."), base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const iteration = process.argv[2]; assert(/^\d{2}$/.test(iteration));
const layout = process.argv[process.argv.indexOf("--layout") + 1];
assert(process.argv.includes("--layout") && ["agentvn", "renpy"].includes(layout));
const smoke = process.argv.includes("--smoke"), out = path.join(base, `portable-${iteration}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const report = { status: "RUNNING", at: new Date().toISOString(), layout, smoke, commands: [], tools: [],
  scope: "ASSEMBLED_CURRENT_NATIVE_FIXED_GAME_FIXTURE_NOT_EDITOR_EXPORT_SETUP_UPGRADE_OR_ANDROID",
  productChanges: 0, builds: 0, installs: 0, modelRequests: 0, deviceOperations: 0 };
const save = () => fs.writeFileSync(path.join(out, "session.json"), JSON.stringify(report, null, 2));
const env = { ...process.env, AGENTVN_WORKSPACE_OUTPUT: out };
const profileTool = path.join(root, "scripts/native-dev-preview-profile.ps1");
let profileJournal = false;
async function command(executable, args, label) {
  const row = { command: [executable, ...args], at: new Date().toISOString(), status: "RUNNING",
    log: path.join(out, label + ".log") }; report.commands.push(row); save();
  const fd = fs.openSync(row.log, "wx");
  try {
    const child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    row.status = row.exitCode === 0 ? "PASS" : "FAILED"; assert.equal(row.exitCode, 0, row.log);
  } finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); save(); }
}
(async () => {
  for (const relative of ["scripts/native-portable-save-session.cjs", "scripts/native-portable-saves-playwright.cjs",
    "scripts/native-portable-save-acl.ps1", "scripts/native-dev-preview-profile.ps1",
    "scripts/lib/installed-runtime-session.cjs", "scripts/lib/current-native-capture.cjs", "scripts/lib/runtime-qa-acl.ps1"]) {
    const target = path.join(out, path.basename(relative));
    fs.copyFileSync(path.join(root, relative), target, fs.constants.COPYFILE_EXCL); report.tools.push(describe(target));
  }
  const source = read(path.join(base, "exit-04/preparation.json"));
  const build = read("F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-01/verified-build.json");
  report.products = build.products.map(p => { assert.equal(sha(p.path), p.sha256); return describe(p.path); });
  assert.equal(sha(source.fixture.input), source.fixture.inputSha256);
  const project = path.join(out, "存档迁移 隔离小工程.vnproj");
  fs.copyFileSync(source.fixture.input, project, fs.constants.COPYFILE_EXCL); env.AGENTVN_TEST_PROJECT = project;
  const cartridge = source.cartridges.find(c => c.layout === layout); assert.equal(sha(cartridge.path), cartridge.sha256);
  const cartridgePath = path.join(out, layout + ".vncart");
  fs.copyFileSync(cartridge.path, cartridgePath, fs.constants.COPYFILE_EXCL);
  const client = path.join(out, "便携 客户端"), resource = path.join(client, "embedded-cartridge");
  fs.mkdirSync(resource, { recursive: true });
  const exe = path.join(client, "临时客户端.exe");
  fs.copyFileSync(report.products[2].path, exe, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(exe), report.products[2].sha256);
  const zip = await JSZip.loadAsync(fs.readFileSync(cartridgePath)), resources = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    assert(!name.includes("\\") && !name.includes("\0") && !path.posix.isAbsolute(name)
      && name.split("/").every(p => p && p !== "." && p !== ".." && !p.includes(":")));
    const target = path.resolve(resource, name); assert(target.startsWith(path.resolve(resource) + path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, await entry.async("nodebuffer"), { flag: "wx" }); resources.push(describe(target));
  }
  const manifest = read(path.join(resource, "manifest.json"));
  assert(/^[a-zA-Z0-9_-]+$/.test(manifest.game_id));
  const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
  const unrelatedCwd = path.join(out, "unrelated-cwd"); fs.mkdirSync(unrelatedCwd);
  profileJournal = true;
  await command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", profileTool,
    "-Action", "Prepare", "-RunDirectory", out, "-Storage", "NativeRoaming"], "profile-prepare");
  const journal = read(path.join(out, "profile-protection.json"));
  const prep = { status: "PASS", at: new Date().toISOString(), sessionRoot: out,
    scope: report.scope, defaultStorage: "PHYSICAL_DEFAULT_PATH", layout, smoke,
    source: describe(path.join(base, "exit-04/preparation.json")), executable: describe(exe),
    sourceExecutable: report.products[2], resources, gameId: manifest.game_id,
    expectedTarget: path.join(client, "saves", manifest.game_id, "preview_gamecli"),
    expectedLegacy: "C:\\Users\\1\\AppData\\Roaming\\com.agentvn.player\\saves\\preview_gamecli",
    fixture: { ...source.fixture, input: project, inputSha256: sha(project) },
    cartridges: [{ ...cartridge, path: cartridgePath }], profiles: journal.records.filter(r => r.existed),
    webview: path.join(out, "webview"), temporary, unrelatedCwd };
  const file = path.join(out, "preparation.json");
  fs.writeFileSync(file, JSON.stringify(prep, null, 2), { flag: "wx" });
  await command(process.execPath, ["scripts/native-portable-saves-playwright.cjs", "--preparation", file], "portable");
  const result = read(path.join(out, "portable.json")); assert.equal(result.status, "PASS");
  report.status = smoke ? "CURRENT_NATIVE_PORTABLE_SMOKE_PASS" : "CURRENT_NATIVE_PORTABLE_SAVE_MIGRATION_PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    if (profileJournal && fs.existsSync(path.join(out, "profile-protection.json"))) {
      const literal = "'" + path.resolve(out).replaceAll("'", "''") + "'";
      await command("powershell.exe", ["-NoProfile", "-Command",
        `$qaRun=${literal};$qaActive=@(Get-CimInstance Win32_Process|Where-Object {` +
        `($_.ExecutablePath -and $_.ExecutablePath.StartsWith($qaRun+'\\',[StringComparison]::OrdinalIgnoreCase)) -or ` +
        `($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like ('*'+$qaRun+'*'))});` +
        `if($qaActive.Count){throw 'Owned fixture or WebView still active; refuse restoring user profile'};` +
        `Write-Output 'PASS owned fixture and WebView absent before original-profile restoration'`], "profile-process-guard");
      await command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", profileTool,
        "-Action", "Restore", "-RunDirectory", out], "profile-restore");
      assert.equal(read(path.join(out, "profile-restoration.json")).status, "PASS");
      report.profileRestoration = describe(path.join(out, "profile-restoration.json"));
    }
    for (const p of report.products || []) assert.equal(sha(p.path), p.sha256);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, layout, smoke, error: report.error, cleanupError: report.cleanupError, out }));
});
