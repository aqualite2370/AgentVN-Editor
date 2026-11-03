"use strict";
// SOURCE browser acceptance. UI-only authoring; store reads are observations.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), net = require("node:net");
const { execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Dialog-Portrait-Authoring-20261020-01";
const checkpoint = "F:/AgentVN/Checkpoints/Dialog-Portrait-Authoring-20261020-01";
const summary = path.join(root, "output/dialog-portrait-authoring-20261020-01");
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const sha = f => hash(fs.readFileSync(f));
const write = (f, value) => fs.writeFileSync(f, JSON.stringify(value, null, 2), { flag: "wx" });
const files = ["shared/cartridge/uiSkin.ts", "shared/cartridge/runtimeCapabilities.ts", "shared/cartridge/constants.ts",
  "shared/cartridge/dialogPortraitLayout.ts", "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
  "editor/src/components/advanced/DialogPortraitLayoutEditor.tsx", "editor/src/components/advanced/RenpyRuntimePreview.tsx",
  "GameCli_framework/src/components/player/DialogBox.tsx", "GameCli_framework/src/components/player/useDialogPortrait.ts"];
const sources = () => files.filter(f => fs.existsSync(path.join(root, f))).map(file => ({ file, sha256: sha(path.join(root, file)) }));
const matrices = [];
for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
  for (const dpr of [1, 2]) for (const reduced of [false, true])
    matrices.push({ width, height, dpr, reduced, key: `${width}-dpr${dpr}-${reduced ? "reduce" : "normal"}` });
const values = { agentvn: { offsetX: 32, offsetY: -16, size: 48 }, renpy: { offsetX: 56, offsetY: -24, size: 40 } };
function compile(contents) {
  const built = require("../editor/node_modules/esbuild").buildSync({ stdin: { contents, resolveDir: root, loader: "ts" },
    bundle: true, platform: "node", format: "cjs", write: false });
  const loaded = { exports: {} }; new Function("module", "exports", built.outputFiles[0].text)(loaded, loaded.exports);
  return loaded.exports;
}
async function prepare() {
  for (const dir of [qa, checkpoint, summary]) assert(!fs.existsSync(dir), dir);
  const history = read("F:/AgentVN/QA/Dialog-Portrait-Source-20261019-01/manifest.json");
  const original = history.packages.find(p => p.layout === "agentvn"); assert.equal(sha(original.path), original.sha256);
  const zip = await JSZip.loadAsync(fs.readFileSync(original.path));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const asset = manifest.assets.find(a => a.asset_id === "qa_portrait"); assert(asset);
  const bytes = await zip.file(asset.path).async("nodebuffer");
  const api = compile(`export {getDefaultUISkinLayout,migrateLegacyUISkinLayout} from "./shared/cartridge/uiSkin";
    export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles";`);
  const project = fixture("dialog-portrait-authoring-20261020-01");
  project.title = "头像布局 作者流程 临时工程";
  project.asset_manifest = [{ asset_id: "qa_portrait", asset_type: "portrait", metadata: {
    filename: "头像.svg", display_name: "专用头像", mime_type: asset.mime_type, file_size: bytes.length,
    data_url: `data:${asset.mime_type};base64,${bytes.toString("base64")}`,
  } }];
  const a = api.migrateLegacyUISkinLayout(api.getDefaultUISkinLayout()), b = api.createRenpyUILayout();
  project.editor_settings = { characters: [{ character_id: "portrait_hero", name: "头像角色", aliases: [] }],
    runtimeUILayout: a, runtimeUILayoutProfiles: { version: 1, activeType: "agentvn", profiles: { agentvn: a, renpy: b } } };
  project.nodes[1].data.scene.commands = [
    { type: "dialog", character_id: "portrait_hero", portrait: "qa_portrait", text: "PORTRAIT_LAYOUT：头像布局独立保存，正文几何不变。" },
    { type: "dialog", character_id: "portrait_hero", text: "PORTRAIT_CONTROL：没有绑定头像的对白。" },
  ];
  for (const dir of [qa, checkpoint, summary]) fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  for (const file of [...files, "AGENTS.md", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
    "shared/cartridge/uiLayoutProfiles.ts", "editor/src/utils/runtimeLayoutRestore.ts"]) {
    if (!fs.existsSync(path.join(root, file))) { saved.push({ file, absent: true }); continue; }
    const to = path.join(checkpoint, "files", file); fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, file), to, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(to), sha(path.join(root, file))); saved.push({ file, sha256: sha(to) });
  }
  const input = path.join(qa, "头像布局临时工程.vnproj"); write(input, project);
  const data = { status: "PASS", at: new Date().toISOString(), qa, checkpoint, input, inputSha256: sha(input),
    saved, portraitSha256: hash(bytes), values, modelRequests: 0,
    dev: { path: path.join(root, "AgentVN Dev.exe"), sha256: sha(path.join(root, "AgentVN Dev.exe")) },
    priorDevRecoverableCheckpoint: "F:/AgentVN/Checkpoints/Role-Geometry-Source-20261020-02",
    originalCartridge: original, scope: "Recoverable dirty source snapshots plus current artifact hashes; frozen installation untouched" };
  write(path.join(checkpoint, "manifest.json"), data); write(path.join(summary, "preparation.json"), data);
  console.log(JSON.stringify({ status: "PASS", input, checkpoint }));
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const p = (await import("/src/store/projectStore.ts")).useProjectStore.getState();
    const g = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
    return { id: p.projectId, settings: p.settings, nodes: g.nodes, edges: g.edges, assets: p.assetManifest };
  });
}
async function openLayout(page, type) {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
  const button = page.locator(`[data-layout-type-option="${type}"]:visible`);
  if (await button.getAttribute("aria-pressed") !== "true") await button.click();
  await page.waitForFunction(type => document.querySelector(".runtime-layout-designer")?.getAttribute("data-layout-type") === type
    && document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false", type);
  await settleEditor(page);
  const structuredPlayerEntry = page.getByTestId("renpy-player-layout-entry");
  if (await structuredPlayerEntry.isVisible()) await structuredPlayerEntry.click();
  await page.locator('[data-help-key="layout.screen"]:visible').getByText("播放页", { exact: true }).click();
  await settleEditor(page);
}
async function saveLayout(page) {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.waitForFunction(() => document.querySelector('[data-help-key="layout.save"]')?.getAttribute("data-save-state") === "saved");
}
async function preview(page) {
  const toggle = page.getByRole("button", { name: "实际 Runtime 预览", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page.locator(".renpy-editor-runtime-viewport[data-preview-phase='ready']").waitFor();
  const frame = page.frames().find(f => f.url().includes("gamecli-preview")); assert(frame);
  await settleRuntime(frame);
  await frame.locator('img[data-portrait-ready="true"]').waitFor();
  return frame;
}
async function observation(frame) {
  return frame.evaluate(async () => {
    const image = document.querySelector(".dialog-portrait"), panel = document.querySelector(".dialog-box"),
      speaker = panel?.querySelector(".speaker"), body = panel?.querySelector(".dialog-text");
    const rect = n => n?.getBoundingClientRect().toJSON();
    const bytes = image ? await (await fetch(image.currentSrc)).arrayBuffer() : new ArrayBuffer(0);
    const range = document.createRange(); if (body) range.selectNodeContents(body);
    return { image: rect(image), panel: rect(panel), speaker: rect(speaker), body: rect(body),
      imageSha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join(""),
      scale: parseFloat(getComputedStyle(panel).getPropertyValue("--runtime-ui-scale")) || 1,
      panelScale: panel.getBoundingClientRect().width / panel.offsetWidth,
      textRects: [...range.getClientRects()].map(r => r.toJSON()),
      overflow: { x: document.documentElement.scrollWidth - innerWidth, bodyX: body.scrollWidth - body.clientWidth },
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      visible: image?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      hit: image === document.elementFromPoint(image.getBoundingClientRect().x + image.getBoundingClientRect().width / 2,
        image.getBoundingClientRect().y + image.getBoundingClientRect().height / 2) };
  });
}
async function observeAt(page, expected) {
  const frame = await preview(page);
  // Readiness can still describe the previous draft for one React commit.
  // Wait for the actual requested presentation, never a fixed delay.
  await frame.waitForFunction(expected => {
    const n = document.querySelector(".dialog-portrait");
    if (!n) return false;
    const r = n.getBoundingClientRect();
    return ["x", "y", "width"].every(k => Math.abs(r[k] - expected[k]) <= 1);
  }, expected);
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return observation(frame);
}
function verify(o, expectedHash) {
  assert(o.visible && o.hit, JSON.stringify(o)); assert.equal(o.imageSha256, expectedHash);
  assert(o.image.left >= 0 && o.image.top >= 0 && o.image.right <= o.viewport.width + 1 && o.image.bottom <= o.viewport.height + 1);
  assert(o.overflow.x <= 1 && o.overflow.bodyX <= 1);
  assert(o.textRects.every(r => r.right <= o.image.left + 1 || r.left >= o.image.right - 1
    || r.bottom <= o.image.top + 1 || r.top >= o.image.bottom - 1), "Portrait overlaps actual body glyphs");
}
function close(a, b, tolerance = 1) { assert(Math.abs(a - b) <= tolerance, `${a} != ${b}`); }
function owners(service) {
  const ids = [service.pid || service.server.pid, service.backendPid].filter(Boolean).map(Number);
  const ports = [service.url, service.backendUrl].filter(Boolean).map(url => Number(new URL(url).port));
  const text = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `$ErrorActionPreference='Stop'; $rows=@(Get-CimInstance Win32_Process -Filter '${ids.map(id => `ProcessId = ${id}`).join(" OR ")}' | Select-Object ProcessId,ExecutablePath,CreationDate); $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(${ports.join(",")}) } | Select-Object LocalPort,OwningProcess); @{processes=$rows;listeners=$listeners} | ConvertTo-Json -Depth 5 -Compress`],
  { encoding: "utf8", windowsHide: true });
  const result = JSON.parse(text);
  assert.equal(result.processes.length, ids.length);
  for (const port of ports) assert(result.listeners.some(row => row.LocalPort === port && ids.includes(row.OwningProcess)));
  return result;
}
async function cleanup(service) {
  const entries = service ? [service.url, service.backendUrl].filter(Boolean) : [];
  const ports = [];
  for (const url of entries) {
    const port = Number(new URL(url).port), listening = await new Promise(resolve => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false)); socket.setTimeout(2000, () => { socket.destroy(); resolve(true); });
    });
    ports.push({ port, listening });
  }
  return { status: ports.every(p => !p.listening) ? "PASS" : "FAILED", ports };
}
async function publish(page, output, type) {
  await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
  await page.locator('[data-package-stage="settings"]').click();
  await page.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  const warning = page.getByRole("button", { name: "查看并确认警告", exact: true });
  if (await warning.isVisible()) await warning.click();
  const consent = page.locator('[data-help-key="package.confirmWarnings"]');
  if (await consent.isVisible()) await consent.check();
  const button = page.locator('[data-help-key="package.export"]:visible');
  await button.scrollIntoViewIfNeeded(); await button.click({ trial: true });
  const pending = page.waitForEvent("download"); await button.click();
  const download = await pending, file = path.join(output, `${type}.vncart`); await download.saveAs(file);
  const zip = await JSZip.loadAsync(fs.readFileSync(file)), layout = JSON.parse(await zip.file("ui/layout.json").async("string")),
    manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  assert.deepEqual(layout.dialogPortrait, values[type]); assert.equal(manifest.runtime_version, "0.22.0");
  const asset = manifest.assets.find(a => a.asset_id === "qa_portrait"); assert(asset);
  const result = { path: file, sha256: sha(file), layout, manifest,
    portraitSha256: hash(await zip.file(asset.path).async("nodebuffer")) };
  await page.locator('[data-help-key="package.close"]:visible').click(); await settleEditor(page);
  return result;
}
async function run(mode, smoke) {
  const prep = read(path.join(summary, "preparation.json")), output = process.env.AGENTVN_WORKSPACE_OUTPUT;
  assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT || ""), path.resolve(prep.input));
  assert(output && path.resolve(output).startsWith(path.resolve(qa) + path.sep) && !fs.existsSync(output));
  if (mode !== "editor") fs.mkdirSync(output, { recursive: true });
  const report = { status: "RUNNING", at: new Date().toISOString(), scope: `SOURCE_${mode.toUpperCase()}_NOT_INSTALLED_NOT_NATIVE_WEBVIEW`,
    sources: sources(), testSha256: sha(__filename), modelRequests: 0, cases: [] };
  const persist = () => fs.writeFileSync(path.join(output, "progress.json"), JSON.stringify(report, null, 2));
  let service, browser;
  try {
    service = mode === "editor" ? await startEditorAcceptance(output)
      : await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(output, "runtime.log") });
    fs.copyFileSync(__filename, path.join(output, "executed-test.cjs"));
    report.service = { url: service.url, pid: service.pid || service.server.pid,
      backendPid: service.backendPid, backendUrl: service.backendUrl, runId: service.runId || service.server.runId };
    report.service.ownership = owners(service);
    browser = await chromium.launch();
    const author = mode === "player" ? read(process.env.AGENTVN_PORTRAIT_AUTHOR_REPORT) : null;
    if (author) assert.equal(author.status, "PASS");
    for (const m of smoke ? matrices.slice(0, 1) : matrices) {
      const item = { ...m, checks: [], status: "RUNNING", observations: {}, artifacts: [] };
      report.cases.push(item); persist();
      const context = await browser.newContext({ viewport: { width: m.width, height: m.height },
        deviceScaleFactor: m.dpr, reducedMotion: m.reduced ? "reduce" : "no-preference", acceptDownloads: true });
      const page = await context.newPage(); page.setDefaultTimeout(40000);
      const errors = []; page.on("pageerror", e => errors.push(String(e)));
      await page.route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/, route => {
        if (route.request().method() !== "POST") return route.continue();
        report.modelRequests++; return route.abort();
      });
      try {
        await (service.server || service).run(async () => {
        if (mode === "editor") {
          // The shared host helper uses explicit test project and output isolation.
          await service.open(page); await settleEditor(page); const before = await snapshot(page);
          for (const type of ["agentvn", "renpy"]) {
            await openLayout(page, type);
            const controls = page.getByTestId("dialog-portrait-layout-editor");
            assert.equal(await controls.count(), 1, "Client layout must expose portrait position controls through the real top-level navigation");
            await controls.locator("summary").click(); await controls.getByRole("spinbutton", { name: "头像水平偏移", exact: true }).waitFor();
            const controlGeometry = [];
            for (const control of await controls.locator('input[type="number"], button').all()) {
              if (!await control.isEnabled()) continue;
              await control.scrollIntoViewIfNeeded(); await control.click({ trial: true });
              const geometry = await control.evaluate(n => {
                const r = n.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(n);
                return { rect: r.toJSON(), tag: n.tagName, text: [...range.getClientRects()].map(r => r.toJSON()),
                  inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
                  hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
              });
              assert(geometry.inside && geometry.hit);
              assert(geometry.text.every(t => t.left >= geometry.rect.left - 1 && t.right <= geometry.rect.right + 1));
              controlGeometry.push(geometry);
            }
            assert.equal(controlGeometry.length, 3);
            item.observations[`${type}-controls`] = controlGeometry;
            const baseFrame = await preview(page);
            await baseFrame.locator(`.ui-skin-scope[data-layout-type="${type}"]`).waitFor();
            await baseFrame.waitForFunction(() => {
              const image = document.querySelector(".dialog-portrait"), panel = document.querySelector(".dialog-box"),
                speaker = panel?.querySelector(".speaker");
              if (!image || !speaker) return false;
              const scale = parseFloat(getComputedStyle(panel).getPropertyValue("--runtime-ui-scale")) || 1;
              return Math.abs(image.getBoundingClientRect().right - speaker.getBoundingClientRect().left
                + 12 * scale * panel.getBoundingClientRect().width / panel.offsetWidth) <= 1;
            });
            const baseline = await observation(baseFrame);
            verify(baseline, prep.portraitSha256); item.observations[`${type}-default`] = baseline;
            for (const [key, label] of [["offsetX", "头像水平偏移"], ["offsetY", "头像垂直偏移"], ["size", "头像尺寸"]]) {
              const input = controls.getByRole("spinbutton", { name: label, exact: true });
              await input.fill(String(values[type][key])); await input.press("Tab");
            }
            await page.locator(".renpy-editor-runtime-viewport[data-preview-phase='ready']").waitFor();
            const factor = baseline.scale * baseline.panelScale, customSize = values[type].size * factor;
            const actual = await observeAt(page, { width: customSize,
              x: baseline.image.right + values[type].offsetX * factor - customSize,
              y: baseline.image.y + baseline.image.height / 2 + values[type].offsetY * factor - customSize / 2 });
            verify(actual, prep.portraitSha256);
            close(actual.image.width, values[type].size * factor);
            close(actual.image.right - baseline.image.right, values[type].offsetX * factor);
            close(actual.image.y + actual.image.height / 2 - baseline.image.y - baseline.image.height / 2, values[type].offsetY * factor);
            assert.deepEqual(actual.body, baseline.body); assert.deepEqual(actual.speaker, baseline.speaker);
            item.observations[`${type}-custom`] = actual; item.checks.push(`${type}: real inputs change Runtime portrait only`);
            await controls.getByRole("button", { name: "恢复头像默认位置", exact: true }).click();
            const reset = await observeAt(page, baseline.image); close(reset.image.x, baseline.image.x); close(reset.image.y, baseline.image.y);
            await page.locator('[data-help-key="layout.undo"]:visible').click();
            const undo = await observeAt(page, actual.image); close(undo.image.x, actual.image.x); close(undo.image.width, actual.image.width);
            await page.locator('[data-help-key="layout.redo"]:visible').click();
            const redo = await observeAt(page, baseline.image); close(redo.image.x, baseline.image.x);
            item.observations[`${type}-history`] = { reset, undo, redo };
            await page.locator('[data-help-key="layout.undo"]:visible').click(); await observeAt(page, actual.image);
            await saveLayout(page);
            await preview(page); await page.mouse.move(10, 10);
            const state = await snapshot(page);
            assert.deepEqual(state.settings.runtimeUILayout.dialogPortrait, values[type]);
            if (type === "renpy") assert.deepEqual(state.settings.runtimeUILayoutProfiles.profiles.agentvn.dialogPortrait, values.agentvn);
            assert.deepEqual(state.nodes, before.nodes); assert.deepEqual(state.edges, before.edges);
            item.checks.push(`${type}: reset/undo/redo/save and other profile/narrative preserved`);
            persist(); console.log(`${m.key}: ${type} authoring and preview PASS`);
          }
          item.screenshot = await captureSourceBrowser(page, path.join(output, `${m.key}-editor.png`),
            { width: m.width, height: m.height, dpr: m.dpr, reduced: m.reduced });
          // One full round trip at each real Editor display; only first case exports cartridges.
          await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
          const pending = page.waitForEvent("download"); await page.locator('[data-help-key="toolbar.saveProject"]').click();
          const download = await pending, portable = path.join(output, `${m.key}.vnproj`); await download.saveAs(portable);
          await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
          const z = await JSZip.loadAsync(fs.readFileSync(portable)), p = JSON.parse(await z.file("project.json").async("string"));
          for (const type of ["agentvn", "renpy"]) assert.deepEqual(p.editor_settings.runtimeUILayoutProfiles.profiles[type].dialogPortrait, values[type]);
          await page.reload();
          await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some(n => !n.disabled));
          await page.locator('[data-help-key="home.recentProject"]').first().click();
          await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
          const persisted = await snapshot(page);
          for (const type of ["agentvn", "renpy"])
            assert.deepEqual(persisted.settings.runtimeUILayoutProfiles.profiles[type].dialogPortrait, values[type]);
          item.checks.push("real backend reopen restores both profiles before portable reimport");
          await page.reload();
          await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some(n => !n.disabled));
          await page.locator(".project-import-button input").first().setInputFiles(portable);
          await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
          const reopened = await snapshot(page);
          for (const type of ["agentvn", "renpy"]) assert.deepEqual(reopened.settings.runtimeUILayoutProfiles.profiles[type].dialogPortrait, values[type]);
          item.checks.push("portable download and real reimport preserve both independent portrait layouts");
          if (m.key === matrices[0].key) for (const type of ["agentvn", "renpy"]) {
            await openLayout(page, type); await saveLayout(page);
            const artifact = await publish(page, output, type);
            assert.equal(artifact.portraitSha256, prep.portraitSha256); item.artifacts.push({ type, ...artifact });
          }
        } else {
          for (const type of ["agentvn", "renpy"]) {
            const source = author.cases[0].artifacts.find(a => a.type === type); assert(source); assert.equal(sha(source.path), source.sha256);
            await page.goto(`${service.url}/?mode=library`);
            // Hidden file inputs can be assigned even under the startup overlay.
            // A real user cannot import there: wait for initial library boot first.
            await settleRuntime(page);
            await page.evaluate(async () => {
              // Read-only observation handle, never calls a store action.
              window.__portraitQaLibrary = (await import("/src/store/libraryStore.ts")).useLibraryStore;
            });
            await page.getByTestId("web-cartridge-file").setInputFiles(source.path);
            await page.waitForFunction(({ config, type }) => {
              // This installed Playwright version treats a Promise as truthy:
              // asynchronous predicates only evaluate once. Poll synchronously.
              const state = window.__portraitQaLibrary.getState();
              const selected = state.games.find(g => g.install_id === state.selectedInstallId);
              return !state.loading && !state.importing && !state.error
                && (selected?.uiSkin?.layout_type ?? "agentvn") === type
                && Object.entries(config).every(([key, value]) => selected?.uiSkin?.dialogPortrait?.[key] === value);
            }, { type, config: values[type] });
            (item.importReceipts ||= {})[type] = await page.evaluate(() => {
              const s = window.__portraitQaLibrary.getState();
              const game = s.games.find(g => g.install_id === s.selectedInstallId);
              if (!game) throw Error(`Selected imported game disappeared: ${JSON.stringify({
                loading: s.loading, importing: s.importing, selected: s.selectedInstallId,
                records: s.records.map(r => r.installId), games: s.games.map(g => g.install_id) })}`);
              return { importing: s.importing, error: s.error, installId: s.selectedInstallId, sourceFileName: game.source_file_name,
                layoutType: game.uiSkin.layout_type ?? "agentvn", config: game.uiSkin.dialogPortrait, contentId: game.contentId };
            });
            await page.getByRole("button", { name: "启动卡带", exact: true }).click(); await settleRuntime(page);
            await page.getByTestId("start-new-game").click(); await settleRuntime(page);
            await page.locator(`.ui-skin-scope[data-layout-type="${type}"]`).waitFor();
            await page.locator('img[data-portrait-ready="true"]').waitFor();
            await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
            const o = await observation(page); item.observations[type] = o; verify(o, prep.portraitSha256);
            const factor = o.scale * o.panelScale;
            close(o.image.width, values[type].size * factor);
            close(o.image.right - o.speaker.left, (values[type].offsetX - 12) * factor);
            close(o.image.y + o.image.height / 2 - o.speaker.y - o.speaker.height / 2, values[type].offsetY * factor);
            item.observations[type] = o;
            await page.locator(".dialog-text").click();
            await page.waitForFunction(() => document.querySelector(".dialog-text")?.textContent.includes("PORTRAIT_CONTROL"));
            assert.equal(await page.locator(".dialog-portrait").count(), 0);
            assert.deepEqual((await page.locator(".dialog-text").boundingBox()), { x: o.body.x, y: o.body.y, width: o.body.width, height: o.body.height });
            item.checks.push(`${type}: actual cartridge file/library/gameplay consumes authored portrait and removes it on next unbound dialogue`);
            item.artifacts.push({ type, path: source.path, sha256: source.sha256 });
          }
          item.screenshot = await captureSourceBrowser(page, path.join(output, `${m.key}-player.png`),
            { width: m.width, height: m.height, dpr: m.dpr, reduced: m.reduced });
        }
        assert.deepEqual(errors, []); item.status = "PASS";
        });
      } catch (e) {
        item.status = "FAILED"; item.error = String(e.stack || e);
        await page.screenshot({ path: path.join(output, `${m.key}-failure.png`), scale: "device" }).catch(() => {});
      } finally { await context.close(); persist(); console.log(JSON.stringify({ key: m.key, status: item.status, error: item.error })); }
      if (item.status !== "PASS") break;
    }
    assert.equal(report.cases.length, smoke ? 1 : 12); assert(report.cases.every(c => c.status === "PASS"));
    assert.equal(report.modelRequests, 0);
    for (const s of report.sources) assert.equal(sha(path.join(root, s.file)), s.sha256, "Source changed during acceptance");
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    await browser?.close(); await service?.stop(); report.cleanup = await cleanup(service);
    if (report.cleanup.status !== "PASS") { report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); write(path.join(output, "report.json"), report);
    console.log(JSON.stringify({ status: report.status, output, error: report.error }));
  }
}
(async () => {
  const mode = process.argv[2];
  if (mode === "prepare") return prepare();
  assert(["editor", "player"].includes(mode)); return run(mode, process.argv.includes("--smoke"));
})().catch(e => { console.error(e); process.exitCode = 1; });
