"use strict";
// Actual installed Release UI; imported fixture and test DB are explicitly isolated.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { validateSolidComponentPreview } = require("./lib/component-preview-style-evidence.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Components-20261021-01";
const attempt = process.argv[2] || "07"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const sourceFile = path.join(qa, "editor-04/report.json"), source = read(sourceFile);
assert.equal(source.status, "PASS");
const installationFile = process.argv[3] || "F:/AgentVN/QA/Component-Preview-Release-20261021-01/installation.json";
const expectedVersion = process.argv[4] || "1.9.15";
assert(["1.9.15", "1.9.16"].includes(expectedVersion));
const installation = read(installationFile);
assert.equal(installation.status, "PASS"); assert.equal(installation.executable.version, expectedVersion);
const rebuiltPaths = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe"]
  .map(file => path.resolve(root, file).toLowerCase());
const historicallyRebuilt = source.protectedFiles.filter(f => rebuiltPaths.includes(path.resolve(f.path).toLowerCase()));
assert.equal(historicallyRebuilt.length, 2, "Only the two explicitly rebuilt Dev products can have a new baseline");
const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: desc(sourceFile),
  installation: desc(installationFile), executable: installation.executable, version: expectedVersion,
  scope: "ACTUAL_INSTALLED_RELEASE_COMPONENT_PREVIEW_ONLY_NOT_WHOLE_ZIP_RETEST",
  launches: [], cleanups: [], screenshots: [], errors: [], modelRequests: 0, cases: [],
  expectedRebuilds: { reason: "Explicit new candidate/Dev rebuild; historical report is not modified", before: historicallyRebuilt },
  protectedFiles: [...source.protectedFiles.filter(f => !rebuiltPaths.includes(path.resolve(f.path).toLowerCase())),
    ...["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe"].map(f => desc(path.join(root, f)))] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, page, protectedCache = false;
function cache(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 45000 });
  fs.writeFileSync(path.join(out, `cache-${action}.log`), result.stdout + result.stderr, { flag: "wx" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
function unchanged() {
  for (const f of [...report.protectedFiles, source.portable, source.archive, report.source])
    assert.equal(sha(f.path), f.sha256, f.path);
}
async function inspect(button, name) {
  const samples = await button.evaluate(async node => {
    const result = [];
    for (let i = 0; i < 12; i++) {
      await new Promise(requestAnimationFrame);
      const s = getComputedStyle(node), r = node.getBoundingClientRect();
      result.push({ now: performance.now(), label: node.getAttribute("aria-label"), hovered: node.matches(":hover"),
        inline: { backgroundColor: node.style.backgroundColor, color: node.style.color },
        actual: { backgroundColor: s.backgroundColor, backgroundImage: s.backgroundImage, color: s.color, opacity: s.opacity },
        shadow: s.boxShadow, transform: s.transform, rect: r.toJSON() });
    }
    return result;
  });
  validateSolidComponentPreview(samples);
  for (const s of samples) {
    assert.equal(s.shadow, "none", name); assert.equal(s.transform, "none", name);
    assert(s.rect.width > 0 && s.rect.height > 0);
  }
  return samples;
}
(async () => {
  unchanged(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  save(); cache("SelfTest"); protectedCache = true; cache("Prepare");
  host = installedReleaseSession({ installationFile, out, report, save, input: source.portable.path });
  page = await host.start();
  const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(source.portable.path)) },
    body: fs.readFileSync(source.portable.path), signal: AbortSignal.timeout(30000) });
  assert(response.ok && (await response.json()).ok);
  await page.reload(); await page.locator(".project-home").waitFor(); await settleEditor(page);
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: source.portable.project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
  assert.equal(await page.locator('.runtime-layout-type-switch [data-layout-type-option="renpy"]:visible')
    .getAttribute("aria-pressed"), "true");
  const details = page.locator("details.renpy-personal-component-library");
  if (!await details.evaluate(n => n.open)) await details.locator("summary").click();
  const library = page.getByTestId("custom-component-library");
  const before = await page.evaluate(() => JSON.parse(JSON.stringify(window.__AGENTVN_PROJECT_STORE__.getState().settings)));
  // Only the local author draft is changed; it is neither saved nor merged.
  await library.getByLabel("组件 HTML", { exact: true }).fill(
    '<div class="root"><button class="button" aria-label="分享组件样式隔离" data-action="open_help">帮助</button></div>');
  await library.getByLabel("组件 CSS", { exact: true }).fill(
    ".root { padding: 12px; } .button { color: #ffffff; background-color: #223344; padding: 8px 12px; border-radius: 4px; }");
  await library.getByTestId("component-import-file").setInputFiles(source.archive.path);
  const imported = library.getByRole("region", { name: "导入预览" })
    .getByTestId("custom-component-preview").getByRole("button").first();
  const author = library.locator(".custom-component-live-preview").getByRole("button", { name: "分享组件样式隔离" });
  const outer = library.getByTestId("component-confirm-import");
  await outer.click();
  const saved = library.locator(".custom-component-saved-preview").getByRole("button").first();
  await saved.waitFor();
  // Scan the same bytes again so all three real preview surfaces coexist.
  await library.getByTestId("component-import-file").setInputFiles([]);
  await library.getByTestId("component-import-file").setInputFiles(source.archive.path);
  await imported.waitFor();
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const viewport = await host.metrics({ width, height, dpr, reduced }); await settleEditor(page);
      const samples = {};
      for (const [name, button] of [["author", author], ["saved", saved], ["imported", imported]]) {
        await button.scrollIntoViewIfNeeded(); await page.mouse.move(0, 0);
        assert(await button.isDisabled(), "Safe preview is not a functional Runtime action");
        samples[name] = await inspect(button, name);
        await button.hover();
        const hover = await button.evaluate(n => {
          const s = getComputedStyle(n);
          return { background: s.backgroundImage, shadow: s.boxShadow, transform: s.transform, rect: n.getBoundingClientRect().toJSON() };
        });
        assert.equal(hover.background, "none"); assert.equal(hover.shadow, "none"); assert.equal(hover.transform, "none");
        samples[`${name}Hover`] = hover;
        assert(hover.rect.left >= 0 && hover.rect.right <= width && hover.rect.top >= 0 && hover.rect.bottom <= height);
        assert(await button.evaluate(n => {
          const r = n.getBoundingClientRect();
          return n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }));
      }
      assert.notEqual(await outer.evaluate(n => getComputedStyle(n).backgroundImage), "none", "Editor theme must remain");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      report.cases.push({ viewport, samples, status: "PASS" }); save();
      if (width === 1920 && dpr === 1 && !reduced) await host.shot("import-preview-fixed");
    }
  assert.equal(report.cases.length, 12); assert.equal(report.modelRequests, 0); assert.deepEqual(report.errors, []);
  assert.deepEqual(await page.evaluate(() => JSON.parse(JSON.stringify(window.__AGENTVN_PROJECT_STORE__.getState().settings))), before);
  report.projectUnchanged = true; report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(async () => {
    try {
      await host?.stop("Component preview evidence finally; not normal physical window close");
      if (protectedCache) { cache("Restore"); report.cacheRestored = read(path.join(out, "native-cache-restoration.json")).status === "PASS"; }
      unchanged(); report.protectedUnchanged = true;
    } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error, cleanupError: report.cleanupError }));
  });
