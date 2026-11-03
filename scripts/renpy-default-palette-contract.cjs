"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const requireFromEditor = createRequire(path.join(root, "editor/package.json"));
const bundle = requireFromEditor("esbuild").buildSync({
  stdin: {
    resolveDir: root,
    loader: "ts",
    contents: 'export { createRenpyUILayout, resolveRuntimeUILayoutSettings, switchRuntimeUILayoutType } from "./shared/cartridge/uiLayoutProfiles"; export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";',
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(
  loaded,
  loaded.exports,
  requireFromEditor,
);

const layout = loaded.exports.createRenpyUILayout();
assert.equal(layout.layout_type, "renpy");
assert.deepEqual(
  {
    background: layout.tokens.colorBackground,
    ink: layout.tokens.colorInk,
    muted: layout.tokens.colorMuted,
    accent: layout.tokens.colorAccent,
    line: layout.tokens.colorLine,
    dialog: layout.tokens.colorDialog,
    dialogText: layout.tokens.colorDialogText,
    speaker: layout.tokens.colorSpeakerPlate,
    speakerText: layout.tokens.colorSpeakerText,
    choice: layout.tokens.colorChoice,
    choiceText: layout.tokens.colorChoiceText,
  },
  {
    background: "#111111",
    ink: "#ffffff",
    muted: "#888888",
    accent: "#00b8c3",
    line: "#555555",
    dialog: "#111111",
    dialogText: "#ffffff",
    speaker: "#1c1c1c",
    speakerText: "#ffffff",
    choice: "#00b8c3",
    choiceText: "#ffffff",
  },
  "Ren'Py defaults must use one coherent template palette",
);
assert.equal(layout.renpy?.shared?.buttonTextColors, undefined,
  "Default state colors must inherit theme tokens; explicit GUI overrides remain opt-in");

const player = layout.screens.find((screen) => screen.screen_id === "player");
const styleOf = (type) => player?.components.find((component) => component.component_type === type)?.style;
const title = layout.screens.find((screen) => screen.screen_id === "title");
const titleContainer = title?.components.find((component) => component.component_type === "main_menu_custom_button_container");
assert.equal(titleContainer?.style?.backgroundColor, "rgba(0, 184, 195, 0.06)");
assert.equal(titleContainer?.style?.borderColor, "rgba(0, 184, 195, 0.58)");
assert.equal(styleOf("stage_background")?.backgroundColor, "#111111");
assert.equal(styleOf("continue_indicator")?.color, "#ffffff");
assert.deepEqual(
  styleOf("quick_button"),
  {
    backgroundColor: "transparent",
    color: "#888888",
    borderColor: "transparent",
    borderWidth: 0,
    borderRadius: 0,
    opacity: 1,
    fontSize: 16,
    fontWeight: 800,
    shadow: "none",
    backdropBlur: 0,
  },
  "Ren'Py quick actions must be text-first by default",
);
assert.deepEqual(
  {
    dialog: styleOf("dialog_panel"),
    speaker: styleOf("speaker_label"),
    text: styleOf("dialog_text"),
    choice: styleOf("choice_option"),
  },
  {
    dialog: {
      backgroundColor: "#111111",
      borderRadius: 0,
      padding: 0,
      backdropBlur: 0,
      shadow: "none",
      borderWidth: 0,
    },
    speaker: {
      backgroundColor: "#1c1c1c",
      color: "#ffffff",
      borderRadius: 0,
      padding: 7,
      fontSize: 18,
      fontWeight: 760,
      shadow: "none",
    },
    text: {
      color: "#ffffff",
      fontSize: 24,
      fontWeight: 500,
      textAlign: "left",
    },
    choice: {
      backgroundColor: "transparent",
      color: "#ffffff",
      borderColor: "transparent",
      borderWidth: 0,
      borderRadius: 0,
      opacity: 1,
      padding: 12,
      fontSize: 20,
      fontWeight: 700,
      textAlign: "center",
      shadow: "none",
    },
  },
  "dialogue and choice defaults must not reintroduce AgentVN blue/pink chrome",
);

const authored = structuredClone(layout);
authored.tokens.colorAccent = "#bb9944";
authored.tokens.colorSurface = "#234567";
authored.screens.find(screen => screen.screen_id === "player").components
  .find(component => component.component_type === "speaker_label").style.color = "#fedcba";
const settings = { runtimeUILayoutProfiles: { version: 1, activeType: "renpy", profiles: {
  agentvn: loaded.exports.getDefaultUISkinLayout(), renpy: authored,
} } };
const before = structuredClone(settings);
const resolved = loaded.exports.resolveRuntimeUILayoutSettings(settings);
assert.deepEqual(resolved.runtimeUILayout.tokens, authored.tokens, "Saved colors must not be rewritten on load");
const switched = loaded.exports.switchRuntimeUILayoutType(
  loaded.exports.switchRuntimeUILayoutType(resolved, "agentvn"), "renpy");
assert.deepEqual(switched.runtimeUILayout, resolved.runtimeUILayout, "Profile switching must retain explicit colors");
assert.deepEqual(settings, before, "Default creation/selection must not mutate saved caller data");
console.log("renpy-default-palette-contract: PASS (default coherence and saved overrides)");
