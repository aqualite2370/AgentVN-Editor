"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process"), { createHash } = require("node:crypto");
const { buildSync } = require("../editor/node_modules/esbuild");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { show, hide, line, script } = require("./sprite-hide-rollback-regression.cjs");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(out.startsWith("F:\\testavn\\Sprite-Position-")); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "SOURCE_RUNTIME_REAL_ART_CONTROLLED_SCRIPT_NOT_NATIVE", cases: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let browser, server;
async function at(p, text) {
  await p.waitForFunction(t => {
    const s = window.__positionStore.getState().engineState;
    return s.dialog?.text === t && !s.isTyping;
  }, text);
}
async function next(p, text) { await p.locator(".dialog-box").click(); await at(p, text); }
async function rect(p) {
  return p.locator('.sprite-slot[data-character-id="alice"]:not(.is-exiting)').evaluate(slot => ({
    slot: slot.getBoundingClientRect().toJSON(),
    image: slot.querySelector('[data-sprite-role="current"] img').getBoundingClientRect().toJSON(),
  }));
}
function same(actual, expected, label) {
  for (const key of ["x", "y", "width", "height"])
    assert(Math.abs(actual[key] - expected[key]) <= .6, `${label} ${key}: ${actual[key]} vs ${expected[key]}`);
}
(async () => {
  const art = JSON.parse(execFileSync("python", ["-c", `
import zipfile,json,base64,hashlib
p=r'C:\\Users\\1\\Downloads\\隐忍的成长_20261109_003641.vnproj'
with zipfile.ZipFile(p) as z:
 rows=[]
 for key,needle in [('portrait','乌赫_大衣_常态'),('companion','毕特雷尔_无语'),('background','工业区-')]:
  name=next(n for n in z.namelist() if needle in n); data=z.read(name)
  rows.append(dict(id=key,path=name,sha256=hashlib.sha256(data).hexdigest(),base64=base64.b64encode(data).decode(),mime='image/png' if name.endswith('.png') else 'image/jpeg'))
 print(json.dumps(rows,ensure_ascii=True))
`], { encoding: "utf8", windowsHide: true, maxBuffer: 24 * 1024 * 1024 }));
  report.art = art.map(({ base64, ...m }) => m);
  const urls = Object.fromEntries(art.map(a => [a.id, `data:${a.mime};base64,${a.base64}`]));
  const m = { exports: {} };
  new Function("module", "exports", "require", buildSync({ stdin: { resolveDir: root, loader: "ts", contents: `
export {createRenpyUILayout} from './shared/cartridge/uiLayoutProfiles';
export {getDefaultUISkinLayout} from './shared/cartridge/uiSkin';` },
    bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(m, m.exports, require);
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(out, "vite.log") });
  report.server = { pid: server.pid, url: server.url, runId: server.runId }; save();
  const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
  browser = await chromium.launch({ headless: true, env: { ...process.env, TEMP: temporary, TMP: temporary } });
  const matrix = [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
    [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))));
  for (const theme of ["agentvn", "renpy"]) for (const config of matrix) {
    const row = { theme, ...config, status: "RUNNING", samples: [] }; report.cases.push(row); save();
    const c = await browser.newContext({ viewport: { width: config.width, height: config.height },
      deviceScaleFactor: config.dpr, reducedMotion: config.reduced ? "reduce" : "no-preference" });
    const p = await c.newPage(); p.on("pageerror", e => report.errors.push(String(e)));
    try {
      const s = script([{ type: "background", background_id: "background" },
        { ...show(), position: "right" }, line("SOLO"),
        { ...show("bob", "companion"), position: "left" }, line("PAIR"),
        { ...show("carol", "companion"), position: "center" }, line("TRIO"),
        hide("bob"), line("LEFT_EXIT"), hide("carol"), line("SOLO_AGAIN"),
        line("UNCHANGED"), { ...show(), position: "left", offset_x: 8 }, line("AUTHOR_MOVE"),
        line("AFTER_MOVE")]);
      s.game_id = `position-${theme}`;
      const manifest = { manifest_version: "1.0.0", game_id: s.game_id, title: "站位稳定验收", author: "QA",
        version: "1", description: "", entry_script: "script.json", runtime_version: "0.32.0", tags: [], language: "zh-CN",
        assets: art.map(a => ({ asset_id: a.id, asset_type: a.id === "background" ? "background" : "sprite", path: a.path, mime_type: a.mime })) };
      await p.goto(server.url + "/?mode=preview");
      await p.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
      await p.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
        sessionId: "position", revision: 1, requestId: "init", runId: "position", screen: "title_menu", ...payload }, "*"),
      { manifest, script: s, assetUrls: urls, uiSkin: theme === "renpy" ? m.exports.createRenpyUILayout() : m.exports.getDefaultUISkinLayout() });
      await p.getByTestId("start-new-game").waitFor(); await settleRuntime(p);
      await p.evaluate(async () => {
        window.__positionStore = (await import("/src/store/runtimeStore.ts")).useRuntimeStore;
        (await import("/src/store/settingsStore.ts")).useSettingsStore.getState().updateSettings({
          textSpeed: 200, textSpeedCps: 200, autoSaveEnabled: false });
      });
      await p.getByTestId("start-new-game").click(); await at(p, "SOLO"); await settleRuntime(p);
      await p.waitForFunction(() => [...document.querySelectorAll(".sprite-slot img")].every(i => i.complete && i.naturalWidth));
      row.baseline = await rect(p);
      await p.evaluate(() => {
        window.__positionFrames = []; window.__positionTracking = true;
        const sample = () => {
          if (!window.__positionTracking) return;
          const slot = document.querySelector('.sprite-slot[data-character-id="alice"]');
          const image = slot?.querySelector('[data-sprite-role="current"] img');
          window.__positionFrames.push({ at: performance.now(), slot: slot?.getBoundingClientRect().toJSON(),
            image: image?.getBoundingClientRect().toJSON(), text: window.__positionStore.getState().engineState.dialog?.text });
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      for (const text of ["PAIR", "TRIO", "LEFT_EXIT", "SOLO_AGAIN", "UNCHANGED"]) {
        await next(p, text); await settleRuntime(p);
        const geometry = await rect(p); row.samples.push({ text, ...geometry });
        same(geometry.slot, row.baseline.slot, text + " slot");
        same(geometry.image, row.baseline.image, text + " image");
        if (text === "PAIR" && config.width === 1920 && config.dpr === 1 && !config.reduced)
          await p.screenshot({ path: path.join(out, `${theme}-pair.png`), scale: "device" });
      }
      row.frames = await p.evaluate(() => { window.__positionTracking = false; return window.__positionFrames; });
      assert(row.frames.length > 5);
      for (const f of row.frames) {
        assert(f.slot && f.image, "Existing sprite must not disappear during someone else's entry/exit");
        same(f.slot, row.baseline.slot, "frame slot"); same(f.image, row.baseline.image, "frame image");
      }
      row.savedBaseline = await p.evaluate(() => window.__positionStore.getState().engine.createSaveSnapshot());
      await next(p, "AUTHOR_MOVE"); await settleRuntime(p); row.authorMove = await rect(p);
      assert(row.authorMove.slot.x < row.baseline.slot.x - config.width * .2);
      same({ ...row.authorMove.image, x: row.baseline.image.x }, row.baseline.image, "author keeps scale and y");
      if (theme === "renpy") await p.getByTestId("renpy-quick-rollback").click();
      else {
        await p.getByTestId("quick-menu-toggle").click();
        await p.getByRole("button", { name: "回退", exact: true }).click();
        await p.getByTestId("quick-menu-toggle").click();
      }
      await at(p, "UNCHANGED"); await settleRuntime(p); same((await rect(p)).image, row.baseline.image, "rollback");
      await p.evaluate(snapshot => window.__positionStore.getState().engine.restoreSaveSnapshot(snapshot), row.savedBaseline);
      await at(p, "UNCHANGED"); await settleRuntime(p); same((await rect(p)).slot, row.baseline.slot, "save restore");
      row.parameters = await p.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
      assert.deepEqual(row.parameters, config); row.status = "PASS";
    } catch (e) {
      row.status = "FAILED"; row.error = e.stack;
      await p.screenshot({ path: path.join(out, `${theme}-${config.width}-${config.dpr}-${config.reduced}-failure.png`) });
    } finally { await c.close(); save(); }
  }
  assert.equal(report.cases.length, 24); assert(report.cases.every(c => c.status === "PASS"));
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = e.stack; process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); await server?.stop(); report.cleanup = "OWNED_BROWSER_SERVER_STOPPED"; save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
    failed: report.cases.filter(c => c.status !== "PASS").map(c => ({ theme: c.theme, width: c.width, error: c.error })), out }));
});
