"use strict";
// New Dev only. Import the archived package via the public byte parser and open
// via UI, save via UI, restart the
// actual host/backend, reimport the new package. No provider or generation calls.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const JSZip = require("../editor/node_modules/jszip");
const { nativeSession, until } = require("./lib/current-native-editor-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const input = path.resolve(process.env.AGENTVN_TEST_PROJECT || "");
const out = path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || "");
assert(process.env.AGENTVN_TEST_PROJECT && process.env.AGENTVN_WORKSPACE_OUTPUT);
assert(out.startsWith("F:\\AgentVN\\QA\\"), "QA evidence belongs under the authorized F drive root");
assert(!fs.existsSync(out), "Never overwrite previous evidence");
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const describe = file => ({ path: file, sha256: hash(file), bytes: fs.statSync(file).size,
  modifiedAt: fs.statSync(file).mtime.toISOString() });
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "NEW_DEV_PUBLIC_PACKAGE_IMPORT_UI_OPEN_SAVE_HOST_BACKEND_RESTART_NO_MODEL_REQUESTS",
  projectInput: "PUBLIC_BACKEND_ARCHIVE_IMPORT_THEN_REAL_UI_OPEN_NATIVE_FILE_PICKER_NOT_RUN",
  directoryInput: "QA_ONLY_LOCAL_PROJECT_PREFERENCE_BEFORE_RELOAD_NATIVE_PICKER_NOT_RUN",
  comparison: "Exact fields and source values; derivative updatedAt excluded; scan chunk resultText JSON compared as parsed values (key order is not content)",
  input: describe(input), dev: describe(path.join(root, "AgentVN Dev.exe")),
  launches: [], cleanups: [], errors: [], screenshots: [], requests: [], cases: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const session = nativeSession({ out, input, report, save });
let page, expected;
function comparablePersistence(value, keys = []) {
  if (keys.length === 3 && keys[0] === "chunkResults" && keys[2] === "resultText" && typeof value === "string") {
    // Hydration reserializes scan analyses after backend canonical object ordering.
    // Parse only valid JSON at this precise seam; every nested value is still compared.
    try { return { scanResultJson: JSON.parse(value) }; } catch { return value; }
  }
  if (Array.isArray(value)) return value.map((child, i) => comparablePersistence(child, [...keys, i]));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "updatedAt")
    .map(([key, child]) => [key, comparablePersistence(child, [...keys, key])]));
}
function semantics(nodes) {
  return nodes.map(n => { const c = structuredClone(n); delete c.measured; delete c.width; delete c.height; return c; });
}
function sources(n) {
  return Object.fromEntries(["jobs", "tasks", "chunkResults", "chapterResults"].map(k =>
    [k, Object.fromEntries(Object.entries(n[k]).map(([id, row]) => [id, row.modelName]))]));
}
async function project() { return (await session.api(`/api/project/projects/${expected.project_id}`)).data; }
async function ready() {
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  await page.getByTestId("novel-task-mini-entry").waitFor();
  await page.waitForFunction(() => {
    const bar = document.querySelector('[data-testid="novel-task-mini-entry"] [role="progressbar"]');
    return bar?.getAttribute("aria-valuenow") === "100";
  });
}
function attach() {
  page.on("websocket", socket => socket.on("framesent", frame => {
    try {
      const p = JSON.parse(String(frame.payload));
      if (p.command === "start_novel_job") report.requests.push({ kind: "novel", operation: p.operation });
    } catch { /* Binary/non-JSON frames are not generation commands. */ }
  }));
}
async function check(label) {
  // Poll the actual public persisted state, rather than accepting a local UI cache.
  await until(async () => {
    const p = await project();
    return p?.editor_settings?.novelPersistence?.importJobSnapshot?.status === "completed";
  }, "completed task persisted");
  const actual = await project();
  assert.deepEqual(sources(actual.editor_settings.novelPersistence), sources(expected.editor_settings.novelPersistence));
  assert.deepEqual(comparablePersistence(actual.editor_settings.novelPersistence),
    comparablePersistence(expected.editor_settings.novelPersistence),
    "Only derivative timestamps and scan JSON key ordering may refresh; every source and content value remains exact");
  assert.deepEqual(semantics(actual.nodes), semantics(expected.nodes));
  assert.deepEqual(actual.edges, expected.edges);
  assert.equal(report.requests.length, 0);
  assert.equal(hash(input), report.input.sha256);
  report.cases.push({ name: label, status: "PASS", sources: sources(actual.editor_settings.novelPersistence) }); save();
}
async function start() {
  page = await session.start(); attach();
  const config = (await session.api("/api/project/state")).data;
  assert.equal(Object.keys(config.provider_secrets ?? {}).length, 0);
  assert.equal(Object.keys(config.provider_selections ?? {}).length, 0);
  await page.evaluate(({ id, out }) => localStorage.setItem("agentvn.projectExportDirectories.v1",
    JSON.stringify({ [id]: out })), { id: expected.project_id, out });
  await page.reload(); await page.locator(".project-home").waitFor();
}
async function importAndOpen(file) {
  const response = await fetch(`http://127.0.0.1:${session.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "content-type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(file)) }, body: fs.readFileSync(file),
    signal: AbortSignal.timeout(20000) });
  const result = await response.json(); assert(response.ok && result.ok);
  await page.reload(); await page.locator(".project-home").waitFor();
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: expected.title }).click();
  await ready();
}
async function saveUI() {
  const before = new Set(fs.readdirSync(out).filter(f => f.endsWith(".vnproj")));
  await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
  const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  const name = await until(() => fs.readdirSync(out).find(f => f.endsWith(".vnproj") && !before.has(f)),
    "new native project bundle");
  const file = path.join(out, name);
  const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const packed = JSON.parse(await zip.file("project.json").async("string"));
  assert.deepEqual(comparablePersistence(packed.editor_settings.novelPersistence),
    comparablePersistence(expected.editor_settings.novelPersistence));
  assert.deepEqual(semantics(packed.nodes), semantics(expected.nodes));
  assert.deepEqual(packed.edges, expected.edges);
  report.bundle = describe(file); save(); return file;
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL); save();
  const original = await JSZip.loadAsync(fs.readFileSync(input), { checkCRC32: true });
  expected = JSON.parse(await original.file("project.json").async("string"));
  assert.equal(expected.project_id, "qa-novel-1935-02-12", "Use only the specific archived QA fixture");
  assert.equal(expected.editor_settings.novelPersistence.importJobSnapshot.status, "completed");
  await start();
  await importAndOpen(input); await check("public-archive-import-real-ui-open-with-no-model-credentials");
  const bundle = await saveUI();
  report.cases.push({ name: "native-ui-save-exact-provenance-and-graph-bytes", status: "PASS" }); save();
  await session.stop("exact-owned forced host/backend restart; not normal native close");
  await start();
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: expected.title }).click();
  await ready(); await check("real-host-backend-restart-retains-source-without-generation");
  await page.locator('[data-help-key="toolbar.home"]').click(); await page.locator(".project-home").waitFor();
  await settleEditor(page);
  await importAndOpen(bundle); await check("new-native-package-public-reimport-ui-open-retains-source");
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    await session.metrics({ width, height: width * 9 / 16, dpr, reduced });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mini = page.getByTestId("novel-task-mini-entry");
    const geometry = await mini.evaluate(n => {
      const r = n.getBoundingClientRect(), b = n.querySelector(".novel-task-card-open"), br = b.getBoundingClientRect();
      return { bounds: r.toJSON(), hit: b.contains(document.elementFromPoint(br.x + br.width / 2, br.y + br.height / 2)),
        overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert(geometry.hit && geometry.overflow <= 1);
    assert(geometry.bounds.left >= 0 && geometry.bounds.top >= 0
      && geometry.bounds.right <= width + 1 && geometry.bounds.bottom <= width * 9 / 16 + 1);
    await session.shot(`restored-${width}-${dpr}-${reduced}`);
  }
  assert.equal(report.cases.length, 4); assert.equal(report.screenshots.length, 12);
  assert.equal(report.requests.length, 0); assert.deepEqual(report.errors, []);
  assert.equal(hash(report.dev.path), report.dev.sha256);
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) report.failureUi = await page.locator("body").innerText().catch(String);
}).finally(async () => {
  try { await session.stop("exact-owned cleanup; not normal native close acceptance"); }
  catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
    modelRequests: report.requests.length, error: report.error, cleanupError: report.cleanupError, out }));
});
