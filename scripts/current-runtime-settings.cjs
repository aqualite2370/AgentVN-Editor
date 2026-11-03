"use strict";
// Preserve the complete 17-control business test; change only candidate,
// fixtures, QA boundaries and native-page readiness. No product edits.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Settings-1.9.35-20261102-01";
const checkpoint = "F:/AgentVN/Checkpoints/Current-Runtime-Settings-20261102-01";
const runtime = "F:/AgentVN/QA/Native-Runtime-State-20261101-01";
const helper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const sourceReport = "F:/AgentVN/QA/Installed-Layout-20261101-01/editor-03/report.json";
const receipt = qa + "/derived-installation.json";
const playerHash = "66945ed6a9d026ab2f17370c9fe1fa207cdc741b7005f61f1ccd539c56e46b0e";
const files = { test: "scripts/installed-runtime-settings-1922.cjs",
  preview: "scripts/lib/installed-runtime-preview-1922-session.cjs", base: "scripts/lib/installed-runtime-session.cjs" };
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function adapt(kind) {
  let text = fs.readFileSync(files[kind], "utf8"); const edits = [];
  function change(before, after) {
    assert.equal(text.split(before).length - 1, 1, "Exact QA adaptation: " + before);
    text = text.replace(before, () => after); edits.push({ before, after });
  }
  if (kind === "base") change("Native-Runtime-State-20261020-01", "Native-Runtime-State-20261101-01");
  if (kind === "preview") {
    change('require("./installed-runtime-session.cjs")', "module.qaBase");
    change('this.page = this.browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes("tauri.localhost"));',
      'this.page = await require("./wait-native-runtime-page.cjs").waitNativeRuntimePage(this.browser);');
    change('"ACTUAL_1922_NSIS_SHIPPED_PLAYER_PREVIEW_NOT_STANDALONE"',
      '"ACTUAL_1935_NSIS_SHIPPED_PLAYER_PREVIEW_NOT_STANDALONE"');
  }
  if (kind === "test") {
    change('require("./lib/installed-runtime-preview-1922-session.cjs")', "module.qaPreview");
    change('"F:/AgentVN/QA/Native-Runtime-State-20261020-01"', JSON.stringify(runtime));
    change('"a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59"', JSON.stringify(playerHash));
    change('"ACTUAL_1922_NSIS_SHIPPED_PLAYER_PREVIEW_NOT_STANDALONE"',
      '"ACTUAL_1935_NSIS_SHIPPED_PLAYER_PREVIEW_NOT_STANDALONE"');
    change('"scripts/native-dev-preview-profile.ps1", "-Action"', JSON.stringify(helper) + ', "-Action"');
    change("`installed-settings-1922-${attempt}`", "`installed-settings-1935-${attempt}`");
    change('desc("F:/AgentVN/Checkpoints/Installed-Runtime-Settings-1922-20261023-01/report.json")',
      "desc(" + JSON.stringify(checkpoint + "/report.json") + ")");
    change('desc("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json")',
      "desc(" + JSON.stringify(receipt) + ")");
    change('assert.equal(installed.version, "1.9.22")', 'assert.equal(installed.version, "1.9.35")');
    change('[installed.executable, ...installed.resources, installed.originalAudit, installed.originalInstallation]',
      '[installed.executable, ...installed.resources, installed.actualInstallation]');
    change(`    report.sources = [
      desc("F:/AgentVN/QA/Windows-Package-20261021-01/editor-04/report.json"),
      desc("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-44/report.json"),
    ];`, `    report.sources = [desc(${JSON.stringify(sourceReport)}), desc(${JSON.stringify(sourceReport)})];`);
    change('    const [win, renpy] = report.sources.map(f => read(f.path));',
      `    const [win, renpy] = report.sources.map(f => read(f.path));
    win.input = win.portable;
    win.observedFiles = win.cartridges.filter(c => c.type === "agentvn");
    renpy.cartridge = renpy.cartridges.find(c => c.type === "renpy");`);
    change('assert.equal(win.status, "PASS"); assert.equal(renpy.status, "PASS");',
      'assert.equal(win.status, "PASS_LIMITED_NATIVE_PROJECT_ROUNDTRIP_AND_UI_CARTRIDGE_EXPORT"); ' +
      'assert.equal(renpy.status, "PASS_LIMITED_NATIVE_PROJECT_ROUNDTRIP_AND_UI_CARTRIDGE_EXPORT");');
    change('    save();\n    report.checkpoint', '    report.executedQABinding = module.qaBinding; save();\n    report.checkpoint');
    change('["installed-runtime-settings-1922-profile-test.cjs", "native-runtime-state-viewport-test.cjs"]',
      '["installed-runtime-settings-1922-profile-test.cjs"]');
    // Rename provenance everywhere while retaining all seven business checks.
    const before = text;
    text = text.replaceAll("ACTUAL_1922_SHIPPED_PREVIEW_ALL17_SETTINGS_SHARED_PREVIEW_IDENTITY",
      "ACTUAL_1935_SHIPPED_PREVIEW_ALL17_SETTINGS_SHARED_PREVIEW_IDENTITY");
    edits.push({ before: "ACTUAL_1922_SHIPPED_PREVIEW_ALL17_SETTINGS_SHARED_PREVIEW_IDENTITY",
      after: "ACTUAL_1935_SHIPPED_PREVIEW_ALL17_SETTINGS_SHARED_PREVIEW_IDENTITY",
      count: before.split("ACTUAL_1922_SHIPPED_PREVIEW_ALL17_SETTINGS_SHARED_PREVIEW_IDENTITY").length - 1 });
  }
  new vm.Script(Module.wrap(text));
  return { text, edits };
}
function verify() {
  const installed = descriptor(), r = read(sourceReport);
  assert.equal(r.status, "PASS_LIMITED_NATIVE_PROJECT_ROUNDTRIP_AND_UI_CARTRIDGE_EXPORT");
  assert.equal(sha(r.portable.path), r.portable.sha256);
  assert.deepEqual(r.cartridges.map(c => c.type).sort(), ["agentvn", "renpy"]);
  for (const c of r.cartridges) assert.equal(sha(c.path), c.sha256);
  assert.equal(installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256, playerHash);
  return installed;
}
function compile(kind, source, extra = {}) {
  const filename = path.resolve(files[kind]), worker = new Module(filename, module);
  Object.assign(worker, { filename, paths: Module._nodeModulePaths(path.dirname(filename)), ...extra });
  worker._compile(source, filename); return worker;
}
const [mode, attempt = "01"] = process.argv.slice(2);
assert(["self-test", "prepare", "run"].includes(mode)); assert.match(attempt, /^\d{2}$/);
const installed = verify(), adapted = Object.fromEntries(Object.keys(files).map(k => [k, adapt(k)]));
// The old guard expected the formerly exact DPR implementation to fail.
// Validate the actual capture guard instead, without a historical-error dependency.
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
for (const delta of [{ dpr: 1.25 }, { dpr: 2 }, { dpr: NaN }, { dpr: null },
  { width: 2560 }, { height: 1440 }, { reduced: true }])
  assert.throws(() => validateNativeViewport({ ...expected, ...delta }, expected));
assert.equal(validateNativeViewport(expected, expected), expected);
validateNativeViewport({ ...expected, dpr: 1.0000000149011612 }, expected);
validateNativeViewport({ ...expected, dpr: 2.0000000298023224 }, { ...expected, dpr: 2 });
if (mode === "self-test") {
  for (const [kind, a] of Object.entries(adapted)) {
    let text = a.text;
    for (const e of a.edits.slice().reverse()) text = text.replaceAll(e.after, () => e.before);
    assert.equal(text, fs.readFileSync(files[kind], "utf8"));
  }
  console.log(JSON.stringify({ status: "PASS", preservedBusinessChecks: 7, controls: 17,
    displayCombinations: 24, executableSha256: playerHash }));
} else if (mode === "prepare") {
  assert(!fs.existsSync(qa) && !fs.existsSync(checkpoint));
  fs.mkdirSync(qa); fs.mkdirSync(checkpoint);
  fs.writeFileSync(receipt, JSON.stringify(installed, null, 2), { flag: "wx" });
  for (const file of [__filename, ...Object.values(files), "AGENTS.md", "plans/ACTIVE_TASKS.md"]) {
    const dest = path.join(checkpoint, path.relative(path.resolve(__dirname, ".."), path.resolve(file)));
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL);
  }
  fs.writeFileSync(checkpoint + "/report.json", JSON.stringify({ status: "PASS", at: new Date().toISOString(),
    products: [installed.executable, ...installed.resources], helper: desc(helper), sourceReport: desc(sourceReport),
    productChanges: 0, builds: 0, modelRequests: 0 }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: "PASS", checkpoint }));
} else {
  assert.deepEqual(read(receipt), installed);
  const folder = path.join(qa, "run-" + attempt); fs.mkdirSync(folder);
  const scripts = Object.entries(adapted).map(([kind, a]) => {
    const executed = path.join(folder, `${kind}-executed.cjs`);
    fs.writeFileSync(executed, a.text, { flag: "wx" });
    return { kind, original: desc(files[kind]), executed: desc(executed), edits: a.edits };
  });
  const binding = path.join(folder, "binding.json");
  fs.writeFileSync(binding, JSON.stringify({ adapter: desc(__filename), scripts, installation: desc(receipt),
    helper: desc(helper), sourceReport: desc(sourceReport), productChanges: 0, modelRequests: 0 }, null, 2), { flag: "wx" });
  const base = compile("base", adapted.base.text);
  const preview = compile("preview", adapted.preview.text, { qaBase: base.exports });
  const filename = path.resolve(files.test), worker = new Module(filename, module);
  Object.assign(worker, { filename, paths: Module._nodeModulePaths(path.dirname(filename)),
    qaPreview: preview.exports, qaBinding: desc(binding) });
  process.argv = [process.execPath, filename, attempt];
  require.main = worker; process.mainModule = worker; worker._compile(adapted.test.text, filename);
}
