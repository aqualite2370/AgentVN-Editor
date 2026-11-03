"use strict";
// Explicit new candidate scope; old installed-runtime-motion-current keeps its historical defaults.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2], smoke = process.argv.includes("--smoke");
assert.match(attempt, /^\d{2}$/);
const out = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-motion-1922-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), out, smoke, commands: [],
  scope: "ACTUAL_1922_INSTALLED_SHIPPED_PLAYER_PREVIEW_NO_STANDALONE_SAVE_OR_NORMAL_EXIT_CLAIM",
  productChanges: 0, builds: 0, modelRequests: 0, normalCloseClaimed: false };
const save = () => fs.writeFileSync(path.join(out, "session.json"), JSON.stringify(report, null, 2));
let prepared = false;
async function command(exe, args, label, env = process.env) {
  const row = { label, command: [exe, ...args], startedAt: new Date().toISOString(), status: "RUNNING",
    log: path.join(out, `${label}.log`) }; report.commands.push(row); save();
  const fd = fs.openSync(row.log, "wx");
  try {
    const child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    row.status = row.exitCode === 0 ? "PASS" : "FAILED";
    assert.equal(row.exitCode, 0, `${label}: ${row.log}`);
  } finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); save(); }
}
const profile = action => command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
  "scripts/native-dev-preview-profile.ps1", "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
`profile-${action.toLowerCase()}`);
(async () => {
  save();
  report.installation = desc("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json");
  const installed = read(report.installation.path);
  assert.equal(installed.status, "PASS"); assert.equal(installed.version, "1.9.22");
  for (const f of [installed.executable, ...installed.resources, installed.originalAudit, installed.originalInstallation])
    assert.equal(sha(f.path), f.sha256);
  report.executable = desc(path.join(installed.installRoot, "agentvn-player.exe"));
  assert.equal(report.executable.sha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");
  report.protectedProducts = read("F:/AgentVN/Checkpoints/Installed-Runtime-Motion-1922-20261023-01/report.json").products;
  for (const f of report.protectedProducts) assert.equal(sha(f.path), f.sha256);
  const win = read("F:/AgentVN/QA/Windows-Package-20261021-01/editor-04/report.json");
  const renpy = read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-44/report.json");
  assert.equal(win.status, "PASS"); assert.equal(renpy.status, "PASS");
  report.sources = [
    desc("F:/AgentVN/QA/Windows-Package-20261021-01/editor-04/report.json"),
    desc("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-44/report.json"),
  ];
  const cartridges = [ { ...win.observedFiles.find(f => f.path.endsWith(".vncart")), layout: "agentvn" },
    { ...renpy.cartridge, layout: "renpy" } ];
  for (const c of cartridges) assert.equal(sha(c.path), c.sha256);
  report.cartridges = cartridges;
  const input = win.input.path; assert.equal(sha(input), win.input.sha256);
  const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
  report.environment = { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out };
  for (const g of ["installed-runtime-motion-1922-policy-test.cjs", "native-runtime-motion-audit-test.cjs",
    "native-runtime-state-viewport-test.cjs"])
    await command(process.execPath, [path.join("scripts", g)], `guard-${g}`);
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
  report.tools = [__filename, "scripts/native-runtime-motion-playwright.cjs",
    "scripts/native-dev-preview-profile.ps1", "scripts/lib/installed-runtime-preview-1922-session.cjs",
    "scripts/lib/installed-runtime-motion-1922-policy.cjs", "scripts/lib/native-runtime-motion-oracle.cjs",
    "scripts/lib/installed-runtime-session.cjs", "scripts/lib/installed-runtime-motion-sampler.cjs",
    "scripts/lib/current-native-capture.cjs"].map(f => {
      const source = desc(f), copy = path.join(out, "tools", path.basename(f));
      fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source.path, copy, fs.constants.COPYFILE_EXCL);
      return source;
    });
  prepared = true; await profile("Prepare");
  const journal = read(path.join(out, "profile-protection.json"));
  const prep = { status: "PASS", sessionRoot: out, executable: report.executable,
    defaultStorage: "CODEX_EXPLICIT_PROFILE_JUNCTION_PREVIEW", storageScope: "PREVIEW_CODEX_EXPLICIT_PROFILE_JUNCTION_NO_DEFAULT_STORAGE_CLAIM",
    fixture: { input, inputSha256: sha(input) }, profiles: journal.records.filter(r => r.existed),
    cartridges, temporary, current1922Preview: true };
  const prepFile = path.join(out, "preparation.json"); fs.writeFileSync(prepFile, JSON.stringify(prep, null, 2), { flag: "wx" });
  await command(process.execPath, ["scripts/native-runtime-motion-playwright.cjs", "--current-native-preparation", prepFile,
    ...(smoke ? ["--smoke"] : [])], "motion", { ...process.env, ...report.environment, TEMP: temporary, TMP: temporary });
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    assert(!rows().some(p => p.Name === "agentvn-player.exe" || p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out)));
    if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
      await profile("Restore"); report.restoration = desc(path.join(out, "profile-restoration.json"));
      assert.equal(read(report.restoration.path).status, "PASS");
    }
    for (const f of [...(report.protectedProducts || []), ...(report.tools || []), ...(report.cartridges || [])])
      assert.equal(sha(f.path), f.sha256);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
