"use strict";
// Execute the actual autosave effect, stores and shared write queue with a
// deterministic debounce clock, controlled transport, and controlled native IPC.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(process.argv[2] && !fs.existsSync(out), "Use a new evidence directory");
assert(out.toLowerCase().replaceAll("\\", "/").startsWith("f:/testavn/"));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "ACTUAL_AUTOSAVE_EFFECT_STORES_AND_QUEUE_CONTROLLED_CLOCK_TRANSPORT_NATIVE_IPC", cases: [], models: 0, builds: 0 };
const records = new Map(), timers = new Map(), listeners = new Map();
let timerId = 0, effect, dispose, calls, backups, transport, ipc, remote;
global.window = {
  location: { search: "" },
  localStorage: { getItem: k => records.get(k) ?? null, setItem: (k, v) => records.set(k, v), removeItem: k => records.delete(k) },
  setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
  clearTimeout(id) { timers.delete(id); }, matchMedia: () => ({ matches: false }),
  addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
  removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
  dispatchEvent(event) { for (const callback of listeners.get(event.type) || []) callback(event); },
};
global.localStorage = window.localStorage;
global.document = { visibilityState: "visible", addEventListener: window.addEventListener, removeEventListener: window.removeEventListener };
global.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
const built = require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export {useEditorProjectAutosave} from "./editor/src/components/editor/useEditorProjectAutosave";
    export {useEditorStore} from "./editor/src/store/editorStore";
    export {useProjectStore} from "./editor/src/store/projectStore";
    export {backendClient} from "./editor/src/api/backendClient";
  ` },
  bundle: true, platform: "node", format: "cjs", write: false, external: ["react"],
  define: { "import.meta.env": "{}" }, nodePaths: [path.join(root, "editor/node_modules")],
});
const compiled = new Module(path.join(out, "actual-effect.cjs"), module);
compiled.filename = path.join(out, "actual-effect.cjs"); compiled.paths = Module._nodeModulePaths(path.join(root, "editor"));
const originalRequire = compiled.require.bind(compiled);
compiled.require = name => name === "react"
  ? { ...require("../editor/node_modules/react"), useEffect: callback => { effect = callback; } }
  : originalRequire(name);
compiled._compile(built.outputFiles[0].text, compiled.filename);
const api = compiled.exports, store = api.useEditorStore, project = api.useProjectStore;
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const tick = () => new Promise(setImmediate);
async function settle() { for (let i = 0; i < 15; i += 1) await tick(); }
async function until(predicate) { for (let i = 0; i < 150; i += 1) { if (predicate()) return; await tick(); } throw Error("Expected controlled operation not reached"); }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function load(id = "a") { const f = fixture(id); store.getState().importProject(f); project.getState().loadProjectMetadata(f); }
function debounce() {
  const scheduled = [...timers.entries()].findLast(([, timer]) => timer.ms === 800);
  assert(scheduled, "An actual autosave debounce must be scheduled");
  timers.delete(scheduled[0]); scheduled[1].fn();
}
function flush() { window.dispatchEvent(new CustomEvent("agentvn:workspace-surface-changed")); }
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
api.backendClient.request = async (route, options) => {
  assert.equal(route, "/api/project/state");
  const payload = JSON.parse(options.body); calls.push(payload);
  if (transport) return transport(payload);
  remote = structuredClone(payload); return { data: payload };
};
window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
  if (command === "write_project_backup") {
    const snapshot = JSON.parse(args.projectJson); backups.push({ snapshot, trigger: args.trigger });
    if (ipc) return ipc(snapshot);
    return { project_id: snapshot.project_id, file_name: "recovery.vnproj" };
  }
  if (command === "append_frontend_error") return "";
  throw Error("Unexpected IPC: " + command);
} };
async function test(name, fn) {
  dispose?.(); await settle(); timers.clear();
  calls = []; backups = []; transport = undefined; ipc = undefined; remote = undefined; load();
  api.useEditorProjectAutosave(); assert.equal(typeof effect, "function"); dispose = effect();
  const row = { name, status: "RUNNING" }; report.cases.push(row); save();
  try { await fn(row); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; }
  row.writes = calls.length; row.backupAttempts = backups.length; save();
}
(async () => {
  for (const kind of ["title", "author", "settings", "assets"]) {
    await test(`纯${kind}修改：无图dirty仍保留对应恢复点`, async () => {
      if (kind === "title") project.getState().setMetadata({ title: "新标题" });
      if (kind === "author") project.getState().setMetadata({ author: "新作者" });
      if (kind === "settings") project.getState().setDefaultSpriteScale(1.2);
      if (kind === "assets") project.getState().setAssetManifest([{ asset_id: "background", kind: "background", name: "背景", metadata: { url: "/background.png" } }]);
      assert.equal(store.getState().dirty, false);
      debounce(); await until(() => backups.length === 1); await settle();
      const saved = backups[0].snapshot;
      assert.equal(saved.title, project.getState().title);
      assert.equal(saved.author, project.getState().author);
      assert.deepEqual(saved.editor_settings, JSON.parse(JSON.stringify(project.getState().settings)));
      assert.deepEqual(saved.asset_manifest, JSON.parse(JSON.stringify(project.getState().assetManifest)));
    });
  }
  await test("成功后重复工作区/隐藏页面事件不追加重复恢复点", async () => {
    project.getState().setMetadata({ title: "只保存一次" }); debounce(); await until(() => backups.length === 1); await settle();
    flush(); window.dispatchEvent(new CustomEvent("pagehide"));
    document.visibilityState = "hidden"; window.dispatchEvent(new CustomEvent("visibilitychange")); document.visibilityState = "visible";
    await settle(); assert.equal(backups.length, 1); assert.equal(calls.length, 1);
  });
  await test("备份拒写后保留重试意图，无新编辑时pagehide也重试且不循环", async () => {
    ipc = async () => { throw Error("RECOVERY_DENIED"); };
    project.getState().setMetadata({ title: "恢复点拒写" }); debounce(); await until(() => backups.length === 1); await settle();
    assert(store.getState().lastError.message.includes("恢复点写入失败"));
    assert.equal(calls.length, 1); assert.equal(timers.size, 0);
    ipc = undefined; window.dispatchEvent(new CustomEvent("pagehide")); await until(() => backups.length === 2); await settle();
    flush(); await settle(); assert.equal(calls.length, 2); assert.equal(backups.length, 2);
  });
  await test("纯元数据数据库拒写后保留内容，下次工作区切换重试", async () => {
    transport = async () => { throw Error("SAVE_DENIED"); };
    project.getState().setMetadata({ title: "数据库拒写" }); debounce(); await until(() => calls.length === 1); await settle();
    assert.equal(project.getState().title, "数据库拒写"); assert.equal(store.getState().dirty, false);
    assert(store.getState().lastError.message.includes("自动保存失败")); assert.equal(backups.length, 0); assert.equal(timers.size, 0);
    transport = undefined; flush(); await until(() => backups.length === 1);
    assert.equal(remote.project_metadata.title, "数据库拒写");
  });
  await test("响应在途编辑并离页：串行提交两真实修订及对应恢复点", async () => {
    const held = deferred();
    transport = async payload => { if (calls.length === 1) await held.promise; remote = structuredClone(payload); return { data: payload }; };
    project.getState().setMetadata({ title: "第一修订" }); debounce(); await until(() => calls.length === 1);
    project.getState().setMetadata({ title: "最终修订" }); flush(); assert.equal(calls.length, 1);
    held.resolve(); await until(() => backups.length === 2); await settle();
    assert.deepEqual(backups.map(b => b.snapshot.title), ["第一修订", "最终修订"]);
    assert.equal(remote.project_metadata.title, "最终修订"); assert.equal(calls.length, 2);
  });
  for (const outcome of ["success", "failure"]) await test(`A→B→A旧备份迟到${outcome}不清除新工程重试或写入其提示`, async () => {
    const held = deferred();
    ipc = () => held.promise;
    project.getState().setMetadata({ title: "旧代次" }); debounce(); await until(() => backups.length === 1);
    load("b"); load("a"); project.getState().setMetadata({ title: "新代次" }); flush();
    ipc = undefined;
    if (outcome === "success") held.resolve({ file_name: "old.vnproj" }); else held.reject(Error("OLD_BACKUP_FAILED"));
    await until(() => backups.length === 2); await settle();
    assert.equal(backups[1].snapshot.title, "新代次"); assert.equal(remote.project_metadata.title, "新代次");
    assert.equal(store.getState().lastError, undefined);
  });
  await test("同工程干净重新载入不制造恢复点；之后首个元数据编辑仍保存", async () => {
    load("a"); debounce(); await until(() => calls.length === 1); await settle(); assert.equal(backups.length, 0);
    project.getState().setMetadata({ title: "重新载入后编辑" }); debounce(); await until(() => backups.length === 1);
    assert.equal(backups[0].snapshot.title, "重新载入后编辑");
  });
  await test("导入素材的服务端物化不产生自动恢复点循环", async () => {
    transport = async payload => {
      const persisted = structuredClone(payload);
      persisted.project_metadata.assetManifest = persisted.project_metadata.assetManifest.map(asset => ({
        ...asset, metadata: { url: "/materialized.png" },
      }));
      remote = persisted; return { data: persisted };
    };
    project.getState().setAssetManifest([{ asset_id: "image", kind: "background", name: "图片", metadata: { data_url: "data:image/png;base64,AA==" } }]);
    debounce(); await until(() => backups.length === 1); await settle();
    assert.equal(backups[0].snapshot.asset_manifest[0].metadata.url, "/materialized.png");
    if ([...timers.values()].some(t => t.ms === 800)) debounce();
    await settle(); assert.equal(backups.length, 1);
  });
  await test("卸载取消debounce与监听器，在途请求完成不新增备份或提示", async () => {
    const held = deferred(); transport = async payload => { await held.promise; return { data: payload }; };
    project.getState().setMetadata({ title: "卸载在途" }); debounce(); await until(() => calls.length === 1);
    project.getState().setMetadata({ title: "未提交的新内容" });
    dispose(); dispose = undefined; held.resolve(); await settle();
    assert.equal([...timers.values()].filter(t => t.ms === 800).length, 0); assert.equal(backups.length, 0);
    flush(); await settle(); assert.equal(calls.length, 1);
    for (const name of ["agentvn:workspace-surface-changed", "pagehide", "visibilitychange"]) assert.equal(listeners.get(name)?.size || 0, 0);
  });
  report.status = report.cases.length === 13 && report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; })
  .finally(() => { dispose?.(); save(); console.log(JSON.stringify(report)); if (report.status !== "PASS") process.exitCode = 1; });
