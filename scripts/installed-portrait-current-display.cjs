"use strict";
// Additional actual parameter sampling for every author display. No exports,
// save calls, state injection or model requests; does not relabel prior runs.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { installedFeatureSession } = require("./lib/installed-candidate-feature-session.cjs");
const { readInstalledViewport } = require("./lib/current-native-capture.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const qa = "F:/AgentVN/QA/Installed-Portrait-20261021-01";
const inputAttempt = process.argv[2] || "02", attempt = process.argv[3] || "01";
assert.match(inputAttempt, /^\d{2}$/); assert.match(attempt, /^\d{2}$/);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const sourcePath = path.join(qa, `editor-${inputAttempt}/report.json`), source = read(sourcePath);
assert(["EDITOR_PASS_PLAYER_NOT_RUN", "FAILED"].includes(source.status)); assert.equal(source.cleanupError, undefined);
if (source.status === "FAILED") {
  assert(source.errors.length > 0 && source.errors.every(e => e.includes("Minified React error #185")));
  assert.equal(source.steps.length, 6); assert(source.steps.every(s => s.status === "PASS"));
}
const prep = read(path.join(qa, "preparation.json")), out = path.join(qa, `display-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), launches: [], cleanups: [], errors: [], modelRequests: 0,
  sourceAuthorStatus: source.status, sourceRenderErrorsStillOpen: source.errors,
  screenshots: [], cases: [], source: { path: sourcePath, sha256: sha(sourcePath) },
  scope: "ACTUAL_INSTALLED_AUTHOR_VIEWPORT_DPR_MEDIA_CONTROL_HIT_SUPPLEMENT_NOT_REPEATED_EXPORT_OR_PREVIEW_MATRIX" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedFeatureSession({ out, report, save, profileRoot: path.dirname(source.launches[0].data), testProject: prep.input.path });
let page;
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL); save();
  page = await host.start(); await settleEditor(page);
  await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: prep.title }).click(); await settleEditor(page);
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    const m = { width, height: width * 9 / 16, dpr, reduced };
    await host.metrics(m); const before = await readInstalledViewport(page, m);
    const item = { ...m, before, status: "RUNNING", types: [] }; report.cases.push(item); save();
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
    for (const type of ["agentvn", "renpy"]) {
      const b = page.locator(`[data-layout-type-option="${type}"]:visible`);
      if (await b.getAttribute("aria-pressed") !== "true") await b.click();
      await page.locator(`.runtime-layout-designer[data-layout-type="${type}"]`).waitFor();
      await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
      await settleEditor(page);
      const structured = page.getByTestId("renpy-player-layout-entry"); if (await structured.isVisible()) await structured.click();
      await page.locator('[data-help-key="layout.screen"]:visible').getByText("播放页", { exact: true }).click(); await settleEditor(page);
      const controls = page.getByTestId("dialog-portrait-layout-editor"); await controls.waitFor();
      if (!await controls.evaluate(n => n.open)) await controls.locator("summary").click();
      const inputs = [];
      for (const [key, label] of [["offsetX", "头像水平偏移"], ["offsetY", "头像垂直偏移"], ["size", "头像尺寸"]]) {
        const input = controls.getByRole("spinbutton", { name: label, exact: true });
        assert.equal(await input.inputValue(), String(prep.values[type][key])); await input.scrollIntoViewIfNeeded(); await input.click();
        const o = await input.evaluate(n => {
          const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { rect: r.toJSON(), hit: hit === n || n.contains(hit), focused: n === document.activeElement,
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(o.hit && o.focused && o.overflow <= 1 && o.rect.left >= 0 && o.rect.top >= 0
          && o.rect.right <= width + 1 && o.rect.bottom <= m.height + 1); inputs.push(o);
      }
      item.types.push({ type, inputs, actual: await readInstalledViewport(page, m) });
    }
    item.after = await readInstalledViewport(page, m); assert.deepEqual(item.after, item.before);
    item.status = "PASS"; save(); console.log(`PASS actual author parameters ${width}/${dpr}/${reduced}`);
  }
  const current = await host.api(`/api/project/projects/${prep.projectId}`);
  assert.deepEqual(current.editor_settings.runtimeUILayoutProfiles.profiles, source.finalProject.editor_settings.runtimeUILayoutProfiles.profiles);
  assert.equal(report.cases.length, 12); assert(report.cases.every(c => c.status === "PASS" && c.types.length === 2));
  assert.equal(report.modelRequests, 0); assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(async () => {
    try { await host.stop("End actual display parameter supplement"); for (const f of prep.immutable) assert.equal(sha(f.path), f.sha256); }
    catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
  });
