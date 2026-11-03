"use strict";
// Current installed all-page authoring plus the confirmation/NVL/bubble gaps.
// Preserve the historical page runner and extend it via checked, recorded edits.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const receipt = "F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json";
function isSpecial(entry) { return ["confirmation", "nvl", "bubble"].includes(entry[0]); }
function expectedPanelMaterial(style, id) {
  assert.match(style.backgroundColor, /^#[a-f\d]{6}$/i);
  const rgb = style.backgroundColor.slice(1).match(/../g).map(n => parseInt(n, 16));
  // Legacy material alpha and independent layer alpha have different renderers.
  // This is an independent test oracle; it does not call production styling code.
  const alpha = style.backgroundOpacity ?? style.opacity ?? .78;
  const separated = id === "confirmation"
    && (style.backgroundOpacity !== undefined || style.contentOpacity !== undefined);
  return { color: [...rgb, separated ? 1 : alpha], opacity: separated ? alpha : style.opacity ?? 1 };
}
function assertPanelMaterial(current, style, id) {
  const expected = expectedPanelMaterial(style, id);
  const values = current.renderedBackground.match(/^rgba?\(([^)]+)\)$/);
  assert(values, current.renderedBackground);
  const rgba = values[1].split(",").map(Number);
  if (rgba.length === 3) rgba.push(1);
  assert.deepEqual(rgba, expected.color);
  assert.equal(Number(current.opacity), expected.opacity);
}
async function ordinaryStable() {
  const confirmation = page.getByTestId("confirmation-layout-editor");
  if (await confirmation.count()) {
    await click(page.getByRole("button", { name: /^(返回)?页面导航$/, exact: true }));
    await confirmation.waitFor({ state: "hidden" });
  }
  const modeEditor = page.getByTestId("dialogue-mode-layout-editor");
  async function normalMode() {
    if (await modeEditor.count()) {
      await click(page.getByRole("combobox", { name: "对白布局模式", exact: true }));
      await click(page.getByRole("option", { name: "普通对白", exact: true }));
      await modeEditor.waitFor({ state: "hidden" });
    }
  }
  await normalMode();
  const structured = page.locator(".renpy-title-editor");
  if (await structured.count()) {
    await click(page.getByTestId("renpy-player-layout-entry"));
    await structured.waitFor({ state: "hidden" });
    // Entering player restores this layout's last dialogue editor mode.
    await normalMode();
  }
  await click(page.locator('[data-help-key="layout.screen"]:visible').getByText("播放页", { exact: true }));
  await page.getByRole("combobox", { name: "对白布局模式", exact: true }).waitFor();
  await normalMode();
  await page.locator('[data-help-key="layout.screen"]:visible').getByText("播放页", { exact: true }).waitFor();
  await settleEditor(page);
}
async function goSpecial(t, entry) {
  // Leave the previous special editor using its real page-navigation control.
  if (await page.getByTestId("confirmation-layout-editor").count()
    || await page.getByTestId("dialogue-mode-layout-editor").count()) {
    await click(page.getByRole("button", { name: /^(返回)?页面导航$/, exact: true }));
    await page.getByTestId("confirmation-layout-editor").waitFor({ state: "hidden" });
    await page.getByTestId("dialogue-mode-layout-editor").waitFor({ state: "hidden" });
    await settleEditor(page);
  }
  if (!isSpecial(entry)) return false;
  await ordinary();
  if (entry[0] === "confirmation") {
    await click(page.locator(".runtime-layout-sidebar").getByRole("button", { name: "确认提示", exact: true }));
    await page.getByTestId("confirmation-layout-editor").waitFor();
  } else {
    await click(page.getByRole("combobox", { name: "对白布局模式", exact: true }));
    await click(page.getByRole("option", { name: entry[0] === "nvl" ? "NVL 累积阅读" : "气泡对白", exact: true }));
    await page.locator(`[data-testid="dialogue-mode-layout-editor"][data-dialogue-mode="${entry[0]}"]`).waitFor();
  }
  await settleEditor(page); return true;
}
async function authorSpecial(t, entry, i) {
  const before = await projectSnapshot(host.current.ports[0]);
  const other = t === "agentvn" ? "renpy" : "agentvn";
  const isolated = structuredClone(before.settings.runtimeUILayoutProfiles.profiles[other]);
  const color = "#" + (0x274158 + i * 0x020103).toString(16);
  if (t === "renpy") await page.getByLabel("当前控件背景颜色", { exact: true }).fill(color);
  else await page.getByLabel(entry[0] === "confirmation" ? "确认背景色"
    : entry[0] === "nvl" ? "NVL背景色" : "气泡背景色", { exact: true }).fill(color);
  await saveLayout();
  const after = await projectSnapshot(host.current.ports[0]), profiles = after.settings.runtimeUILayoutProfiles;
  assert.deepEqual(profiles.profiles[other], isolated);
  const config = layout => entry[0] === "confirmation" ? layout.confirmationLayout : layout.dialogueLayouts?.[entry[0]];
  assert.equal(config(profiles.profiles[t]).panelStyle.backgroundColor, color);
  const unrelated = layout => {
    const clone = structuredClone(layout);
    if (entry[0] === "confirmation") delete clone.confirmationLayout;
    else {
      delete clone.dialogueLayouts?.[entry[0]];
      if (clone.dialogueLayouts && !Object.keys(clone.dialogueLayouts).length) delete clone.dialogueLayouts;
    }
    return clone;
  };
  assert.deepEqual(unrelated(profiles.profiles[t]), unrelated(before.settings.runtimeUILayoutProfiles.profiles[t]));
  const shared = profiles.profiles[t].screens.find(s => s.screen_id === "player")
    .components.find(c => c.component_type === "dialog_panel")?.style;
  const effectivePanelStyle = { ...(entry[0] === "confirmation" ? {} : shared),
    ...config(profiles.profiles[t]).panelStyle };
  return { color, region: entry[2], otherTypeUnchanged: true, unrelatedSettingsUnchanged: true,
    persisted: config(profiles.profiles[t]), effectivePanelStyle };
}
async function previewSpecial(t, entry) {
  const viewport = page.locator('.advanced-tab-content.is-active .renpy-editor-runtime-viewport[data-preview-phase="ready"]');
  await viewport.waitFor({ timeout: 45000 });
  const frame = await (await viewport.locator("iframe").elementHandle()).contentFrame();
  assert(frame); await settleRuntime(frame);
  const selector = entry[0] === "confirmation" ? ".modal-panel"
    : `.dialog-box[data-dialogue-layout-mode="${entry[0]}"]`;
  await frame.locator(selector).waitFor({ timeout: 25000 });
  const current = await frame.locator(selector).evaluate(element => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    const material = element.querySelector(':scope > [data-ui-opacity-layer="background"]');
    const background = getComputedStyle(material || element);
    return { rect: rect.toJSON(), renderedBackground: background.backgroundColor, opacity: background.opacity,
      content: element.textContent, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      overflow: document.documentElement.scrollWidth - innerWidth,
      layoutType: element.dataset.layoutType, mode: element.dataset.dialogueLayoutMode,
      visible: style.display !== "none" && style.visibility !== "hidden",
      focusUnavailable: Boolean(document.activeElement?.closest("[inert],[aria-hidden=true]")) };
  });
  const authored = report.pages.at(-1).author;
  report.pages.at(-1).previewProbe = current; save();
  assertPanelMaterial(current, authored.effectivePanelStyle, entry[0]);
  assert(current.visible && current.opacity > 0 && current.rect.width > 0 && current.rect.height > 0);
  assert(current.rect.left >= -1 && current.rect.top >= -1
    && current.rect.right <= current.viewport.width + 1 && current.rect.bottom <= current.viewport.height + 1);
  assert(current.overflow <= 1 && !current.focusUnavailable);
  if (entry[0] === "confirmation") {
    assert.equal(current.layoutType, t);
    const buttons = frame.locator(".modal-panel button");
    assert(await buttons.count() >= 2);
    for (const button of await buttons.all()) assert(await button.isEnabled());
  } else { assert.equal(current.mode, entry[0]); assert(current.content.trim().length > 0); }
  await host.shot(`${t}-${entry[0]}-${host.current.ports[1]}-${report.pages.length}`);
  return { kind: "ACTUAL_INSTALLED_RUNTIME_IFRAME", geometry: await geometry(), runtime: current,
    savedStyleConsumed: true };
}
function build(original) {
  let source = original; const adaptations = [];
  function one(before, after, reason) {
    assert.equal(source.split(before).length - 1, 1, reason);
    source = source.replace(before, () => after); adaptations.push({ before, after, reason });
  }
  one('let installationFile = "F:/AgentVN/QA/Editor-1.9.13-20261021-01/installation.json";',
    `let installationFile = ${JSON.stringify(receipt)};`, "Explicit current real NSIS receipt");
  one('scope: "INSTALLED_PAGE_SURVEY_AND_AUTHOR_NOT_STANDALONE_GAME_EXPORT_OR_NATIVE_FILE_PICKER",',
    'candidateVersion: "1.9.30", scope: "INSTALLED_1930_ALL_PAGE_AUTHOR_WITH_CONFIRMATION_NVL_BUBBLE_NOT_EXPORT_OR_ANDROID",',
    "Declare actual candidate and precise extended scope");
  one('async function go(t, entry) {', 'async function go(t, entry) {\n  if (await goSpecial(t, entry)) return;',
    "Use real ordinary/confirmation/mode navigation and leave previous special editor");
  one(`async function ordinary() {
  const nav = page.getByRole("button", { name: "页面导航", exact: true });
  if (await nav.isVisible()) await click(nav);
  const player = page.getByTestId("renpy-player-layout-entry");
  if (await player.isVisible()) await click(player);
  await click(page.locator('[data-help-key="layout.screen"]:visible').getByText("播放页", { exact: true }));
}`, ordinaryStable.toString().replace("ordinaryStable", "ordinary"),
  "Navigate real editor states and normalize the independently restored dialogue editor mode");
  one('async function preview(t, entry) {', 'async function preview(t, entry) {\n  if (isSpecial(entry)) return previewSpecial(t, entry);',
    "Special pages require ready actual Runtime, current saved style and complete geometry");
  one('async function author(t, entry, i) {', 'async function author(t, entry, i) {\n  if (isSpecial(entry)) return authorSpecial(t, entry, i);',
    "Author special styles using real UI, save and check unrelated fields");
  one('if (await override.isVisible()) await click(override);',
    'const overrideCount = await override.count();\n' +
    '    report.pages.at(-1).navigationBefore = { open: await navigation.getAttribute("open"),\n' +
    '      overrideCount, overrideVisible: await override.isVisible(), source: await page.getByTestId("renpy-font-source").innerText() }; save();\n' +
    '    const fontSource = report.pages.at(-1).navigationBefore.source.trim();\n' +
    '    assert(["继承", "覆盖"].includes(fontSource));\n' +
    '    if (fontSource === "继承") await click(override);',
    "Wait for the actual inheritance source and click its override instead of sampling transient mount/visibility");
  const definitions = [isSpecial, expectedPanelMaterial, assertPanelMaterial, goSpecial, authorSpecial, previewSpecial]
    .map(fn => fn.toString()).join("\n");
  one('function component(profiles, t, e) {', definitions + '\n' +
    'const specialPages = [["confirmation", "确认提示", "confirmation_panelStyle"],\n' +
    '  ["nvl", "NVL", "nvl_panelStyle"], ["bubble", "气泡", "bubble_panelStyle"]];\n' +
    'function component(profiles, t, e) {', "Extend existing author lifecycle without replacing its oracles");
  one('(t === "agentvn" ? standard : [...menus, standard[1], standard[2]]).entries()',
    '[...(t === "agentvn" ? standard : [...menus, standard[1], standard[2]]), ...specialPages].entries()',
    "Include all17 previous pages plus three additional pages per layout");
  one('(type === "agentvn" ? 8 : 9)', '(type === "agentvn" ? 11 : 12)',
    "Require23 pages per display; reject partial matrices");
  return { source, adaptations };
}
module.exports = { build, expectedPanelMaterial, assertPanelMaterial };
if (require.main === module) {
  require("./candidate-1930-exit.cjs").validateInstallation(receipt);
  assert.equal(process.argv[2], "author"); assert.match(process.argv[3] || "", /^\d{2}$/);
  assert(process.argv.includes("--matrix") && process.argv.includes("--codex-cache-view"));
  assert(!process.argv.some(a => a.startsWith("--audit=") || a.startsWith("--type=")));
  const file = path.join(__dirname, "installed-layout-pages-current.cjs"), result = build(fs.readFileSync(file, "utf8"));
  new vm.Script(Module.wrap(result.source));
  const prep = `F:/AgentVN/QA/Editor-1.9.30-20261026-01/layout-author-preparation-${process.argv[3]}`;
  fs.mkdirSync(prep, { recursive: false });
  const executed = path.join(prep, "executed-layout-pages.cjs");
  fs.writeFileSync(executed, result.source, { flag: "wx" });
  fs.writeFileSync(path.join(prep, "binding.json"), JSON.stringify({
    source: { path: file, sha256: sha(file) }, executed: { path: executed, sha256: sha(executed) },
    adapter: { path: __filename, sha256: sha(__filename) }, adaptations: result.adaptations,
    candidateVersion: "1.9.30", productChanges: 0, modelRequests: 0,
  }, null, 2), { flag: "wx" });
  const worker = new Module(file, module); worker.filename = file;
  worker.paths = Module._nodeModulePaths(path.dirname(file)); worker._compile(result.source, file);
}
