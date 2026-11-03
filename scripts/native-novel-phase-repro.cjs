"use strict";
// Minimized real-native regression from isolated completed test DB. No model.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process"), assert = require("node:assert/strict");
const { nativeSession, until } = require("./lib/current-native-editor-session.cjs");
const { qa, checkpoint, summary } = require("./native-novel-partial.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
async function run(name, previous) {
  assert(/^phase-\d{2}$/.test(name)); assert(/^\d{2}$/.test(previous));
  const out = path.join(qa, name), backup = path.join(checkpoint, name);
  for (const d of [out, backup]) { assert(!fs.existsSync(d)); fs.mkdirSync(d); }
  const sourceFile = path.join(qa, `session-${previous}/report.json`), prior = load(sourceFile);
  assert.equal(prior.status, "CURRENT_NATIVE_NOVEL_PARTIAL_PASS");
  const sourceDb = path.join(prior.launches[0].data, "backend/vn_engine.db");
  const destDb = path.join(out, "data/backend/vn_engine.db");
  fs.mkdirSync(path.dirname(destDb), { recursive: true });
  const sourceHash = sha(sourceDb);
  const files = [__filename, "backend/app/api/routes_novel_process.py",
    "editor/src/components/novel-import/NovelProcessTaskWorkbench.tsx", "editor/src/novel-import/novelProcessJobAdapter.ts"];
  const copied = [];
  for (const file of files) {
    const original = path.resolve(root, file), target = path.join(backup, path.relative(root, original));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(original, target, fs.constants.COPYFILE_EXCL);
    copied.push({ path: original, sha256: sha(original), checkpoint: target });
  }
  const query = spawnSync("python", ["-c", [
    "import sqlite3,pathlib,sys",
    "source=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True)",
    "target=sqlite3.connect(sys.argv[2]);source.backup(target);target.close();source.close()",
  ].join("\n"), sourceDb, destDb], { encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(query.status, 0, query.stderr);
  const report = { status: "RUNNING", at: new Date().toISOString(),
    scope: "CURRENT_NATIVE_FRESH_WEBVIEW_REAL_API_CLONED_ISOLATED_DB_NOT_RELEASE",
    prior: { path: sourceFile, sha256: sha(sourceFile) }, copied, sourceDb: { path: sourceDb, sha256: sourceHash },
    cloneDb: destDb, launches: [], cleanups: [], screenshots: [], errors: [], modelRequests: 0, productChanges: 0 };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  const session = nativeSession({ out, input: prior.inputs[1].path, report, save });
  let started = false, page;
  try {
    started = true; page = await session.start();
    page.on("request", req => {
      if (req.method() === "POST" && /\/api\/(?:novel|assistant)\//.test(new URL(req.url()).pathname))
        report.modelRequests++;
    });
    const b = prior.inputs[1];
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: b.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    await until(() => page.getByTestId("novel-task-mini-entry").getAttribute("data-job-status")
      .then(status => status === "cancelled"), "cancelled task in fresh WebView");
    await page.getByTestId("novel-task-mini-entry").getByRole("button", { name: /^打开小说任务面板/ }).click();
    const panel = page.getByTestId("novel-task-workbench"); await panel.waitFor();
    report.job = await session.api(`/api/novel/processing/execute/jobs/${prior.jobB}`);
    report.apiPanel = await session.api(`/api/novel/processing/execute/jobs/${prior.jobB}/panel`);
    report.project = (await session.api(`/api/project/projects/${b.id}`)).data;
    report.actualImportedNodes = report.project.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === prior.jobB).length;
    report.domPhases = await panel.locator(".novel-phase-timeline article").evaluateAll(nodes => nodes.map(n => ({
      label: n.querySelector("header strong")?.textContent, class: n.className,
      meters: [...n.querySelectorAll('[role="progressbar"]')].map(m => ({
        label: m.getAttribute("aria-label"), value: Number(m.getAttribute("aria-valuenow")) })),
      text: n.textContent,
    })));
    await session.shot("cancelled-fresh-webview-false-completion");
    assert.equal(report.job.status, "cancelled"); assert.equal(report.job.completedChunks, 0);
    assert.equal(report.actualImportedNodes, 0); assert.equal(report.modelRequests, 0);
    const falsePhases = ["import_write", "validation"].filter(id => {
      const row = report.apiPanel.phaseProgress.find(p => p.phase === id);
      return row.status === "completed" && row.percent === 100;
    });
    report.falsePhases = falsePhases;
    report.rawAndDomAgree = falsePhases.length > 0 && falsePhases.every(id => {
      const api = report.apiPanel.phaseProgress.find(p => p.phase === id);
      return report.domPhases.some(p => p.label === api.label && p.class.includes("is-completed") &&
        p.meters.some(m => m.value === 100));
    });
    assert.equal(report.rawAndDomAgree, falsePhases.length > 0);
    assert.equal(falsePhases.length, 0,
      "Cancelled job with zero graph writes must not report blueprint write/validation complete");
    report.status = "CURRENT_NATIVE_PHASE_STATUS_PASS";
  } catch (e) {
    report.error = String(e.stack || e);
    report.status = report.falsePhases?.length && report.rawAndDomAgree
      ? "REPRODUCED_PRODUCT_PHASE_STATUS_FAILURE" : "QA_OR_ENVIRONMENT_FAILED";
    process.exitCode = 1;
  } finally {
    if (started) {
      try { await session.stop("minimized repro exact-owned cleanup; not normal native close"); }
      catch (e) { report.cleanupError = String(e); report.status = "QA_OR_ENVIRONMENT_FAILED"; }
    }
    assert.equal(sha(sourceDb), sourceHash, "Original test DB must remain unchanged");
    assert.equal(sha(sourceFile), report.prior.sha256, "Original PASS report must remain unchanged");
    for (const f of copied) assert.equal(sha(f.path), f.sha256, "No product changes during repro");
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, falsePhases: report.falsePhases, models: report.modelRequests, out }));
  }
}
run(process.argv[2], process.argv[3]).catch(e => { console.error(e.stack || e); process.exitCode = 1; });
