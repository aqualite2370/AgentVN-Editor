"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process"), { createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."), [phase, attempt, evidenceAttempt = "01"] = process.argv.slice(2);
assert(["matrix", "support", "build"].includes(phase)); assert.match(attempt, /^\d{2}$/); assert.match(evidenceAttempt, /^\d{2}$/);
const base = "F:/AgentVN/QA/Renpy-Title-Text-20261024-01", out = path.join(base, `${phase}-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size,
  modifiedUtc: fs.statSync(file).mtime.toISOString() });
const sourceFiles = ["shared/cartridge/uiSkin.ts", "shared/cartridge/renpyTitleControls.ts",
  "shared/cartridge/runtimeCapabilities.ts", "shared/cartridge/constants.ts",
  "editor/src/components/advanced/RenpyTitleEditor.tsx", "editor/src/components/advanced/RenpyTitleTextEditor.tsx",
  "editor/src/components/advanced/renpy-title-editor.css", "GameCli_framework/src/components/shell/RenpyTitleView.tsx"];
const r = { status: "RUNNING", phase, startedAt: new Date().toISOString(), out, commands: [], cells: [],
  sources: sourceFiles.map(file => ({ file, sha256: sha(path.join(root, file)) })),
  scope: "SOURCE_BROWSER_AND_DEV_NOT_FROZEN_INSTALLATION_OR_ANDROID", modelRequests: 0 };
const executed = fs.readFileSync(__filename), save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
async function command(label, exe, args, env = {}) {
  const c = { label, command: [exe, ...args], startedAt: new Date().toISOString(), log: path.join(out, `${label}.log`), env };
  r.commands.push(c); save();
  const fd = fs.openSync(c.log, "wx");
  try {
    const child = spawn(exe, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", fd, fd] });
    c.pid = child.pid; save();
    c.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(c.exitCode, 0, `${label}: ${c.log}`); assert(fs.statSync(c.log).size > 0); c.status = "PASS";
  } catch (e) { c.status = "FAILED"; throw e; }
  finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(c)); }
}
function verifyBrowser(file) {
  const report = read(file);
  assert.equal(report.status, "PASS"); assert.equal(report.steps.length, 7);
  assert(report.steps.every(s => s.status === "PASS")); assert(report.browserClosed);
  assert.equal(report.cleanup.status, "PASS"); assert.equal(report.runtimeCleanup.status, "PASS");
  assert.deepEqual(report.sources, r.sources); assert.equal(report.modelRequests, 0);
  assert.equal(sha(report.tool.path), report.tool.sha256); assert.equal(sha(path.join(path.dirname(file), "executed.cjs")), report.tool.sha256);
  assert.equal(report.screenshots.length, 4);
  for (const s of report.screenshots) {
    assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, report.viewport); assert.deepEqual(s.before, s.after);
    const b = fs.readFileSync(s.path);
    assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr);
    assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr);
  }
  for (const f of [report.portable, report.cartridge]) assert.equal(sha(f.path), f.sha256);
  return { ...desc(file), viewport: report.viewport, steps: report.steps.length };
}
(async () => {
  save();
  if (phase === "matrix") {
    r.smoke = verifyBrowser(path.join(base, "green-06/1920x1080-dpr2-reduced/report.json"));
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const viewport = { width, height, dpr, reduced }, name = `${width}x${height}-dpr${dpr}-${reduced ? "reduced" : "normal"}`;
        await command(name, process.execPath, ["scripts/renpy-title-text-authoring-playwright.cjs", `matrix-${attempt}`, "--wording", "--full"],
          { AGENTVN_TITLE_TEXT_VIEWPORT: JSON.stringify(viewport) });
        r.cells.push(verifyBrowser(path.join(out, name, "report.json"))); save();
      }
    assert.equal(r.cells.length, 12); assert.equal(new Set(r.cells.map(c => JSON.stringify(c.viewport))).size, 12);
  } else if (phase === "support") {
    for (const name of ["renpy-title-text-runtime-test", "runtime-layout-profiles-test", "title-button-label-sync-contract",
      "title-text-button-export-contract", "layout-opacity-inheritance-test", "renpy-gui-import-apply-test"])
      await command(name, process.execPath, [`scripts/${name}.cjs`]);
    await command("knowledge-index-generate", process.execPath, ["scripts/build-agent-doc-index.cjs"]);
    await command("knowledge-index", process.execPath, ["scripts/assistant-knowledge-index-test.cjs", path.join(out, "knowledge-index")]);
  } else {
    const matrixFile = path.join(base, `matrix-${evidenceAttempt}/report.json`),
      supportFile = path.join(base, `support-${evidenceAttempt}/report.json`);
    const matrix = read(matrixFile), support = read(supportFile);
    assert.equal(matrix.status, "PASS"); assert.equal(support.status, "PASS");
    assert.deepEqual(matrix.sources, r.sources); assert.deepEqual(support.sources, r.sources);
    assert.equal(matrix.cells.length, 12);
    for (const cell of matrix.cells) {
      assert.equal(sha(cell.path), cell.sha256); verifyBrowser(cell.path);
    }
    assert.equal(support.commands.length, 8); assert(support.commands.every(c => c.status === "PASS" && c.exitCode === 0));
    r.preconditions = [desc(matrixFile), desc(supportFile)];
    const checkpoint = read("F:/AgentVN/Checkpoints/Renpy-Title-Text-20261024-02/manifest.json");
    r.frozenProducts = checkpoint.products.filter(p => !p.path.endsWith("AgentVN Dev.exe"));
    for (const p of r.frozenProducts) assert.equal(sha(p.path), p.sha256);
    const backups = path.join("F:/AgentVN/Checkpoints/Renpy-Title-Text-20261024-02", `build-${attempt}-products`);
    assert(!fs.existsSync(backups)); fs.mkdirSync(backups); r.backups = [];
    for (const [name, original] of [["previous-dev.exe", "AgentVN Dev.exe"],
      ["previous-preview.exe", "editor/src-tauri/binaries/agentvn-player.exe"]]) {
      const source = path.join(root, original), copy = path.join(backups, name);
      fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(source), sha(copy)); r.backups.push({ original: desc(source), retained: desc(copy) });
    }
    await command("editor-typecheck", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run typecheck"]);
    await command("editor-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run build"]);
    await command("runtime-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
    await command("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
    r.dev = desc(path.join(root, "AgentVN Dev.exe"));
    assert.equal(r.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    r.preview = desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    assert.equal(r.preview.sha256, sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
    r.bundled = r.sources.filter(s => s.file.startsWith("shared/") || s.file.startsWith("GameCli_framework/")).map(s => {
      const file = path.join(root, "editor/src-tauri/bundle-workspace", s.file);
      assert.equal(sha(file), s.sha256); return desc(file);
    });
    for (const p of r.frozenProducts) assert.equal(sha(p.path), p.sha256);
  }
  for (const s of r.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
  r.status = "PASS";
})().catch(e => { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  r.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "executed.cjs"), executed, { flag: "wx" }); save();
  console.log(JSON.stringify({ status: r.status, phase, out, error: r.error }));
});
