"use strict";
// Real installed UI. Native directory dialogs are operated separately through
// Computer Use, never replaced with a mocked Tauri response or store mutation.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip"), { chromium } = require("../editor/node_modules/playwright");
const { sha256, settleEditor, dismissEnvironmentCompletion } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const run = "D:/AgentVN/output/installed-project-directory-20261018-01";
const work = "F:/AgentVN-QA-InstalledProjectDirectory-20261018-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const [phase, out, attempt = "1"] = process.argv.slice(2);
assert(["seed", "choose-a", "choose-b", "cancel", "switch-save", "restart", "matrix", "reset", "missing",
  "default-save", "default-restart", "collision"].includes(phase));
assert(out && !fs.existsSync(out)); fs.mkdirSync(out);
const suffix = Number(attempt) === 1 ? "" : `-${String(Number(attempt)).padStart(2, "0")}`;
const launch = read(path.join(run, `launch${suffix}.json`)), fixture = read(path.join(run, "fixtures.json"));
const prep = read(path.join(run, "preparation.json"));
assert.equal(prep.status, "PASS"); assert(prep.profiles.every(p => fs.existsSync(p.held)));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
const report = { status: "RUNNING", phase, at: new Date().toISOString(), attempt: Number(attempt),
  checks: [], artifacts: [], screenshots: [], nativeInput: null, pageErrors: [], productChanges: 0, realModelRequests: 0,
  scope: "ACTUAL_INSTALLED_UI_DEFAULT_PROFILES_WHOLE_ISOLATED; CONTROLLED_FIXTURE_IMPORT_SEPARATELY_LABELLED",
  error: null };
let browser, page, cdp, expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
const write = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function check(name, action) {
  const row = { name, status: "RUNNING" }; report.checks.push(row); write();
  try { row.detail = await action(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { write(); }
}
async function shot(name) {
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), expected)); write();
}
async function settings() {
  await dismissEnvironmentCompletion(page);
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();
  await settleEditor(page);
}
async function open(project) {
  if (await page.locator(".editor-toolbar").isVisible()) {
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
    await page.getByRole("button", { name: "返回首页", exact: true }).click(); await settleEditor(page);
  }
  await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  assert.equal(await page.evaluate(() => window.__AGENTVN_PROJECT_STORE__.getState().projectId), project.projectId);
  await settings();
}
async function label() { return (await page.locator('[data-help-key="settings.projectExportDirectory.current"]').innerText()).trim(); }
async function mapping() {
  return page.evaluate(() => JSON.parse(localStorage.getItem("agentvn.projectExportDirectories.v1") || "{}"));
}
async function saveNative(project, directory, systemDownloads = false) {
  if (systemDownloads) {
    assert.equal(path.resolve(directory).toLowerCase(), path.resolve("C:/Users/1/Downloads").toLowerCase());
    assert(fixture.projects.some(p => p.projectId === project.projectId && p.title === project.title));
  } else assert(path.resolve(directory).startsWith(path.resolve(work) + path.sep));
  // Never hash or move arbitrary user downloads. Only the unique QA title
  // prefix belongs to this run; chosen QA directories contain only QA files.
  const files = () => fs.readdirSync(directory).filter(n => !systemDownloads || n.startsWith(project.title));
  const before = files(), old = before.map(n => ({ name: n, sha256: sha256(fs.readFileSync(path.join(directory, n))) }));
  await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
  await page.getByRole("button", { name: "保存工程", exact: true }).click();
  const confirmation = page.getByTestId("project-save-confirmation"); await confirmation.waitFor();
  const added = files().filter(n => !before.includes(n));
  assert.equal(added.length, 1); assert(added[0].endsWith(".vnproj"));
  for (const f of old) assert.equal(sha256(fs.readFileSync(path.join(directory, f.name))), f.sha256);
  const file = path.join(directory, added[0]), bytes = fs.readFileSync(file), zip = await JSZip.loadAsync(bytes);
  const p = JSON.parse(await zip.file("project.json").async("string"));
  assert.equal(p.project_id, project.projectId);
  assert(!JSON.stringify(p).includes("projectExportDirectories"));
  assert(!JSON.stringify(p).includes(directory));
  const text = await confirmation.innerText(); assert(text.includes(file), "Actual native save confirmation must identify the created file");
  await shot(`save-${report.artifacts.length}`);
  await confirmation.getByRole("button", { name: "OK", exact: true }).click(); await confirmation.waitFor({ state: "hidden" });
  const artifact = { path: file, sha256: sha256(bytes), bytes: bytes.length, generatedAt: fs.statSync(file).mtime.toISOString(), projectId: p.project_id };
  report.artifacts.push(artifact); return { artifact, priorFilesUnchanged: old.length, portableDirectoryLeak: false };
}
(async () => {
  assert.equal(sha256(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))), launch.executableSha256);
  assert.equal(launch.executableSha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
  report.launch = { path: path.join(run, `launch${suffix}.json`), sha256: sha256(fs.readFileSync(path.join(run, `launch${suffix}.json`))), ...launch };
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page); page.setDefaultTimeout(25000);
  cdp = await page.context().newCDPSession(page);
  page.on("pageerror", e => report.pageErrors.push(String(e)));
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" }); await readInstalledViewport(page, expected);
  if (phase === "seed") {
    await check("Two isolated fixtures imported through real packaged backend; this is not native project-picker acceptance", async () => {
      for (const p of fixture.projects) {
        assert.equal(sha256(fs.readFileSync(p.input)), p.sha256);
        const response = await fetch(`http://127.0.0.1:${launch.backendPort}/api/project/projects/import`, {
          method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(p.input)) },
          body: fs.readFileSync(p.input), signal: AbortSignal.timeout(30000) });
        const value = await response.json(); assert(response.ok && value.ok && value.data.project_id === p.projectId);
      }
      await page.reload({ waitUntil: "domcontentloaded" });
      return { projects: fixture.projects.map(p => p.projectId), controlledPreparation: true };
    });
    await check("Real home entry opens project A with default download-directory label and no preference mapping", async () => {
      await open(fixture.projects[0]); assert.equal(await label(), "系统下载目录");
      const map = await mapping(); assert.equal(map[fixture.projects[0].projectId], undefined);
      assert.equal(map[fixture.projects[1].projectId], undefined); await shot("default-before-choice"); return { map };
    });
  } else if (phase === "choose-a" || phase === "choose-b" || phase === "cancel") {
    const project = fixture.projects[phase === "choose-b" ? 1 : 0];
    await open(project);
    await check("Native directory selection/cancellation uses the owned real dialog and changes only the current project's local preference", async () => {
      const before = await mapping(), beforeLabel = await label();
      report.nativeInput = { status: "WAITING_FOR_REAL_NATIVE_DIALOG", ownerPid: launch.editorPid,
        title: "选择当前工程的 .vnproj 保存目录", cancel: phase === "cancel",
        selectedPath: phase === "cancel" ? null : project.directory, requestedAt: new Date().toISOString() }; write();
      await page.locator('[data-help-key="settings.projectExportDirectory.choose"]').click();
      console.log(JSON.stringify({ phase, nativeInput: report.nativeInput, out }, null, 2));
      if (phase === "cancel") {
        // Computer Use leaves an explicit completion marker only after the
        // actual cancel action and fresh native observation.
        const until = Date.now() + 120000;
        while (!fs.existsSync(path.join(out, "native-completion.json")) && Date.now() < until)
          await new Promise(r => setTimeout(r, 200));
        assert(fs.existsSync(path.join(out, "native-completion.json")), "Native cancel evidence missing");
        assert.deepEqual(await mapping(), before); assert.equal(await label(), beforeLabel);
      } else {
        await page.waitForFunction(({ id, directory }) => {
          const map = JSON.parse(localStorage.getItem("agentvn.projectExportDirectories.v1") || "{}");
          return map[id] === directory;
        }, { id: project.projectId, directory: project.directory }, { timeout: 120000 });
        const after = await mapping(); assert.equal(await label(), project.directory);
        for (const [id, value] of Object.entries(before)) if (id !== project.projectId) assert.equal(after[id], value);
      }
      report.nativeInput.status = "REAL_UI_RESULT_OBSERVED"; await shot("after-native-dialog");
      return { before, after: await mapping(), directory: await label() };
    });
  } else if (phase === "switch-save" || phase === "restart") {
    await check("Project A directory restores on entry and consecutive saves create distinct packages without overwriting", async () => {
      await open(fixture.projects[0]); assert.equal(await label(), fixture.projects[0].directory);
      const one = await saveNative(fixture.projects[0], fixture.projects[0].directory);
      const two = await saveNative(fixture.projects[0], fixture.projects[0].directory);
      assert.notEqual(one.artifact.path, two.artifact.path); return { one, two };
    });
    await check("Actual project switch selects B's directory then restores A without changing either mapping", async () => {
      await open(fixture.projects[1]); assert.equal(await label(), fixture.projects[1].directory);
      const b = await saveNative(fixture.projects[1], fixture.projects[1].directory);
      await open(fixture.projects[0]); assert.equal(await label(), fixture.projects[0].directory);
      const map = await mapping();
      for (const p of fixture.projects) assert.equal(map[p.projectId], p.directory);
      return { b, map };
    });
    if (phase === "restart") {
      const first = read(path.join(run, "launch.json")), old = read(path.join(run, "backend-ready.json"));
      const next = read(path.join(run, `backend-ready${suffix}.json`));
      assert.notEqual(first.editorPid, launch.editorPid);
      assert(old.processes.filter(p => p.Name === "creator-backend.exe").every(p => !next.processes.some(n => n.ProcessId === p.ProcessId)));
      report.realRestart = { frontendPidBefore: first.editorPid, frontendPidAfter: launch.editorPid,
        backendPidsBefore: old.processes.filter(p => p.Name === "creator-backend.exe").map(p => p.ProcessId),
        backendPidsAfter: next.processes.filter(p => p.Name === "creator-backend.exe").map(p => p.ProcessId) };
    }
  } else if (phase === "matrix") {
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      expected = { width, height, dpr, reduced };
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" }); await readInstalledViewport(page, expected);
      await check(`Actual project settings controls remain visible and clickable ${width}/${dpr}/${reduced}`, async () => {
        await settings();
        await page.getByRole("region", { name: "工程保存目录", exact: true }).scrollIntoViewIfNeeded();
        const metrics = await page.locator('[data-help-key="settings.projectExportDirectory.current"]').evaluate(node => {
          const p = node.closest("section") || node.parentElement;
          const items = [...p.querySelectorAll("button")].map(b => {
            const r = b.getBoundingClientRect();
            return { label: b.textContent, disabled: b.disabled, rect: r.toJSON(),
              hit: b.disabled || b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
          });
          return { controls: items, overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(metrics.controls.length >= 2); assert(metrics.overflow <= 1);
        for (const c of metrics.controls) assert(c.hit && c.rect.left >= 0 && c.rect.right <= width && c.rect.top >= 0 && c.rect.bottom <= height);
        await shot(`${width}-${dpr}-${reduced}`); return { expected, metrics };
      });
    }
  } else if (phase === "default-save" || phase === "default-restart") {
    await check("Without a mapping, actual installed Save writes distinct valid portable packages to the system Downloads directory", async () => {
      const p = fixture.projects[0]; await open(p);
      assert.equal(await label(), "系统下载目录"); assert.equal((await mapping())[p.projectId], undefined);
      const first = await saveNative(p, "C:/Users/1/Downloads", true);
      const second = await saveNative(p, "C:/Users/1/Downloads", true);
      assert.notEqual(first.artifact.path, second.artifact.path);
      return { first, second, selectedDirectoryNotRequired: true };
    });
    if (phase === "default-restart") {
      const previous = read(path.join(run, "launch.json")), priorBackend = read(path.join(run, "backend-ready.json"));
      const currentBackend = read(path.join(run, `backend-ready${suffix}.json`));
      assert.notEqual(previous.editorPid, launch.editorPid);
      assert(priorBackend.processes.filter(p => p.Name === "creator-backend.exe")
        .every(p => !currentBackend.processes.some(n => n.ProcessId === p.ProcessId)));
      report.realRestart = { editorBefore: previous.editorPid, editorAfter: launch.editorPid,
        backendBefore: priorBackend.processes.filter(p => p.Name === "creator-backend.exe").map(p => p.ProcessId),
        backendAfter: currentBackend.processes.filter(p => p.Name === "creator-backend.exe").map(p => p.ProcessId) };
    }
  } else if (phase === "collision") {
    await check("An actually occupied timestamp filename creates a suffixed package and preserves all pre-existing valid bytes", async () => {
      const p = fixture.projects[0]; await open(p); assert.equal(await label(), "系统下载目录");
      const prior = read(path.join(run, "default-restart-01/report.json"));
      const source = prior.artifacts[0]; assert.equal(sha256(fs.readFileSync(source.path)), source.sha256);
      const bundled = require("../editor/node_modules/esbuild").buildSync({
        entryPoints: [path.resolve("editor/src/utils/fileNames.ts")], bundle: true, platform: "node", format: "cjs", write: false
      }).outputFiles[0].text;
      const mod = { exports: {} }; new Function("module", "exports", bundled)(mod, mod.exports);
      report.collisionSetup = { method: "Controlled valid QA package copies reserve actual upcoming timestamp names; no clock or Tauri mocking",
        source, files: [] };
      const now = Date.now();
      for (let offset = 0; offset <= 30; offset++) {
        const file = path.join("C:/Users/1/Downloads", mod.exports.buildProjectExportFileName(p.title, new Date(now + offset * 1000)));
        assert.equal(path.dirname(file).toLowerCase(), path.resolve("C:/Users/1/Downloads").toLowerCase());
        assert(path.basename(file).startsWith(p.title) && !fs.existsSync(file));
        fs.copyFileSync(source.path, file, fs.constants.COPYFILE_EXCL);
        assert.equal(sha256(fs.readFileSync(file)), source.sha256);
        report.collisionSetup.files.push({ path: file, sha256: source.sha256 }); write();
      }
      const result = await saveNative(p, "C:/Users/1/Downloads", true);
      assert(/-1\.vnproj$/.test(result.artifact.path));
      const original = result.artifact.path.replace(/-1\.vnproj$/, ".vnproj");
      assert(report.collisionSetup.files.some(f => f.path === original));
      for (const f of report.collisionSetup.files) assert.equal(sha256(fs.readFileSync(f.path)), f.sha256);
      return { nativeSave: result, actuallyCollidedWith: original, preservedCopies: report.collisionSetup.files.length };
    });
  } else if (phase === "reset") {
    await check("Reset clears only A and project B keeps its explicit directory", async () => {
      await open(fixture.projects[0]);
      await page.locator('[data-help-key="settings.projectExportDirectory.reset"]').click();
      assert.equal(await label(), "系统下载目录");
      const map = await mapping(); assert.equal(map[fixture.projects[0].projectId], undefined);
      assert.equal(map[fixture.projects[1].projectId], fixture.projects[1].directory);
      await open(fixture.projects[1]); assert.equal(await label(), fixture.projects[1].directory); await shot("reset-only-A");
      return { map };
    });
  } else if (phase === "missing") {
    await open(fixture.projects[0]);
    const p = fixture.projects[0], moved = p.directory + " 本轮暂存";
    assert.equal(await label(), p.directory);
    assert(path.resolve(p.directory).startsWith(path.resolve(work) + path.sep));
    assert(path.resolve(moved).startsWith(path.resolve(work) + path.sep));
    assert(fs.lstatSync(p.directory).isDirectory() && !fs.lstatSync(p.directory).isSymbolicLink() && !fs.existsSync(moved));
    const downloads = "C:/Users/1/Downloads";
    const before = fs.readdirSync(downloads).filter(n => n.includes(p.title));
    try {
      fs.renameSync(p.directory, moved);
      await check("Unavailable chosen directory gives an explicit path/error and does not silently save to Downloads", async () => {
        await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
        await page.getByRole("button", { name: "保存工程", exact: true }).click();
        await page.waitForFunction(dir => document.body.innerText.includes("PROJECT_EXPORT_DIRECTORY_INVALID")
          && document.body.innerText.includes(dir), p.directory);
        assert.equal(await page.getByTestId("project-save-confirmation").count(), 0);
        assert.deepEqual(fs.readdirSync(downloads).filter(n => n.includes(p.title)), before);
        assert(!fs.existsSync(p.directory)); await shot("missing-directory-error");
        return { directory: p.directory, fallbackFilesCreated: 0, mapping: await mapping() };
      });
    } finally {
      assert(!fs.existsSync(p.directory) && fs.lstatSync(moved).isDirectory());
      fs.renameSync(moved, p.directory); report.missingDirectoryRestored = true; write();
    }
    await check("After restoring the exact directory, real Save retries successfully", () => saveNative(p, p.directory));
  }
  assert(report.checks.length > 0); assert.equal(report.pageErrors.length, 0); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  await shot("failure").catch(() => {});
}).finally(async () => {
  await browser?.close().catch(() => {}); report.finishedAt = new Date().toISOString(); write();
  console.log(JSON.stringify({ status: report.status, phase, checks: report.checks.length, error: report.error, out }, null, 2));
});
