"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Editor-1.9.25-20261025-01";
const installationFile = path.join(qa, "installation.json");
const attempt = process.argv[2] || "02";
assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `installed-smoke-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  modifiedUtc: fs.statSync(f).mtime.toISOString() });
const installation = read(installationFile);
assert.equal(installation.status, "PASS");
assert.equal(installation.executable.version, "1.9.25");
const project = fixture("editor-installed-smoke-20261025-01");
project.title = "1.9.25 安装版隔离冒烟工程";
const input = path.join(out, "安装版冒烟临时工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ACTUAL_EDITOR_1_9_25_INSTALL_RUNTIME_SMOKE_NOT_FULL_ACCEPTANCE",
  candidateVersion: "1.9.25", modelRequests: 0, productChanges: 0,
  installation: desc(installationFile), input: desc(input), launches: [], screenshots: [],
  actions: [], errors: [], cleanups: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host;
(async () => {
  const session = installedReleaseSession({ installationFile, out, report, save, input });
  host = session;
  const page = await session.start();
  report.actions.push({ action: "editor-home", status: "PASS", url: page.url(),
    projectHome: await page.locator(".project-home").count() });
  const importResponse = await fetch(`http://127.0.0.1:${session.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "content-type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
    body: fs.readFileSync(input), signal: AbortSignal.timeout(30000),
  });
  const imported = await importResponse.json();
  assert(importResponse.ok && imported.ok);
  assert.equal(imported.data.project_id, project.project_id);
  await page.reload();
  await page.locator(".project-home").waitFor();
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor({ timeout: 60000 });
  report.actions.push({ action: "project-import-and-open", status: "PASS", projectId: project.project_id });
  await page.setViewportSize({ width: 1920, height: 1080 });
  const surface = page.locator('[data-testid="workspace-surface-nav"] [data-workspace-surface]');
  assert.equal(await surface.count(), 5);
  const names = await surface.evaluateAll(nodes => nodes.map(node => ({
    key: node.getAttribute("data-workspace-surface"), text: node.textContent?.trim(),
    rect: node.getBoundingClientRect().toJSON(),
  })));
  assert.deepEqual(names.map(n => n.key), ["edit", "options", "assistant", "preview", "publish"]);
  report.actions.push({ action: "surface-nav-discovered", status: "PASS", names });
  for (const key of ["options", "assistant", "edit"]) {
    await page.locator(`[data-workspace-surface="${key}"]`).click();
    await page.waitForFunction(expected => document.querySelector(`[data-workspace-surface="${expected}"]`)?.getAttribute("aria-current") === "page", key);
    const shell = await page.locator('[data-testid="editor-shell-layout"]').boundingBox();
    assert(shell && shell.width > 0 && shell.height > 0);
    report.actions.push({ action: `surface-${key}`, status: "PASS", shell });
  }
  const shot = path.join(out, "installed-editor-1920x1080.png");
  await page.screenshot({ path: shot });
  report.screenshots.push({ ...desc(shot), viewport: { width: 1920, height: 1080, dpr: 1 } });
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  try { await host?.stop("1.9.25 installed smoke"); report.cleanups.push({ status: "PASS" }); }
  catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
