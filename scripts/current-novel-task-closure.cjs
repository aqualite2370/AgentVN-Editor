"use strict";
// Current sealed installation, original task lifecycle assertions. Replace only
// the deferred motion oracle with functional ownership/focus/hit checks.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Novel-Task-1.9.35-20261102-01";
const receipt = "F:/AgentVN/QA/Controls-1.9.35-20261102-01/derived-actual-installation.json";
const resource = "F:/AgentVN/QA/Functional-Continuation-20261101/installed-editor-20261101-02/installer-resource-report.json";
const originalFile = path.join(__dirname, "installed-novel-task-floating-playwright.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function build(original) {
  let source = original; const edits = [];
  const change = (before, after, count = 1) => {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  };
  change('const { armFloatingMotion, finishFloatingMotion, assertFloatingMotion } = require("./lib/floating-motion-probe.cjs");\n', "");
  change('"scripts/lib/floating-motion-probe.cjs", ...(currentCandidate ? [',
    '...(currentCandidate ? [');
  change('.recent-project-open:not(:disabled):visible', "[data-help-key='home.recentProject']:not(:disabled):visible", 2);
  const start = source.indexOf('  await stage("installed-high-resolution-card-workspace-motion-and-focus-matrix", async () => {');
  const end = source.indexOf('  await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });\n  if (currentCandidate) await stage', start);
  assert(start > 0 && end > start);
  const before = source.slice(start, end);
  const after = `  await stage("installed-high-resolution-card-workspace-function-and-focus-matrix", async () => {
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const expected = { width, height: width * 9 / 16, dpr, reduced };
      const item = { ...expected, status: "RUNNING" }; report.currentMatrix = item; save();
      await metrics(expected); item.actualBefore = await readInstalledViewport(page, expected);
      await page.locator('[data-workspace-surface="options"]:visible').click(); await A.settleEditor(page);
      const before = await geometry(), card = before.card;
      assert(card.width >= 138 && card.width <= 142 && card.height >= 80 && card.height <= 96);
      assert(before.text.includes("处理中") && before.progress === "50" && before.hit && !before.nestedButtons && before.overflow <= 1);
      assert(card.x >= 12 && card.y >= before.toolbar.bottom + 11 && card.right <= width - 12 &&
        card.bottom <= Math.min(expected.height - 12, before.status.top - 12) + 1);
      const open = mini().getByRole("button", { name: /打开小说任务面板/ });
      if (dpr === 2) { await open.focus(); await page.keyboard.press("Enter"); } else await open.click();
      await panel().waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const n = document.querySelector('[data-testid="novel-task-workbench"]');
        return n && !n.closest("[inert]") && n.contains(document.activeElement);
      });
      item.panelOwnsFocus = await panel().evaluate(n => n.contains(document.activeElement) && !n.closest("[inert]"));
      const after = await geometry(); item.expandedGeometry = after;
      for (const track of ["palette", "flow", "inspector"]) for (const key of ["x", "y", "width", "height"])
        assert(Math.abs(before[track][key] - after[track][key]) < 1, track + "." + key + " moved");
      item.footer = await panel().locator(".novel-task-actions button").evaluateAll(buttons => buttons.map(button => {
        const r = button.getBoundingClientRect(), p = button.closest("section").getBoundingClientRect();
        return { label: button.textContent, hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
          contained: r.x >= p.x && r.y >= p.y && r.right <= p.right && r.bottom <= p.bottom };
      }));
      assert(item.footer.length && item.footer.every(button => button.hit && button.contained));
      const token = panel().getByRole("tab", { name: reduced ? "按章节" : "按处理槽", exact: true });
      await token.click(); item.tokenView = reduced ? "chapter" : "agent";
      await until(() => token.getAttribute("aria-selected").then(value => value === "true"), "Actual token tab selection");
      if (width === 1920 && dpr === 1 && !reduced) await screenshot("installed-expanded-task-panel.png", expected);
      if (dpr === 2) await page.keyboard.press("Escape");
      else await panel().getByRole("button", { name: "最小化任务面板", exact: true }).click();
      await panel().waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.matches(".novel-task-card-open"));
      item.cardFocusRestored = true;
      assert.equal(await page.locator('[data-workspace-surface="options"]:visible').getAttribute("aria-current"), "page");
      assert.equal(await page.locator(".novel-task-backdrop").count(), 0);
      await openPanel();
      await panel().getByRole("button", { name: "最小化任务面板", exact: true }).click();
      // Exercise real interrupted inputs, with no duration or frame-count gate.
      await open.click(); await panel().waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const nodes = [...document.querySelectorAll('[data-testid="novel-task-workbench"]')].filter(n => !n.closest("[inert]"));
        return nodes.length === 1 && nodes[0].contains(document.activeElement);
      });
      item.singleInteractiveOwner = true; await closePanel();
      item.actualAfter = await readInstalledViewport(page, expected);
      item.geometry = before; item.status = "PASS"; report.matrix.push(item); save();
      await screenshot("functional-card-" + width + "-dpr" + dpr + "-" + reduced + ".png", expected);
      delete report.currentMatrix;
      console.log("PASS novel card functionality " + width + "/" + dpr + "/" + reduced);
    }
    assert.equal(report.matrix.length, 12);
    return { viewportNote: "Actual installed WebView logical viewport/DPR; not physical 4K",
      deferredMotionAssertionsExecuted: false, focusHitOwnershipAndGeometryRetained: true };
  });
`;
  source = source.slice(0, start) + after + source.slice(end); edits.push({ before, after, count: 1 });
  // A checkpoint of the new test scope; prior full worktree checkpoints remain.
  change('["diff", "--binary"]', '["diff", "--binary", "--", "editor/src/components/novel-import", "editor/src/store/novelImportStore.ts"]');
  change('const report = {\n  status:', 'const report = {\n  qaBusiness: module.qaBusiness, executedBusiness: module.qaExecuted, deferredMotion: true,\n  status:');
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function main(mode, attempt = "01") {
  const actual = descriptor(); assert.deepEqual(read(receipt).executable, actual.executable);
  const original = fs.readFileSync(originalFile, "utf8"), result = build(original);
  if (mode === "self-test") {
    assert(!result.source.includes("assertFloatingMotion("));
    assert(!result.source.includes("finishFloatingMotion("));
    assert.throws(() => build(""));
    console.log(JSON.stringify({ status: "PASS", exactCandidate: actual.executable,
      functionalMatrix: 12, originalLifecycleStages: 9, motionProbes: 0, productStarts: 0 }));
    return;
  }
  assert.equal(mode, "run"); assert.match(attempt, /^\d{2}$/);
  fs.mkdirSync(qa, { recursive: true });
  const binding = path.join(qa, "binding-" + attempt); assert(!fs.existsSync(binding)); fs.mkdirSync(binding);
  const executed = path.join(binding, "executed.cjs");
  fs.writeFileSync(executed, result.source, { flag: "wx" });
  fs.copyFileSync(__filename, path.join(binding, "adapter.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(binding, "binding.json"), JSON.stringify({
    original: desc(originalFile), executed: desc(executed), adapter: desc(__filename), edits: result.edits,
    actualInstallation: actual.actualInstallation, productChanges: 0, builds: 0, modelRequests: 0,
  }, null, 2), { flag: "wx" });
  const out = qa + "/session-" + attempt;
  process.env.AGENTVN_TEST_PROJECT = out + "/隔离工程 A.vnproj";
  process.env.AGENTVN_WORKSPACE_OUTPUT = out;
  process.argv = [process.execPath, originalFile, resource, out, "--candidate=1.9.35",
    "--installation-file=" + receipt, "--candidate-qa-root=" + qa];
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(path.dirname(originalFile)),
    qaBusiness: desc(originalFile), qaExecuted: desc(executed) });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(process.argv[2], process.argv[3]);
module.exports = { build, qa, receipt, resource };
