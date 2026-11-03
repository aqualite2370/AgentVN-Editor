"use strict";
// Targeted installed style evidence. No product modification, layout save or model requests.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { validate } = require("./lib/installed-components-current-evidence.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Components-20261021-01";
const attempt = process.argv[2] || "05"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const sourceFile = path.join(qa, "editor-04/report.json"), source = read(sourceFile); validate(source);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: desc(sourceFile),
  scope: "ACTUAL_INSTALLED_COMPONENT_SCAN_PREVIEW_DECLARED_STYLE_PROBE_1080P_DPR1",
  launches: [], cleanups: [], screenshots: [], errors: [], modelRequests: 0, productChanges: 0, samples: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, page, protectedCache = false;
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 45000 });
  fs.writeFileSync(path.join(out, `cache-${action}.log`), r.stdout + r.stderr, { flag: "wx" }); assert.equal(r.status, 0, r.stdout + r.stderr);
}
function unchanged() {
  for (const f of [...source.protectedFiles, source.portable, source.archive, report.source]) assert.equal(sha(f.path), f.sha256);
}
(async () => {
  unchanged(); fs.copyFileSync(__filename, path.join(out, "executed-probe.cjs"), fs.constants.COPYFILE_EXCL);
  save(); cache("SelfTest"); protectedCache = true; cache("Prepare");
  host = installedReleaseSession({ installationFile: source.installation.path, out, report, save, input: source.portable.path });
  page = await host.start();
  const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(source.portable.path)) },
    body: fs.readFileSync(source.portable.path), signal: AbortSignal.timeout(30000) });
  const body = await r.json(); assert(r.ok && body.ok);
  await page.reload(); await page.locator(".project-home").waitFor(); await settleEditor(page);
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: source.portable.project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
  assert.equal(await page.locator('.runtime-layout-type-switch [data-layout-type-option="renpy"]:visible').getAttribute("aria-pressed"), "true");
  const d = page.locator("details.renpy-personal-component-library");
  if (!await d.evaluate(n => n.open)) await d.locator("summary").click();
  const library = page.getByTestId("custom-component-library");
  const before = await page.evaluate(() => JSON.parse(JSON.stringify(window.__AGENTVN_PROJECT_STORE__.getState().settings)));
  await library.getByTestId("component-import-file").setInputFiles(source.archive.path);
  await library.getByTestId("component-confirm-import").waitFor();
  const preview = library.getByRole("region", { name: "导入预览" });
  const button = preview.getByTestId("custom-component-preview").getByRole("button").first();
  await button.scrollIntoViewIfNeeded();
  report.samples = await button.evaluate(async b => {
    const results = [];
    for (let i = 0; i < 24; i++) {
      await new Promise(requestAnimationFrame); const s = getComputedStyle(b), r = b.getBoundingClientRect();
      results.push({ now: performance.now(), inline: { backgroundColor: b.style.backgroundColor, color: b.style.color },
        actual: { backgroundColor: s.backgroundColor, backgroundImage: s.backgroundImage, color: s.color, opacity: s.opacity },
        rect: r.toJSON(), hovered: b.matches(":hover"), label: b.getAttribute("aria-label") });
    }
    return results;
  }); save();
  report.screenshot = await host.shot("import-preview-style"); // Screenshot is evidence, not the assertion.
  assert.deepEqual(await page.evaluate(() => JSON.parse(JSON.stringify(window.__AGENTVN_PROJECT_STORE__.getState().settings))), before);
  report.projectUnchanged = true;
  const last = report.samples.slice(-8);
  assert(last.every(s => s.label?.startsWith("分享组件")), "Exclude the enclosing import selector from component evidence");
  assert(last.every(s => s.inline.backgroundColor === "rgb(34, 51, 68)"), "Must probe the declared imported CSS, not an unrelated button");
  assert(last.every(s => JSON.stringify(s.actual) === JSON.stringify(last[0].actual)), "Wait for a real stable style rather than a transient frame");
  report.styleMatchesDeclared = last.every(s => s.actual.backgroundColor === s.inline.backgroundColor && s.actual.color === s.inline.color);
  assert(report.styleMatchesDeclared, "Installed safe preview overrides the imported component's explicit background/text style");
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    await host?.stop("Read-only component style probe finally, not normal native close");
    if (protectedCache) { cache("Restore"); report.cacheRestored = read(path.join(out, "native-cache-restoration.json")).status === "PASS"; }
    unchanged(); report.protectedUnchanged = true;
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, samples: report.samples.length, styleMatchesDeclared: report.styleMatchesDeclared,
    last: report.samples.at(-1), error: report.error, cleanupError: report.cleanupError, out }, null, 2));
});
