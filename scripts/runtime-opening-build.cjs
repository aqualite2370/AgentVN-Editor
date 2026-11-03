"use strict";
// Build only after the new real-media matrix and existing menu behavior pass.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert(/^\d{2}$/.test(attempt || ""));
const base = "F:/AgentVN/QA/Runtime-Opening-20261023-01";
const out = path.join(base, `build-${attempt}`); assert(!fs.existsSync(out));
fs.mkdirSync(out);
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), commands: [], backups: [],
  scope: "SOURCE_QA_AND_DEV_BUILD_NOT_INSTALLER_ACCEPTANCE", modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function command(label, exe, args) {
  const c = { label, command: [exe, ...args], startedAt: new Date().toISOString(),
    log: path.join(out, `${label}.log`) };
  report.commands.push(c); save();
  const fd = fs.openSync(c.log, "wx");
  try {
    const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd] });
    c.pid = child.pid; save();
    c.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(c.exitCode, 0, `${label} failed: ${c.log}`);
    c.status = "PASS";
  } catch (e) { c.status = "FAILED"; throw e; }
  finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); }
}
(async () => {
  const matrixFile = path.join(base, "matrix-03/report.json");
  const interruptionFile = path.join(base, "matrix-04/report.json");
  const menuFile = path.join(base, "menu-regression-02/report.json");
  const matrix = read(matrixFile), followup = read(interruptionFile), menu = read(menuFile);
  // Preserve matrix-03's two QA failures. Only their explicit follow-up may
  // replace those cases; the other thirty run once against these same bytes.
  assert.equal(matrix.status, "FAILED"); assert.equal(matrix.cases.length, 32);
  const oldFailures = matrix.cases.filter(c => c.status === "FAILED");
  assert.equal(oldFailures.length, 2);
  assert(oldFailures.every(c => c.interrupt && c.kind === "video" && c.layout === "agentvn"
    && c.contextClosed && c.error.includes("Continuous opening handoff, including reduced motion")));
  assert.equal(followup.status, "PASS"); assert.equal(followup.mode, "INTERRUPTION_FOLLOWUP");
  assert.equal(followup.cases.length, 2);
  assert.deepEqual(followup.sources, matrix.sources, "Scoped follow-up must exercise the same product bytes");
  const acceptedCases = [...matrix.cases.filter(c => !c.interrupt), ...followup.cases];
  assert.equal(acceptedCases.length, 32);
  assert(acceptedCases.every(c => c.status === "PASS" && c.contextClosed));
  assert(matrix.browserClosed && matrix.serverStopped && followup.browserClosed && followup.serverStopped);
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of [1, 2]) for (const reduced of [false, true]) for (const layout of ["agentvn", "renpy"])
      assert.equal(acceptedCases.filter(c => c.width === width && c.height === height && c.dpr === dpr &&
        c.reduced === reduced && c.layout === layout && c.kind === "video" && !c.interrupt && c.status === "PASS").length, 1);
  for (const reduced of [false, true]) {
    assert.equal(acceptedCases.filter(c => c.interrupt && c.reduced === reduced && c.width === 1920
      && c.height === 1080 && c.dpr === 1 && c.layout === "agentvn" && c.kind === "video").length, 1);
    for (const kind of ["image_sequence", "default", "broken"]) assert.equal(
      acceptedCases.filter(c => c.kind === kind && c.reduced === reduced && c.layout === "renpy"
        && c.width === 1920 && c.height === 1080 && c.dpr === 1).length, 1);
  }
  assert.equal(menu.status, "PASS"); assert.equal(menu.cases.length, 27);
  assert.equal(menu.gameplayLaunch.status, "PASS");
  report.preconditions = [desc(matrixFile), desc(interruptionFile), desc(menuFile)];
  report.coverage = { accepted: acceptedCases.length, normalFromOriginal: 30, interruptionFollowup: 2,
    originalMatrixStatus: matrix.status, preservedFailures: oldFailures.map(c => ({
      reduced: c.reduced, error: c.error, reason: "Entrance moved to the media layer; old assertion measured only the backdrop",
    })) };
  for (const f of matrix.sources) assert.equal(sha(path.join(root, f.file)), f.sha256, "Sources changed since behavior test");
  report.sources = matrix.sources;
  for (const image of [...matrix.screenshots, ...followup.screenshots]) {
    assert.equal(sha(image.path), image.sha256);
    const b = fs.readFileSync(image.path), v = image.viewport;
    assert.equal(b.readUInt32BE(16), v.width * v.dpr);
    assert.equal(b.readUInt32BE(20), v.height * v.dpr);
  }
  const checkpoint = read("F:/AgentVN/Checkpoints/Runtime-Opening-20261023-01/manifest.json");
  report.frozenInstallation = checkpoint.products.filter(f => !f.file.endsWith("AgentVN Dev.exe"));
  for (const f of report.frozenInstallation) assert.equal(sha(f.file), f.sha256);
  const backupRoot = path.join("F:/AgentVN/Checkpoints/Runtime-Opening-20261023-01", `build-${attempt}-products`);
  assert(!fs.existsSync(backupRoot)); fs.mkdirSync(backupRoot);
  for (const [name, file] of [
    ["root-dev.exe", "AgentVN Dev.exe"],
    ["preview-resource.exe", "editor/src-tauri/binaries/agentvn-player.exe"],
    ["previous-target-player.exe", "GameCli_framework/src-tauri/target/release/agentvn-player.exe"],
    ["previous-target-editor.exe", "editor/src-tauri/target/debug/agentvn-editor.exe"],
  ]) {
    const source = path.join(root, file);
    if (!fs.existsSync(source)) continue;
    const copy = path.join(backupRoot, name); fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(source), sha(copy));
    report.backups.push({ original: desc(source), retained: desc(copy) }); save();
  }
  await command("editor-typecheck", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run typecheck"]);
  await command("editor-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run build"]);
  await command("runtime-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
  await command("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
  report.dev = desc(path.join(root, "AgentVN Dev.exe"));
  report.debug = desc(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
  assert.equal(report.dev.sha256, report.debug.sha256, "Root Dev must really be replaced");
  report.preview = desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
  assert.equal(report.preview.sha256, sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
  for (const f of report.sources) assert.equal(sha(path.join(root, f.file)), f.sha256);
  report.bundledSources = report.sources.map(f => {
    const file = path.join(root, "editor/src-tauri/bundle-workspace", f.file);
    assert.equal(sha(file), f.sha256, "Bundled Runtime must match tested source"); return desc(file);
  });
  for (const f of report.frozenInstallation) assert.equal(sha(f.file), f.sha256);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
  save(); console.log(JSON.stringify({ status: report.status, out, dev: report.dev, error: report.error }));
});
