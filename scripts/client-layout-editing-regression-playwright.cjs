#!/usr/bin/env node
"use strict";

// Full editor, real top navigation, isolated backend; no internal tab events.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { saveProjectContainerSync } = require("./project-container.cjs");
const validationModule = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { contents: 'export { validateUISkinLayout } from "./shared/cartridge/uiSkin";',
    resolveDir: path.resolve(__dirname, ".."), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(validationModule, validationModule.exports);

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/playwright/client-layout-editing", runId);
const editorPort = 6881;
const backendPort = 8381;
const origin = `http://127.0.0.1:${editorPort}`;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const viewports = [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
  { width: 1440, height: 900 },
  { width: 757, height: 299 },
  { width: 390, height: 844 },
  { width: 2400, height: 1080 },
  { width: 1280, height: 800 },
  { width: 640, height: 360 },
  { width: 844, height: 390 },
];
fs.mkdirSync(output, { recursive: true });
const deviceScaleFactor = Number(process.env.LAYOUT_DPR || 1);
const report = { runId, deviceScaleFactor, ok: false, cases: [] };
const alignmentLabels = {
  left: "左对齐", centerX: "水平居中", right: "右对齐",
  top: "顶端对齐", centerY: "垂直居中", bottom: "底端对齐",
  sameWidth: "等宽", sameHeight: "等高",
  distributeX: "水平等距", distributeY: "垂直等距",
};
const snapLabels = {
  "layout.snapGrid": "吸附网格", "layout.snapEdges": "吸附边缘",
  "layout.snapCenter": "吸附中心线", "layout.snapSafe": "吸附安全区",
};
let baselineLayout;

async function ready(url) {
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server not ready: ${url}`);
}

function stop(child) {
  if (!child?.pid) return;
  spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
}

function fixture() {
  const now = new Date().toISOString();
  const common = {
    description: "", memoryMode: "hybrid",
    aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
    previewState: { currentCommandIndex: 0, isPlaying: false },
    editorMeta: { collapsedInspectorSections: [], source: "manual" },
  };
  return {
    schema_version: "1.0.0", project_id: `layout_editing_${runId}`,
    title: "Layout Editing Regression", author: "QA",
    created_at: now, updated_at: now, memory_mode: "hybrid",
    viewport: { x: 0, y: 0, zoom: 1 }, asset_manifest: [],
    nodes: [
      { id: "start", type: "startNode", position: { x: 40, y: 220 }, data: { ...common, nodeKind: "start", label: "入口" } },
      { id: "scene", type: "sceneNode", position: { x: 320, y: 180 }, data: {
        ...common, nodeKind: "scene", label: "布局测试",
        scene: { scene_id: "layout_scene", title: "布局测试", summary: "", chapter: 1, tags: [],
          commands: [{ type: "narration", text: "用于验证客户端布局编辑，不包含用户素材。" }] },
      } },
    ],
    edges: [{ id: "start_scene", source: "start", target: "scene", sourceHandle: "default" }],
    editor_settings: { defaultMemoryMode: "hybrid", characterDisplayNames: {}, characterDialogStyles: {} },
  };
}

async function settled(page) {
  await page.waitForFunction(() => document.querySelector(".advanced-tab-content.is-active[data-tab='layout']")
    && !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving")
    && !document.querySelector(".toolbar-popover.is-morphing"));
}

async function openLayout(page, input) {
  await page.goto(origin);
  const file = page.locator(".project-import-button input").first();
  await file.waitFor({ state: "attached" });
  await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some((n) => !n.disabled));
  await file.setInputFiles(input);
  // Import enters the project automatically. Do not click the home card
  // underneath its loading overlay (that would race the real entry flow).
  await page.locator(".editor-toolbar").waitFor({ timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await settled(page);
}

async function geometry(page) {
  return page.evaluate(() => {
    const selectors = [".toolbar-popover.advanced", ".runtime-layout-grid", ".runtime-layout-sidebar",
      ".runtime-layout-center", ".runtime-layout-inspector", ".runtime-layout-stage"];
    const nodes = Object.fromEntries(selectors.map((selector) => {
      const node = document.querySelector(selector);
      const rect = node.getBoundingClientRect();
      let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(parent).overflowX)) {
          const bounds = parent.getBoundingClientRect();
          left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
        }
      }
      return [selector, { rect: rect.toJSON(), clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth, visibleWidth: Math.max(0, right - left) }];
    }));
    return { nodes, pageOverflow: document.documentElement.scrollWidth - innerWidth };
  });
}

async function testGeometry(page, viewport) {
  if (viewport.width >= 1920) {
    await page.locator(".runtime-layout-designer").evaluate((node) => { node.scrollLeft = node.scrollWidth; });
  }
  const value = await geometry(page);
  report.cases.push({ case: "geometry", viewport, value });
  assert(value.pageOverflow <= 1, "page horizontal overflow");
  for (const [selector, data] of Object.entries(value.nodes)) {
    assert(data.rect.width > 0, `${selector} has no width`);
    assert(data.visibleWidth >= data.rect.width - 2, `${selector} clipped horizontally: ${JSON.stringify(data)}`);
    if (selector !== ".toolbar-popover.advanced")
      assert(data.scrollWidth <= data.clientWidth + 2, `${selector} internal horizontal overflow: ${JSON.stringify(data)}`);
  }
  const rects = [".runtime-layout-sidebar", ".runtime-layout-center", ".runtime-layout-inspector"]
    .map((selector) => value.nodes[selector].rect);
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
    const x = Math.min(rects[a].right, rects[b].right) - Math.max(rects[a].left, rects[b].left);
    const y = Math.min(rects[a].bottom, rects[b].bottom) - Math.max(rects[a].top, rects[b].top);
    assert(x <= 1 || y <= 1, "layout panes overlap");
  }
}

async function testActionLabels(page, viewport) {
  const alignment = page.locator(".runtime-layout-toolbar details").filter({ has: page.locator("summary", { hasText: "对齐" }) });
  await alignment.locator("summary").click();
  assert.match(await alignment.getByRole("note").innerText(), /等宽.*2.*等距.*3/,
    "a single selected component needs a visible explanation for disabled actions");
  for (const [action, label] of Object.entries(alignmentLabels)) {
    const button = alignment.getByRole("button", { name: label, exact: true });
    await button.scrollIntoViewIfNeeded();
    const rect = await button.boundingBox();
    assert(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width + 1
      && rect.y + rect.height <= viewport.height + 1, `alignment ${label} is clipped`);
    if (action.startsWith("same") || action.startsWith("distribute")) {
      assert(await button.isDisabled(), `${label} requires multiple selected components`);
      assert.match(await button.getAttribute("title") || "", /至少[两三]个可调整组件/);
    } else {
      assert(!await button.isDisabled(), `${label} should work with one selected component`);
      await button.click({ trial: true });
    }
  }
  await alignment.locator("summary").click();
  const snapping = page.locator(".runtime-layout-toolbar details").filter({ has: page.locator("summary", { hasText: "吸附" }) });
  await snapping.locator("summary").click();
  for (const [key, label] of Object.entries(snapLabels)) {
    const checkbox = snapping.getByRole("checkbox", { name: label, exact: true });
    assert.equal(await checkbox.getAttribute("data-help-key"), key);
    await checkbox.scrollIntoViewIfNeeded();
    const rect = await checkbox.boundingBox();
    assert(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width + 1
      && rect.y + rect.height <= viewport.height + 1, `snapping ${label} is clipped`);
    await checkbox.click({ trial: true });
  }
  await snapping.locator("summary").click();
  report.cases.push({ case: "action-labels", viewport, alignments: Object.values(alignmentLabels), snaps: Object.values(snapLabels) });
}

async function testPresetGeometry(page) {
  await page.locator(".runtime-layout-screen-list button").getByText("播放页", { exact: true }).click();
  await selectComponent(page, "dialog_panel");
  const before = await rectInputs(page);
  const appearance = page.locator(".runtime-layout-inspector details").filter({ has: page.locator("summary", { hasText: /^外观$/ }) });
  await appearance.locator("summary").click();
  const background = appearance.locator("label").filter({ hasText: /^backgroundColor/ }).locator('input:not([type="color"])');
  const originalBackground = await background.inputValue();
  await background.fill("#224466");
  const menu = page.locator(".runtime-layout-toolbar details").filter({ has: page.locator("summary", { hasText: "预设" }) });
  await menu.locator("summary").click();
  await page.getByRole("combobox", { name: "预设页面范围", exact: true }).click();
  await page.getByRole("option", { name: "当前页面", exact: true }).click();
  await page.getByRole("combobox", { name: "布局预设", exact: true }).click();
  await page.getByRole("option", { name: "Ren'Py（进阶）风格", exact: true }).click();
  await clickUnclippedButton(menu.locator('[data-help-key="layout.applyPreset"]'));
  const after = await rectInputs(page);
  assert.notDeepEqual(after, before, "Ren'Py preset must have real player geometry distinct from default");
  assert.equal(await background.inputValue(), "#224466", "preset overwrote authored dialogue color");
  await menu.locator("summary").click();
  await page.locator('[data-help-key="layout.undo"]').click();
  assert.deepEqual(await rectInputs(page), before, "preset application must undo in one step");
  await menu.locator("summary").click();
  await page.getByRole("combobox", { name: "布局预设", exact: true }).click();
  await page.getByRole("option", { name: "极简字幕", exact: true }).click();
  await clickUnclippedButton(menu.locator('[data-help-key="layout.applyPreset"]'));
  const subtitle = await rectInputs(page);
  assert.notDeepEqual(subtitle, before, "subtitle preset must have real player geometry distinct from default");
  assert.notDeepEqual(subtitle, after, "subtitle preset must differ from Ren'Py geometry");
  assert.equal(await background.inputValue(), "#224466", "subtitle preset overwrote authored dialogue color");
  await menu.locator("summary").click();
  await page.locator('[data-help-key="layout.undo"]').click();
  assert.deepEqual(await rectInputs(page), before, "subtitle application must undo in one step");
  await page.locator('[data-help-key="layout.undo"]').click();
  assert.equal(await background.inputValue(), originalBackground, "style regression left the baseline altered");
  await page.locator(".runtime-layout-screen-list button").getByText("标题主页", { exact: true }).click();
  await selectComponent(page, "title_start_button");
  await menu.locator("summary").click();
  await page.getByRole("combobox", { name: "布局预设", exact: true }).click();
  await page.getByRole("option", { name: "Ren'Py（进阶）风格", exact: true }).click();
  const apply = menu.locator('[data-help-key="layout.applyPreset"]');
  assert(await apply.isDisabled(), "player-only preset must not apply to an unsupported current title page");
  assert.match(await menu.getByRole("note").innerText(), /仅支持播放页/,
    "unsupported current page needs a visible scope explanation");
  const titleBefore = await rectInputs(page);
  const titleModified = titleBefore[0] + 3;
  await page.locator(".runtime-layout-inspector details").first().locator('input[type="number"]').first().fill(String(titleModified));
  await page.getByRole("combobox", { name: "预设页面范围", exact: true }).click();
  await page.getByRole("option", { name: "全部页面", exact: true }).click();
  assert(!await apply.isDisabled(), "all-pages scope must include the supported player page");
  await clickUnclippedButton(apply);
  assert.equal((await rectInputs(page))[0], titleModified, "all-pages preset erased authored title geometry");
  await menu.locator("summary").click();
  await page.locator(".runtime-layout-screen-list button").getByText("播放页", { exact: true }).click();
  await selectComponent(page, "dialog_panel");
  assert.deepEqual(await rectInputs(page), after, "all-pages preset did not apply to the supported player page");
  await page.locator('[data-help-key="layout.undo"]').click();
  assert.deepEqual(await rectInputs(page), before, "all-pages preset must undo as one geometry operation");
  await page.locator(".runtime-layout-screen-list button").getByText("标题主页", { exact: true }).click();
  await selectComponent(page, "title_start_button");
  assert.equal((await rectInputs(page))[0], titleModified, "undoing preset also undid unrelated title editing");
  await page.locator('[data-help-key="layout.undo"]').click();
  assert.deepEqual(await rectInputs(page), titleBefore, "preset scope regression left the title changed");
  report.cases.push({ case: "preset-player-geometry-and-scope", before, renpy: after, subtitle });
}

async function testProtectedPreset(browser) {
  const project = fixture();
  project.project_id += "_protected";
  project.title = "Locked Layout Preset Regression";
  const authored = structuredClone(baselineLayout);
  const player = authored.screens.find((screen) => screen.screen_id === "player");
  const dialog = player.components.find((component) => component.component_id === "dialog_panel");
  dialog.rect = { x: 11, y: 65, width: 82, height: 29 };
  dialog.locked = true;
  dialog.style.backgroundColor = "#224466";
  project.editor_settings.runtimeUILayout = authored;
  const input = path.join(output, "locked-preset.vnproj");
  saveProjectContainerSync(input, project, { silent: true });
  const page = await browser.newPage({ viewport: viewports[0] });
  try {
    await openLayout(page, input);
    await page.locator(".runtime-layout-screen-list button").getByText("播放页", { exact: true }).click();
    await selectComponent(page, "dialog_panel");
    const before = await rectInputs(page);
    assert.deepEqual(before, [11, 65, 82, 29], "locked fixture did not reach the real inspector");
    assert(await page.locator(".runtime-layout-inspector details").first().locator('input[type="number"]').first().isDisabled(),
      "locked component was editable before applying a preset");
    const lockedInputValues = await page.locator(".runtime-layout-inspector input").evaluateAll((nodes) =>
      nodes.filter((node) => node.matches("input, select, textarea")).map((node) => ({
        disabled: node.disabled,
        value: node.value,
      })),
    );
    assert(lockedInputValues.length > 0 && lockedInputValues.every((field) => field.disabled),
      "every locked inspector control must be disabled");
    await dragBlock(page, "dialog_panel", 20, 8);
    assert.deepEqual(await rectInputs(page), before, "pointer drag moved a locked component");
    await page.locator('.runtime-layout-component-list input[data-component-id="dialog_text"]').check();
    const alignment = page.locator(".runtime-layout-toolbar details")
      .filter({ has: page.locator("summary", { hasText: "对齐" }) });
    await alignment.locator("summary").click();
    assert(await alignment.getByRole("button", { name: alignmentLabels.sameWidth, exact: true }).isDisabled(),
      "alignment must exclude a locked component from its editable targets");
    await alignment.locator("summary").click();
    await selectComponent(page, "dialog_panel");
    const menu = page.locator(".runtime-layout-toolbar details").filter({ has: page.locator("summary", { hasText: "预设" }) });
    await menu.locator("summary").click();
    await page.getByRole("combobox", { name: "布局预设", exact: true }).click();
    await page.getByRole("option", { name: "Ren'Py（进阶）风格", exact: true }).click();
    await clickUnclippedButton(menu.locator('[data-help-key="layout.applyPreset"]'));
    assert.deepEqual(await rectInputs(page), before, "preset moved an authored locked component");
    report.cases.push({ case: "locked-component-boundary", before, lockedInputValues, ok: true });
  } finally {
    await page.close();
  }
}

async function testGroupLocks(browser) {
  for (const lockedMember of ["group", "child"]) {
    const project = fixture();
    project.project_id += `_locked_${lockedMember}`;
    project.title = `Group lock ${lockedMember}`;
    const authored = structuredClone(baselineLayout);
    const title = authored.screens.find((screen) => screen.screen_id === "title");
    title.components = title.components.filter((item) =>
      !["main_menu_custom_button_container", "main_menu_custom_button"].includes(item.component_type));
    const groupId = "title_custom_button_container";
    title.components.push(
      { component_id: groupId, component_type: "main_menu_custom_button_container",
        rect: { x: 9, y: 19, width: 32, height: 10 }, locked: lockedMember === "group", zIndex: 40 },
      ...["locked_child_a", "locked_child_b"].map((id, index) => ({
        component_id: id, component_type: "main_menu_custom_button", label: `自定义 ${index}`,
        rect: { x: 10 + index * 20, y: 20, width: 10, height: 8 },
        locked: lockedMember === "child" && index === 0, zIndex: 41 + index,
        style: { backgroundColor: "#224466", color: "#ffffff" }, action: { kind: "none" },
      })),
    );
    project.editor_settings.runtimeUILayout = authored;
    const input = path.join(output, `locked-group-${lockedMember}.vnproj`);
    saveProjectContainerSync(input, project, { silent: true });
    const page = await browser.newPage({ viewport: viewports[0] });
    try {
      await openLayout(page, input);
      await page.locator(".runtime-layout-screen-list button").getByText("标题主页", { exact: true }).click();
      for (const viewport of [viewports[0], viewports[2], viewports[3]]) {
        await page.setViewportSize(viewport);
        const id = lockedMember === "group" ? "locked_child_b" : groupId;
        await selectComponent(page, id);
        const before = await rectInputs(page);
        const fields = page.locator(".runtime-layout-inspector details").first().locator('input[type="number"]');
        assert(await fields.nth(0).isDisabled() && await fields.nth(1).isDisabled(),
          `${lockedMember}: group lock must protect numerical movement`);
        const block = page.locator(`.runtime-layout-block[data-component-id="${id}"]`);
        assert.equal(await block.locator(".runtime-layout-resize-handle").count(), 0,
          `${lockedMember}: locked geometry must not offer a resize handle`);
        await dragBlock(page, id, 12, 5);
        assert.deepEqual(await rectInputs(page), before, `${lockedMember}: group geometry changed by drag`);
        const alignment = page.locator(".runtime-layout-toolbar details")
          .filter({ has: page.locator("summary", { hasText: "对齐" }) });
        await alignment.locator("summary").click();
        assert(await alignment.getByRole("button", { name: "水平居中", exact: true }).isDisabled(),
          `${lockedMember}: alignment must not bypass group lock`);
        await alignment.locator("summary").click();
        report.cases.push({ case: "group-lock-geometry", lockedMember, viewport, before });
      }
    } finally {
      await page.close();
    }
  }
}

async function testPresetVisualGeometry(page, viewport) {
  await page.locator(".runtime-layout-screen-list button").getByText("播放页", { exact: true }).click();
  await selectComponent(page, "dialog_panel");
  const original = await rectInputs(page);
  const menu = page.locator(".runtime-layout-toolbar details").filter({ has: page.locator("summary", { hasText: "预设" }) });
  for (const name of ["Ren'Py（进阶）风格", "极简字幕"]) {
    await menu.locator("summary").click();
    await page.getByRole("combobox", { name: "布局预设", exact: true }).click();
    await page.getByRole("option", { name, exact: true }).click();
    await clickUnclippedButton(menu.locator('[data-help-key="layout.applyPreset"]'));
    const geometry = await page.evaluate(() => {
      const frame = document.querySelector(".runtime-layout-stage");
      const ids = ["dialog_panel", "speaker_label", "dialog_text", "continue_indicator", "choice_list"];
      const rects = Object.fromEntries(ids.map((id) => {
        const node = document.querySelector(`.runtime-layout-expected-preview [data-preview-component-id="${id}"]`);
        return [id, node?.getBoundingClientRect().toJSON()];
      }));
      return { frame: frame.getBoundingClientRect().toJSON(), rects,
        overflow: frame.scrollWidth - frame.clientWidth };
    });
    for (const [id, rect] of Object.entries(geometry.rects)) {
      assert(rect && rect.width > 0 && rect.height > 0, `${name}/${id}: no visible preview geometry`);
      assert(rect.left >= geometry.frame.left - 2 && rect.right <= geometry.frame.right + 2
        && rect.top >= geometry.frame.top - 2 && rect.bottom <= geometry.frame.bottom + 2,
      `${name}/${id}: outside game frame at ${viewport.width}x${viewport.height}`);
    }
    const choice = geometry.rects.choice_list, panel = geometry.rects.dialog_panel;
    assert(choice.bottom <= panel.top + 1 || choice.top >= panel.bottom - 1,
      `${name}: choices cover dialogue at ${viewport.width}x${viewport.height}`);
    assert(geometry.overflow <= 2, `${name}: horizontal frame overflow`);
    report.cases.push({ case: "preset-preview-geometry", viewport, name, geometry });
    await menu.locator("summary").click();
    await page.locator('[data-help-key="layout.undo"]').click();
    assert.deepEqual(await rectInputs(page), original, `${name}: undo changed prior player geometry`);
  }
}

async function selectComponent(page, id) {
  await page.locator(`.runtime-layout-component-list button[data-component-id="${id}"]`).click();
}

async function rectInputs(page) {
  return page.locator(".runtime-layout-inspector details").first().locator('input[type="number"]').evaluateAll(
    (inputs) => inputs.map((input) => Number(input.value)),
  );
}

async function clickUnclippedButton(button) {
  await button.scrollIntoViewIfNeeded();
  const geometry = await button.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (["hidden", "clip", "auto", "scroll"].includes(style.overflowX)) {
        left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
      }
      if (["hidden", "clip", "auto", "scroll"].includes(style.overflowY)) {
        top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
      }
    }
    return { label: node.textContent, rect: rect.toJSON(), left, top, right, bottom };
  });
  assert(geometry.rect.left >= geometry.left - 2 && geometry.rect.right <= geometry.right + 2
    && geometry.rect.top >= geometry.top - 2 && geometry.rect.bottom <= geometry.bottom + 2,
  `layout action is clipped: ${JSON.stringify(geometry)}`);
  await button.click();
  return geometry;
}

async function dragBlock(page, id, dx, dy, whileDragging) {
  await page.mouse.move(0, 0);
  await page.locator(".hover-help-card").waitFor({ state: "hidden", timeout: 3000 });
  const block = page.locator(`.runtime-layout-block[data-component-id="${id}"]`);
  await block.scrollIntoViewIfNeeded();
  const hit = await block.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const positions = [[0.5, 0.5], [0.2, 0.5], [0.8, 0.5], [0.5, 0.25], [0.5, 0.75],
      [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]];
    const blockedBy = [];
    for (const [x, y] of positions) {
      const point = { x: rect.left + rect.width * x, y: rect.top + rect.height * y };
      const target = document.elementFromPoint(point.x, point.y);
      if (node === target || node.contains(target)) return { ok: true, point };
      blockedBy.push({ x, y, id: target?.closest(".runtime-layout-block")?.getAttribute("data-component-id"),
        className: target?.closest(".hover-help-card, .runtime-layout-block")?.className });
    }
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { ok: false, rect: rect.toJSON(), blockedBy, target: target?.outerHTML.slice(0, 300) };
  });
  assert(hit.ok, `component ${id} cannot receive a real pointer: ${JSON.stringify(hit)}`);
  const point = hit.point;
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 8 });
  if (whileDragging) await whileDragging();
  await page.mouse.up();
}

async function setSnapModes(page, enabled = []) {
  const menu = page.locator(".runtime-layout-toolbar details").filter({ has: page.locator("summary", { hasText: "吸附" }) });
  await menu.locator("summary").click();
  for (const key of ["layout.snapGrid", "layout.snapEdges", "layout.snapCenter", "layout.snapSafe"]) {
    const checkbox = menu.locator(`input[data-help-key="${key}"]`);
    if (enabled.includes(key)) await checkbox.check();
    else await checkbox.uncheck();
  }
  await menu.locator("summary").click();
}

async function testPlayerDrag(page, viewport) {
  await page.locator('.runtime-layout-screen-list button').getByText("播放页", { exact: true }).click();
  // Isolate the geometry/undo contract from snapping; the separate
  // testSnapping exercises real gestures with toggles enabled.
  await setSnapModes(page);
  await selectComponent(page, "speaker_label");
  const before = await rectInputs(page);
  await dragBlock(page, "speaker_label", 18, -8);
  const after = await rectInputs(page);
  assert(after[0] > before[0] + 0.1, `speaker drag did not update authored x: ${before} -> ${after}`);
  assert(await page.locator('[data-help-key="layout.undo"]').isEnabled(), "drag is absent from layout undo/save session");
  await page.locator('[data-help-key="layout.undo"]').click();
  assert.deepEqual(await rectInputs(page), before, "one undo must undo the entire drag");
  await page.locator('[data-help-key="layout.redo"]').click();
  assert.deepEqual(await rectInputs(page), after, "redo must restore the entire drag");
  const handle = page.locator('.runtime-layout-block[data-component-id="speaker_label"] .runtime-layout-resize-handle');
  await handle.scrollIntoViewIfNeeded();
  const bounds = await handle.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 12, bounds.y + bounds.height / 2 + 4, { steps: 6 });
  await page.mouse.up();
  const resized = await rectInputs(page);
  assert(resized[2] > after[2], `real resize must change authored width: ${after} -> ${resized}; viewport=${JSON.stringify(viewport)}`);
  await page.locator('[data-help-key="layout.undo"]').click();
  assert.deepEqual(await rectInputs(page), after, "one undo must undo the entire resize");
  await page.locator('[data-help-key="layout.redo"]').click();
  await page.locator('[data-help-key="layout.save"]').click();
  await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
  assert.deepEqual(await rectInputs(page), resized, "saving must not discard dragged/resized geometry");
  await page.locator('[data-help-key="layout.undo"]').click();
  assert.deepEqual(await rectInputs(page), after, "successful save must preserve the undo history");
  await page.locator('[data-help-key="layout.redo"]').click();
  assert.deepEqual(await rectInputs(page), resized, "redo must remain available after a successful save");
  report.cases.push({ case: "player-drag-resize", viewport, before, after, resized });
}

async function testSaveFailureRetry(page, viewport) {
  await page.locator(".runtime-layout-screen-list button").getByText("播放页", { exact: true }).click();
  await selectComponent(page, "speaker_label");
  const before = await rectInputs(page);
  const target = before[0] + 1.5;
  await page.locator(".runtime-layout-inspector details").first().locator('input[type="number"]').nth(0).fill(String(target));
  assert.equal((await rectInputs(page))[0], target, "retry fixture edit did not reach the layout draft");
  await page.locator('[data-help-key="layout.save"].is-primary').waitFor();

  let failed = false;
  const seenRequests = [];
  const routeHandler = async (route) => {
    seenRequests.push({ url: route.request().url(), method: route.request().method() });
    if (route.request().method() === "POST") {
      let payload;
      try { payload = route.request().postDataJSON(); } catch {}
      if (payload?.project_metadata?.settings?.runtimeUILayout) {
        failed = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, data: null, error: { message: "intentional layout save failure" } }),
        });
        return;
      }
    }
    await route.continue();
  };
  await page.route("**/api/project/state", routeHandler);
  try {
    await page.locator('[data-help-key="layout.save"]').click();
    await page.locator(".runtime-layout-save-feedback.is-error").waitFor({ timeout: 30000 }).catch((error) => {
      report.saveFailureRetryRequests = seenRequests;
      throw error;
    });
    assert.equal(failed, true, "failure fixture did not intercept the layout save");
    assert.equal(await page.locator('[data-help-key="layout.save"]').textContent().then((text) => text.includes("重试保存")), true,
      "failed save did not expose retry action");
    assert.equal((await rectInputs(page))[0], target, "failed save changed the in-memory draft");
  } finally {
    await page.unroute("**/api/project/state", routeHandler);
  }

  await page.locator('[data-help-key="layout.save"]').click();
  await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
  assert.deepEqual(await rectInputs(page), [target, before[1], before[2], before[3]],
    "retry save changed the authored geometry");
  await page.locator('[data-help-key="layout.undo"]').click();
  assert.deepEqual(await rectInputs(page), before, "undo history was lost across failed save and retry");
  await page.locator('[data-help-key="layout.redo"]').click();
  assert.equal((await rectInputs(page))[0], target, "redo did not restore the retried save edit");
  report.cases.push({ case: "save-failure-retry", viewport, before, target });
}

async function testSnapping(page, viewport) {
  await page.locator(".runtime-layout-screen-list button").getByText("播放页", { exact: true }).click();
  await page.getByRole("button", { name: "添加遮罩", exact: true }).click();
  const id = await page.locator(".runtime-layout-component-list label.is-active").getAttribute("data-component-id");
  const fields = page.locator(".runtime-layout-inspector details").first().locator('input[type="number"]');
  for (const [index, value] of [29.2, 11.3, 8, 8].entries()) await fields.nth(index).fill(String(value));
  await setSnapModes(page);
  const stage = await page.locator(".runtime-layout-stage").boundingBox();
  const delta = stage.width * 0.004;
  await dragBlock(page, id, delta, 0);
  const withoutSnap = await rectInputs(page);
  assert(withoutSnap[0] > 29.35 && withoutSnap[0] < 29.85, `disabled snap moved to a grid: ${withoutSnap}`);
  assert.equal(await page.locator(".runtime-layout-snap-guide").count(), 0, "disabled snap left a reference line");
  await page.locator('[data-help-key="layout.undo"]').click();
  assert.equal((await rectInputs(page))[0], 29.2, "undo after free drag failed");

  await setSnapModes(page, ["layout.snapGrid"]);
  const gridPseudo = await page.locator(".runtime-layout-stage").evaluate((node) => {
    const grid = getComputedStyle(node, "::after");
    return { display: grid.display, backgroundSize: grid.backgroundSize };
  });
  assert.equal(gridPseudo.backgroundSize, "5% 5%, 5% 5%", "visible grid step differs from snap math");
  assert.notEqual(gridPseudo.display, "none", "grid must render on authored game frame");
  // Snapping has a CSS-pixel threshold, not a percentage threshold.
  // Keep the pointer just inside it even when the canvas is 4K-wide.
  const snapInset = Math.min(4, stage.width * 0.001);
  await dragBlock(page, id, stage.width * 0.008 - snapInset, 0, async () => {
    const guide = page.locator('.runtime-layout-snap-guide[data-snap-guide-axis="x"][data-snap-guide-kind="grid"]');
    await guide.waitFor();
    assert.equal(await guide.evaluate((node) => getComputedStyle(node).pointerEvents), "none",
      "snap guide must never intercept the drag");
    const line = await guide.boundingBox();
    const frame = await page.locator(".runtime-layout-stage").boundingBox();
    assert(line.x >= frame.x && line.x <= frame.x + frame.width, "grid guide left the game frame");
  });
  const withSnap = await rectInputs(page);
  assert.equal(withSnap[0], 30, `grid toggle did not snap real pointer drag: ${withSnap}`);
  assert.equal(await page.locator(".runtime-layout-snap-guide").count(), 0, "snap guide survived pointer release");
  await page.locator('[data-help-key="layout.undo"]').click();
  assert.equal((await rectInputs(page))[0], 29.2, "snapped gesture must undo in one step");
  const resizeHandle = page.locator(`.runtime-layout-block[data-component-id="${id}"] .runtime-layout-resize-handle`);
  await resizeHandle.scrollIntoViewIfNeeded();
  const handleBounds = await resizeHandle.boundingBox();
  const frameBounds = await page.locator(".runtime-layout-stage").boundingBox();
  const handlePoint = { x: handleBounds.x + handleBounds.width / 2, y: handleBounds.y + handleBounds.height / 2 };
  await page.mouse.move(handlePoint.x, handlePoint.y);
  await page.mouse.down();
  await page.mouse.move(frameBounds.x + frameBounds.width * 0.4 - Math.min(3, frameBounds.width * 0.003), handlePoint.y, { steps: 8 });
  const resizeGuide = page.locator('.runtime-layout-snap-guide[data-snap-guide-axis="x"][data-snap-guide-kind="grid"]');
  await resizeGuide.waitFor();
  await page.mouse.up();
  const resizedWithSnap = await rectInputs(page);
  assert.equal(resizedWithSnap[0], 29.2, "resize snapping moved the left edge instead of the right edge");
  assert(Math.abs(resizedWithSnap[0] + resizedWithSnap[2] - 40) < 0.02,
    `resize did not snap right edge to 40% frame line: ${resizedWithSnap}`);
  assert.equal(await page.locator(".runtime-layout-snap-guide").count(), 0, "resize guide survived pointer release");
  await page.locator('[data-help-key="layout.undo"]').click();
  assert.equal((await rectInputs(page))[2], 8, "snapped resize must undo as one gesture");
  report.cases.push({ case: "snapping-resize", viewport, resizedWithSnap });
  for (const [key, start, expected] of [
    ["layout.snapEdges", 0.2, 0],
    ["layout.snapCenter", 45.5, 46],
    ["layout.snapSafe", 4.5, 5],
  ]) {
    await fields.nth(0).fill(String(start));
    assert.equal((await rectInputs(page))[0], start, "numeric field must preserve exact input despite snap mode");
    await setSnapModes(page, [key]);
    let edgeGuide;
    const snapDelta = stage.width * (expected - start) / 100 + (expected === 0 ? snapInset : -snapInset);
    await dragBlock(page, id, snapDelta, 0, key === "layout.snapEdges" ? async () => {
      const guide = page.locator('.runtime-layout-snap-guide[data-snap-guide-axis="x"][data-snap-guide-kind="edge"]');
      await guide.waitFor();
      edgeGuide = { source: await guide.getAttribute("data-snap-guide-source") };
    } : undefined);
    const result = await rectInputs(page);
    if (key === "layout.snapEdges") {
      const peerEdges = await page.locator(".runtime-layout-block").evaluateAll((nodes, sourceId) => {
        const stage = document.querySelector(".runtime-layout-stage").getBoundingClientRect();
        return nodes.filter((node) => node.dataset.componentId === sourceId && !node.classList.contains("is-hidden"))
          .flatMap((node) => {
            const rect = node.getBoundingClientRect();
            return [(rect.left - stage.left) / stage.width * 100, (rect.right - stage.left) / stage.width * 100];
          });
      }, edgeGuide?.source);
      assert(edgeGuide?.source, "edge snapping did not show a reference line during real pointer drag");
      const expectedEdges = edgeGuide.source === "frame-left" ? [0]
        : edgeGuide.source === "frame-right" ? [100] : peerEdges;
      assert(expectedEdges.some((edge) =>
        Math.abs(result[0] - edge) <= 0.2 || Math.abs(result[0] + result[2] - edge) <= 0.2),
      `drag did not align to its indicated edge: ${result}, guide=${JSON.stringify(edgeGuide)}, edges=${peerEdges}`);
    } else {
      assert.equal(result[0], expected, `${key} did not affect real pointer drag: ${result}`);
    }
    assert.equal(await page.locator(".runtime-layout-snap-guide").count(), 0, `${key} left a guide after release`);
    report.cases.push({ case: "snapping-mode", viewport, key, start, result, edgeGuide });
  }
  report.cases.push({ case: "snapping-grid-toggle", viewport, withoutSnap, withSnap, gridPseudo });
}

async function testModifierSelection(page, viewport) {
  await page.locator(".runtime-layout-screen-list button").getByText("标题主页", { exact: true }).click();
  const first = "title_start_button", second = "title_settings_button";
  const selectedIds = () => page.locator(".runtime-layout-component-list input:checked")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.componentId).sort());
  for (const modifier of ["Control", "Meta"]) {
    await selectComponent(page, first);
    await page.locator(`.runtime-layout-component-list button[data-component-id="${second}"]`)
      .click({ modifiers: [modifier] });
    assert.deepEqual(await selectedIds(), [first, second].sort(),
      `${modifier}+list click must keep the first component selected`);
    await page.locator(`.runtime-layout-component-list button[data-component-id="${second}"]`)
      .click({ modifiers: [modifier] });
    assert.deepEqual(await selectedIds(), [first], `${modifier}+click must toggle selection exactly once`);
  }
  report.cases.push({ case: "modifier-list-selection", viewport });
  for (const modifier of ["Control", "Meta"]) {
    await selectComponent(page, first);
    const button = page.locator(`.runtime-layout-block[data-component-id="${second}"]`);
    await button.click({ modifiers: [modifier] });
    assert.deepEqual(await selectedIds(), [first, second].sort(),
      `${modifier}+canvas click must not be reset by the subsequent click event`);
    await button.click({ modifiers: [modifier] });
    assert.deepEqual(await selectedIds(), [first], `${modifier}+canvas click must toggle exactly once`);
  }
  report.cases.push({ case: "modifier-canvas-selection", viewport });
}

async function testZoomCoordinateMapping(page, viewport) {
  await page.locator(".runtime-layout-screen-list button").getByText("播放页", { exact: true }).click();
  await page.getByRole("button", { name: "添加遮罩", exact: true }).click();
  const id = await page.locator(".runtime-layout-component-list label.is-active").getAttribute("data-component-id");
  const fields = page.locator(".runtime-layout-inspector details").first().locator('input[type="number"]');
  await setSnapModes(page, ["layout.snapGrid"]);
  try {
    for (const label of ["适应", "50%", "75%", "100%"]) {
      const zoom = page.locator(".runtime-layout-zoom-switch").getByRole("button", { name: label, exact: true });
      await zoom.click();
      await fields.nth(0).fill("29.2");
      await fields.nth(1).fill("10");
      await fields.nth(2).fill("8");
      await fields.nth(3).fill("8");
      const before = await rectInputs(page);
      const frame = await page.locator(".runtime-layout-stage").boundingBox();
      await dragBlock(page, id, frame.width * 0.008 - Math.min(4, frame.width * 0.001), 0);
      const after = await rectInputs(page);
      assert.equal(after[0], 30, `${label} zoom changed snap coordinates: ${before} -> ${after}`);
      assert.equal(after[1], before[1], `${label} zoom unexpectedly moved the vertical authored coordinate`);
      assert.equal(await page.locator(".runtime-layout-snap-guide").count(), 0,
        `${label} zoom left a guide after pointer release`);
      await page.locator('[data-help-key="layout.undo"]').click();
      assert.deepEqual(await rectInputs(page), before, `${label} zoom drag did not undo as one gesture`);
      report.cases.push({ case: "zoom-snap-coordinate-mapping", viewport, zoom: label, before, after });
    }
  } finally {
    await page.locator(".runtime-layout-zoom-switch").getByRole("button", { name: "适应", exact: true }).click();
  }
}

async function testCustomContainer(page, viewport) {
  await page.locator(".runtime-layout-screen-list button").getByText("标题主页", { exact: true }).click();
  await page.getByRole("button", { name: "添加自定义标题按钮", exact: true }).click();
  const customId = await page.locator('.runtime-layout-component-list label.is-active').getAttribute("data-component-id");
  const buttonBefore = await rectInputs(page);
  const groupId = "title_custom_button_container";
  assert.equal(await page.locator(`.runtime-layout-component-list button[data-component-id="${groupId}"]`).count(), 1,
    "custom button group must remain editable");
  await selectComponent(page, groupId);
  const groupBefore = await rectInputs(page);
  const inputs = page.locator(".runtime-layout-inspector details").first().locator('input[type="number"]');
  assert(await inputs.nth(2).isDisabled() && await inputs.nth(3).isDisabled(), "group dimensions must be automatic");
  // Viewports share the authored fixture. Do not ask the tenth move to
  // exceed the game frame and mistake intentional clamping for lost linkage.
  const moveDelta = groupBefore[0] + groupBefore[2] + 3 <= 100 ? 3 : -3;
  await inputs.nth(0).fill(String(groupBefore[0] + moveDelta));
  const groupAfter = await rectInputs(page);
  assert(Math.abs(groupAfter[0] - groupBefore[0] - moveDelta) < 0.02, "group did not move by the requested in-bounds distance");
  await selectComponent(page, customId);
  const buttonAfter = await rectInputs(page);
  assert(Math.abs(buttonAfter[0] - buttonBefore[0] - moveDelta) < 0.02, "moving group must move its child");
  assert.equal(await page.locator(".runtime-layout-expected-preview .part-main_menu_custom_button_container").count(), 0,
    "editor-only group must not paint a phantom runtime rectangle");
  const saved = page.waitForResponse((response) => {
    if (!response.url().endsWith("/api/project/state") || response.request().method() !== "POST") return false;
    // The editor autosave shares this endpoint. Match this actual layout
    // submission, not an earlier in-flight graph autosave response.
    const submitted = response.request().postDataJSON()?.project_metadata?.settings?.runtimeUILayout;
    return submitted?.screens.find((screen) => screen.screen_id === "title")
      ?.components.find((component) => component.component_id === groupId)?.rect.x === groupAfter[0];
  });
  await page.locator('[data-help-key="layout.save"]').click();
  const body = await (await saved).json();
  assert(body.ok, "layout save failed");
  const layout = body.data.project_metadata.settings.runtimeUILayout;
  const validation = validationModule.exports.validateUISkinLayout(layout);
  assert.equal(validation.ok, true, `New custom button saved invalid layout: ${JSON.stringify(validation.errors)}`);
  const persisted = layout.screens.find((screen) => screen.screen_id === "title").components;
  assert.equal(persisted.find((component) => component.component_id === groupId)?.rect.x, groupAfter[0],
    "backend round trip stripped the authored button group");
  assert.equal(persisted.find((component) => component.component_id === customId)?.rect.x, buttonAfter[0]);
  await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
  await selectComponent(page, groupId);
  assert.deepEqual(await rectInputs(page), groupAfter, "canonical saved layout changed the group");
  report.cases.push({ case: "custom-container", viewport, groupBefore, groupAfter, buttonBefore, buttonAfter });
}

async function testFixedQuickMenu(page, viewport) {
  await page.locator(".runtime-layout-screen-list button").getByText("播放页", { exact: true }).click();
  await selectComponent(page, "quick_menu");
  const before = await rectInputs(page);
  const inputs = page.locator(".runtime-layout-inspector details").first().locator('input[type="number"]');
  assert.equal(await inputs.evaluateAll((nodes) => nodes.filter((node) => node.disabled).length), 4);
  const toggle = page.getByTestId("preview-quick-menu-toggle");
  await toggle.scrollIntoViewIfNeeded();
  const box = await toggle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 25, box.y + box.height / 2 + 8, { steps: 8 });
  await page.mouse.up();
  assert.deepEqual(await rectInputs(page), before, "fixed quick-menu geometry must not change by dragging its preview");
  await toggle.click();
  await toggle.click();
  assert.deepEqual(await rectInputs(page), before, "quick-menu toggle must not change authored geometry");
  if (viewport.width === 1920) {
    const menu = page.locator(".runtime-layout-toolbar details").filter({ has: page.locator("summary", { hasText: "对齐" }) });
    await menu.locator("summary").click();
    const align = menu.getByRole("button", { name: alignmentLabels.centerX, exact: true });
    assert(await align.isDisabled(), "fixed quick menu must not offer alignment with no editable target");
    assert.match(await align.getAttribute("title") || "", /可调整|选中/, "disabled alignment needs an explanation");
    assert.match(await menu.getByRole("note").innerText(), /选中可调整组件/,
      "fixed quick menu needs a visible explanation for disabled actions");
    await menu.locator("summary").click();
    assert.deepEqual(await rectInputs(page), before, "alignment must not bypass fixed quick-menu geometry");
  }
  report.cases.push({ case: "fixed-quick-menu", viewport, before });
}

async function testMask(page) {
  await page.getByRole("button", { name: "添加遮罩", exact: true }).click();
  const id = await page.locator(".runtime-layout-component-list label.is-active").getAttribute("data-component-id");
  const before = await rectInputs(page);
  await dragBlock(page, id, 15, 4);
  const after = await rectInputs(page);
  assert(after[0] > before[0], "explicit mask must be canvas-draggable");
  await page.locator('[data-help-key="layout.save"]').click();
  await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
  assert.deepEqual(await rectInputs(page), after, "saved mask changed");
  report.cases.push({ case: "explicit-mask", id, before, after });
}

async function testRestoreCurrentPage(page, viewport) {
  const screenButton = (label) => page.locator(".runtime-layout-screen-list button").getByText(label, { exact: true });
  const readLayout = async () => {
    const result = await (await page.request.get(`${backendUrl}/api/project/state`)).json();
    assert(result.ok, "backend state read failed");
    return result.data.project_metadata.settings.runtimeUILayout;
  };
  const save = async () => {
    const expectedSpeaker = (await rectInputs(page))[0];
    const responsePromise = page.waitForResponse((response) => {
      if (!response.url().endsWith("/api/project/state") || response.request().method() !== "POST") return false;
      const submitted = response.request().postDataJSON()?.project_metadata?.settings?.runtimeUILayout;
      const player = submitted?.screens.find((screen) => screen.screen_id === "player");
      const title = submitted?.screens.find((screen) => screen.screen_id === "title");
      return player?.components.find((component) => component.component_id === "speaker_label")?.rect.x === expectedSpeaker
        && title?.components.find((component) => component.component_id === "title_start_button")?.rect.x === titleBefore[0];
    });
    await page.locator('[data-help-key="layout.save"]').click();
    const response = await responsePromise;
    assert((await response.json()).ok, "restore-current layout save request failed");
    await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
    return readLayout();
  };
  // Make another page observably different, then select ALL in the preset UI.
  await screenButton("标题主页").click();
  await selectComponent(page, "title_start_button");
  const titleBefore = await rectInputs(page);
  titleBefore[0] += 1;
  await page.locator(".runtime-layout-inspector details").first().locator('input[type="number"]').nth(0).fill(String(titleBefore[0]));
  await screenButton("播放页").click();
  await selectComponent(page, "speaker_label");
  const speakerBefore = await rectInputs(page);
  const before = await save();
  const expected = structuredClone(before);
  const playerDefaults = baselineLayout.screens.find((screen) => screen.screen_id === "player");
  const restoredIds = ["dialog_panel", "speaker_label", "dialog_text", "continue_indicator", "choice_list"];
  for (const component of expected.screens.find((screen) => screen.screen_id === "player").components) {
    if (restoredIds.includes(component.component_id) && !component.locked) {
      component.rect = structuredClone(playerDefaults.components.find((item) => item.component_id === component.component_id).rect);
    }
  }
  const menu = page.locator(".runtime-layout-toolbar details").filter({ has: page.locator("summary", { hasText: "预设" }) });
  await menu.locator("summary").click();
  await page.getByRole("combobox", { name: "预设页面范围", exact: true }).click();
  await page.getByRole("option", { name: "全部页面", exact: true }).click();
  const restoreButton = menu.locator('[data-help-key="layout.restoreCurrent"]');
  const buttonGeometry = await clickUnclippedButton(restoreButton);
  await menu.locator("summary").click();
  const speakerDefault = playerDefaults.components.find((item) => item.component_id === "speaker_label").rect;
  assert.deepEqual(await rectInputs(page), [speakerDefault.x, speakerDefault.y, speakerDefault.width, speakerDefault.height],
    "restore-current must restore the current page's built-in geometry");
  await screenButton("标题主页").click();
  await selectComponent(page, "title_start_button");
  assert.deepEqual(await rectInputs(page), titleBefore, "restore-current inherited ALL preset scope and changed another page");
  assert.deepEqual(await readLayout(), before, "restore-current persisted before explicit Save");
  await page.locator('[data-help-key="layout.undo"]').click();
  await screenButton("播放页").click();
  await selectComponent(page, "speaker_label");
  assert.deepEqual(await rectInputs(page), speakerBefore, "restore-current must be one undo step");
  await page.locator('[data-help-key="layout.redo"]').click();
  assert.deepEqual(await save(), expected, "restore-current changed protected layout data or failed to save restored geometry");
  report.cases.push({ case: "restore-current-page", viewport, presetScope: "all", buttonGeometry, ok: true });
}

async function testRepairDialog(page, viewport) {
  const screenButton = (label) => page.locator(".runtime-layout-screen-list button").getByText(label, { exact: true });
  const readLayout = async () => {
    const response = await (await page.request.get(`${backendUrl}/api/project/state`)).json();
    assert(response.ok, "backend state read failed");
    return response.data.project_metadata.settings.runtimeUILayout;
  };
  const save = async () => {
    await page.locator('[data-help-key="layout.save"]').click();
    await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
    return readLayout();
  };
  const dialogIds = ["dialog_panel", "speaker_label", "dialog_text", "continue_indicator"];
  await screenButton("播放页").click();
  for (const id of [...dialogIds, "choice_list"]) {
    await selectComponent(page, id);
    const rect = await rectInputs(page);
    await page.locator(".runtime-layout-inspector details").first().locator('input[type="number"]').nth(0).fill(String(rect[0] + 1));
  }
  await screenButton("标题主页").click();
  await selectComponent(page, "title_start_button");
  const titleBefore = await rectInputs(page);
  const before = await save();
  const expected = structuredClone(before);
  const playerDefaults = baselineLayout.screens.find((screen) => screen.screen_id === "player");
  for (const component of expected.screens.find((screen) => screen.screen_id === "player").components) {
    if (dialogIds.includes(component.component_id) && !component.locked) {
      component.rect = structuredClone(playerDefaults.components.find((item) => item.component_id === component.component_id).rect);
    }
  }
  const presetScope = viewport.width >= 1920 || viewport.width <= 390 ? "当前页面" : "全部页面";
  const menu = page.locator(".runtime-layout-toolbar details").filter({ has: page.locator("summary", { hasText: "预设" }) });
  await menu.locator("summary").click();
  await page.getByRole("combobox", { name: "预设页面范围", exact: true }).click();
  await page.getByRole("option", { name: presetScope, exact: true }).click();
  await page.getByRole("combobox", { name: "布局预设", exact: true }).click();
  await page.getByRole("option", { name: "极简字幕", exact: true }).click();
  const buttonGeometry = await clickUnclippedButton(menu.locator('[data-help-key="layout.repairDialog"]'));
  await menu.locator("summary").click();
  assert.deepEqual(await rectInputs(page), titleBefore, "repair-dialog reset the title page instead of only player dialogue");
  assert.deepEqual(await readLayout(), before, "repair-dialog persisted before Save");
  await screenButton("播放页").click();
  async function checkPlayer(layout, message) {
    for (const id of [...dialogIds, "choice_list"]) {
      await selectComponent(page, id);
      const rect = layout.screens.find((screen) => screen.screen_id === "player").components
        .find((component) => component.component_id === id).rect;
      assert.deepEqual(await rectInputs(page), [rect.x, rect.y, rect.width, rect.height], `${message}: ${id}`);
    }
  }
  await checkPlayer(expected, "repair-dialog scope");
  await page.locator('[data-help-key="layout.undo"]').click();
  await checkPlayer(before, "repair-dialog undo");
  await page.locator('[data-help-key="layout.redo"]').click();
  await checkPlayer(expected, "repair-dialog redo");
  assert.deepEqual(await save(), expected, "repair-dialog changed protected content or lost saved geometry");
  report.cases.push({ case: "repair-dialog", viewport, invokedFrom: "title", presetScope, preset: "subtitle", buttonGeometry, ok: true });
}

async function testRestoreAll(page, viewport) {
  const readLayout = async () => {
    const response = await (await page.request.get(`${backendUrl}/api/project/state`)).json();
    assert(response.ok);
    return response.data.project_metadata.settings.runtimeUILayout;
  };
  const screenButton = (label) => page.locator(".runtime-layout-screen-list button").getByText(label, { exact: true });
  await screenButton("标题主页").click();
  await selectComponent(page, "title_start_button");
  const saved = await readLayout();
  const previous = await rectInputs(page);
  const authored = [...previous];
  authored[0] += 2;
  await page.locator(".runtime-layout-inspector details").first().locator('input[type="number"]').first().fill(String(authored[0]));
  const undo = page.locator('[data-help-key="layout.undo"]');
  const redo = page.locator('[data-help-key="layout.redo"]');
  const history = { undoDisabled: await undo.isDisabled(), redoDisabled: await redo.isDisabled() };
  const menu = page.locator(".runtime-layout-toolbar details").filter({ has: page.locator("summary", { hasText: "预设" }) });
  await menu.locator("summary").click();
  await page.getByRole("combobox", { name: "预设页面范围", exact: true }).click();
  await page.getByRole("option", { name: "当前页面", exact: true }).click();
  const buttonGeometry = await clickUnclippedButton(menu.locator('[data-help-key="layout.restoreAll"]'));
  const dialog = page.getByRole("dialog", { name: "恢复所有页面的内置布局？", exact: true });
  await dialog.waitFor({ timeout: 5000 });
  assert.match(await dialog.innerText(), /所有页面/);
  assert.match(await dialog.innerText(), /未锁定/);
  assert.match(await dialog.innerText(), /自定义组件/);
  assert.match(await dialog.innerText(), /保存/);
  await dialog.evaluate(async (node) => {
    await Promise.all(node.parentElement.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
  });
  await page.locator(".hover-help-card").waitFor({ state: "hidden", timeout: 2000 });
  const dialogGeometry = await dialog.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { rect: rect.toJSON(), width: innerWidth, height: innerHeight,
      clientWidth: node.clientWidth, scrollWidth: node.scrollWidth };
  });
  assert(dialogGeometry.rect.left >= 0 && dialogGeometry.rect.right <= dialogGeometry.width
    && dialogGeometry.rect.top >= 0 && dialogGeometry.rect.bottom <= dialogGeometry.height, "restore confirmation escaped viewport");
  assert(dialogGeometry.scrollWidth <= dialogGeometry.clientWidth + 1, "restore confirmation has horizontal overflow");
  await page.screenshot({ path: path.join(output, `restore-all-confirmation-${viewport.width}x${viewport.height}.png`) });
  assert.deepEqual(await rectInputs(page), authored, "opening confirmation changed the draft");
  assert.deepEqual(await readLayout(), saved, "opening confirmation persisted layout");
  await clickUnclippedButton(dialog.getByRole("button", { name: "取消", exact: true }));
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(await rectInputs(page), authored, "Cancel changed unsaved geometry");
  assert.deepEqual({ undoDisabled: await undo.isDisabled(), redoDisabled: await redo.isDisabled() }, history);
  await menu.locator("summary").click();
  await undo.click();
  assert.deepEqual(await rectInputs(page), previous, "Cancel inserted an undo entry");
  await redo.click();
  assert.deepEqual(await rectInputs(page), authored, "Cancel damaged redo");
  await menu.locator("summary").click();
  await clickUnclippedButton(menu.locator('[data-help-key="layout.restoreAll"]'));
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(await rectInputs(page), authored, "Escape changed the draft");
  await clickUnclippedButton(menu.locator('[data-help-key="layout.restoreAll"]'));
  await dialog.waitFor();
  const confirmGeometry = await clickUnclippedButton(dialog.getByRole("button", { name: "确认恢复所有页面", exact: true }));
  await dialog.waitFor({ state: "hidden" });
  await menu.locator("summary").click();
  const expected = structuredClone(saved);
  const protectedTypes = new Set(["quick_menu", "quick_button", "choice_option", "main_menu_custom_button_container"]);
  for (const screen of expected.screens) {
    for (const component of screen.components) {
      const original = baselineLayout.screens.find((item) => item.screen_id === screen.screen_id)?.components
        .find((item) => item.component_id === component.component_id && item.component_type === component.component_type);
      if (original?.rect && !component.locked && !protectedTypes.has(component.component_type)) {
        component.rect = structuredClone(original.rect);
      }
    }
  }
  const defaultTitle = expected.screens.find((screen) => screen.screen_id === "title").components
    .find((component) => component.component_id === "title_start_button").rect;
  assert.deepEqual(await rectInputs(page), [defaultTitle.x, defaultTitle.y, defaultTitle.width, defaultTitle.height]);
  assert.deepEqual(await readLayout(), saved, "confirmation persisted before explicit Save");
  await undo.click();
  assert.deepEqual(await rectInputs(page), authored, "restore-all must undo in one step");
  await redo.click();
  await page.locator('[data-help-key="layout.save"]').click();
  await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
  assert.deepEqual(await readLayout(), expected, "restore-all deleted user content or changed non-geometric data");
  const savedHistory = { undoDisabled: await undo.isDisabled(), redoDisabled: await redo.isDisabled() };
  await menu.locator("summary").click();
  await clickUnclippedButton(menu.locator('[data-help-key="layout.restoreAll"]'));
  await dialog.waitFor();
  await clickUnclippedButton(dialog.getByRole("button", { name: "确认恢复所有页面", exact: true }));
  await dialog.waitFor({ state: "hidden" });
  await menu.locator("summary").click();
  assert.deepEqual({ undoDisabled: await undo.isDisabled(), redoDisabled: await redo.isDisabled() }, savedHistory,
    "an already restored layout added an empty undo entry");
  assert(await page.locator(".runtime-layout-save-feedback.is-saved").isVisible(), "a no-op restore marked the draft dirty");
  report.cases.push({ case: "restore-all-confirmation", viewport, buttonGeometry, dialogGeometry, confirmGeometry, ok: true });
}

async function testTitleTextStyle(page, viewport) {
  await page.locator(".runtime-layout-screen-list button").getByText("标题主页", { exact: true }).click();
  const id = { 1920: "title_start_button", 2560: "title_start_button", 3840: "title_start_button",
    1440: "title_settings_button", 757: "title_gallery_button", 390: "title_about_button",
    2400: "title_continue_button", 1280: "title_save_load_button", 640: "title_start_button", 844: "title_settings_button" }[viewport.width];
  await selectComponent(page, id);
  const preview = page.locator(`.runtime-layout-expected-preview [data-preview-component-id="${id}"]`);
  const style = await preview.evaluate((node) => {
    const s = getComputedStyle(node);
    return { background: s.backgroundColor, border: s.borderTopWidth, shadow: s.boxShadow };
  });
  const persisted = (await (await page.request.get(`${backendUrl}/api/project/state`)).json())
    .data.project_metadata.settings.runtimeUILayout.screens.find((screen) => screen.screen_id === "title")
    .components.find((component) => component.component_id === id);
  const alreadyAuthored = persisted.titleButtonStyleSource === "layout";
  const initialColor = alreadyAuthored ? "rgb(35, 69, 103)" : "rgba(0, 0, 0, 0)";
  assert.deepEqual(style, { background: initialColor, border: "0px", shadow: "none" },
    "layout preview default title button must be text only");
  const appearance = page.locator(".runtime-layout-inspector details").filter({ has: page.locator("summary", { hasText: /^外观$/ }) });
  await appearance.locator("summary").click();
  const background = appearance.locator("label").filter({ hasText: /^backgroundColor/ }).locator('input:not([type="color"])');
  assert.equal(await background.inputValue(), alreadyAuthored ? "#234567" : "transparent", "inspector disagrees with effective style");
  const editedColor = alreadyAuthored ? "#345678" : "#234567";
  await background.fill(editedColor);
  const waitColor = (color) => page.waitForFunction(({ id, color }) => {
    const node = document.querySelector(`.runtime-layout-expected-preview [data-preview-component-id="${id}"]`);
    return node && getComputedStyle(node).backgroundColor === color;
  }, { id, color });
  await waitColor(alreadyAuthored ? "rgb(52, 86, 120)" : "rgb(35, 69, 103)");
  await page.locator('[data-help-key="layout.undo"]').click();
  await waitColor(initialColor);
  await page.locator('[data-help-key="layout.redo"]').click();
  if (alreadyAuthored) await background.fill("#234567");
  const label = preview.locator(".preview-button-content");
  const initialFontSize = await label.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  const fontInput = appearance.locator("label").filter({ hasText: /^fontSize/ }).locator('input[type="number"]');
  await fontInput.fill("8");
  const smallerFontSize = await label.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  assert(smallerFontSize < initialFontSize, "title text preview ignores the explicit font size");
  await fontInput.fill("18");
  await page.locator('[data-help-key="layout.save"]').click();
  await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
  const state = await (await page.request.get(`${backendUrl}/api/project/state`)).json();
  const saved = state.data.project_metadata.settings.runtimeUILayout.screens.find((screen) => screen.screen_id === "title").components
    .find((component) => component.component_id === id);
  assert.equal(saved.titleButtonStyleSource, "layout", "saved layout lost the explicit styling source");
  assert.equal(saved.style.backgroundColor, "#234567");
  report.cases.push({ case: "title-text-style-override", viewport, id, ok: true });
}

async function testTitleThemeBoundary(page) {
  const state = await (await page.request.get(`${backendUrl}/api/project/state`)).json();
  const authoredButtons = state.data.project_metadata.settings.runtimeUILayout.screens
    .find((screen) => screen.screen_id === "title").components.filter((component) => component.titleButtonStyleSource === "layout");
  assert(authoredButtons.length > 0, "theme regression requires an explicitly styled title button");
  await page.locator('[data-help-key="advanced.tab.theme"]:visible').click();
  await page.locator(".advanced-tab-content.is-active[data-tab='theme']").waitFor();
  await page.locator('[data-help-key="theme.scope"]').click();
  await page.getByRole("option", { name: "开始/重新开始按钮", exact: true }).click();
  await page.getByTestId("title-button-layout-only-note").waitFor({ timeout: 3000 });
  assert(await page.locator('[data-help-key="theme.resetScope"]').isDisabled(), "theme reset can erase explicit layout styles");
  assert.equal(await page.locator('.runtime-theme-inspector input[type="color"]').count(), 0,
    "title styling must have one explicit editing entry");
  await page.locator(".runtime-theme-preset-list > button").last().click();
  async function saveThemeRequest() {
    await page.waitForFunction(() => !document.querySelector(".runtime-theme-status")?.textContent.includes("检测中"));
    if (await page.locator('[data-help-key="theme.save"]').isDisabled()) {
      if (!await page.locator(".runtime-theme-status ul").count()) {
        await page.locator('[data-help-key="theme.validation"]').click();
      }
      const issues = await page.locator(".runtime-theme-status").innerText();
      report.themeValidationFailure = issues;
      assert.fail(`Theme save blocked: ${issues}`);
    }
    const [request] = await Promise.all([
      page.waitForRequest((request) => request.url().endsWith("/api/project/state")
        && request.method() === "POST" && request.postDataJSON()?.project_metadata?.settings?.runtimeUILayout),
      page.locator('[data-help-key="theme.save"]').click(),
    ]);
    const response = await request.response();
    assert(response && (await response.json()).ok, "theme save request failed");
    return request.postDataJSON().project_metadata.settings.runtimeUILayout;
  }
  const presetSaved = await saveThemeRequest();
  assert.deepEqual(presetSaved.screens.find((screen) => screen.screen_id === "title"),
    state.data.project_metadata.settings.runtimeUILayout.screens.find((screen) => screen.screen_id === "title"),
    "theme preset must preserve explicit title style");
  await page.locator('[data-help-key="theme.restoreDefault"]').click();
  const submitted = await saveThemeRequest();
  assert.deepEqual(submitted.screens.find((screen) => screen.screen_id === "title"),
    state.data.project_metadata.settings.runtimeUILayout.screens.find((screen) => screen.screen_id === "title"),
    "default theme reset must preserve title geometry and custom content");
  for (const component of authoredButtons) {
    assert.deepEqual(submitted.screens.find((screen) => screen.screen_id === "title").components
      .find((item) => item.component_id === component.component_id), component,
    "restoring default theme erased an explicit title style in the actual save request");
  }
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await settled(page);
  await page.locator(".runtime-layout-screen-list button").getByText("标题主页", { exact: true }).click();
  for (const component of authoredButtons) {
    const preview = page.locator(`.runtime-layout-expected-preview [data-preview-component-id="${component.component_id}"]`);
    assert.equal(await preview.evaluate((node) => getComputedStyle(node).backgroundColor), "rgb(35, 69, 103)",
      "theme application overrode explicit title style");
  }
  report.cases.push({ case: "title-theme-boundary", ok: true });
}

async function testMultiAlignment(page) {
  await page.setViewportSize(viewports[0]);
  await page.locator(".runtime-layout-screen-list button").getByText("标题主页", { exact: true }).click();
  const ids = [];
  for (const rect of [[10, 10, 10, 8], [40, 25, 15, 10], [80, 65, 10, 12]]) {
    await page.getByRole("button", { name: "添加遮罩", exact: true }).click();
    ids.push(await page.locator(".runtime-layout-component-list label.is-active").getAttribute("data-component-id"));
    const inputs = page.locator(".runtime-layout-inspector details").first().locator('input[type="number"]');
    for (let i = 0; i < rect.length; i++) await inputs.nth(i).fill(String(rect[i]));
  }
  async function readRects() {
    const rects = [];
    for (const id of ids) { await selectComponent(page, id); rects.push(await rectInputs(page)); }
    return rects;
  }
  const menu = page.locator(".runtime-layout-toolbar details").filter({ has: page.locator("summary", { hasText: "对齐" }) });
  for (const action of ["sameWidth", "sameHeight", "distributeX", "distributeY"]) {
    const before = await readRects();
    await selectComponent(page, ids[0]);
    for (const id of ids.slice(1)) await page.locator(`.runtime-layout-component-list input[data-component-id="${id}"]`).check();
    await menu.locator("summary").click();
    await menu.getByRole("button", { name: alignmentLabels[action], exact: true }).click();
    await menu.locator("summary").click();
    const after = await readRects();
    if (action.startsWith("same")) {
      const index = action === "sameWidth" ? 2 : 3;
      assert(after.every((rect) => rect[index] === before[0][index]), `${action} did not size every selected component to the first selection`);
    } else {
      const axis = action === "distributeX" ? 0 : 1;
      const size = axis + 2;
      const gaps = [after[1][axis] - after[0][axis] - after[0][size], after[2][axis] - after[1][axis] - after[1][size]];
      assert(Math.abs(gaps[0] - gaps[1]) < 0.03, `${action} did not equalize gaps: ${gaps}`);
      assert.equal(after[0][axis], before[0][axis], "distribution moved its first endpoint");
      assert.equal(after[2][axis], before[2][axis], "distribution moved its last endpoint");
    }
    await page.locator('[data-help-key="layout.undo"]').click();
    assert.deepEqual(await readRects(), before, `${action} must be a single undo step`);
    await page.locator('[data-help-key="layout.redo"]').click();
    assert.deepEqual(await readRects(), after, `${action} redo lost geometry`);
    report.cases.push({ case: "multi-alignment", action, before, after });
  }
  await page.locator('[data-help-key="layout.save"]').click();
  await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
}

async function testInsufficientDistributionSpace(page) {
  await page.setViewportSize(viewports[0]);
  await page.locator(".runtime-layout-screen-list button").getByText("标题主页", { exact: true }).click();
  const ids = [];
  for (const rect of [[10, 10, 45, 30], [40, 25, 45, 30], [80, 40, 15, 15]]) {
    await page.getByRole("button", { name: "添加遮罩", exact: true }).click();
    ids.push(await page.locator(".runtime-layout-component-list label.is-active").getAttribute("data-component-id"));
    const inputs = page.locator(".runtime-layout-inspector details").first().locator('input[type="number"]');
    for (let i = 0; i < rect.length; i++) await inputs.nth(i).fill(String(rect[i]));
  }
  await selectComponent(page, ids[0]);
  for (const id of ids.slice(1)) {
    await page.locator(`.runtime-layout-component-list input[data-component-id="${id}"]`).check();
  }
  const menu = page.locator(".runtime-layout-toolbar details").filter({ has: page.locator("summary", { hasText: "对齐" }) });
  await menu.locator("summary").click();
  for (const label of [alignmentLabels.distributeX, alignmentLabels.distributeY]) {
    const button = menu.getByRole("button", { name: label, exact: true });
    assert(await button.isDisabled(), `${label} must be disabled when selected components have no distribution space`);
    assert.match(await button.getAttribute("title") || "", /空间|重叠|间距/,
      `${label} disabled state needs an explanation`);
  }
  await menu.locator("summary").click();
  report.cases.push({ case: "insufficient-distribution-space", ids });
}

async function testReload(page, resumeDraft = false) {
  await page.setViewportSize(viewports[0]);
  const state = await (await page.request.get(`${backendUrl}/api/project/state`)).json();
  const expected = state.data.project_metadata.settings.runtimeUILayout;
  await page.reload();
  await page.waitForFunction(() => document.querySelector(".editor-toolbar")
    || [...document.querySelectorAll(".recent-project-open:not(:disabled)")].some((node) => node.textContent.includes("Layout Editing Regression")));
  if (!await page.locator(".editor-toolbar").isVisible()) {
    if (resumeDraft) await page.locator('[data-help-key="home.openDraft"]').click();
    else await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: "Layout Editing Regression" }).first().click();
  }
  await page.locator(".editor-toolbar").waitFor();
  await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await settled(page);
  for (const [screenId, label, id] of [
    ["title", "标题主页", "title_custom_button_container"],
    ["player", "播放页", "speaker_label"],
  ]) {
    await page.locator(".runtime-layout-screen-list button").getByText(label, { exact: true }).click();
    await selectComponent(page, id);
    const rect = expected.screens.find((screen) => screen.screen_id === screenId).components
      .find((component) => component.component_id === id).rect;
    assert.deepEqual(await rectInputs(page), [rect.x, rect.y, rect.width, rect.height], `${id} changed after editor reload`);
  }
  for (const mask of expected.screens.find((screen) => screen.screen_id === "player").components.filter((component) => component.component_type === "mask")) {
    await selectComponent(page, mask.component_id);
    assert.deepEqual(await rectInputs(page), [mask.rect.x, mask.rect.y, mask.rect.width, mask.rect.height], "mask changed after reload");
    assert.equal(await page.locator('.runtime-layout-mask-fieldset input[type="number"]').first().inputValue(),
      String(mask.style.backdropBlur), "mask material changed after reload");
  }
  await page.locator(".runtime-layout-screen-list button").getByText("标题主页", { exact: true }).click();
  for (const component of expected.screens.find((screen) => screen.screen_id === "title").components
    .filter((component) => component.titleButtonStyleSource === "layout")) {
    assert.equal(await page.locator(`.runtime-layout-expected-preview [data-preview-component-id="${component.component_id}"]`)
      .evaluate((node) => getComputedStyle(node).backgroundColor), "rgb(35, 69, 103)", "explicit title style lost after reload");
  }
  report.cases.push({ case: resumeDraft ? "resume-draft" : "backend-reload", ok: true });
}

async function run() {
  for (const port of [editorPort, backendPort]) await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
  const input = path.join(output, "layout-editing.vnproj");
  saveProjectContainerSync(input, fixture(), { silent: true });
  const data = path.join(output, "isolated-data");
  const backend = spawn("python", ["backend_launcher.py"], {
    cwd: path.join(root, "backend"), windowsHide: true, stdio: "ignore",
    env: { ...process.env, AGENTVN_EDITOR_DATA_DIR: data, AGENTVN_BACKEND_DATA_DIR: data,
      DATABASE_PATH: path.join(data, "vn_engine.db"), AGENTVN_BACKEND_PORT: String(backendPort), AGENTVN_LEGACY_DATABASE_PATHS: "" },
  });
  const editor = spawn("cmd.exe", ["/d", "/s", "/c", `npm run dev -- --host 127.0.0.1 --port ${editorPort} --strictPort`], {
    cwd: path.join(root, "editor"), windowsHide: true, stdio: "ignore",
    env: { ...process.env, VITE_BACKEND_URL: backendUrl },
  });
  let browser, page;
  try {
    await ready(`${backendUrl}/api/health`); await ready(origin);
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: viewports[0], deviceScaleFactor });
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await openLayout(page, input);
    await page.locator('[data-help-key="layout.save"]').click();
    await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
    baselineLayout = (await (await page.request.get(`${backendUrl}/api/project/state`)).json()).data.project_metadata.settings.runtimeUILayout;
    await testPresetGeometry(page);
    for (const viewport of viewports.filter((v) => !process.env.LAYOUT_VIEWPORT || v.width === Number(process.env.LAYOUT_VIEWPORT))) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.locator(".runtime-layout-screen-list button").getByText("播放页", { exact: true }).click();
      await selectComponent(page, "choice_list");
      await testActionLabels(page, viewport);
      await testPresetVisualGeometry(page, viewport);
      await testGeometry(page, viewport);
      await testModifierSelection(page, viewport);
      await testPlayerDrag(page, viewport);
      if (viewport.width === 1920) await testSaveFailureRetry(page, viewport);
      await testSnapping(page, viewport);
      await testZoomCoordinateMapping(page, viewport);
      await testCustomContainer(page, viewport);
      await testFixedQuickMenu(page, viewport);
      if (viewport.width === 1920) await testMask(page);
      await testRestoreCurrentPage(page, viewport);
      await testRepairDialog(page, viewport);
      await testRestoreAll(page, viewport);
      await testTitleTextStyle(page, viewport);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(output, `${viewport.width}x${viewport.height}.png`) });
      console.log(`PASS layout editing ${viewport.width}x${viewport.height} DPR=${deviceScaleFactor}`);
    }
    await testMultiAlignment(page);
    await testInsufficientDistributionSpace(page);
    await testReload(page);
    await testReload(page, true);
    await testTitleThemeBoundary(page);
    assert.deepEqual(errors, [], "page errors");
    await testProtectedPreset(browser);
    await testGroupLocks(browser);
    report.ok = true;
  } catch (error) {
    report.error = String(error.stack || error);
    if (await page?.locator(".runtime-theme-status").count()) {
      if (!await page.locator(".runtime-theme-status ul").count()) {
        await page.locator('[data-help-key="theme.validation"]').click().catch(() => {});
      }
      report.themeValidationFailure = await page.locator(".runtime-theme-status").innerText();
      console.error(report.themeValidationFailure);
    }
    report.failureInspector = await page?.locator(".runtime-layout-inspector").evaluate((inspector) => {
      const boundary = inspector.getBoundingClientRect();
      return [...inspector.querySelectorAll("*")].map((node) => {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        return { tag: node.tagName, className: node.className, text: node.textContent?.slice(0, 100),
          rect: rect.toJSON(), minWidth: style.minWidth, whiteSpace: style.whiteSpace, display: style.display,
          gridTemplateColumns: style.gridTemplateColumns, overflow: style.overflow };
      }).filter((value) => value.rect.width && value.rect.right > boundary.right + 1).slice(0, 30);
    }).catch(() => []);
    report.failureGeometry = await page?.evaluate(() => {
      const values = [];
      for (let node = document.querySelector('.runtime-layout-component-list button[data-component-id="speaker_label"]');
        node; node = node.parentElement) {
        const style = getComputedStyle(node);
        values.push({ class: node.className, rect: node.getBoundingClientRect().toJSON(),
          scrollTop: node.scrollTop, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight,
          height: style.height, overflow: style.overflow, contain: style.contain });
      }
      return values;
    }).catch(() => []);
    await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    stop(editor); stop(backend);
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
}
run().then(() => console.log("client-layout-editing-regression-playwright: PASS"))
  .catch((error) => { console.error(error); process.exitCode = 1; });
