"use strict";
// Independent read-only acceptance audit. Never rewrites the original runs.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const sharp = require("../GameCli_framework/node_modules/sharp");
const A = require("./lib/installed-acceptance.cjs");
assert.equal(process.argv.length, 5, "node audit <final-root> <cleanup-verification.json> <fresh-report.json>");
const [root, cleanupFile, output] = process.argv.slice(2).map(p => path.resolve(p));
assert(!fs.existsSync(output));
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const ev = f => ({ path: f, sha256: A.sha256(fs.readFileSync(f)) });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [] };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
async function check(name, action) {
  const row = { name, status: "RUNNING" }; report.checks.push(row); save();
  try { row.evidence = await action(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; throw e; } finally { save(); }
}
(async () => {
  const nativeFile = path.join(root, "native-runtime-01/report.json"), native = read(nativeFile);
  const exportFile = path.join(root, "windows-04/export-resource-review-01.json"), exported = read(exportFile);
  const provenanceFile = path.join(root, "input/input-provenance.json"), provenance = read(provenanceFile);
  await check("All twelve native combinations and seventy-two actual user flows", () => {
    assert.equal(native.status, "INSTALLED_FINAL_WINDOWS_NATIVE_MATRIX_PASS");
    assert.equal(native.cases.length, 12); assert.deepEqual(native.errors, []);
    const keys = new Set();
    for (const c of native.cases) {
      assert.equal(c.status, "PASS"); assert.equal(c.checks.length, 6);
      assert(c.checks.every(x => x.status === "PASS"));
      assert(c.cleanup.alreadyExited || c.cleanup.exitCode === 0);
      keys.add(c.key);
    }
    assert.equal(keys.size, 12);
    assert.equal(exported.status, "INSTALLED_FINAL_WINDOWS_EXPORT_AUDIT_PASS_RUNTIME_PENDING");
    assert.equal(exported.assets.length, 143);
    assert.equal(ev(exported.executable.path).sha256, exported.executable.sha256);
    return { runtime: ev(nativeFile), export: ev(exportFile), flows: 72,
      limitation: "Representative canonical story branch and controls, not every authored line/route; WebView viewport emulation, not physical 4K." };
  });
  await check("Native PNG pixels, complete screenshot evidence, viewport and DPR", async () => {
    let pngs = 0;
    for (const c of native.cases) {
      assert(c.screenshots.length >= 8);
      for (const shot of c.screenshots) {
        const file = shot.path || shot.file || shot.screenshot?.path;
        assert(file, `Missing screenshot path: ${JSON.stringify(shot)}`);
        const meta = await sharp(file).metadata();
        assert.equal(meta.width, c.viewport.width * c.viewport.dpr);
        assert.equal(meta.height, c.viewport.height * c.viewport.dpr);
        if (shot.sha256) assert.equal(ev(file).sha256, shot.sha256);
        pngs++;
      }
      assert(c.actualViewport && c.finalViewport);
      assert(c.transitions.length >= 5);
      for (const t of c.transitions)
        assert(t.frames.some(f => f.black > 0 && f.black < 1 || f.launch > 0 && f.launch < 1));
    }
    return { pngs, modes: ["normal", "reduced"], dpr: [1, 2], actualWebview: true };
  });
  await check("Actual EXE-adjacent save bytes and restored gameplay positions", () => {
    const saves = [];
    for (const c of native.cases) {
      const row = c.checks.find(x => x.name.includes("native save/load"));
      assert(row);
      const e = row.evidence;
      assert.equal(e.loaded.scene, e.saved.scene); assert.equal(e.loaded.command, e.saved.command);
      assert.equal(e.loaded.page, e.saved.page);
      assert(e.files.length > 0);
      for (const file of e.files) {
        assert(A.inside(path.join(path.dirname(exported.executable.path), "saves"), file.actualPath));
        assert.equal(ev(file.copy).sha256, file.sha256);
        assert.equal(fs.statSync(file.copy).size, file.bytes);
        if (file.copy.endsWith(".json")) assert(Object.keys(read(file.copy)).length > 0);
        saves.push({ case: c.key, ...file });
      }
    }
    return saves;
  });
  await check("Canonical source, isolated portable input, user database and product hashes unchanged", () => {
    const protectedFiles = read(cleanupFile).protectedFiles
      .filter(f => !/\\plans\\ACTIVE_TASKS\.md$/i.test(f.path));
    for (const f of protectedFiles) assert.equal(ev(f.path).sha256, f.sha256, `Changed protected file: ${f.path}`);
    assert.equal(ev(provenance.source).sha256, provenance.sourceSha256);
    assert.equal(ev(provenance.output).sha256, provenance.outputSha256);
    assert.equal(ev(path.join(root, "windows-04/installed-session", path.basename(provenance.output))).sha256,
      provenance.outputSha256);
    return { protectedFiles: protectedFiles.length, source: ev(provenance.source), input: ev(provenance.output) };
  });
  await check("Owned native/editor process IDs and ports are no longer live", () => {
    const owner = read(path.join(root, "windows-04/installed-session/installed-processes.json"));
    const pids = [...new Set([owner.editorPid, owner.backendPid, ...native.cases.map(c => c.owner.pid)])];
    const ports = [...new Set([owner.cdpPort, owner.backendPort, ...native.cases.map(c => c.owner.port)])];
    const r = spawnSync("powershell.exe", ["-NoProfile", "-Command",
      `$ids=@(${pids.join(",")}); $ports=@(${ports.join(",")}); ` +
      `@{processes=@(Get-CimInstance Win32_Process | Where-Object {$ids -contains $_.ProcessId} | Select-Object ProcessId,Name,CommandLine);` +
      `listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$ports -contains $_.LocalPort} | Select-Object LocalPort,OwningProcess)} | ConvertTo-Json -Depth 6 -Compress`],
    { windowsHide: true, encoding: "utf8", timeout: 30000 });
    assert.equal(r.status, 0, r.stderr);
    const state = JSON.parse(r.stdout.replace(/^\uFEFF/, ""));
    assert.deepEqual(state.processes, []); assert.deepEqual(state.listeners, []);
    return { pids, ports, state };
  });
  report.status = "INSTALLED_FINAL_WINDOWS_TERMINAL_AUDIT_PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, output, error: report.error })); });
