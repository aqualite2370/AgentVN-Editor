"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const esbuild = require("../editor/node_modules/esbuild");
const JSZip = require("../editor/node_modules/jszip");
const root = path.resolve(__dirname, ".."), out = process.argv[2];
assert(out && !fs.existsSync(out), "Use a new evidence directory");
fs.mkdirSync(out, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(
  "F:/AgentVN/Checkpoints/GUI-Scope-20261019-01/manifest.json", "utf8"));
const loaded = { exports: {} };
const bundle = esbuild.buildSync({ stdin: {
  contents: `export {parseRenpyGUIParameters} from "./shared/cartridge/renpyGui";
    export {scanRenpyGuiArchive} from "./editor/src/renpy/renpyGuiImport";`,
  loader: "ts", resolveDir: root,
}, bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
new Function("module", "exports", "require", bundle.outputFiles[0].text)(loaded, loaded.exports, require);
const api = loaded.exports, sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [],
  scope: "actual shared parser and archive scanner, authentic pinned official full template; not installed acceptance",
  modelSubmissions: 0, parserSha256: sha(fs.readFileSync(path.join(root, "shared/cartridge/renpyGui.ts"))) };
async function test(name, callback) {
  const item = { name, status: "RUNNING" }; report.cases.push(item);
  try { await callback(item); item.status = "PASS"; }
  catch (error) { item.status = "FAILED"; item.error = String(error.stack || error); }
}
const parse = source => api.parseRenpyGUIParameters(source);
const base = "define gui.interface_text_size = 22\ndefine gui.navigation_spacing = 4\n";
(async () => {
  await test("unconditional later definition still wins", item => {
    item.result = parse(base + "define gui.interface_text_size = 26");
    assert.equal(item.result.values.shared.fontSize, 26);
    assert.equal(item.result.complete, true);
  });
  await test("direct static init python assignment remains supported", item => {
    item.result = parse(base + "\ninit -2 python:\n    gui.interface_text_size = 24\n    gui.navigation_spacing = 6");
    assert.equal(item.result.values.shared.fontSize, 24);
    assert.equal(item.result.values.shared.spacing, 6);
    assert.equal(item.result.complete, true);
  });
  for (const [name, block] of [
    ["phone branch", 'init python:\n    if renpy.variant("small"):\n        gui.interface_text_size = 30'],
    ["false branch", "init python:\n    if False:\n        gui.interface_text_size = 30"],
    ["else branch", "init python:\n    if True:\n        pass\n    else:\n        gui.interface_text_size = 30"],
    ["decorated variant", "init python:\n    @gui.variant\n    def small():\n        gui.interface_text_size = 30"],
    ["unexecuted function", "def configure_gui():\n    gui.interface_text_size = 30"],
    ["screen logic", "screen preferences():\n    gui.interface_text_size = 30"],
    ["named Python store", "init python in isolated_store:\n    gui.interface_text_size = 30"],
    ["nested conditional", "init python:\n    if True:\n        if True:\n            gui.interface_text_size = 30"],
    ["multiline conditional", "init python:\n    if (\n        False\n    ):\n        gui.interface_text_size = 30"],
    ["tab-indented branch", "init python:\n\tif False:\n\t\tgui.interface_text_size = 30"],
  ]) await test(`${name} cannot override unconditional desktop`, item => {
    item.result = parse(base + block);
    assert.equal(item.result.values.shared.fontSize, 22);
    assert.equal(item.result.values.shared.spacing, 4);
    assert(item.result.issues.some(issue => issue.code === "unsupported_context"
      && issue.parameter === "gui.interface_text_size" && issue.line > 2
      && issue.expression === "30"), "Ignored blocks must produce visible, source-located diagnostics");
    assert.equal(item.result.complete, false);
  });
  await test("rejected block cannot poison references; dedent resumes allowed scope", item => {
    item.result = parse(base + `init python:
    @gui.variant
    def small():
        gui.interface_text_size = 30
        gui.hover_color = "#ff0000"
    gui.navigation_spacing = gui.interface_text_size / 2
define gui.navigation_xpos = 44
define gui.button_text_hover_color = gui.hover_color
`);
    assert.equal(item.result.values.shared.fontSize, 22);
    assert.equal(item.result.values.shared.spacing, 11);
    assert.equal(item.result.values.shared.x, 44);
    assert.equal(item.result.values.shared.buttonTextColors, undefined);
    assert(item.result.issues.some(issue => issue.code === "unsupported_expression"
      && issue.parameter === "gui.button_text_hover_color"));
  });
  await test("comments and multiline strings never create assignment/block ownership", item => {
    item.result = parse(`${base}
"""
init python:
    if True:
        gui.interface_text_size = 99
"""
# if False:
define gui.navigation_xpos = 42 # comment
init python:
    """ if False:
        gui.interface_text_size = 88
    """
    gui.navigation_spacing = 8
`);
    assert.deepEqual(item.result.values.shared, { fontSize: 22, spacing: 8, x: 42 });
    assert.equal(item.result.complete, true);
  });
  await test("arbitrary expressions are not executed in allowed or denied scope", item => {
    delete globalThis.__agentvnGuiScopeExecuted;
    item.result = parse(`${base}
define gui.navigation_xpos = (globalThis.__agentvnGuiScopeExecuted = true)
init python:
    if True:
        gui.interface_text_size = __import__('os').system('unsafe')
`);
    assert.equal(globalThis.__agentvnGuiScopeExecuted, undefined);
    assert.equal(item.result.values.shared.x, undefined);
    assert.equal(item.result.values.shared.fontSize, 22);
    assert(item.result.issues.some(issue => issue.code === "unsupported_expression"));
    assert(item.result.issues.some(issue => issue.code === "unsupported_context"));
  });
  await test("authentic full official ZIP retains desktop defaults and all 25 resource bytes", async item => {
    const bytes = fs.readFileSync(manifest.officialArchive.path);
    assert.equal(sha(bytes), manifest.officialArchive.sha256);
    item.archive = manifest.officialArchive;
    const zip = await JSZip.loadAsync(bytes);
    const source = await zip.file("官方模板 中文/game/gui.rpy").async("string");
    assert(source.includes("@gui.variant") && source.includes("def small():"));
    const result = await api.scanRenpyGuiArchive(new Uint8Array(bytes));
    item.values = result.parameters.values; item.issues = result.issues;
    item.assets = result.assets.map(asset => ({ path: asset.path, sha256: sha(asset.bytes) }));
    assert.equal(result.parameters.values.shared.fontSize, 22);
    assert.equal(result.parameters.values.shared.spacing, 4);
    assert.equal(result.parameters.values.save_load.saveColumns, 3);
    assert.equal(result.assets.length, 25);
    for (const asset of item.assets) assert.equal(asset.sha256,
      manifest.officialFiles.find(file => asset.path === `官方模板 中文/game/${file.relative}`)?.sha256);
    for (const parameter of ["gui.interface_text_size", "gui.navigation_spacing", "gui.file_slot_cols"])
      assert(result.issues.some(issue => issue.code === "unsupported_context" && issue.parameter === parameter));
    assert(result.issues.some(issue => issue.code === "unsupported_script"));
    assert.equal(result.complete, false, "Unimported template logic must not be presented as fully supported");
  });
  report.status = report.cases.length > 0 && report.cases.every(item => item.status === "PASS") ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
    failures: report.cases.filter(item => item.status === "FAILED").map(item => ({ name: item.name, error: item.error })),
    output: out }, null, 2));
});
