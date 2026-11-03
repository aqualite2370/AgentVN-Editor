"use strict";
// Real Runtime UI and store. IPC is controlled; this is not installed/native migration acceptance.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), out = process.argv[2];
assert(out && !fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "SOURCE_RUNTIME_REAL_BROWSER_CONTROLLED_TAURI_IPC",
  modelRequests: 0, cases: [], errors: [], screenshots: [] };
const persist = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const layoutModule = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(layoutModule, layoutModule.exports);
let server, browser, currentPage;
const matrix = [[1920,1080], [2560,1440], [3840,2160]].flatMap(([width,height]) =>
  [1,2].flatMap(dpr => [false,true].flatMap(reduced =>
    ["agentvn","renpy"].map(layout => ({ width,height,dpr,reduced,layout })))));
async function initialize(page, layout) {
  await page.goto(`${server.url}/?mode=preview`);
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
  await page.evaluate(async uiSkin => {
    const { useRuntimeStore: store } = await import("/src/store/runtimeStore.ts");
    const game = { install_id: "preview_gamecli", game_id: "claim-game", title: "旧档归属确认回归",
      uiSkin, gallery: [], assetUrls: {}, manifest: { game_id: "claim-game", title: "旧档归属确认回归", assets: [], entry_scene_id: "main" },
      script: { game_id: "claim-game", entry_scene_id: "main", characters: [],
        scenes: [{ scene_id: "main", title: "Main", commands: [{ type: "narration", text: "旧档归属确认" }] }] } };
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { window.removeEventListener("message", ready); reject(Error("preview init timeout")); }, 10000);
      function ready(event) {
        if (event.data?.type === "agentvn.live-preview.ready" && event.data.sessionId === "claim-ui") {
          clearTimeout(timeout); window.removeEventListener("message", ready); resolve();
        }
      }
      window.addEventListener("message", ready);
      window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "claim-ui",
        revision: 1, requestId: "claim-ui", runId: "claim-ui", screen: "title_menu",
        manifest: game.manifest, script: game.script, uiSkin, assetUrls: {} }, "*");
    });
    const candidate = { fileName: "slot-01.json", sourceSha256: "a".repeat(64), slot: 1, saveKind: "manual",
      createdAt: "2026-09-25 12:00", sceneId: "main", summary: "待确认的剧情摘要", conflict: false };
    window.__claimInfo = { portable: true,
      sourceDirectory: "C:\\旧资料 中文\\saves\\preview_gamecli",
      targetDirectory: "F:\\隔离 游戏\\saves\\claim-game\\preview_gamecli",
      availableFiles: [], conflictFiles: ["slot-02.json"], skippedFiles: ["slot-03.json"], copiedFiles: [],
      unverifiedFiles: [candidate, { ...candidate, fileName: "slot-02.json", slot: 2, conflict: true }] };
    window.__claimCalls = []; window.__claimFailure = false;
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => 0, invoke: async (command, args) => {
        if (command === "get_save_storage_info") return structuredClone(window.__claimInfo);
        if (command === "migrate_legacy_saves") {
          window.__claimCalls.push(structuredClone(args));
          if (window.__claimFailure) throw Error("旧存档已变更，请重新扫描并确认归属。");
          if (args.gameId !== "claim-game" || args.legacyClaims?.length !== 1
            || args.legacyClaims[0].fileName !== candidate.fileName
            || args.legacyClaims[0].sourceSha256 !== candidate.sourceSha256)
            throw Error("Unexpected ownership confirmation");
          window.__claimInfo.unverifiedFiles = window.__claimInfo.unverifiedFiles.filter(file => file.conflict);
          window.__claimInfo.copiedFiles = [candidate.fileName];
          return structuredClone(window.__claimInfo);
        }
        if (command === "list_saves" || command === "list_gallery_unlocks") return [];
        return null;
      } };
    store.getState().setRuntimeMode("fixed"); await store.getState().loadGame(game);
  }, layout === "renpy" ? layoutModule.exports.createRenpyUILayout() : layoutModule.exports.getDefaultUISkinLayout());
}
async function geometry(dialog) {
  return dialog.evaluate(panel => {
    const r = panel.getBoundingClientRect();
    const controls = [...panel.querySelectorAll("button:not([disabled]),input:not([disabled])")].map(control => {
      const b = control.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width/2,b.y + b.height/2);
      return { label: control.ariaLabel || control.textContent, box: b.toJSON(), hit: control === hit || control.contains(hit) };
    });
    return { rect: r.toJSON(), controls, focusedInside: panel.contains(document.activeElement),
      inside: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
}
(async () => {
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
    configFile: path.join(root, "GameCli_framework/vite.config.cjs"), port: 0, logFile: path.join(out, "vite.log") });
  const live = rows(); report.owner = live.find(p => p.ProcessId === server.pid); assert(report.owner);
  report.known = ownedProcessTree(live, server.pid, report.owner.Created);
  report.port = Number(new URL(server.url).port); report.url = server.url; report.runId = server.runId;
  assert(listeners([report.port]).every(l => report.known.some(p => p.ProcessId === l.OwningProcess)));
  browser = await chromium.launch();
  for (const m of matrix) {
    await server.assertAlive();
    const context = await browser.newContext({ viewport: { width: m.width, height: m.height },
      deviceScaleFactor: m.dpr, reducedMotion: m.reduced ? "reduce" : "no-preference" });
    const page = currentPage = await context.newPage();
    page.on("pageerror", e => report.errors.push(String(e)));
    const row = { ...m, status: "RUNNING" }; report.cases.push(row); persist();
    try {
      await initialize(page, m.layout);
      const dialog = page.getByRole("dialog", { name: "复制旧存档到游戏目录？", exact: true });
      await dialog.waitFor(); await settleRuntime(page);
      row.initial = await geometry(dialog);
      assert(row.initial.inside && row.initial.focusedInside && row.initial.overflow <= 1);
      assert(row.initial.controls.every(c => c.hit));
      const claim = dialog.getByRole("checkbox", { name: "确认 slot-01.json 属于当前游戏", exact: true });
      assert.equal(await claim.isChecked(), false);
      assert.equal(await dialog.getByRole("checkbox", { name: "确认 slot-02.json 属于当前游戏", exact: true }).isDisabled(), true);
      assert.equal(await dialog.getByTestId("save-migration-confirm").isDisabled(), true);
      await claim.check();
      assert.equal(await dialog.getByTestId("save-migration-confirm").isEnabled(), true);
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
      assert.deepEqual(await page.evaluate(() => window.__claimCalls), [], "cancel leaves source and target untouched");
      await page.getByTestId("open-save-load").click(); await settleRuntime(page);
      await page.getByTestId("save-storage-open").click(); await dialog.waitFor(); await settleRuntime(page);
      assert.equal(await claim.isChecked(), false, "new review must not retain previous ownership consent");
      await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
      assert((await geometry(dialog)).focusedInside);
      await claim.check(); await page.evaluate(() => { window.__claimFailure = true; });
      await dialog.getByRole("button", { name: "确认归属并复制", exact: true }).click();
      await dialog.getByRole("alert").waitFor();
      assert.match(await dialog.getByRole("alert").innerText(), /已变更/);
      assert.equal(await claim.isChecked(), true, "failed write retains review and explicit retry");
      await page.evaluate(() => { window.__claimFailure = false; });
      await dialog.getByRole("button", { name: "重试复制", exact: true }).click();
      await dialog.waitFor({ state: "detached" }); await settleRuntime(page);
      row.calls = await page.evaluate(() => window.__claimCalls);
      assert.equal(row.calls.length, 2);
      for (const call of row.calls) assert.deepEqual(call, { installId: "preview_gamecli", gameId: "claim-game",
        confirmed: true, legacyClaims: [{ fileName: "slot-01.json", sourceSha256: "a".repeat(64) }] });
      await page.getByTestId("save-storage-open").click(); await dialog.waitFor(); await settleRuntime(page);
      assert.equal(await dialog.getByRole("checkbox").count(), 1, "only the untouched conflicting candidate remains");
      assert.equal(await dialog.getByRole("checkbox").isDisabled(), true);
      assert.equal(await dialog.getByTestId("save-migration-confirm").isDisabled(), true);
      row.final = await geometry(dialog);
      assert(row.final.inside && row.final.focusedInside && row.final.overflow <= 1
        && row.final.controls.every(c => c.hit));
      const expected = { width: m.width, height: m.height, dpr: m.dpr, reduced: m.reduced };
      const actual = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight,
        dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
      row.before = await actual(); assert.deepEqual(row.before, expected);
      const file = path.join(out, `${m.width}-${m.dpr}-${m.reduced}-${m.layout}.png`);
      const png = await page.screenshot({ path: file });
      row.after = await actual(); assert.deepEqual(row.after, expected);
      assert.equal(png.readUInt32BE(16), m.width * m.dpr); assert.equal(png.readUInt32BE(20), m.height * m.dpr);
      report.screenshots.push({ file, width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
      assert(await page.getByTestId("save-storage-open").evaluate(b => b === document.activeElement));
      row.status = "PASS";
    } finally { persist(); await context.close(); currentPage = undefined; }
  }
  assert.equal(report.cases.length, 24); assert(report.cases.every(c => c.status === "PASS"));
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (report.cases.at(-1)?.status === "RUNNING") report.cases.at(-1).status = "FAILED";
  await currentPage?.screenshot({ path: path.join(out,"failure.png") }).catch(() => {});
}).finally(async () => {
  const errors = [];
  try { await browser?.close(); } catch(e) { errors.push(String(e)); }
  try { await server?.stop(); } catch(e) { errors.push(String(e)); }
  try {
    const live = rows(); report.survivors = (report.known || []).filter(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
    report.remainingListeners = report.port ? listeners([report.port]) : [];
    assert.equal(report.survivors.length, 0); assert.equal(report.remainingListeners.length, 0);
  } catch(e) { errors.push(String(e)); }
  report.cleanup = errors.length ? "FAILED" : "PASS";
  if (errors.length) { report.cleanupErrors = errors; report.status = "FAILED"; process.exitCode = 1; }
  persist(); console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error, cleanup: report.cleanup, out }));
});
