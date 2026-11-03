"use strict";
// Real current Dev WebView, cloned isolated DB, no model/graph writes.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { nativeSession, until } = require("./lib/current-native-editor-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { qa } = require("./native-novel-partial.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/AgentVN/QA/Novel-Phase-Repair-20261020-01";
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const load = f => JSON.parse(fs.readFileSync(f, "utf8"));
async function main() {
  const [name, previous] = process.argv.slice(2);
  assert(/^matrix-\d{2}$/.test(name) && /^\d{2}$/.test(previous));
  const out = path.join(base, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const source = path.join(qa, `session-${previous}/report.json`), prior = load(source);
  assert.equal(prior.status, "CURRENT_NATIVE_NOVEL_PARTIAL_PASS");
  assert.equal(prior.verifyGraphPhases, true);
  const db = path.join(prior.launches[0].data, "backend/vn_engine.db"), original = sha(db);
  const target = path.join(out, "data/backend/vn_engine.db"); fs.mkdirSync(path.dirname(target), { recursive: true });
  const copy = spawnSync("python", ["-c", [
    "import sqlite3,pathlib,sys",
    "s=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True)",
    "t=sqlite3.connect(sys.argv[2]);s.backup(t);t.close();s.close()",
  ].join("\n"), db, target], { encoding: "utf8", windowsHide: true, timeout: 20000 });
  assert.equal(copy.status, 0, copy.stderr);
  const productFiles = ["AgentVN Dev.exe", "editor/src/novel-import/novelProcessGraphProgress.ts",
    "editor/src/novel-import/importToGraph.ts", "editor/src/components/novel-import/NovelProcessTaskWorkbench.tsx",
    "backend/app/api/routes_novel_process.py"];
  const report = { status: "RUNNING", at: new Date().toISOString(),
    scope: "CURRENT_DEV_NATIVE_WEBVIEW_EMULATED_VIEWPORT_NOT_PHYSICAL_4K_OR_RELEASE_OR_MOTION_ACCEPTANCE",
    prior: { path: source, sha256: sha(source) }, sourceDb: { path: db, sha256: original },
    products: productFiles.map(f => ({ path: path.join(root, f), sha256: sha(path.join(root, f)) })),
    launches: [], cleanups: [], screenshots: [], errors: [], matrix: [], modelRequests: 0 };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  const session = nativeSession({ out, input: prior.inputs[0].path, report, save });
  let started = false, page;
  try {
    started = true; page = await session.start();
    page.on("request", req => {
      if (req.method() === "POST" && /\/api\/(?:novel|assistant)\//.test(new URL(req.url()).pathname))
        report.modelRequests++;
    });
    for (const [index, project] of prior.inputs.entries()) {
      if (index) {
        await page.locator('[data-help-key="toolbar.home"]').click();
        await page.locator(".project-home").waitFor(); await settleEditor(page);
      }
      await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
      await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
      await until(() => page.getByTestId("novel-task-mini-entry").getAttribute("data-job-status")
        .then(s => s === (index ? "cancelled" : "completed")), "restored current project task");
      await page.getByTestId("novel-task-mini-entry").getByRole("button", { name: /^打开小说任务面板/ }).click();
      const panel = page.getByTestId("novel-task-workbench"); await panel.waitFor();
      await until(() => panel.evaluate(el => el.getAnimations().every(a => a.playState === "finished")), "panel entry finishes");
      for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
        for (const dpr of [1, 2]) for (const reduced of [false, true]) {
          const viewport = { width, height, dpr, reduced };
          const metrics = await session.metrics(viewport);
          const result = { project: project.id, job: index ? prior.jobB : prior.jobA,
            viewport, metrics, rows: [], status: "RUNNING" };
          report.matrix.push(result); save();
          for (const id of ["import_write", "validation"]) {
            const row = panel.locator(`[data-phase="${id}"]`); await row.scrollIntoViewIfNeeded();
            const data = await row.evaluate(el => {
              const r = el.getBoundingClientRect(), p = el.closest(".novel-task-workbench").getBoundingClientRect();
              const b = el.closest(".novel-task-body").getBoundingClientRect();
              const meter = el.querySelector('[role="progressbar"]');
              return { id: el.dataset.phase, status: el.dataset.phaseStatus, basis: el.dataset.progressBasis,
                percent: Number(meter.getAttribute("aria-valuenow")), text: el.textContent,
                rect: r.toJSON(), panel: p.toJSON(), body: b.toJSON(),
                visible: r.width > 0 && r.height > 0 && r.left >= b.left - 1 && r.right <= b.right + 1
                  && r.top >= b.top - 1 && r.bottom <= b.bottom + 1,
                hit: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
                horizontalOverflow: el.scrollWidth > el.clientWidth + 1 };
            });
            assert.equal(data.status, index ? "cancelled" : "completed"); assert.equal(data.percent, index ? 0 : 100);
            assert.equal(data.basis, id === "import_write" ? "current_project_graph" : "current_project_structure_validation");
            assert(data.visible && data.hit && !data.horizontalOverflow, JSON.stringify(data));
            assert(data.panel.left >= -1 && data.panel.top >= -1 &&
              data.panel.right <= width + 1 && data.panel.bottom <= height + 1);
            result.rows.push(data);
          }
          result.controls = await panel.locator("footer button:not(:disabled)").evaluateAll(buttons => buttons.map(el => {
            const r = el.getBoundingClientRect(), p = el.closest(".novel-task-workbench").getBoundingClientRect();
            return { label: el.textContent, visible: r.width > 0 && r.height > 0 &&
              r.left >= p.left && r.right <= p.right + 1 && r.top >= p.top && r.bottom <= p.bottom + 1,
              hit: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
          }));
          assert(result.controls.length >= 2 && result.controls.every(c => c.visible && c.hit));
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          if (!index && dpr === 2 && !reduced) await session.shot(`phase-panel-${width}-dpr2`);
          result.status = "PASS"; save();
        }
      }
      await panel.locator('[data-help-key="novel.task.closePanel"]').click();
      await panel.waitFor({ state: "detached" });
      await session.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
    }
    assert.equal(report.matrix.length, 24); assert(report.matrix.every(m => m.status === "PASS" && m.rows.length === 2));
    assert.equal(report.screenshots.length, 3); assert.equal(report.modelRequests, 0); assert.deepEqual(report.errors, []);
    report.status = "NOVEL_PHASE_NATIVE_DISPLAY_MATRIX_PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page) await session.shot("failure").catch(e => { report.captureError = String(e); });
  } finally {
    if (started) try { await session.stop("matrix exact-owned cleanup; not normal-close evidence"); }
    catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    assert.equal(sha(db), original); assert.equal(sha(source), report.prior.sha256);
    for (const file of report.products) assert.equal(sha(file.path), file.sha256);
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, combinations: report.matrix.length,
      models: report.modelRequests, out, error: report.error }));
  }
}
main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
