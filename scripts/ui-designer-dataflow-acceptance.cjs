#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const ROOT = path.resolve(__dirname, "..");

function loadDataflowHarness() {
  const source = `
    import { getDefaultUISkinLayout, editUILayoutComponentStyle } from "./shared/cartridge/uiSkin";
    import { useProjectStore } from "./editor/src/store/projectStore";
    import { useEditorStore } from "./editor/src/store/editorStore";

    export function roundTripProject() {
      const layout = getDefaultUISkinLayout();
      const title = layout.screens.find((screen) => screen.screen_id === "title");
      if (!title) throw new Error("Missing title screen.");
      title.components = title.components.map((component) => component.component_id === "title_start_button"
        ? editUILayoutComponentStyle(component, { backgroundColor: "#234567", borderWidth: 2 })
        : component);
      title.components.push({
        component_id: "title_custom_button_dataflow",
        component_type: "main_menu_custom_button",
        label: "Dataflow",
        visible: false,
        rect: { x: 6, y: 88, width: 20, height: 7 },
        mobileRect: { x: 6, y: 90, width: 27, height: 6 },
        style: {
          backgroundColor: "#192234",
          backgroundImage: "asset:dataflow-art",
          backgroundFit: "cover",
          color: "#f6f8ff",
          borderRadius: 10,
        },
        action: {
          kind: "external_url",
          url: "https://example.com/dataflow",
          open_mode: "system_browser",
        },
      });
      const now = new Date().toISOString();
      const project = {
        schema_version: "1.0.0",
        project_id: "dataflow_project",
        title: "Dataflow Project",
        author: "AgentVN QA",
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        memory_mode: "hybrid",
        asset_manifest: [{
          asset_id: "dataflow-art",
          asset_type: "ui",
          metadata: {
            filename: "dataflow-art.png",
            mime_type: "image/png",
            project_path: "assets/ui/dataflow-art.png",
          },
        }],
        editor_settings: { runtimeUILayout: layout },
        created_at: now,
        updated_at: now,
      };

      useEditorStore.getState().importProject(project);
      useProjectStore.getState().loadProjectMetadata(project);
      const projectState = useProjectStore.getState();
      const exported = useEditorStore.getState().exportProject({
        projectId: projectState.projectId,
        title: projectState.title,
        author: projectState.author,
        assetManifest: projectState.assetManifest,
        editorSettings: { ...projectState.settings },
        createdAt: projectState.createdAt,
      });
      return { source: project, exported };
    }

    export function loadLegacyProject() {
      const layout = getDefaultUISkinLayout();
      const title = layout.screens.find((screen) => screen.screen_id === "title");
      if (!title) throw new Error("Missing title screen.");
      title.components = title.components.filter((component) => (
        component.component_type !== "main_menu_custom_button"
        && component.component_type !== "main_menu_custom_button_container"
      ));
      const now = new Date().toISOString();
      useProjectStore.getState().loadProjectMetadata({
        project_id: "legacy_dataflow_project",
        title: "Legacy",
        author: "",
        asset_manifest: [],
        editor_settings: { runtimeUILayout: layout },
        created_at: now,
        updated_at: now,
      });
      return useProjectStore.getState().settings.runtimeUILayout;
    }
  `;
  const result = esbuild.buildSync({
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: ROOT,
      sourcefile: "output/ui-designer-dataflow-entry.ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    write: false,
    logLevel: "silent",
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error("Unable to compile UI designer dataflow harness.");
  const filename = path.join(ROOT, "output", "ui-designer-dataflow-entry.cjs");
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(ROOT);
  compiled._compile(output, filename);
  return compiled.exports;
}

function buttonFields(component) {
  return {
    component_id: component.component_id,
    component_type: component.component_type,
    label: component.label,
    action: component.action,
    rect: component.rect,
    style: component.style,
    visible: component.visible,
  };
}

const harness = loadDataflowHarness();
const { source, exported } = harness.roundTripProject();
const sourceTitle = source.editor_settings.runtimeUILayout.screens.find((screen) => screen.screen_id === "title");
const exportedTitle = exported.editor_settings.runtimeUILayout.screens.find((screen) => screen.screen_id === "title");
const sourceButton = sourceTitle.components.find((component) => component.component_id === "title_custom_button_dataflow");
const exportedButton = exportedTitle.components.find((component) => component.component_id === "title_custom_button_dataflow");
assert.deepEqual(exportedTitle.components.find((component) => component.component_id === "title_start_button"),
  sourceTitle.components.find((component) => component.component_id === "title_start_button"),
  "explicit built-in title style and its source must survive project store import/export");

assert.ok(sourceButton, "source custom button must exist");
assert.ok(exportedButton, "exported custom button must exist");
const sourceGroup = sourceTitle.components.find((component) => component.component_type === "main_menu_custom_button_container");
const exportedGroup = exportedTitle.components.find((component) => component.component_id === sourceGroup?.component_id);
assert.ok(sourceGroup && exportedGroup, "authored button group must survive project export/import");
assert.deepEqual(exportedGroup, sourceGroup, "export must preserve group metadata, not replace it with a default");
assert.deepEqual(
  buttonFields(exportedButton),
  buttonFields(sourceButton),
  "project store load + editor export must preserve every custom button business field",
);
assert.equal(exportedButton.action.kind, "external_url", "action kind must survive round-trip");
assert.equal(exportedButton.action.url, "https://example.com/dataflow", "action URL must survive round-trip");
assert.equal(exportedButton.style.backgroundImage, "asset:dataflow-art", "stable image reference must survive round-trip");
assert.equal(Object.hasOwn(exportedButton, "mobileRect"), false, "unified layout export must not contain mobileRect");
assert.ok(!Object.hasOwn(exported.editor_settings, "selectedId"), "selection state must not enter editor_settings");
assert.ok(!Object.hasOwn(exported.editor_settings, "history"), "layout history must not enter editor_settings");

const legacyLayout = harness.loadLegacyProject();
const legacyTitle = legacyLayout.screens.find((screen) => screen.screen_id === "title");
assert.ok(legacyTitle, "legacy title screen must load");
assert.equal(
  legacyTitle.components.filter((component) => component.component_type === "main_menu_custom_button").length,
  0,
  "legacy project must not invent custom buttons",
);

console.log(JSON.stringify({
  ok: true,
  checks: [
    "projectStore load and editorStore export preserve custom button business fields",
    "external_url action and stable image reference survive serialization",
    "layout-local selection/history are excluded from editor_settings",
    "legacy project without custom buttons loads safely",
  ],
}, null, 2));
