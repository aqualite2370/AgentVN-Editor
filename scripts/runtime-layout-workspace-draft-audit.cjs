"use strict";
// Evidence audit; never starts a product, browser, model request or device.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const JSZip = require("../editor/node_modules/jszip");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const auditAttempt = process.argv[3] ?? "01";
assert.match(auditAttempt, /^\d{2}$/);
const out = `F:/AgentVN/QA/Layout-Workspace-Draft-20261102-${attempt}`;
const file = path.join(out, "report.json");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const r = read(file), auditFile = path.join(out, `evidence-audit-${auditAttempt}.json`);
assert(!fs.existsSync(auditFile));
const audit = { status: "RUNNING", at: new Date().toISOString(), report: { path: file, sha256: hash(file) },
  scope: "SOURCE_REAL_BROWSER_EVIDENCE_NOT_INSTALLED", checks: [], modelRequests: 0, productStarts: 0 };
const executedTool = path.join(out, `executed-audit-${auditAttempt}.cjs`);
fs.copyFileSync(__filename, executedTool, fs.constants.COPYFILE_EXCL);
audit.tool = { path: executedTool, sha256: hash(executedTool) };
function check(name, action) {
  const item = { name, status: "RUNNING" }; audit.checks.push(item);
  return Promise.resolve().then(action).then(detail => { item.status = "PASS"; item.detail = detail; },
    error => { item.status = "FAILED"; item.error = String(error.stack || error); throw error; });
}
function verify(descriptor) {
  assert.equal(hash(descriptor.path), descriptor.sha256);
  assert.equal(fs.statSync(descriptor.path).size, descriptor.bytes);
}
(async () => {
  await check("nonempty-complete-matrix-and-four-author-workflows", () => {
    assert.equal(r.status, "PASS"); assert.equal(r.scope, "SOURCE_REAL_BROWSER_CURRENT_WORKTREE_NOT_INSTALLED");
    assert.equal(r.expectedDisplayCount, 12); assert.equal(r.cases.length, 15);
    assert(r.cases.every(c => c.status === "PASS")); assert.deepEqual(r.errors, []);
    assert(!r.cleanupError && !r.error);
    const matrix = r.cases.filter(c => c.name.startsWith("valid-save-and-invalid-workspace-roundtrip-"));
    assert.equal(matrix.length, 12);
    const keys = matrix.map(c => {
      const d = c.detail.display; assert.equal(d.height, d.width * 9 / 16);
      const g = c.detail.geometry; assert(g.focused && g.hit && !g.inert && g.horizontalOverflow <= 1);
      assert(c.detail.savedBaselineUnchanged && c.detail.invalidDraftRetained && c.detail.executionBlocked);
      return `${d.width}/${d.dpr}/${d.reduced}`;
    });
    const expected = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
      [false, true].map(reduced => `${width}/${dpr}/${reduced}`)));
    assert.deepEqual(keys.sort(), expected.sort());
    assert.deepEqual(r.cases.filter(c => !c.name.startsWith("valid-save-")).map(c => c.name), [
      "failed-save-keeps-draft-and-successful-save-survives-real-reload",
      "real-project-A-B-A-navigation-restores-only-the-owning-draft",
      "real-player-consumes-exported-last-valid-code-not-the-invalid-draft",
    ]);
    return { combinations: 12, workflows: 4, cases: 15 };
  });
  await check("executed-source-copies-and-current-source-still-match", () => {
    assert.equal(r.source.length, 3);
    for (const source of r.source) {
      verify(source);
      const rel = path.relative(root, source.path);
      assert(!rel.startsWith("..") && !path.isAbsolute(rel));
      const copy = path.join(out, "executed-source", rel);
      assert.equal(hash(copy), source.sha256);
    }
    const digest = crypto.createHash("sha256");
    for (const folder of ["editor/src", "GameCli_framework/src", "shared"]) {
      for (const f of fs.readdirSync(path.join(root, folder), { recursive: true }).sort()) {
        if (/\.(?:ts|tsx|mjs|css)$/.test(f))
          digest.update(folder + "/" + f).update(fs.readFileSync(path.join(root, folder, f)));
      }
    }
    assert.equal(digest.digest("hex"), r.sourceTreeSHA256);
    return { frozenSources: 3, productTree: r.sourceTreeSHA256 };
  });
  await check("twelve-real-DPR-PNGs-have-exact-dimensions-and-bytes", () => {
    assert.equal(r.screenshots.length, 12);
    for (const s of r.screenshots) {
      verify(s); const png = fs.readFileSync(s.path), m = s.metrics;
      assert.equal(png.readUInt32BE(16), m.width * m.dpr);
      assert.equal(png.readUInt32BE(20), m.height * m.dpr);
    }
    assert.equal(new Set(r.screenshots.map(s => `${s.metrics.width}/${s.metrics.dpr}/${s.metrics.reduced}`)).size, 12);
    return { PNGs: 12, physicalDisplayClaimed: false };
  });
  await check("all-exported-cartridges-exclude-invalid-unsaved-code-and-have-functional-slots", async () => {
    const files = r.cases.map(c => c.detail.actualExport ?? c.detail.exported).filter(Boolean);
    assert.equal(files.length, 13);
    for (const f of files) {
      verify(f); const zip = await JSZip.loadAsync(fs.readFileSync(f.path), { checkCRC32: true });
      const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
      const component = layout.screens.find(s => s.screen_id === "title")
        .components.find(c => c.component_id === "title_start_button");
      assert.equal(layout.advancedPresentationEnabled, true);
      assert.equal(component.presentation.version, 1);
      assert.equal((component.presentation.html.match(/<slot name="content"/g) ?? []).length, 1);
      assert(!/(?:^|})\s*body\s*\{/.test(component.presentation.css),
        "A global body selector must never enter the published control");
      for (const entry of Object.values(zip.files).filter(f => !f.dir && /\.(json|css|html)$/.test(f.name))) {
        const content = await entry.async("string");
        assert(!content.includes("__qaDraftExecuted") && !content.includes("--qa-invalid-draft")
          && !content.includes("--qa-other-project-draft"), entry.name);
      }
    }
    const player = r.cases.find(c => c.name.startsWith("real-player-consumes-")).detail;
    assert(player.actualPlayerCSS && player.unsavedScriptNotExecuted);
    return { realUIExports: 13, browserPlayerConsumption: true };
  });
  await check("no-owned-process-or-service-remains", async () => {
    assert.equal(r.cleanups.length, 1); assert.equal(r.cleanups[0].status, "PASS");
    const pids = [r.owner.pid, r.owner.backendPid, r.runtimeOwner.pid];
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), "PID remains: " + pid);
    for (const url of [r.owner.url, r.owner.backendUrl, r.runtimeOwner.url]) {
      let reachable = false;
      try { await fetch(url, { signal: AbortSignal.timeout(1500) }); reachable = true; } catch {}
      assert(!reachable, "Service remains: " + url);
    }
    assert.equal(r.modelRequests, 0);
    return { pids, ports: 3, modelRequests: 0 };
  });
  audit.status = "PASS";
})().catch(error => {
  audit.status = "FAILED"; audit.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  audit.finishedAt = new Date().toISOString();
  fs.writeFileSync(auditFile, JSON.stringify(audit, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: audit.status, checks: audit.checks.length, auditFile, error: audit.error }));
});
