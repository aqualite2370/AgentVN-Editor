"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process"), { createHash } = require("node:crypto");
const { buildSync } = require("../editor/node_modules/esbuild");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { show, hide, line, script, exitAnimation } = require("./sprite-hide-rollback-regression.cjs");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(out.startsWith("F:\\testavn\\Sprite-Hide-Rollback-")); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "SOURCE_FULL_RUNTIME_CONTROLLED_SCRIPT_REAL_USER_ART_NOT_NATIVE_INSTALL",
  cases: [], errors: [], sourceProjectReadOnly: true, modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
let server, browser;
async function state(page) {
  return page.evaluate(async () => {
    const s = (await import("/src/store/runtimeStore.ts")).useRuntimeStore.getState();
    return { text: s.engineState.dialog?.text, sprites: Object.keys(s.engineState.sprites),
      savedSprites: Object.keys(s.engine.createSaveSnapshot().sprites),
      index: s.engineState.currentCommandIndex, typing: s.engineState.isTyping,
      animations: s.engineState.animationEffects.length, mode: s.spritePresentationMode };
  });
}
async function at(page, text) {
  await page.waitForFunction(text => {
    const s = window.__qaRollbackStore.getState();
    return s.engineState.dialog?.text === text && !s.engineState.isTyping;
  }, text);
}
async function advance(page, text) { await page.locator(".dialog-box").click(); await at(page, text); }
async function rollback(page, theme, text) {
  if (theme === "renpy") await page.getByTestId("renpy-quick-rollback").click();
  else {
    const toggle = page.getByTestId("quick-menu-toggle");
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    await page.getByRole("button", { name: "回退", exact: true }).click();
    if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click();
  }
  await at(page, text);
}
(async () => {
  // Only read three selected, clothed character/background entries. Never unpack the project.
  const art = JSON.parse(execFileSync("python", ["-c", `
import zipfile,json,base64,hashlib
p=r'C:\\Users\\1\\Downloads\\隐忍的成长_20261109_003641.vnproj'
with zipfile.ZipFile(p) as z:
 rows=[]
 for key,needle in [('portrait','乌赫_大衣_常态'),('companion','毕特雷尔_无语'),('background','工业区-')]:
  name=next(n for n in z.namelist() if needle in n)
  data=z.read(name)
  rows.append(dict(id=key,path=name,sha256=hashlib.sha256(data).hexdigest(),base64=base64.b64encode(data).decode(),mime='image/png' if name.endswith('.png') else 'image/jpeg'))
 print(json.dumps(rows,ensure_ascii=True))
`], { encoding: "utf8", maxBuffer: 24 * 1024 * 1024, windowsHide: true }));
  report.art = art.map(({ base64, ...metadata }) => metadata); save();
  const urls = Object.fromEntries(art.map(a => [a.id, `data:${a.mime};base64,${a.base64}`]));
  for (const a of art) assert.equal(sha(Buffer.from(a.base64, "base64")), a.sha256);
  const mod = { exports: {} };
  new Function("module", "exports", "require", buildSync({ stdin: { resolveDir: root, loader: "ts", contents: `
export { createRenpyUILayout } from './shared/cartridge/uiLayoutProfiles';
export { getDefaultUISkinLayout } from './shared/cartridge/uiSkin';` }, bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(mod, mod.exports, require);
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(out, "vite.log") });
  report.server = { pid: server.pid, url: server.url, runId: server.runId }; save();
  const temp = path.join(out, "temporary"); fs.mkdirSync(temp);
  browser = await chromium.launch({ headless: true, env: { ...process.env, TEMP: temp, TMP: temp } });
  const matrix = process.argv.includes("--matrix")
    ? [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) => [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))))
    : [false, true].map(reduced => ({ width: 1920, height: 1080, dpr: 1, reduced }));
  for (const hideMode of process.argv.includes("--both-hide-paths") ? ["sprite", "animation-all"] : ["sprite"])
  for (const theme of ["agentvn", "renpy"]) for (const m of matrix) {
    const row = { hideMode, theme, ...m, status: "RUNNING", sizes: [], snapshots: [] }; report.cases.push(row); save();
    const context = await browser.newContext({ viewport: { width: m.width, height: m.height }, deviceScaleFactor: m.dpr,
      reducedMotion: m.reduced ? "reduce" : "no-preference" });
    const page = await context.newPage(); page.on("pageerror", e => report.errors.push(String(e)));
    try {
      const s = script([
        { type: "background", background_id: "background" }, show(), line("COUNT_1"),
        { ...show("bob", "companion"), position: "right" }, line("COUNT_2"),
        show("carol", "companion"), show("dave"), show("eve", "companion"), line("COUNT_5"),
        ...["bob", "carol", "dave", "eve"].map(id => ({ ...hide(id), animation_config: undefined })), line("BEFORE"),
        hideMode === "sprite" ? hide("alice", false, 1000) : { ...exitAnimation("sprite:all"), params: { duration_ms: 1000 } },
        line("HIDDEN_1"), line("HIDDEN_2"), line("HIDDEN_3"),
        show("alice", "companion"), line("RETURNED"), line("NEXT"),
      ]);
      s.game_id += `-${theme}`; s.characters = [{ character_id: "alice", name: "验收角色" }];
      const manifest = { manifest_version: "1.0.0", game_id: s.game_id, title: "立绘回退验收", author: "QA",
        version: "1", description: "", entry_script: "script.json", runtime_version: "0.32.0", tags: [], language: "zh-CN",
        assets: art.map(a => ({ asset_id: a.id, asset_type: a.id === "background" ? "background" : "sprite", path: a.path, mime_type: a.mime })) };
      const skin = theme === "renpy" ? mod.exports.createRenpyUILayout() : mod.exports.getDefaultUISkinLayout();
      await page.goto(server.url + "/?mode=preview");
      await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
      await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
        sessionId: "hide-rollback", revision: 1, requestId: "init", runId: "hide-rollback", screen: "title_menu", ...payload }, "*"),
      { manifest, script: s, uiSkin: skin, assetUrls: urls });
      await page.getByTestId("start-new-game").waitFor(); await settleRuntime(page);
      await page.evaluate(async () => { window.__qaRollbackStore = (await import("/src/store/runtimeStore.ts")).useRuntimeStore; });
      await page.evaluate(async () => (await import("/src/store/settingsStore.ts")).useSettingsStore.getState().updateSettings({ textSpeed: 200, textSpeedCps: 200 }));
      await page.getByTestId("start-new-game").click(); await at(page, "COUNT_1"); await settleRuntime(page);
      for (const [text, count] of [["COUNT_1", 1], ["COUNT_2", 2], ["COUNT_5", 5], ["BEFORE", 1]]) {
        if (text !== "COUNT_1") await advance(page, text);
        await page.waitForFunction(count => document.querySelectorAll(".sprite-slot:not(.is-exiting)").length === count, count);
        await page.waitForFunction(() => [...document.querySelectorAll(".sprite-slot img")].every(i => i.complete && i.naturalWidth > 0));
        await settleRuntime(page);
        row.sizes.push({ count, rect: await page.locator('.sprite-slot[data-character-id="alice"] img').evaluate(i => i.getBoundingClientRect().toJSON()) });
        if (count === 2 && m.width === 1920 && m.dpr === 1 && !m.reduced)
          await page.screenshot({ path: path.join(out, `${hideMode}-${theme}-real-art-two-sprites.png`), scale: "device" });
      }
      const baseline = row.sizes[0].rect;
      assert(row.sizes.every(r => Math.abs(r.rect.width - baseline.width) < .5 && Math.abs(r.rect.height - baseline.height) < .5));
      await advance(page, "HIDDEN_1"); row.duringExit = await state(page); save();
      assert.deepEqual(row.duringExit.savedSprites, []);
      await advance(page, "HIDDEN_2"); await advance(page, "HIDDEN_3");
      await page.waitForFunction(() => !window.__qaRollbackStore.getState().engineState.sprites.alice);
      for (const text of ["HIDDEN_2", "HIDDEN_1"]) {
        await rollback(page, theme, text); const snapshot = await state(page); row.snapshots.push(snapshot);
        assert.deepEqual(snapshot.sprites, []); assert.deepEqual(snapshot.savedSprites, []);
        await page.waitForFunction(() => !document.querySelector(".sprite-slot"));
      }
      if (m.width === 1920 && m.dpr === 1 && !m.reduced)
        await page.screenshot({ path: path.join(out, `${hideMode}-${theme}-hidden-after-rollback.png`), scale: "device" });
      await rollback(page, theme, "BEFORE"); assert.deepEqual((await state(page)).sprites, ["alice"]);
      for (const text of ["HIDDEN_1", "HIDDEN_2", "HIDDEN_3"]) {
        assert(await page.evaluate(async () => (await import("/src/store/runtimeStore.ts")).useRuntimeStore.getState().rollForward()));
        await at(page, text); assert.deepEqual((await state(page)).sprites, []);
      }
      for (const text of ["HIDDEN_2", "HIDDEN_1", "BEFORE"]) await rollback(page, theme, text);
      await advance(page, "HIDDEN_1");
      // Interrupt the exit by showing the same character again before its timer completes.
      await advance(page, "HIDDEN_2"); await advance(page, "HIDDEN_3"); await advance(page, "RETURNED");
      await page.waitForFunction(() => window.__qaRollbackStore.getState().engineState.sprites.alice?.sprite_id === "companion");
      await page.waitForTimeout(1100); assert.deepEqual((await state(page)).sprites, ["alice"]);
      assert.equal((await state(page)).text, "RETURNED");
      const parameters = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
      assert.deepEqual(parameters, { ...m, overflow: false }); row.parameters = parameters;
      row.status = "PASS";
    } catch (e) { row.status = "FAILED"; row.error = e.stack; await page.screenshot({ path: path.join(out, `${hideMode}-${theme}-${m.width}-${m.dpr}-${m.reduced}-failure.png`) }); }
    finally { await context.close(); save(); }
  }
  assert(report.cases.length > 0); assert(report.cases.every(c => c.status === "PASS")); assert.deepEqual(report.errors, []);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = e.stack; process.exitCode = 1; }).finally(async () => {
  await browser?.close(); await server?.stop(); report.cleanup = "OWNED_BROWSER_SERVER_STOPPED"; save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.map(c => ({ theme: c.theme, status: c.status, error: c.error })), error: report.error }));
});
