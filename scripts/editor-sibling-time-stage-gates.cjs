"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process"), { createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."), [phase, attempt] = process.argv.slice(2);
assert(["support", "build"].includes(phase)); assert.match(attempt, /^\d{2}$/);
const base = "F:/AgentVN/QA/Editor-Sibling-Time-20261024-01", out = path.join(base, `${phase}-${attempt}`);
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size, modifiedUtc: fs.statSync(f).mtime.toISOString() });
const cp = read("F:/AgentVN/Checkpoints/Editor-Sibling-Time-20261024-01/manifest.json");
const matrixPath = path.join(base, "green-02/report.json"), matrix = read(matrixPath);
assert.equal(matrix.status, "PASS"); assert.equal(matrix.cleanup.status, "PASS"); assert.equal(matrix.modelRequests, 0);
assert.equal(matrix.matrix.length, 12); assert.equal(matrix.screenshots.length, 12);
assert.equal(new Set(matrix.matrix.map(c => c.key)).size, 12);
assert(matrix.matrix.every(c => c.status === "PASS" && c.episodes.length === 6 && c.episodes.every(e =>
  e.status === "PASS" && e.renderedIntermediateFrames >= 2 && e.observedDurationsMs.length > 0
  && e.observedDurationsMs.every(ms => Math.abs(ms - e.expectedDurationMs) < .001))));
for (const c of matrix.matrix) for (const e of c.episodes) assert.equal(sha(e.trace.path), e.trace.sha256);
for (const s of matrix.screenshots) {
  assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
  const b = fs.readFileSync(s.path);
  assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr);
  assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr);
}
for (const s of matrix.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const executed = fs.readFileSync(__filename);
const tools = ["scripts/editor-sibling-time-playwright.cjs", "scripts/editor-transition-presentation-test.cjs",
  "scripts/editor-options-motion-playwright.cjs", "scripts/advanced-tools-transition-regression-playwright.cjs"];
const r = { status: "RUNNING", startedAt: new Date().toISOString(), phase, commands: [],
  scope: "EDITOR_SIBLING_READER_SOURCE_AND_DEV_NOT_FROZEN_INSTALLATION",
  matrix: desc(matrixPath), sources: matrix.sources, protected: matrix.protected,
  tools: tools.map(f => desc(path.join(root, f))), frozen: cp.products.slice(2), modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
async function command(label, exe, args, extra = {}) {
  const env = { AGENTVN_TEST_PROJECT: cp.input.path, AGENTVN_WORKSPACE_OUTPUT: path.join(out, label),
    TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary"), ...extra };
  const c = { label, command: [exe, ...args], env, log: path.join(out, `${label}.log`),
    status: "RUNNING", startedAt: new Date().toISOString() };
  r.commands.push(c); save(); fs.mkdirSync(env.TEMP, { recursive: true });
  const fd = fs.openSync(c.log, "wx");
  try {
    const child = spawn(exe, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", fd, fd] });
    c.pid = child.pid; save();
    c.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(c.exitCode, 0, `${label}: ${c.log}`); c.status = "PASS";
    if (exe === process.execPath && args[0] === "scripts/editor-options-motion-playwright.cjs") {
      const report = read(path.join(env.AGENTVN_WORKSPACE_OUTPUT, "report.json"));
      assert.equal(report.status, "PASS"); assert.equal(report.cases.length, 1);
      c.behavior = desc(path.join(env.AGENTVN_WORKSPACE_OUTPUT, "report.json"));
    }
  } catch (e) { c.status = "FAILED"; throw e; }
  finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ label, status: c.status, log: c.log })); }
}
(async () => {
  save();
  if (phase === "support") {
    await command("reader-unit", process.execPath, ["scripts/editor-transition-presentation-test.cjs"]);
    for (const reduced of [false, true]) for (const name of ["focus", "loaderror", "supersede", "cancel"])
      await command(`${name}-${reduced ? "reduced" : "normal"}`, process.execPath,
        ["scripts/editor-options-motion-playwright.cjs", `--case=${name}`],
        { MOTION_VIEWPORTS: "1080p", MOTION_REDUCED: reduced ? "1" : "0" });
    await command("real-load-timeout", process.execPath, ["scripts/editor-options-motion-playwright.cjs", "--case=timeout"],
      { MOTION_VIEWPORTS: "1080p", MOTION_REDUCED: "0" });
    await command("advanced-transition", process.execPath, ["scripts/advanced-tools-transition-regression-playwright.cjs"],
      { ADVANCED_TOOLS_VIEWPORT: "1080p" });
    assert.equal(r.commands.length, 11);
    for (const p of cp.products) assert.equal(sha(p.path), p.sha256, "No generated binary writes during support");
  } else {
    const support = read(path.join(base, "support-01/report.json"));
    assert.equal(support.status, "PASS"); assert.equal(support.commands.length, 11);
    assert(support.commands.every(c => c.status === "PASS" && c.exitCode === 0));
    assert.deepEqual(support.sources, r.sources); r.support = desc(path.join(base, "support-01/report.json"));
    const backup = path.join(out, "prior-products"); fs.mkdirSync(backup); r.backups = [];
    for (const p of cp.products.slice(0, 2)) {
      assert.equal(sha(p.path), p.sha256);
      const file = path.join(backup, path.basename(p.path));
      fs.copyFileSync(p.path, file, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(file), p.sha256); r.backups.push({ source: p, retained: desc(file) });
    }
    await command("editor-typecheck", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run typecheck"]);
    await command("editor-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run build"]);
    await command("gamecli-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
    await command("full-dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
    r.dev = desc(path.join(root, "AgentVN Dev.exe"));
    assert.equal(r.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    assert(new Date(r.dev.modifiedUtc) >= new Date(r.commands.at(-1).startedAt), "Dev must actually be overwritten this run");
    r.player = desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    assert.equal(r.player.sha256, sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
    r.bundled = ["GameCli_framework/src/app/RuntimeScreenNavigator.tsx", "GameCli_framework/src/app/runtimePageCrossfade.ts"]
      .map(f => {
        const file = path.join(root, "editor/src-tauri/bundle-workspace", f);
        assert.equal(sha(file), sha(path.join(root, f))); return desc(file);
      });
  }
  for (const s of r.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
  for (const s of r.protected) assert.equal(sha(path.join(root, s.file)), s.sha256);
  for (const f of [...r.tools, ...r.frozen]) assert.equal(sha(f.path), f.sha256);
  r.status = "PASS";
})().catch(e => { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  r.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(out, "executed.cjs"), executed, { flag: "wx" });
  save(); console.log(JSON.stringify({ status: r.status, phase, out, error: r.error }));
});
