"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(out.startsWith("F:\\testavn\\Sfx-Stop-Fade-") && !fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", cases: [], errors: [],
  boundary: "ACTUAL_REACT_EDITOR_JSON_RELOAD_ENGINE_AND_HTML_AUDIO_NOT_INSTALLED_NOT_LISTENING" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const samples = 8000 * 10, wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
// Low-level PCM is only a controlled media source; no claim of audible QA.
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(120 * Math.sin(i * Math.PI * 2 * 220 / 8000)), 44 + i * 2);
const audioUrl = "data:audio/wav;base64," + wav.toString("base64");
const runtimeBundle = require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, contents: `
export {RuntimeAudio} from './GameCli_framework/src/components/player/RuntimeAudio';
export {useRuntimeStore} from './GameCli_framework/src/store/runtimeStore';
export {useSettingsStore} from './GameCli_framework/src/store/settingsStore';` },
  bundle: true, platform: "browser", format: "esm", write: false, define: { "import.meta.env": "{}" },
  external: ["react"],
  nodePaths: [path.join(root, "editor/node_modules"), path.join(root, "GameCli_framework/node_modules")],
}).outputFiles[0].text.replaceAll('from "react"', 'from "/__sfx_react__.js"');
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div>
<script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(t)=>t;window.__vite_plugin_react_preamble_installed__=true;</script>
<script type="module">
import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {SfxCommandEditor} from '/src/components/command-editors/SfxCommandEditor.tsx';
import {useProjectStore} from '/src/store/projectStore.ts';
import {RuntimeAudio,useRuntimeStore,useSettingsStore} from '/__sfx_runtime__.js';
import '/src/styles/variables.css';import '/src/styles/layout.css';import '/src/styles/editor-tokens.css';
import '/src/styles/editor-number-input.css';
const url=${JSON.stringify(audioUrl)};
useProjectStore.setState({projectId:'sfx-browser',assetManifest:[{asset_id:'tone',asset_type:'sfx',metadata:{filename:'音效.wav',data_url:url}}]});
useSettingsStore.setState(s=>({settings:{...s.settings,audioWhenUnfocused:true,audioWhenMinimized:true,muteAll:false,muteSfx:false,volumeMaster:1,volumeSfx:1,selfVoicing:false,audioEmphasis:false}}));
window.runtimeStore=useRuntimeStore;
function App(){
const [command,setCommand]=React.useState(()=>JSON.parse(localStorage.getItem('sfx-command')||'{"type":"sfx","sfx_id":"tone","volume":0.6}'));
const [saved,setSaved]=React.useState(false);
async function start(){
 const script={schema_version:'1.0.0',game_id:'sfx-browser',entry_scene_id:'main',scenes:[{scene_id:'main',title:'音效测试',commands:[
 {type:'sfx',sfx_id:'tone',volume:.8},{type:'sfx',sfx_id:'tone',volume:.6},{type:'sfx',sfx_id:'other',volume:.5},
 {type:'narration',text:'PLAYING'},command,{type:'narration',text:'STOPPING'},
 {type:'sfx',sfx_id:'tone'},{type:'narration',text:'NEW_SOUND'},{type:'sfx',sfx_id:'',action:'stop'},
 {type:'narration',text:'STOPPED'}]}]};
 await useRuntimeStore.getState().loadGame({install_id:'sfx-browser',game_id:'sfx-browser',title:'音效测试',script,
 manifest:{game_id:'sfx-browser',assets:[{asset_id:'tone',asset_type:'sfx',path:url},{asset_id:'other',asset_type:'sfx',path:url}]},
 assetUrls:{tone:url,other:url},gallery:[]});
 useRuntimeStore.getState().engine.start();
}
return React.createElement('main',{style:{maxWidth:700,margin:'32px auto',padding:24}},
 React.createElement('h2',null,'音效事件'),
 React.createElement(SfxCommandEditor,{command,onChange:c=>{setCommand(c);setSaved(false)}}),
 React.createElement('div',{style:{display:'flex',gap:12,marginTop:20}},
 React.createElement('button',{onClick:()=>{localStorage.setItem('sfx-command',JSON.stringify(command));setSaved(true)}},'保存事件'),
 React.createElement('button',{onClick:start},'启动测试剧情'),
 React.createElement('button',{onClick:()=>{const engine=useRuntimeStore.getState().engine;engine.completeTyping();engine.next();}},'下一步')),
 React.createElement('output',null,saved?'事件已保存':''),
 React.createElement(RuntimeAudio));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
</script></body></html>`;
let server, browser, context, page;
(async () => {
  const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
  server = await startOwnedViteServer({ root: path.join(root, "editor"), logFile: path.join(out, "vite.log") });
  report.server = { pid: server.pid, url: server.url, runId: server.runId }; save();
  browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"],
    env: { ...process.env, TEMP: temporary, TMP: temporary } });
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    const display = { width, height, dpr, reduced }, row = { display, status: "RUNNING" }; report.cases.push(row); save();
    context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: reduced ? "reduce" : "no-preference" });
    page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on("pageerror", e => report.errors.push(e.stack || String(e)));
    await page.addInitScript(() => {
      window.audioInstances = [];
      const Original = window.Audio;
      window.Audio = function(url) { const a = new Original(url); window.audioInstances.push(a); return a; };
      window.Audio.prototype = Original.prototype;
    });
    await page.route("**/__sfx__", r => r.fulfill({ contentType: "text/html", body: html }));
    await page.route("**/__sfx_runtime__.js", r => r.fulfill({ contentType: "application/javascript", body: runtimeBundle }));
    await page.route("**/__sfx_react__.js", r => r.fulfill({ contentType: "application/javascript", body:
      `import React from '/node_modules/.vite/deps/react.js';
export const {useEffect,useRef,useState,useCallback,useMemo,useSyncExternalStore,useLayoutEffect,createElement}=React;export default React;` }));
    await page.goto(server.url + "/__sfx__");
    await page.getByRole("combobox", { name: "音效播放动作", exact: true }).click();
    await page.getByRole("option", { name: "停止", exact: true }).click();
    await page.getByRole("combobox", { name: "音效停止效果", exact: true }).click();
    await page.getByRole("option", { name: "淡出", exact: true }).click();
    const duration = page.getByLabel("淡出时长（毫秒）", { exact: true });
    await duration.fill("750"); await duration.press("Tab");
    await page.getByRole("button", { name: "保存事件", exact: true }).click();
    const expected = { type: "sfx", sfx_id: "tone", volume: .6, action: "stop", fade_ms: 750 };
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("sfx-command"))), expected);
    await page.reload(); await duration.waitFor(); assert.equal(await duration.inputValue(), "750");
    await page.getByRole("button", { name: "启动测试剧情" }).click();
    await page.waitForFunction(() => window.audioInstances.length === 3 && window.audioInstances.every(a => !a.paused), { }, { timeout: 20000 });
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    row.fadeFrames = await page.evaluate(() => new Promise(resolve => {
      const frames = [];
      function sample() {
        frames.push({ time: performance.now(), volume: audioInstances[0].volume, paused: audioInstances[0].paused });
        if (audioInstances[0].paused) resolve(frames); else requestAnimationFrame(sample);
      } sample();
    }));
    assert(row.fadeFrames.length > 4);
    assert(row.fadeFrames.some(f => f.volume > 0 && f.volume < .7));
    for (let i = 1; i < row.fadeFrames.length; i++) assert(row.fadeFrames[i].volume <= row.fadeFrames[i - 1].volume + .0001);
    assert.deepEqual(await page.evaluate(() => audioInstances.map(a => a.paused)), [true, true, false]);
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.waitForFunction(() => audioInstances.length === 4 && !audioInstances[3].paused);
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.waitForFunction(() => audioInstances.every(a => a.paused));
    // Test stop-all from the actual editor, then reset/rewind cleanup.
    await page.getByRole("button", { name: "清空停止目标", exact: true }).click();
    await page.getByRole("combobox", { name: "音效停止效果", exact: true }).click();
    await page.getByRole("option", { name: "立即停止", exact: true }).click();
    await page.getByRole("button", { name: "保存事件", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("sfx-command"))),
      { ...expected, sfx_id: "", fade_ms: 0 });
    await page.getByRole("button", { name: "启动测试剧情" }).click();
    await page.waitForFunction(() => audioInstances.length === 7 && !audioInstances[6].paused);
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.waitForFunction(() => audioInstances.every(a => a.paused));
    await page.getByRole("button", { name: "启动测试剧情" }).click();
    await page.waitForFunction(() => audioInstances.length === 10 && !audioInstances[9].paused);
    await page.evaluate(() => runtimeStore.getState().engine.reset());
    await page.waitForFunction(() => audioInstances.every(a => a.paused));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    row.screenshot = await captureSourceBrowser(page, path.join(out, `sfx-${width}-${dpr}-${reduced}.png`), display);
    row.status = "PASS"; await context.close(); context = undefined; save();
  }
  assert.equal(report.cases.length, 12); assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = e.stack; process.exitCode = 1;
  if (page && !page.isClosed()) { report.text = await page.locator("body").innerText(); await page.screenshot({ path: path.join(out, "failure.png") }); }
}).finally(async () => {
  await context?.close(); await browser?.close(); await server?.stop();
  report.cleanup = "OWNED_BROWSER_SERVER_STOPPED"; report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error, errors: report.errors }));
});
