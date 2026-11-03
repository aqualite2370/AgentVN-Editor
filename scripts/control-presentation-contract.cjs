"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { buildSync } = require("../editor/node_modules/esbuild");
const attempt = process.argv[2]; assert.match(attempt, /^(red|green)-\d{2}$/);
const out = `F:/AgentVN/QA/Renpy-Redesign-20261021-01/presentation-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "SHARED_BEHAVIOR_NOT_BROWSER_OR_INSTALLED", cases: [] };
try {
  const mod = { exports: {} };
  new Function("module", "exports", buildSync({ stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "ts",
    contents: `export * from "./shared/cartridge/controlPresentation";
      export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles";
      export {minimumRuntimeVersionForLayout} from "./shared/cartridge/runtimeCapabilities";
      export {validateUISkinLayout, migrateLegacyUISkinLayout} from "./shared/cartridge/uiSkin";` },
    bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(mod, mod.exports);
  const api = mod.exports;
  // Isolate the 0.24 code capability from the newer 0.25 Hide capability.
  const withoutHide = value => {
    const copy = structuredClone(value);
    for (const screen of copy.screens) screen.components = screen.components.filter(c => c.component_id !== "quick_hide_ui_button");
    return copy;
  };
  const source = { version: 1, html: '<span class="root"><span class="body"><slot name="content"></slot></span></span>',
    css: '.root { background-color: #26374a; border-radius: 6px; } .body { padding: 4px; }' };
  const parsed = api.compileControlPresentation(source);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.issues));
  assert.equal(parsed.definition.root.children[0].children[0].tag, "slot",
    "Native functional content must remain a single real slot");
  const layout = api.createRenpyUILayout();
  layout.advancedPresentationEnabled = true;
  const hero = layout.screens[0].components.find(c => c.component_type === "main_menu_hero");
  hero.presentation = source;
  const enabled = api.resolveLayoutPresentations(layout);
  assert.deepEqual(enabled.screens[0].components.find(c => c.component_id === hero.component_id).presentation, source);
  layout.advancedPresentationEnabled = false;
  const disabled = api.resolveLayoutPresentations(layout);
  assert.equal(disabled.screens[0].components.find(c => c.component_id === hero.component_id).presentation, undefined);
  assert.deepEqual(hero.presentation, source, "Disabling must keep authored code intact");
  report.cases.push({ name: "safe-content-slot-and-reversible-override-layer", status: "PASS" });
  layout.advancedPresentationEnabled = true;
  assert.equal(api.minimumRuntimeVersionForLayout("0.23.0", withoutHide(layout)), "0.24.0",
    "A Runtime without native presentation support must not silently ignore it");
  for (const [html, css] of [
    ['<span class="root">内容丢失</span>', ""],
    ['<span class="root"><slot name="content"></slot><slot name="content"></slot></span>', ""],
    ['<span class="root"><script>alert(1)</script><slot name="content"></slot></span>', ""],
    ['<span class="root" onclick="alert(1)"><slot name="content"></slot></span>', ""],
    [source.html, ".root { background-color: url(https://example.org/x); }"],
    [source.html, "body { color: white; }"],
    ['<span class="root"><button data-action="start_game">开始</button><slot name="content"></slot></span>', ""],
  ]) assert.equal(api.compileControlPresentation({ version: 1, html, css }).ok, false, "Unsafe or broken functional content must be rejected");
  assert.equal(api.validateUISkinLayout(layout).errors.length, 0);
  hero.presentation = { ...source, html: "<script>broken</script>" };
  assert(api.validateUISkinLayout(layout).errors.some(issue => issue.code === "ui_control_presentation"));
  report.cases.push({ name: "runtime-capability-and-invalid-source-rejection", status: "PASS" });
  assert.equal(api.compileControlPresentation({ ...source,
    css: ".root:hover { padding: 30px; }" }).ok, false,
    "State-only geometry must be rejected with an actionable issue instead of moving the hit target");
  assert.equal(api.compileControlPresentation({ ...source,
    css: ".root { padding: 30px; } .root:hover { color: #ffccaa; }" }).ok, true);
  report.cases.push({ name: "state-geometry-stable-and-safe-color-feedback", status: "PASS" });
  if (process.argv.includes("--coverage")) {
    const player = api.createRenpyUILayout().screens.find(screen => screen.screen_id === "player");
    for (const id of ["quick_rollback_button", "quick_history_button", "quick_skip_button", "quick_auto_button",
      "quick_save_load_button", "quick_save_button", "quick_load_button", "quick_settings_button", "quick_hide_ui_button"])
      assert(player.components.some(component => component.component_id === id),
        `Every visible native quick action must be selectable and editable: ${id}`);
    report.cases.push({ name: "all-native-quick-actions-are-authored-controls", status: "PASS" });
  }
  if (process.argv.includes("--regions")) {
    const regions = api.createRenpyUILayout();
    regions.advancedPresentationEnabled = true;
    regions.confirmationLayout = { panelPresentation: source, textPresentation: source };
    regions.dialogueLayouts = { nvl: { textPresentation: source }, bubble: { panelPresentation: source } };
    assert.deepEqual(api.validateUISkinLayout(regions).errors, [], "Mode and confirmation controls accept safe code");
    assert.equal(api.minimumRuntimeVersionForLayout("0.23.0", withoutHide(regions)), "0.24.0");
    const off = api.resolveLayoutPresentations({ ...regions, advancedPresentationEnabled: false });
    assert.equal(off.confirmationLayout.panelPresentation, undefined);
    assert.equal(off.dialogueLayouts.nvl.textPresentation, undefined);
    assert.equal(off.dialogueLayouts.bubble.panelPresentation, undefined);
    assert.deepEqual(regions.confirmationLayout.panelPresentation, source);
    regions.dialogueLayouts.nvl.textPresentation = { ...source, html: "<script>broken</script>" };
    assert(api.validateUISkinLayout(regions).errors.some(error => error.code === "ui_control_presentation"));
    report.cases.push({ name: "mode-and-confirmation-safe-reversible-code", status: "PASS" });
  }
  if (process.argv.includes("--legacy")) {
    const legacy = api.createRenpyUILayout();
    legacy.ui_layout_version = "1.2.0";
    const settings = legacy.screens.find(s => s.screen_id === "player").components
      .find(c => c.component_id === "quick_settings_button");
    settings.style = { backgroundColor: "#123456" };
    settings.presentation = source;
    const original = structuredClone(settings);
    const migrated = api.migrateLegacyUISkinLayout(legacy);
    assert.deepEqual(migrated.screens.find(s => s.screen_id === "player").components
      .find(c => c.component_id === "quick_settings_button"), original,
      "A Ren'Py quick settings control's explicit data must survive old-schema migration");
    report.cases.push({ name: "legacy-renpy-authored-settings-survive-migration", status: "PASS" });
  }
  if (process.argv.includes("--title-controls")) {
    const titleLayout = api.createRenpyUILayout();
    const title = titleLayout.screens.find(s => s.screen_id === "title");
    for (const id of ["title_help_button", "title_exit_button"]) {
      const control = title.components.find(c => c.component_id === id);
      assert(control, `Every visible Ren'Py title action must be editable: ${id}`);
      control.presentation = source;
    }
    const migrated = api.migrateLegacyUISkinLayout(titleLayout);
    assert.deepEqual(migrated.screens.find(s => s.screen_id === "title").components
      .find(c => c.component_id === "title_exit_button").presentation, source,
      "Ren'Py's supported exit action must keep its presentation during normalization");
    report.cases.push({ name: "renpy-title-native-help-exit-editability-and-source-preservation", status: "PASS" });
  }
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
}
