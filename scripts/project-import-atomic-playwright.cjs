"use strict";
// Real home/file import and backend persistence. Store access is read-only evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const root = path.resolve(__dirname, ".."), label = "Project-Import-Atomic-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/project-import-atomic-20261020-01");
const input = path.join(qa, "保留当前工程.vnproj"), badFile = path.join(qa, "拒绝导入.vnproj");
const retryFile = path.join(qa, "修正后再导入.vnproj");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const executedTestBytes = fs.readFileSync(__filename);
const executedTestSha = crypto.createHash("sha256").update(executedTestBytes).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), { flag: "wx" });
const productFiles = ["editor/src/app/App.tsx", "editor/src/store/editorStore.ts", "editor/src/store/projectStore.ts",
  "editor/src/store/novelImportStore.ts", "backend/app/services/project_state_service.py"];
const binaries = ["AgentVN Dev.exe", "editor/src-tauri/binaries/creator-backend.exe", "editor/src-tauri/binaries/agentvn-player.exe"];
if (process.argv.includes("--prepare")) {
  for (const dir of [qa, checkpoint, summary]) { assert(!fs.existsSync(dir)); fs.mkdirSync(dir, { recursive: true }); }
  const saved = [...productFiles, "scripts/project-import-atomic-playwright.cjs",
    "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md", ...binaries].map(file => {
    const source = path.join(root, file), target = path.join(checkpoint, file);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(source), sha(target)); return { file, sha256: sha(source) };
  });
  const baseline = fixture("project-import-atomic-baseline-20261020");
  baseline.title = "请保留当前工程"; baseline.nodes[1].data.scene.title = "原场景";
  const bad = structuredClone(baseline);
  bad.project_id = "project-import-atomic-rejected-20261020"; bad.title = "不应替换当前工程";
  bad.nodes[1].data.scene.title = "拒绝导入的场景";
  bad.asset_manifest = [{ asset_id: "invalid-bg", asset_type: "background", metadata: {
    filename: "invalid.svg", display_name: "非法内嵌图片", mime_type: "image/svg+xml",
    data_url: "data:image/svg+xml;base64,PRIVATE-INVALID!", blob_url: "data:image/svg+xml;base64,PRIVATE-INVALID!",
  } }];
  const retry = structuredClone(bad); retry.title = "修正后正常导入";
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>');
  retry.asset_manifest[0].metadata.data_url = `data:image/svg+xml;base64,${bytes.toString("base64")}`;
  retry.asset_manifest[0].metadata.blob_url = retry.asset_manifest[0].metadata.data_url;
  for (const [file, value] of [[input, baseline], [badFile, bad], [retryFile, retry]]) write(file, value);
  write(path.join(summary, "preparation.json"), { at: new Date().toISOString(), qa, checkpoint, saved,
    fixtures: [input, badFile, retryFile].map(file => ({ path: file, sha256: sha(file) })),
    scope: "ISOLATED_FIXTURES_AND_RECOVERABLE_PRODUCT_SNAPSHOTS_NO_USER_DATA" });
  console.log(JSON.stringify({ status: "PASS", qa, checkpoint }));
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const e = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
    const p = (await import("/src/store/projectStore.ts")).useProjectStore.getState();
    const n = (await import("/src/store/novelImportStore.ts")).useNovelImportStore.getState();
    return JSON.parse(JSON.stringify({
      graph: { nodes: e.nodes, edges: e.edges, selectedNodeId: e.selectedNodeId, selectedEdgeId: e.selectedEdgeId,
        viewport: e.viewport, memoryMode: e.memoryMode, dirty: e.dirty, graphHistory: e.graphHistory,
        projectLoadGeneration: e.projectLoadGeneration },
      metadata: { projectId: p.projectId, title: p.title, author: p.author, createdAt: p.createdAt,
        updatedAt: p.updatedAt, settings: p.settings, assetManifest: p.assetManifest },
      novel: { persistence: n.persistence, session: n.session },
      cache: { draft: localStorage.getItem("agentvn.currentProjectDraft"), recent: localStorage.getItem("agentvn.recentProjects") },
    }));
  });
}
async function responseData(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  assert(r.ok, `${r.status}: ${url}`); return (await r.json()).data;
}
async function homeReady(page) {
  await page.locator(".project-import-button input").first().waitFor({ state: "attached" });
  await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some(i => !i.disabled)
    && !document.querySelector(".project-entry-loading-overlay"));
  await settleEditor(page);
}
async function clickable(locator) {
  await locator.scrollIntoViewIfNeeded(); await locator.click({ trial: true });
  const result = await locator.evaluate(n => {
    const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { rect: r.toJSON(), hit: n.contains(hit), visible: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
  });
  assert(result.hit && result.visible, JSON.stringify(result)); return result;
}
async function main() {
  assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT || ""), path.resolve(input));
  const output = path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || "");
  assert(output.startsWith(path.resolve(qa) + path.sep) && !fs.existsSync(output), "Fresh isolated output required");
  const preparation = read(path.join(summary, "preparation.json"));
  for (const f of preparation.fixtures) assert.equal(sha(f.path), f.sha256);
  const report = { status: "RUNNING", at: new Date().toISOString(), scope: "REAL_SOURCE_BROWSER_HOME_IMPORT_REAL_BACKEND_NOT_INSTALLED",
    cases: [], modelRequests: 0, sources: productFiles.map(file => ({ file, sha256: sha(path.join(root, file)) })) };
  let host, browser;
  const persist = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  try {
    host = await startEditorAcceptance(output);
    report.service = { editorUrl: host.url, backendUrl: host.backendUrl, backendPid: host.backendPid, vitePid: host.server.pid };
    persist(); browser = await chromium.launch();
    const full = [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
      [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))));
    for (const display of process.argv.includes("--smoke") ? full.slice(0, 1) : full) {
      const key = `${display.width}-dpr${display.dpr}-${display.reduced ? "reduce" : "normal"}`;
      const row = { ...display, key, status: "RUNNING", checks: [], attempts: [], screenshots: [] };
      report.cases.push(row); persist();
      const context = await browser.newContext({ viewport: { width: display.width, height: display.height },
        deviceScaleFactor: display.dpr, reducedMotion: display.reduced ? "reduce" : "no-preference", acceptDownloads: true });
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      const invalid = read(badFile), retry = read(retryFile);
      invalid.project_id += `-${key}`; retry.project_id = invalid.project_id;
      const invalidInput = path.join(output, `${key}-invalid.vnproj`), retryInput = path.join(output, `${key}-retry.vnproj`);
      const sameIdInput = path.join(output, `${key}-same-id-invalid.vnproj`);
      write(invalidInput, invalid); write(retryInput, retry);
      write(sameIdInput, { ...invalid, project_id: read(input).project_id });
      const errors = []; page.on("pageerror", e => errors.push(String(e)));
      await context.route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/, route => {
        if (route.request().method() !== "POST") return route.continue();
        report.modelRequests++; return route.abort();
      });
      try {
        await host.server.run(async () => {
          await host.open(page); await settleEditor(page);
          const node = page.locator('.react-flow__node[data-id="scene"]');
          await clickable(node); await node.click();
          const title = page.locator('input[data-help-key="field.title"]:visible').first();
          await title.fill("必须保留的用户编辑"); await title.press("Tab");
          const returnHome = page.locator('[data-help-key="toolbar.home"]:visible');
          await clickable(returnHome);
          const save = page.waitForResponse(r => r.request().method() === "PUT" &&
            r.url() === `${host.backendUrl}/api/project/projects/${read(input).project_id}`);
          await returnHome.click(); assert((await save).ok()); await homeReady(page);
          const baseline = await snapshot(page);
          assert.equal(baseline.metadata.projectId, read(input).project_id);
          assert.equal(baseline.graph.nodes.find(n => n.id === "scene").data.scene.title, "必须保留的用户编辑");
          assert.equal(baseline.graph.selectedNodeId, "scene");
          const oldProject = await responseData(`${host.backendUrl}/api/project/projects/${baseline.metadata.projectId}`);
          row.before = baseline; row.checks.push("Real node selection/edit/return-home establishes baseline");
          const faults = process.argv.includes("--smoke") ? ["invalid-encoding"]
            : ["invalid-encoding", "same-id-invalid", "http-503", "network-abort"];
          for (const fault of faults) {
            const actualEncodingFailure = fault === "invalid-encoding" || fault === "same-id-invalid";
            const rejectedId = fault === "same-id-invalid" ? baseline.metadata.projectId : invalid.project_id;
            const endpoint = `${host.backendUrl}/api/project/projects/${rejectedId}`;
            const attempt = { fault, boundary: actualEncodingFailure ? "ACTUAL_BACKEND_422" : "CONTROLLED_TRANSPORT_FAILURE",
              before: await snapshot(page) }; row.attempts.push(attempt); persist();
            if (fault === "invalid-encoding" && process.argv.includes("--probe")) await page.route(endpoint, async route => {
              if (route.request().method() !== "PUT") return route.continue();
              attempt.atSaveBoundary = await snapshot(page); persist();
              await route.continue();
            });
            if (!actualEncodingFailure) await page.route(endpoint, route => {
              if (route.request().method() !== "PUT") return route.continue();
              return fault === "http-503" ? route.fulfill({ status: 503, contentType: "application/json",
                body: JSON.stringify({ detail: "QA_IMPORT_SERVICE_UNAVAILABLE" }) }) : route.abort("connectionreset");
            });
            let completion;
            const event = fault === "network-abort" ? "requestfailed" : "response";
            const pending = page.waitForEvent(event, value => {
              const req = fault === "network-abort" ? value : value.request();
              return req.url() === endpoint && req.method() === "PUT";
            });
            await page.locator(".project-import-button input").first().setInputFiles(
              fault === "same-id-invalid" ? sameIdInput : invalidInput);
            completion = await pending;
            attempt.responseStatus = fault === "network-abort" ? null : completion.status();
            if (actualEncodingFailure) {
              assert.equal(completion.status(), 422); const text = await completion.text();
              assert(text.includes("PROJECT_ASSET_DATA_URL_INVALID")); assert(!text.includes("PRIVATE-INVALID"));
            }
            await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some(i => !i.disabled)
              || !!document.querySelector(".editor-toolbar:not([inert])"));
            await settleEditor(page);
            attempt.after = await snapshot(page);
            attempt.homeVisible = await page.locator(".project-home").isVisible();
            attempt.alert = await page.locator(".project-import-status").allTextContents();
            attempt.backendCatalog = await responseData(`${host.backendUrl}/api/project/catalog`);
            attempt.oldProject = await responseData(`${host.backendUrl}/api/project/projects/${baseline.metadata.projectId}`);
            persist();
            assert.deepEqual(attempt.after, attempt.before, `${fault}: failed import changed current graph/metadata/novel/cache`);
            assert(attempt.homeVisible, `${fault}: import failure must not navigate to editor`);
            assert(attempt.alert.some(text => text.includes(actualEncodingFailure ? "PROJECT_ASSET_DATA_URL_INVALID"
              : fault === "http-503" ? "QA_IMPORT_SERVICE_UNAVAILABLE" : "无法连接后端服务")
              && (fault !== "network-abort" || text.includes(host.backendUrl))), `${fault}: no actionable error`);
            if (fault !== "same-id-invalid") assert(!attempt.backendCatalog.some(p => p.project_id === rejectedId));
            assert.deepEqual(attempt.oldProject, oldProject);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
            attempt.status = "PASS";
            if (!actualEncodingFailure || process.argv.includes("--probe")) await page.unroute(endpoint);
            row.checks.push(`${fault}: graph/selection/history/novel/cache/persisted project unchanged; actionable error; retry enabled`);
          }
          row.screenshots.push(await captureSourceBrowser(page, path.join(output, `${key}-rejected.png`), display));
          await page.locator(".project-import-button input").first().setInputFiles(retryInput);
          await page.locator(".editor-toolbar").waitFor({ state: "visible" });
          await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
          await settleEditor(page);
          const recovered = await snapshot(page);
          assert.equal(recovered.metadata.projectId, retry.project_id);
          assert.equal(recovered.metadata.title, "修正后正常导入");
          const actual = await responseData(`${host.backendUrl}/api/project/projects/${recovered.metadata.projectId}`);
          assert.equal(actual.title, recovered.metadata.title); assert.equal(actual.asset_manifest.length, 1);
          assert(actual.asset_manifest[0].metadata.backend_asset_path);
          row.checks.push("Corrected same-ID project imports after rejection and persists one asset");
          await page.reload(); await homeReady(page);
          const resume = page.locator('[data-help-key="home.openDraft"]:visible');
          await clickable(resume); await resume.click();
          await page.locator(".editor-toolbar").waitFor({ state: "visible" });
          await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay")); await settleEditor(page);
          assert.equal((await snapshot(page)).metadata.projectId, retry.project_id);
          const downloadEvent = page.waitForEvent("download");
          const saveButton = page.locator('[data-help-key="toolbar.saveProject"]:visible');
          await clickable(saveButton); await saveButton.click();
          const savedPath = path.join(output, `${key}-reopened.vnproj`);
          await (await downloadEvent).saveAs(savedPath);
          const zip = await JSZip.loadAsync(fs.readFileSync(savedPath));
          const portable = JSON.parse(await zip.file("project.json").async("string"));
          assert.equal(portable.project_id, retry.project_id); assert.equal(portable.asset_manifest.length, 1);
          const a = portable.asset_manifest[0];
          const savedBytes = await zip.file(a.metadata.project_path).async("nodebuffer");
          assert.deepEqual(savedBytes, Buffer.from(retry.asset_manifest[0].metadata.data_url.split(",")[1], "base64"));
          row.portable = { path: savedPath, sha256: sha(savedPath), assetBytes: savedBytes.length };
          await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
          row.checks.push("Reload/resume from persisted project and real portable save preserve exact corrected asset bytes");
          assert.deepEqual(errors, []);
          row.screenshots.push(await captureSourceBrowser(page, path.join(output, `${key}-retry.png`), display));
        });
        row.status = "PASS"; console.log(`PASS ${key}`);
      } catch (error) {
        row.status = "FAILED"; row.error = String(error.stack || error);
        row.diagnostic = { text: (await page.locator("body").innerText()).slice(0, 3000), errors };
        row.screenshots.push(await captureSourceBrowser(page, path.join(output, `${key}-failure.png`), display).catch(e => ({ error: String(e) })));
        throw error;
      } finally { persist(); await context.close(); }
    }
    assert.equal(report.cases.length, process.argv.includes("--smoke") ? 1 : 12); assert.equal(report.modelRequests, 0);
    report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    await browser?.close(); await host?.stop();
    if (host) {
      const ports = [host.url, host.backendUrl].map(url => Number(new URL(url).port));
      const pids = [host.server.pid, host.backendPid];
      const current = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
        `$p=@(Get-CimInstance Win32_Process -Filter '${pids.map(p => `ProcessId=${p}`).join(" OR ")}'|Select-Object ProcessId);` +
        `$l=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess);` +
        `@{processes=$p;listeners=$l}|ConvertTo-Json -Compress -Depth 4`], { encoding: "utf8", windowsHide: true }));
      report.cleanup = { status: current.processes.length || current.listeners.length ? "FAILED" : "PASS", pids, ports, current };
      if (report.cleanup.status !== "PASS") { report.status = "FAILED"; process.exitCode = 1; }
    }
    report.finishedAt = new Date().toISOString(); report.testSource = { path: __filename, sha256: executedTestSha };
    if (sha(__filename) !== executedTestSha) { report.status = "FAILED"; report.sourceChangedDuringRun = true; process.exitCode = 1; }
    for (const f of productFiles) assert.equal(sha(path.join(root, f)), report.sources.find(s => s.file === f).sha256);
    persist(); fs.writeFileSync(path.join(output, "executed-test.cjs"), executedTestBytes, { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, output, cases: report.cases.length, error: report.error?.split("\n")[0] }));
  }
}
