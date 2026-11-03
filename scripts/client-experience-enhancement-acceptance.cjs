#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

const CASES = [
  {
    id: "baseline",
    title: "Core editor/runtime entry points and shared UI skin baseline",
    status: "implemented",
    run: runBaseline,
  },
  {
    id: "custom-button-schema",
    title: "Custom title button action schema and URL safety",
    status: "implemented",
    run: runCustomButtonSchema,
  },
  {
    id: "transition-schema",
    title: "Shared visual transition schema and legacy normalization",
    status: "implemented",
    run: runTransitionSchema,
  },
  {
    id: "background-transition-engine",
    title: "Expose normalized background transition metadata from StoryEngine",
    status: "implemented",
    run: runBackgroundTransitionEngine,
  },
  {
    id: "background-transition-runtime",
    title: "Run double-layer background transitions",
    status: "implemented",
    run: runBackgroundTransitionRuntime,
  },
  {
    id: "background-transition-interruption",
    title: "Handle rapid background transition replacement and cleanup",
    status: "implemented",
    run: runBackgroundTransitionInterruption,
  },
  {
    id: "custom-button-create",
    title: "Create custom title buttons in the editor",
    status: "implemented",
    run: runCustomButtonCreate,
  },
  {
    id: "custom-button-edit",
    title: "Edit, hide, and delete custom title buttons",
    status: "implemented",
    run: runCustomButtonEdit,
  },
  {
    id: "custom-button-existing-image",
    title: "Use existing project images on custom title buttons",
    status: "implemented",
    run: runCustomButtonExistingImage,
  },
  {
    id: "custom-button-image-import",
    title: "Import custom button images into the project manifest",
    status: "implemented",
    run: runCustomButtonImageImport,
  },
  {
    id: "custom-button-container",
    title: "Edit an auto-sized lower-left custom button container",
    status: "implemented",
    run: runCustomButtonContainer,
  },
  {
    id: "custom-button-persist",
    title: "Save, reopen, undo, and redo custom title buttons",
    status: "implemented",
    run: runCustomButtonPersist,
  },
  {
    id: "custom-button-export",
    title: "Export and re-import custom button assets",
    status: "implemented",
    run: runCustomButtonExport,
  },
  {
    id: "custom-button-runtime-render",
    title: "Render custom title buttons and images in GameCli",
    status: "implemented",
    run: runCustomButtonRuntimeRender,
  },
  {
    id: "custom-button-runtime-link",
    title: "Safely open external links in web and desktop runtimes",
    status: "implemented",
    run: runCustomButtonRuntimeLink,
  },
  {
    id: "custom-button-responsive",
    title: "Responsive layout and accessibility for custom buttons",
    status: "implemented",
    run: runCustomButtonResponsive,
  },
  {
    id: "background-transition-editor",
    title: "Background transition editor controls",
    status: "implemented",
    run: runBackgroundTransitionEditor,
  },
  {
    id: "sprite-transition-editor",
    title: "Sprite replacement transition editor controls",
    status: "implemented",
    run: runSpriteTransitionEditor,
  },
  {
    id: "transition-persist",
    title: "Persist and export background/sprite transition settings",
    status: "implemented",
    run: runTransitionPersist,
  },
  {
    id: "sprite-transition-engine",
    title: "Expose normalized sprite replacement metadata from StoryEngine",
    status: "implemented",
    run: runSpriteTransitionEngine,
  },
  {
    id: "sprite-layer-order",
    title: "Author and render deterministic sprite depth ordering",
    status: "implemented",
    run: runSpriteLayerOrder,
  },
  {
    id: "sprite-transition-runtime",
    title: "Run old/new sprite replacement transitions",
    status: "implemented",
    run: runSpriteTransitionRuntime,
  },
  {
    id: "transition-interruption",
    title: "Handle rapid transition replacement and cancellation",
    status: "implemented",
    run: runTransitionInterruption,
  },
  {
    id: "reduced-motion",
    title: "Respect reduced-motion preferences",
    status: "implemented",
    run: runReducedMotion,
  },
  {
    id: "backward-compatibility",
    title: "Load legacy projects, cartridges, and command fields",
    status: "implemented",
    run: runBackwardCompatibility,
  },
  {
    id: "final-e2e",
    title: "Editor-to-export-to-GameCli end-to-end acceptance",
    status: "implemented",
    run: runFinalE2E,
  },
  {
    id: "final-docs",
    title: "Final documentation and regression readiness",
    status: "implemented",
    run: runFinalDocs,
  },
];

function usage() {
  return [
    "Usage:",
    "  node scripts/client-experience-enhancement-acceptance.cjs --list",
    "  node scripts/client-experience-enhancement-acceptance.cjs --case <case-name>",
    "  node scripts/client-experience-enhancement-acceptance.cjs --all",
    "",
    "Pending cases return a non-zero exit code and are never counted as passing.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    mode: "",
    caseId: "",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--list") {
      setMode(options, "list");
      continue;
    }
    if (arg === "--all") {
      setMode(options, "all");
      continue;
    }
    if (arg === "--case" || arg.startsWith("--case=")) {
      setMode(options, "case");
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++index];
      if (!value || value.startsWith("--")) throw new Error("--case requires a case name.");
      options.caseId = value.trim();
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function setMode(options, mode) {
  if (options.mode && options.mode !== mode) {
    throw new Error(`Choose exactly one execution mode; received --${options.mode} and --${mode}.`);
  }
  options.mode = mode;
}

function relativePath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function resolveProjectFile(relativeFile) {
  const resolved = path.resolve(ROOT, relativeFile);
  const rootWithSeparator = ROOT.endsWith(path.sep) ? ROOT : `${ROOT}${path.sep}`;
  if (resolved !== ROOT && !resolved.startsWith(rootWithSeparator)) {
    throw new Error(`Refusing to inspect a path outside the project: ${resolved}`);
  }
  return resolved;
}

function requireFile(relativeFile, checks) {
  const filePath = resolveProjectFile(relativeFile);
  if (!fs.existsSync(filePath)) throw new Error(`Missing required file: ${relativeFile}`);
  if (!fs.statSync(filePath).isFile()) throw new Error(`Expected a file but found another entry: ${relativeFile}`);
  checks.push({ assertion: "file exists", file: relativeFile });
  return filePath;
}

function readRequiredFile(relativeFile, checks) {
  return fs.readFileSync(requireFile(relativeFile, checks), "utf8");
}

function requireMatch(source, pattern, description, relativeFile, checks) {
  if (!pattern.test(source)) {
    throw new Error(`Missing ${description} in ${relativeFile}; expected pattern ${pattern}.`);
  }
  checks.push({ assertion: description, file: relativeFile });
}

function runBaseline() {
  const checks = [];
  const files = {
    uiSkin: "shared/cartridge/uiSkin.ts",
    sharedCommands: "shared/cartridge/types.ts",
    characterAnimation: "shared/animation/characterAnimation.ts",
    editorCommands: "editor/src/types/commands.ts",
    runtimeLayoutDesigner: "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
    backgroundEditor: "editor/src/components/command-editors/BackgroundCommandEditor.tsx",
    spriteEditor: "editor/src/components/command-editors/SpriteCommandEditor.tsx",
    gameCliCommands: "GameCli_framework/src/types/commands.ts",
    storyEngine: "GameCli_framework/src/engine/StoryEngine.ts",
    backgroundLayer: "GameCli_framework/src/components/player/BackgroundLayer.tsx",
    spriteLayer: "GameCli_framework/src/components/player/SpriteLayer.tsx",
    mainMenu: "GameCli_framework/src/components/shell/MainMenu.tsx",
    uiSkinRuntime: "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  };

  const uiSkin = readRequiredFile(files.uiSkin, checks);
  const customButtonOccurrences = uiSkin.match(/["']main_menu_custom_button["']/g) ?? [];
  if (customButtonOccurrences.length < 2) {
    throw new Error(
      `${files.uiSkin} must register main_menu_custom_button in both UILayoutComponentType and allowedComponentTypes; found ${customButtonOccurrences.length} occurrence(s).`,
    );
  }
  requireMatch(
    uiSkin,
    /export\s+type\s+UILayoutComponentType\s*=/,
    "shared UILayoutComponentType declaration",
    files.uiSkin,
    checks,
  );
  requireMatch(
    uiSkin,
    /const\s+allowedComponentTypes\s*:\s*UILayoutComponentType\[\]\s*=/,
    "shared allowedComponentTypes registry",
    files.uiSkin,
    checks,
  );
  checks.push({
    assertion: "main_menu_custom_button is present in the shared type union and validator registry",
    file: files.uiSkin,
  });

  for (const commandFile of [files.editorCommands, files.gameCliCommands]) {
    const source = readRequiredFile(commandFile, checks);
    requireMatch(source, /export\s+interface\s+BackgroundCommand\b/, "BackgroundCommand type", commandFile, checks);
    requireMatch(source, /export\s+interface\s+SpriteCommand\b/, "SpriteCommand type", commandFile, checks);
  }

  const runtimeEntries = [
    [files.backgroundLayer, /export\s+function\s+BackgroundLayer\b/, "BackgroundLayer runtime entry"],
    [files.spriteLayer, /export\s+function\s+SpriteLayer\b/, "SpriteLayer runtime entry"],
    [files.mainMenu, /export\s+function\s+MainMenu\b/, "MainMenu runtime entry"],
  ];
  for (const [relativeFile, pattern, description] of runtimeEntries) {
    const source = readRequiredFile(relativeFile, checks);
    requireMatch(source, pattern, description, relativeFile, checks);
  }

  for (const relativeFile of [
    files.sharedCommands,
    files.characterAnimation,
    files.runtimeLayoutDesigner,
    files.backgroundEditor,
    files.spriteEditor,
    files.storyEngine,
    files.uiSkinRuntime,
  ]) {
    requireFile(relativeFile, checks);
  }

  return {
    summary: `Verified ${Object.keys(files).length} core files and ${checks.length} baseline assertions.`,
    checks,
  };
}

function loadTypeScriptPublicApi(entrySource, virtualName) {
  const esbuild = require("../editor/node_modules/esbuild");
  const result = esbuild.buildSync({
    stdin: {
      contents: entrySource,
      loader: "ts",
      resolveDir: ROOT,
      sourcefile: virtualName,
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    write: false,
    logLevel: "silent",
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error(`esbuild produced no output for ${virtualName}.`);
  const compiled = new Module(path.join(ROOT, virtualName), module);
  compiled.filename = path.join(ROOT, virtualName);
  compiled.paths = Module._nodeModulePaths(ROOT);
  compiled._compile(output, compiled.filename);
  return compiled.exports;
}

function expect(condition, description, details = "") {
  if (!condition) {
    throw new Error(`${description}${details ? `; ${details}` : ""}`);
  }
}

function findTitleScreen(layout) {
  return layout.screens.find((screen) => screen.screen_id === "title");
}

function layoutWithCustomButton(getDefaultUISkinLayout, action) {
  const layout = JSON.parse(JSON.stringify(getDefaultUISkinLayout()));
  const titleScreen = findTitleScreen(layout);
  if (!titleScreen) throw new Error("Default UI skin is missing the title screen.");
  const component = {
    component_id: "title_custom_button_schema_acceptance",
    component_type: "main_menu_custom_button",
    label: "Official website",
    visible: true,
    rect: { x: 72, y: 84, width: 24, height: 7 },
  };
  if (action !== undefined) component.action = action;
  titleScreen.components.push(component);
  return layout;
}

function runCustomButtonSchema() {
  const checks = [];
  const uiSkinFile = "shared/cartridge/uiSkin.ts";
  const uiSkinSource = readRequiredFile(uiSkinFile, checks);
  requireMatch(
    uiSkinSource,
    /export\s+type\s+UILayoutActionKind\s*=\s*"none"\s*\|\s*"external_url"/,
    "UILayoutActionKind allows only none and external_url",
    uiSkinFile,
    checks,
  );
  requireMatch(
    uiSkinSource,
    /export\s+interface\s+UILayoutAction\s*\{[\s\S]*?kind:\s*UILayoutActionKind;[\s\S]*?url\?:\s*string;[\s\S]*?open_mode\?:\s*"system_browser";[\s\S]*?\}/,
    "UILayoutAction public type shape",
    uiSkinFile,
    checks,
  );
  requireMatch(
    uiSkinSource,
    /action\?:\s*UILayoutAction;/,
    "UILayoutComponent action extension point",
    uiSkinFile,
    checks,
  );

  const publicApi = loadTypeScriptPublicApi(
    [
      'export { normalizeExternalUrl, isSafeExternalUrl, validateExternalUrl } from "./shared/cartridge/externalAction";',
      'export { getDefaultUISkinLayout, validateUISkinLayout } from "./shared/cartridge/uiSkin";',
    ].join("\n"),
    "output/automated/client-experience-enhancement/custom-button-schema-entry.ts",
  );
  const {
    getDefaultUISkinLayout,
    isSafeExternalUrl,
    normalizeExternalUrl,
    validateExternalUrl,
    validateUISkinLayout,
  } = publicApi;

  for (const [name, value] of Object.entries({
    getDefaultUISkinLayout,
    isSafeExternalUrl,
    normalizeExternalUrl,
    validateExternalUrl,
    validateUISkinLayout,
  })) {
    expect(typeof value === "function", `Missing public function ${name}`);
  }

  expect(
    normalizeExternalUrl("  https://example.com/path?q=1  ") === "https://example.com/path?q=1",
    "normalizeExternalUrl must trim surrounding whitespace",
  );
  checks.push({ assertion: "external URL normalization trims whitespace", file: "shared/cartridge/externalAction.ts" });

  expect(
    normalizeExternalUrl("example.com") === "example.com",
    "normalizeExternalUrl must not guess a missing URL scheme",
  );
  checks.push({ assertion: "normalization does not guess a missing scheme", file: "shared/cartridge/externalAction.ts" });

  const safeUrls = ["https://example.com", "http://localhost:3000/path"];
  for (const url of safeUrls) {
    expect(isSafeExternalUrl(url) === true, `Expected safe external URL to pass: ${url}`);
    const helperResult = validateExternalUrl(url);
    expect(helperResult?.ok === true, `Expected validateExternalUrl to accept ${url}`, JSON.stringify(helperResult));
    const validation = validateUISkinLayout(
      layoutWithCustomButton(getDefaultUISkinLayout, {
        kind: "external_url",
        url,
        open_mode: "system_browser",
      }),
    );
    expect(validation.ok === true, `Expected UI skin validator to accept ${url}`, JSON.stringify(validation.errors));
    checks.push({ assertion: `safe external URL accepted: ${url}`, file: "shared/cartridge/uiSkin.ts" });
  }

  const unsafeUrls = [
    ["javascript:alert(1)", "external_url_unsupported_protocol"],
    ["data:text/html,<h1>unsafe</h1>", "external_url_unsupported_protocol"],
    ["file:///C:/unsafe.txt", "external_url_unsupported_protocol"],
    ["example.com/no-scheme", "external_url_invalid"],
  ];
  for (const [url, expectedCode] of unsafeUrls) {
    expect(isSafeExternalUrl(url) === false, `Expected unsafe external URL to fail: ${url}`);
    const helperResult = validateExternalUrl(url);
    expect(helperResult?.ok === false, `Expected validateExternalUrl to reject ${url}`, JSON.stringify(helperResult));
    expect(helperResult?.code === expectedCode, `Unexpected helper error code for ${url}`, JSON.stringify(helperResult));
    expect(
      typeof helperResult?.message === "string" && helperResult.message.length > 0,
      `Expected a stable helper error message for ${url}`,
      JSON.stringify(helperResult),
    );
    const validation = validateUISkinLayout(
      layoutWithCustomButton(getDefaultUISkinLayout, {
        kind: "external_url",
        url,
        open_mode: "system_browser",
      }),
    );
    expect(validation.ok === false, `Expected UI skin validator to reject ${url}`);
    expect(
      validation.errors.some((error) => error.code === expectedCode && error.path?.endsWith(".action.url")),
      `Expected ${expectedCode} at the action URL path for ${url}`,
      JSON.stringify(validation.errors),
    );
    checks.push({ assertion: `unsafe external URL rejected: ${url}`, file: "shared/cartridge/uiSkin.ts" });
  }

  const emptyHelperResult = validateExternalUrl("   ");
  expect(
    emptyHelperResult?.ok === false && emptyHelperResult.code === "external_url_required",
    "Empty external URL must return external_url_required",
    JSON.stringify(emptyHelperResult),
  );
  const emptyValidation = validateUISkinLayout(
    layoutWithCustomButton(getDefaultUISkinLayout, {
      kind: "external_url",
      url: "   ",
    }),
  );
  expect(emptyValidation.ok === false, "external_url action with an empty URL must fail");
  expect(
    emptyValidation.errors.some(
      (error) => error.code === "external_url_required" && error.path?.endsWith(".action.url"),
    ),
    "Empty external_url action must report external_url_required at action.url",
    JSON.stringify(emptyValidation.errors),
  );
  checks.push({ assertion: "external_url action requires a non-empty URL", file: "shared/cartridge/uiSkin.ts" });

  const unknownKindValidation = validateUISkinLayout(
    layoutWithCustomButton(getDefaultUISkinLayout, {
      kind: "run_script",
      url: "https://example.com",
    }),
  );
  expect(unknownKindValidation.ok === false, "Unknown action kinds must fail validation");
  expect(
    unknownKindValidation.errors.some(
      (error) => error.code === "ui_action_kind" && error.path?.endsWith(".action.kind"),
    ),
    "Unknown action kind must report ui_action_kind at action.kind",
    JSON.stringify(unknownKindValidation.errors),
  );
  checks.push({ assertion: "unknown action kind is rejected", file: "shared/cartridge/uiSkin.ts" });

  const invalidOpenModeValidation = validateUISkinLayout(
    layoutWithCustomButton(getDefaultUISkinLayout, {
      kind: "external_url",
      url: "https://example.com",
      open_mode: "embedded_webview",
    }),
  );
  expect(invalidOpenModeValidation.ok === false, "Unsupported external URL open mode must fail validation");
  expect(
    invalidOpenModeValidation.errors.some(
      (error) => error.code === "ui_action_open_mode" && error.path?.endsWith(".action.open_mode"),
    ),
    "Unsupported open mode must report ui_action_open_mode at action.open_mode",
    JSON.stringify(invalidOpenModeValidation.errors),
  );
  checks.push({ assertion: "unsupported external URL open mode is rejected", file: "shared/cartridge/uiSkin.ts" });

  const noneValidation = validateUISkinLayout(
    layoutWithCustomButton(getDefaultUISkinLayout, {
      kind: "none",
      url: "javascript:ignored()",
    }),
  );
  expect(noneValidation.ok === true, "none action must ignore an unused URL", JSON.stringify(noneValidation.errors));
  checks.push({ assertion: "none action ignores an unused URL", file: "shared/cartridge/uiSkin.ts" });

  const legacyValidation = validateUISkinLayout(getDefaultUISkinLayout());
  expect(legacyValidation.ok === true, "Legacy UI skin without action must remain valid", JSON.stringify(legacyValidation.errors));
  checks.push({ assertion: "legacy layout without action remains valid", file: "shared/cartridge/uiSkin.ts" });

  return {
    summary: `Verified ${checks.length} custom button action and external URL behaviors.`,
    checks,
  };
}

function runtimeScriptWithCommand(command) {
  return {
    schema_version: "1.0.0",
    game_id: "transition_schema_acceptance",
    title: "Transition schema acceptance",
    entry_scene_id: "scene_transition",
    characters: [],
    scenes: [
      {
        scene_id: "scene_transition",
        title: "Transition",
        summary: "Shared transition contract",
        chapter: 1,
        tags: ["acceptance"],
        commands: [command],
        is_ending: true,
      },
    ],
  };
}

function runTransitionSchema() {
  const checks = [];
  const commandFiles = [
    "shared/cartridge/types.ts",
    "editor/src/types/commands.ts",
    "GameCli_framework/src/types/commands.ts",
  ];
  for (const commandFile of commandFiles) {
    const source = readRequiredFile(commandFile, checks);
    requireMatch(
      source,
      /transition_config\?:\s*VisualTransitionConfig\s*\|\s*null/,
      "background transition_config command field",
      commandFile,
      checks,
    );
    requireMatch(
      source,
      /switch_transition\?:\s*VisualTransitionConfig\s*\|\s*null/,
      "sprite switch_transition command field",
      commandFile,
      checks,
    );
    requireMatch(source, /transition\?:\s*string\s*\|\s*null/, "legacy background transition field", commandFile, checks);
    requireMatch(source, /animation_config\?:\s*CharacterSpriteAnimationConfig\s*\|\s*null/, "legacy sprite animation_config field", commandFile, checks);
  }

  const publicApi = loadTypeScriptPublicApi(
    [
      "export * from './shared/animation/visualTransition';",
      "export { validateRuntimeScript } from './shared/cartridge/validators';",
    ].join("\n"),
    "output/automated/client-experience-enhancement/transition-schema-entry.ts",
  );
  const {
    DEFAULT_VISUAL_TRANSITION_CONFIG,
    MAX_VISUAL_TRANSITION_DURATION_MS,
    MIN_VISUAL_TRANSITION_DURATION_MS,
    VISUAL_TRANSITION_KINDS,
    mapLegacyBackgroundTransition,
    normalizeVisualTransition,
    sanitizeVisualTransitionEasing,
    validateRuntimeScript,
    validateVisualTransitionConfig,
  } = publicApi;

  for (const [name, value] of Object.entries({
    mapLegacyBackgroundTransition,
    normalizeVisualTransition,
    sanitizeVisualTransitionEasing,
    validateRuntimeScript,
    validateVisualTransitionConfig,
  })) {
    expect(typeof value === "function", `Missing public function ${name}`);
  }

  const expectedKinds = [
    "none",
    "fade",
    "crossfade",
    "reveal_center",
    "wipe_left_to_right",
    "wipe_right_to_left",
    "blur",
    "slide_left",
    "slide_right",
    "slide_up",
    "slide_down",
  ];
  expect(
    JSON.stringify(VISUAL_TRANSITION_KINDS) === JSON.stringify(expectedKinds),
    "Visual transition kind registry does not cover the planned effect family",
    JSON.stringify(VISUAL_TRANSITION_KINDS),
  );
  for (const kind of expectedKinds) {
    const normalized = normalizeVisualTransition({ kind });
    expect(normalized?.kind === kind, `Allowed transition kind failed normalization: ${kind}`, JSON.stringify(normalized));
  }
  checks.push({ assertion: "all planned transition kinds normalize", file: "shared/animation/visualTransition.ts" });

  expect(normalizeVisualTransition(undefined) === undefined, "Undefined transition must preserve no-explicit-animation semantics");
  expect(normalizeVisualTransition(null) === undefined, "Null transition must preserve no-explicit-animation semantics");
  checks.push({ assertion: "missing config preserves legacy instant behavior", file: "shared/animation/visualTransition.ts" });

  const invalidKind = normalizeVisualTransition({ kind: "spin_and_inject" });
  expect(
    invalidKind?.kind === DEFAULT_VISUAL_TRANSITION_CONFIG.kind,
    "Invalid kind must normalize to the documented fallback",
    JSON.stringify(invalidKind),
  );
  const invalidKindIssues = validateVisualTransitionConfig({ kind: "spin_and_inject" }, "transition");
  expect(
    invalidKindIssues.some((issue) => issue.code === "visual_transition_kind" && issue.path === "transition.kind"),
    "Strict validation must reject an invalid transition kind",
    JSON.stringify(invalidKindIssues),
  );
  checks.push({ assertion: "invalid kind has fallback and strict validation error", file: "shared/animation/visualTransition.ts" });

  const durationCases = [
    [{ kind: "crossfade", duration_ms: -50 }, MIN_VISUAL_TRANSITION_DURATION_MS],
    [{ kind: "crossfade", duration_ms: 20 }, MIN_VISUAL_TRANSITION_DURATION_MS],
    [{ kind: "crossfade", duration_ms: 25000 }, MAX_VISUAL_TRANSITION_DURATION_MS],
    [{ kind: "crossfade", duration_ms: Number.NaN }, DEFAULT_VISUAL_TRANSITION_CONFIG.duration_ms],
    [{ kind: "crossfade", duration_ms: "900" }, DEFAULT_VISUAL_TRANSITION_CONFIG.duration_ms],
    [{ kind: "none", duration_ms: 900 }, 0],
  ];
  for (const [input, expectedDuration] of durationCases) {
    const normalized = normalizeVisualTransition(input);
    expect(
      normalized?.duration_ms === expectedDuration,
      "Transition duration normalization is unstable",
      `input=${JSON.stringify(input)} output=${JSON.stringify(normalized)} expected=${expectedDuration}`,
    );
  }
  const durationIssues = [
    ...validateVisualTransitionConfig({ kind: "crossfade", duration_ms: -1 }, "transition"),
    ...validateVisualTransitionConfig({ kind: "crossfade", duration_ms: 10001 }, "transition"),
    ...validateVisualTransitionConfig({ kind: "crossfade", duration_ms: "900" }, "transition"),
  ];
  expect(
    durationIssues.filter((issue) => issue.code === "visual_transition_duration").length === 3,
    "Strict validation must reject out-of-range and non-number durations",
    JSON.stringify(durationIssues),
  );
  checks.push({ assertion: "duration clamps and invalid values have stable behavior", file: "shared/animation/visualTransition.ts" });

  for (const easing of ["linear", "ease", "ease-in", "ease-out", "ease-in-out"]) {
    expect(sanitizeVisualTransitionEasing(easing) === easing, `Safe easing was not preserved: ${easing}`);
  }
  const bezier = "cubic-bezier(0.4, 0, 0.2, 1)";
  expect(sanitizeVisualTransitionEasing(bezier) === bezier, "Safe cubic-bezier easing must be preserved");
  checks.push({ assertion: "safe preset and cubic-bezier easing values pass", file: "shared/animation/visualTransition.ts" });

  for (const easing of [
    "ease; color: red",
    "ease-in-out } body { display:none",
    "url(https://example.com/easing)",
    "cubic-bezier(2, 0, 0.2, 1)",
  ]) {
    expect(
      sanitizeVisualTransitionEasing(easing) === DEFAULT_VISUAL_TRANSITION_CONFIG.easing,
      `Unsafe easing must fall back: ${easing}`,
    );
    const easingIssues = validateVisualTransitionConfig({ kind: "crossfade", easing }, "transition");
    expect(
      easingIssues.some((issue) => issue.code === "visual_transition_easing" && issue.path === "transition.easing"),
      `Unsafe easing must fail strict validation: ${easing}`,
      JSON.stringify(easingIssues),
    );
  }
  checks.push({ assertion: "CSS injection and unsafe easing values are rejected", file: "shared/animation/visualTransition.ts" });

  const legacyMappings = [
    ["fade", "fade"],
    ["crossfade", "crossfade"],
    ["slide_left", "slide_left"],
    ["slide-right", "slide_right"],
    ["left_to_right", "wipe_left_to_right"],
    ["right_to_left", "wipe_right_to_left"],
    ["center", "reveal_center"],
    ["blur", "blur"],
  ];
  for (const [legacy, expectedKind] of legacyMappings) {
    const mapped = mapLegacyBackgroundTransition(legacy);
    expect(mapped?.kind === expectedKind, `Legacy transition did not map: ${legacy}`, JSON.stringify(mapped));
  }
  expect(mapLegacyBackgroundTransition("unknown_transition") === undefined, "Unknown legacy transition must not invent animation");
  checks.push({ assertion: "legacy background transitions map deterministically", file: "shared/animation/visualTransition.ts" });

  const validBackgroundScript = validateRuntimeScript(
    runtimeScriptWithCommand({
      type: "background",
      background_id: "bg",
      transition: "fade",
      transition_config: { kind: "reveal_center", duration_ms: 420, easing: bezier },
    }),
  );
  expect(validBackgroundScript.ok === true, "Valid background transition_config must pass script validation", JSON.stringify(validBackgroundScript.errors));

  const invalidBackgroundScript = validateRuntimeScript(
    runtimeScriptWithCommand({
      type: "background",
      background_id: "bg",
      transition_config: { kind: "crossfade", duration_ms: 15, easing: "url(evil)" },
    }),
  );
  expect(invalidBackgroundScript.ok === false, "Invalid background transition_config must fail script validation");
  expect(
    invalidBackgroundScript.errors.some((issue) => issue.code === "visual_transition_duration"),
    "Background transition duration error missing",
    JSON.stringify(invalidBackgroundScript.errors),
  );
  expect(
    invalidBackgroundScript.errors.some((issue) => issue.code === "visual_transition_easing"),
    "Background transition easing error missing",
    JSON.stringify(invalidBackgroundScript.errors),
  );

  const invalidSpriteScript = validateRuntimeScript(
    runtimeScriptWithCommand({
      type: "sprite",
      character_id: "hero",
      sprite_id: "hero_default",
      visible: true,
      animation: "fade_in",
      animation_config: null,
      switch_transition: { kind: "unknown" },
    }),
  );
  expect(invalidSpriteScript.ok === false, "Invalid sprite switch_transition must fail script validation");
  expect(
    invalidSpriteScript.errors.some(
      (issue) => issue.code === "visual_transition_kind" && issue.path?.endsWith(".switch_transition.kind"),
    ),
    "Sprite switch transition kind error missing",
    JSON.stringify(invalidSpriteScript.errors),
  );
  checks.push({ assertion: "runtime script validator consumes both new transition fields", file: "shared/cartridge/validators.ts" });

  return {
    summary: `Verified ${checks.length} shared visual transition schema assertions.`,
    checks,
  };
}

function runCustomButtonCreate() {
  const checks = [];
  const helperFile = "scripts/client-experience-custom-button-create-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Playwright helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }

  const reportFile = "output/playwright/client-experience-enhancement/custom-button-create/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Custom button create Playwright report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 10, "Playwright report has insufficient behavior checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));
  return {
    summary: `Verified ${report.checks.length} real editor interactions with Playwright.`,
    checks,
  };
}

function runCustomButtonEdit() {
  const checks = [];
  const designerFile = "editor/src/components/advanced/RuntimeLayoutDesigner.tsx";
  const designerSource = readRequiredFile(designerFile, checks);
  requireMatch(
    designerSource,
    /from\s+["'][^"']*shared\/cartridge\/externalAction["']/,
    "custom button URL editor imports the shared external action module",
    designerFile,
    checks,
  );
  requireMatch(
    designerSource,
    /validateExternalUrl\(selected\.action\.url\)/,
    "URL field and test action consume validateExternalUrl",
    designerFile,
    checks,
  );
  requireMatch(
    designerSource,
    /navigator\.clipboard\.writeText\(testedUrl\)/,
    "validated test URL uses the safe clipboard fallback",
    designerFile,
    checks,
  );
  if (/window\.open\(/.test(designerSource)) {
    throw new Error(`${designerFile} must not directly open custom button URLs with window.open.`);
  }
  checks.push({
    assertion: "custom button URL editor has no direct window.open fallback",
    file: designerFile,
  });

  const helperFile = "scripts/client-experience-custom-button-create-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath, "--edit"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Custom button edit Playwright helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }

  const reportFile = "output/playwright/client-experience-enhancement/custom-button-edit/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Custom button edit Playwright report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 24, "Edit Playwright report has insufficient behavior checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));
  return {
    summary: `Verified ${report.checks.length} create/edit/delete interactions with Playwright.`,
    checks,
  };
}

function runCustomButtonExistingImage() {
  const checks = [];
  const publicApi = loadTypeScriptPublicApi(
    [
      "export * from './shared/cartridge/uiAssetReference';",
      "export { getDefaultUISkinLayout, validateUISkinHealth, validateUISkinLayout } from './shared/cartridge/uiSkin';",
    ].join("\n"),
    "output/automated/client-experience-enhancement/custom-button-existing-image-entry.ts",
  );
  const {
    assetIdFromUILayoutReference,
    getDefaultUISkinLayout,
    toUILayoutAssetReference,
    validateUISkinHealth,
    validateUISkinLayout,
  } = publicApi;
  const stableReference = toUILayoutAssetReference("ui_button_art");
  expect(stableReference === "asset:ui_button_art", "Stable UI asset reference must use asset:<id>", stableReference);
  expect(
    assetIdFromUILayoutReference(stableReference) === "ui_button_art",
    "Stable UI asset reference must round-trip its asset id",
  );
  const stableLayout = getDefaultUISkinLayout();
  const titleScreen = findTitleScreen(stableLayout);
  expect(Boolean(titleScreen), "Default UI skin is missing the title screen");
  titleScreen.components.push({
    component_id: "title_custom_button_existing_image_contract",
    component_type: "main_menu_custom_button",
    label: "Official",
    visible: true,
    rect: { x: 6, y: 84, width: 20, height: 7 },
    style: { backgroundImage: stableReference },
  });
  const schemaValidation = validateUISkinLayout(stableLayout);
  expect(schemaValidation.ok === true, "asset:<id> background references must pass UI skin validation", JSON.stringify(schemaValidation.errors));
  const knownAssetHealth = validateUISkinHealth(stableLayout, { availableAssetIds: ["ui_button_art"] });
  expect(
    !knownAssetHealth.warnings.some((warning) => warning.code === "ui_missing_background_asset"),
    "Known asset:<id> reference must not produce a missing-asset warning",
    JSON.stringify(knownAssetHealth.warnings),
  );
  const missingAssetHealth = validateUISkinHealth(stableLayout, { availableAssetIds: [] });
  expect(
    missingAssetHealth.warnings.some(
      (warning) => warning.code === "ui_missing_background_asset"
        && warning.path?.endsWith(".style.backgroundImage"),
    ),
    "Missing asset:<id> reference must produce a stable health warning",
    JSON.stringify(missingAssetHealth.warnings),
  );
  const unsafeLayout = JSON.parse(JSON.stringify(stableLayout));
  const unsafeTitleScreen = findTitleScreen(unsafeLayout);
  unsafeTitleScreen.components.at(-1).style.backgroundImage = "blob:https://editor.invalid/temporary";
  const unsafeValidation = validateUISkinLayout(unsafeLayout);
  expect(
    unsafeValidation.errors.some((error) => error.code === "ui_background_image"),
    "blob: references must not be accepted as persisted UI skin image references",
    JSON.stringify(unsafeValidation.errors),
  );
  checks.push(
    { assertion: "asset:<id> references round-trip through the shared helper", file: "shared/cartridge/uiAssetReference.ts" },
    { assertion: "UI skin schema accepts stable references and rejects blob: persistence", file: "shared/cartridge/uiSkin.ts" },
    { assertion: "UI skin health distinguishes known and missing asset ids", file: "shared/cartridge/uiSkin.ts" },
  );

  const helperFile = "scripts/client-experience-custom-button-create-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath, "--existing-image"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Custom button existing-image Playwright helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }

  const reportFile = "output/playwright/client-experience-enhancement/custom-button-existing-image/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Custom button existing-image Playwright report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 8, "Existing-image Playwright report has insufficient behavior checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));
  return {
    summary: `Verified ${report.checks.length} existing-image interactions with Playwright.`,
    checks,
  };
}

function runCustomButtonImageImport() {
  const checks = [];
  const publicApi = loadTypeScriptPublicApi(
    "export * from './editor/src/utils/projectAssets';",
    "output/automated/client-experience-enhancement/custom-button-image-import-entry.ts",
  );
  const {
    MAX_IMPORTED_UI_IMAGE_BYTES,
    createImportedUIImageAsset,
    validateImportedUIImageFile,
  } = publicApi;
  expect(typeof createImportedUIImageAsset === "function", "Missing createImportedUIImageAsset helper");
  expect(typeof validateImportedUIImageFile === "function", "Missing validateImportedUIImageFile helper");
  for (const [name, type] of [
    ["button.png", "image/png"],
    ["button.jpg", "image/jpeg"],
    ["button.webp", "image/webp"],
    ["button.gif", "image/gif"],
  ]) {
    const validation = validateImportedUIImageFile({ name, type, size: 128 });
    expect(validation.ok === true, `Expected supported button image to pass: ${name}`, JSON.stringify(validation));
  }
  expect(
    validateImportedUIImageFile({ name: "button.png", type: "", size: 128 }).ok === true,
    "Missing browser MIME type must be inferred from a supported extension",
  );
  for (const descriptor of [
    { name: "button.svg", type: "image/svg+xml", size: 128, code: "unsupported_extension" },
    { name: "button.png", type: "text/plain", size: 128, code: "unsupported_mime_type" },
    { name: "button.png", type: "image/png", size: MAX_IMPORTED_UI_IMAGE_BYTES + 1, code: "file_too_large" },
    { name: "button.png", type: "image/png", size: 0, code: "empty_file" },
  ]) {
    const validation = validateImportedUIImageFile(descriptor);
    expect(
      validation.ok === false && validation.code === descriptor.code,
      `Expected stable image import rejection ${descriptor.code}`,
      JSON.stringify(validation),
    );
  }
  const createdAsset = createImportedUIImageAsset(
    { name: "button-art.png", type: "image/png", size: 128 },
    "data:image/png;base64,AA==",
    new Set(["button-art"]),
    "2026-07-10T00:00:00.000Z",
  );
  expect(createdAsset.asset_id === "button-art_2", "Duplicate asset id must receive a stable suffix", JSON.stringify(createdAsset));
  expect(createdAsset.asset_type === "ui", "Imported button image must use ui asset type", JSON.stringify(createdAsset));
  expect(createdAsset.metadata.project_path === "assets/ui/button-art_2-button-art.png", "Imported image project path must use assets/ui/", JSON.stringify(createdAsset));
  expect(createdAsset.metadata.data_url === "data:image/png;base64,AA==", "Imported image must keep its data URL", JSON.stringify(createdAsset));
  expect(!createdAsset.metadata.filePath && !createdAsset.metadata.path, "Imported image must not store a local filesystem path", JSON.stringify(createdAsset));
  checks.push(
    { assertion: "PNG, JPEG, WebP, and GIF validation uses stable MIME/extension rules", file: "editor/src/utils/projectAssets.ts" },
    { assertion: "SVG, mismatched MIME, empty, and oversized files are rejected with stable codes", file: "editor/src/utils/projectAssets.ts" },
    { assertion: "import helper creates a unique ui AssetRef under assets/ui without local paths", file: "editor/src/utils/projectAssets.ts" },
  );

  const exportHelperFile = "scripts/client-experience-image-import-export-check.cjs";
  const exportHelperPath = requireFile(exportHelperFile, checks);
  const exportResult = spawnSync(process.execPath, [exportHelperPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (exportResult.stdout) process.stdout.write(exportResult.stdout);
  if (exportResult.stderr) process.stderr.write(exportResult.stderr);
  if (exportResult.error) throw exportResult.error;
  if (exportResult.status !== 0) {
    throw new Error(
      `Image-import export helper failed with exit ${String(exportResult.status)}.`
      + ` stdout=${JSON.stringify((exportResult.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((exportResult.stderr || "").slice(-3000))}`,
    );
  }
  checks.push({
    assertion: "preview export includes imported data-url bytes at the assets/ui project path",
    file: "editor/src/cartridge/exportCartridge.ts",
  });

  const helperFile = "scripts/client-experience-custom-button-create-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath, "--image-import"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Custom button image-import Playwright helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }

  const reportFile = "output/playwright/client-experience-enhancement/custom-button-image-import/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Custom button image-import Playwright report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 8, "Image-import Playwright report has insufficient behavior checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));
  return {
    summary: `Verified ${report.checks.length} direct image-import interactions with Playwright.`,
    checks,
  };
}

function runCustomButtonContainer() {
  const checks = [];
  const helperFile = "scripts/client-experience-custom-button-create-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath, "--container"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Custom button container Playwright helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }

  const reportFile = "output/playwright/client-experience-enhancement/custom-button-container/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Custom button container Playwright report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 8, "Container Playwright report has insufficient behavior checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));
  return {
    summary: `Verified ${report.checks.length} custom-button container interactions with Playwright.`,
    checks,
  };
}

function runCustomButtonPersist() {
  const checks = [];
  const dataflowFile = "scripts/ui-designer-dataflow-acceptance.cjs";
  const dataflowPath = requireFile(dataflowFile, checks);
  const dataflowResult = spawnSync(process.execPath, [dataflowPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (dataflowResult.stdout) process.stdout.write(dataflowResult.stdout);
  if (dataflowResult.stderr) process.stderr.write(dataflowResult.stderr);
  if (dataflowResult.error) throw dataflowResult.error;
  if (dataflowResult.status !== 0) {
    throw new Error(`UI designer dataflow acceptance failed with exit ${String(dataflowResult.status)}.`);
  }
  checks.push({
    assertion: "projectStore/editorStore serialization dataflow preserves custom button fields",
    file: dataflowFile,
  });

  const helperFile = "scripts/client-experience-custom-button-create-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath, "--persist"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Custom button persistence Playwright helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }

  const reportFile = "output/playwright/client-experience-enhancement/custom-button-persist/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Custom button persistence Playwright report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 10, "Persistence Playwright report has insufficient behavior checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));
  return {
    summary: `Verified ${report.checks.length} save/reopen/undo/redo interactions with Playwright.`,
    checks,
  };
}

function runCustomButtonExport() {
  const checks = [];
  const helperFile = "scripts/client-experience-custom-button-export-check.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Custom button export/import helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }
  const reportFile = "output/automated/client-experience-enhancement/custom-button-export/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Custom button export report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 4, "Custom button export report has insufficient checks");
  checks.push(...report.checks.map((assertion) => ({ assertion, file: helperFile })));
  return {
    summary: `Verified ${report.checks.length} archive/export/GameCli import behaviors.`,
    checks,
  };
}

function runCustomButtonRuntimeRender() {
  const checks = [];
  const assetResolverFile = "GameCli_framework/src/utils/uiLayoutAssetUrl.ts";
  const runtimeFile = "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx";
  const mainMenuFile = "GameCli_framework/src/components/shell/MainMenu.tsx";
  const assetResolverSource = readRequiredFile(assetResolverFile, checks);
  const runtimeSource = readRequiredFile(runtimeFile, checks);
  const mainMenuSource = readRequiredFile(mainMenuFile, checks);
  requireMatch(
    assetResolverSource,
    /export\s+function\s+resolveUILayoutAssetUrl\s*\(/,
    "single runtime resolver for UI layout asset references",
    assetResolverFile,
    checks,
  );
  requireMatch(
    runtimeSource,
    /resolveUILayoutAssetUrl\(/,
    "runtime component styles use the safe UI asset resolver",
    runtimeFile,
    checks,
  );
  requireMatch(
    runtimeSource,
    /export\s+function\s+useUILayoutComponents\s*\(/,
    "runtime hook for ordered multi-component layout lookup",
    runtimeFile,
    checks,
  );
  requireMatch(
    mainMenuSource,
    /useUILayoutComponents\(\s*"title"\s*,\s*"main_menu_custom_button"\s*\)/,
    "MainMenu requests all custom title buttons",
    mainMenuFile,
    checks,
  );
  requireMatch(
    mainMenuSource,
    /data-testid="custom-title-button"/,
    "stable custom title button test id",
    mainMenuFile,
    checks,
  );
  requireMatch(
    mainMenuSource,
    /data-ui-component-id=\{component\.component_id\}/,
    "custom title button exposes its stable component id",
    mainMenuFile,
    checks,
  );

  const helperFile = "scripts/client-experience-custom-button-runtime-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Custom button runtime Playwright helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }
  const reportFile = "output/playwright/client-experience-enhancement/custom-button-runtime-render/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Custom button runtime Playwright report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 18, "Runtime Playwright report has insufficient behavior checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));
  return {
    summary: `Verified ${report.checks.length} custom-button rendering behaviors with Playwright.`,
    checks,
  };
}

function runCustomButtonRuntimeLink() {
  const checks = [];
  const adapterFile = "GameCli_framework/src/utils/openExternalUrl.ts";
  const mainMenuFile = "GameCli_framework/src/components/shell/MainMenu.tsx";
  const packageFile = "GameCli_framework/package.json";
  const cargoFile = "GameCli_framework/src-tauri/Cargo.toml";
  const rustFile = "GameCli_framework/src-tauri/src/lib.rs";
  const capabilityFile = "GameCli_framework/src-tauri/capabilities/default.json";
  const adapterSource = readRequiredFile(adapterFile, checks);
  const mainMenuSource = readRequiredFile(mainMenuFile, checks);
  const packageSource = readRequiredFile(packageFile, checks);
  const cargoSource = readRequiredFile(cargoFile, checks);
  const rustSource = readRequiredFile(rustFile, checks);
  const capabilitySource = readRequiredFile(capabilityFile, checks);
  requireMatch(
    adapterSource,
    /validateExternalUrl\(/,
    "runtime external opener validates through the shared URL helper",
    adapterFile,
    checks,
  );
  requireMatch(
    adapterSource,
    /window\.open\([^,]+,\s*["_']_blank["_']\s*,\s*["_']noopener,noreferrer["_']\)/,
    "web opener requests noopener and noreferrer",
    adapterFile,
    checks,
  );
  requireMatch(
    adapterSource,
    /openUrl\(/,
    "desktop opener delegates to Tauri plugin-opener openUrl",
    adapterFile,
    checks,
  );
  requireMatch(
    mainMenuSource,
    /executeUILayoutAction\(/,
    "custom title buttons delegate actions to the safe adapter",
    mainMenuFile,
    checks,
  );
  requireMatch(packageSource, /"@tauri-apps\/plugin-opener"/, "Tauri opener JavaScript dependency", packageFile, checks);
  requireMatch(cargoSource, /tauri-plugin-opener\s*=/, "Tauri opener Rust dependency", cargoFile, checks);
  requireMatch(rustSource, /\.plugin\(tauri_plugin_opener::init\(\)\)/, "Tauri opener plugin initialization", rustFile, checks);
  requireMatch(capabilitySource, /"opener:default"/, "Tauri default URL opener capability", capabilityFile, checks);

  const helperFile = "scripts/client-experience-custom-button-runtime-link-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Custom button runtime-link Playwright helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }
  const reportFile = "output/playwright/client-experience-enhancement/custom-button-runtime-link/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Custom button runtime-link Playwright report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 12, "Runtime-link Playwright report has insufficient behavior checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));
  return {
    summary: `Verified ${report.checks.length} safe external-link behaviors with Playwright.`,
    checks,
  };
}

function runCustomButtonResponsive() {
  const checks = [];
  const uiSkinFile = "shared/cartridge/uiSkin.ts";
  const shellCssFile = "GameCli_framework/src/styles/shell.css";
  const uiSkinSource = readRequiredFile(uiSkinFile, checks);
  const shellCssSource = readRequiredFile(shellCssFile, checks);
  requireMatch(
    uiSkinSource,
    /ui_custom_button_overlap/,
    "UI health warning for overlapping custom title buttons",
    uiSkinFile,
    checks,
  );
  requireMatch(
    shellCssSource,
    /\.custom-title-button[\s\S]*?min-height:\s*var\(--runtime-touch-size/,
    "custom title buttons use the runtime touch target token",
    shellCssFile,
    checks,
  );

  const publicApi = loadTypeScriptPublicApi(
    "export { getDefaultUISkinLayout, validateUISkinHealth } from './shared/cartridge/uiSkin';",
    "output/automated/client-experience-enhancement/custom-button-responsive-entry.ts",
  );
  const layout = publicApi.getDefaultUISkinLayout();
  const title = layout.screens.find((screen) => screen.screen_id === "title");
  expect(Boolean(title), "Default UI skin is missing title screen");
  title.components.push(
    {
      component_id: "responsive_overlap_a",
      component_type: "main_menu_custom_button",
      label: "Overlap A",
      visible: true,
      rect: { x: 5, y: 86, width: 22, height: 8 },
      mobileRect: { x: 5, y: 86, width: 42, height: 8 },
    },
    {
      component_id: "responsive_overlap_b",
      component_type: "main_menu_custom_button",
      label: "Overlap B",
      visible: true,
      rect: { x: 8, y: 87, width: 22, height: 8 },
      mobileRect: { x: 8, y: 87, width: 42, height: 8 },
    },
    {
      component_id: "responsive_fixed_overlap",
      component_type: "main_menu_custom_button",
      label: "Fixed overlap",
      visible: true,
      rect: { x: 78, y: 76, width: 18, height: 7 },
      mobileRect: { x: 7, y: 84, width: 86, height: 7 },
    },
  );
  const health = publicApi.validateUISkinHealth(layout);
  expect(
    health.warnings.some((warning) => warning.code === "ui_custom_button_overlap"),
    "Overlapping custom title buttons must produce a deterministic UI health warning",
    JSON.stringify(health.warnings),
  );
  checks.push({
    assertion: "overlapping custom title buttons produce an editor-visible health warning",
    file: uiSkinFile,
  });
  expect(
    health.warnings.some((warning) => (
      warning.code === "ui_custom_button_overlap"
      && warning.path?.includes("responsive_fixed_overlap")
      && warning.path?.includes("title_about_button")
    )),
    "A custom title button overlapping a visible fixed title action must produce a deterministic UI health warning",
    JSON.stringify(health.warnings),
  );
  checks.push({
    assertion: "custom buttons overlapping visible fixed title actions produce an editor-visible health warning",
    file: uiSkinFile,
  });

  const helperFile = "scripts/client-experience-custom-button-responsive-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Custom button responsive Playwright helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }
  const reportFile = "output/playwright/client-experience-enhancement/custom-button-responsive/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Custom button responsive Playwright report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 12, "Responsive Playwright report has insufficient behavior checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));
  return {
    summary: `Verified ${report.checks.length} responsive and accessibility behaviors with Playwright.`,
    checks,
  };
}

function runBackgroundTransitionEditor() {
  const checks = [];
  const controlsFile = "editor/src/components/command-editors/VisualTransitionControls.tsx";
  const backgroundEditorFile = "editor/src/components/command-editors/BackgroundCommandEditor.tsx";
  const controlsSource = readRequiredFile(controlsFile, checks);
  const backgroundEditorSource = readRequiredFile(backgroundEditorFile, checks);
  requireMatch(
    controlsSource,
    /resolveVisualTransition|mapLegacyBackgroundTransition/,
    "visual transition controls resolve structured and legacy background settings",
    controlsFile,
    checks,
  );
  requireMatch(
    controlsSource,
    /parseVisualTransitionEasing/,
    "visual transition controls validate easing through the shared safe parser",
    controlsFile,
    checks,
  );
  requireMatch(
    backgroundEditorSource,
    /<VisualTransitionControls[\s\S]*?transition_config/,
    "background command editor binds the reusable controls to transition_config",
    backgroundEditorFile,
    checks,
  );

  const helperFile = "scripts/client-experience-background-transition-editor-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Background-transition editor Playwright helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }
  const reportFile = "output/playwright/client-experience-enhancement/background-transition-editor/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Background-transition editor Playwright report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 12, "Background-transition Playwright report has insufficient behavior checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));
  return {
    summary: `Verified ${report.checks.length} background-transition editor behaviors with Playwright.`,
    checks,
  };
}

function runSpriteTransitionEditor() {
  const checks = [];
  const controlsFile = "editor/src/components/command-editors/VisualTransitionControls.tsx";
  const spriteEditorFile = "editor/src/components/command-editors/SpriteCommandEditor.tsx";
  const controlsSource = readRequiredFile(controlsFile, checks);
  const spriteEditorSource = readRequiredFile(spriteEditorFile, checks);
  requireMatch(
    controlsSource,
    /disabledReason|contextHint/,
    "visual transition controls expose contextual disabled and guidance states",
    controlsFile,
    checks,
  );
  requireMatch(
    spriteEditorSource,
    /<VisualTransitionControls[\s\S]*?switch_transition/,
    "sprite command editor binds replacement controls to switch_transition",
    spriteEditorFile,
    checks,
  );
  requireMatch(
    spriteEditorSource,
    /animation_config[\s\S]*?switch_transition|switch_transition[\s\S]*?animation_config/,
    "sprite editor keeps entry-exit animation and replacement transition concepts separate",
    spriteEditorFile,
    checks,
  );

  const helperFile = "scripts/client-experience-sprite-transition-editor-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Sprite-transition editor Playwright helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }
  const reportFile = "output/playwright/client-experience-enhancement/sprite-transition-editor/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Sprite-transition editor Playwright report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 14, "Sprite-transition Playwright report has insufficient behavior checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));
  return {
    summary: `Verified ${report.checks.length} sprite-transition editor behaviors with Playwright.`,
    checks,
  };
}

function runTransitionPersist() {
  const checks = [];
  const helperFile = "scripts/client-experience-transition-persist-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Transition persistence Playwright helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }
  const reportFile = "output/playwright/client-experience-enhancement/transition-persist/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Transition persistence Playwright report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 16, "Transition persistence report has insufficient behavior checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));
  return {
    summary: `Verified ${report.checks.length} transition persistence/export behaviors with Playwright.`,
    checks,
  };
}

function runBackgroundTransitionEngine() {
  const checks = [];
  const helperFile = "scripts/client-experience-background-transition-runtime-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath, "--engine-only"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, AGENTVN_BACKGROUND_TRANSITION_PORT: "6993" },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Background-transition runtime helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }
  const reportFile = "output/playwright/client-experience-enhancement/background-transition-runtime/engine-report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Background-transition engine report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 12, "Background-transition engine report has insufficient checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));
  return {
    summary: `Verified ${report.checks.length} background-transition engine/browser behaviors.`,
    checks,
  };
}

function runBackgroundTransitionRuntime() {
  const checks = [];
  const helperFile = "scripts/client-experience-background-transition-runtime-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  let result;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = spawnSync(process.execPath, [helperPath], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, AGENTVN_BACKGROUND_TRANSITION_PORT: attempt === 0 ? "6995" : "7005" },
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.status === 0 || result.error) break;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Background-transition runtime helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }

  const reportFile = "output/playwright/client-experience-enhancement/background-transition-runtime/runtime-report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Background-transition runtime report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 24, "Background-transition runtime report has insufficient checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));

  const layerFile = "GameCli_framework/src/components/player/BackgroundLayer.tsx";
  const cssFile = "GameCli_framework/src/styles/player.css";
  const layerSource = readRequiredFile(layerFile, checks);
  const cssSource = readRequiredFile(cssFile, checks);
  requireMatch(layerSource, /background-transition-frame/, "BackgroundLayer renders explicit transition frames", layerFile, checks);
  requireMatch(layerSource, /onAnimationEnd/, "BackgroundLayer cleans transitions from animation completion", layerFile, checks);
  requireMatch(layerSource, /window\.setTimeout/, "BackgroundLayer has a fallback cleanup timer", layerFile, checks);
  requireMatch(cssSource, /--visual-transition-duration/, "background transition duration uses a CSS variable", cssFile, checks);
  requireMatch(cssSource, /--visual-transition-easing/, "background transition easing uses a CSS variable", cssFile, checks);
  requireMatch(cssSource, /transition-reveal_center/, "center reveal has a runtime CSS implementation", cssFile, checks);
  requireMatch(cssSource, /transition-wipe_left_to_right/, "left-to-right wipe has a runtime CSS implementation", cssFile, checks);
  requireMatch(cssSource, /transition-wipe_right_to_left/, "right-to-left wipe has a runtime CSS implementation", cssFile, checks);
  requireMatch(cssSource, /transition-blur/, "blur has a runtime CSS implementation", cssFile, checks);

  return {
    summary: `Verified ${report.checks.length} double-layer background transition behaviors.`,
    checks,
  };
}

function runBackgroundTransitionInterruption() {
  const checks = [];
  const helperFile = "scripts/client-experience-background-transition-runtime-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  let result;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = spawnSync(process.execPath, [helperPath, "--interruption"], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, AGENTVN_BACKGROUND_TRANSITION_PORT: attempt === 0 ? "6996" : "7006" },
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.status === 0 || result.error) break;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Background-transition interruption helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }

  const reportFile = "output/playwright/client-experience-enhancement/background-transition-runtime/interruption-report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Background-transition interruption report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 25, "Background-transition interruption report has insufficient checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));

  const layerFile = "GameCli_framework/src/components/player/BackgroundLayer.tsx";
  const layerSource = readRequiredFile(layerFile, checks);
  requireMatch(layerSource, /generation/, "background presentation uses a local transition generation", layerFile, checks);
  requireMatch(layerSource, /visibilitychange/, "background cleanup reacts to browser visibility restoration", layerFile, checks);
  requireMatch(layerSource, /addEventListener\(\s*"focus"/, "background cleanup reacts to window focus restoration", layerFile, checks);
  requireMatch(layerSource, /window\.clearTimeout/, "background cleanup cancels fallback timers", layerFile, checks);

  return {
    summary: `Verified ${report.checks.length} rapid background replacement and cleanup behaviors.`,
    checks,
  };
}

function runSpriteTransitionEngine() {
  const checks = [];
  const helperFile = "scripts/client-experience-sprite-transition-runtime-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath, "--engine-only"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Sprite-transition engine helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }

  const reportFile = "output/playwright/client-experience-enhancement/sprite-transition-runtime/engine-report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Sprite-transition engine report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 16, "Sprite-transition engine report has insufficient checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));

  const settingsFile = "GameCli_framework/src/types/settings.ts";
  const engineFile = "GameCli_framework/src/engine/StoryEngine.ts";
  const settingsSource = readRequiredFile(settingsFile, checks);
  const engineSource = readRequiredFile(engineFile, checks);
  requireMatch(settingsSource, /interface\s+SpriteReplacementState/, "runtime sprite replacement metadata type", settingsFile, checks);
  requireMatch(engineSource, /resolveVisualTransition\(\s*command\.switch_transition/, "StoryEngine normalizes sprite switch_transition", engineFile, checks);
  requireMatch(engineSource, /previous_sprite_id/, "StoryEngine preserves the outgoing sprite id", engineFile, checks);
  requireMatch(engineSource, /stripSpriteReplacement/, "save and restore strip transient sprite replacement metadata", engineFile, checks);

  return {
    summary: `Verified ${report.checks.length} sprite-transition engine/browser behaviors.`,
    checks,
  };
}

function runSpriteLayerOrder() {
  const checks = [];
  const helperFile = "scripts/client-experience-sprite-layer-order-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Sprite-layer-order helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }

  const reportFile = "output/playwright/client-experience-enhancement/sprite-layer-order/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Sprite-layer-order report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 24, "Sprite-layer-order report has insufficient checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));

  const files = [
    "shared/cartridge/types.ts",
    "editor/src/types/commands.ts",
    "GameCli_framework/src/types/commands.ts",
  ];
  for (const file of files) {
    const source = readRequiredFile(file, checks);
    requireMatch(source, /layer\?:\s*number\s*\|\s*null/, "sprite command exposes optional numeric layer", file, checks);
  }
  const editorFile = "editor/src/components/command-editors/SpriteCommandEditor.tsx";
  const editorSource = readRequiredFile(editorFile, checks);
  requireMatch(editorSource, /data-help-key="command\.sprite\.layer"/, "sprite editor exposes the layer control", editorFile, checks);
  requireMatch(editorSource, /MIN_SPRITE_LAYER[\s\S]*MAX_SPRITE_LAYER/, "sprite editor uses shared layer bounds", editorFile, checks);

  return {
    summary: `Verified ${report.checks.length} sprite layer schema, engine, save, and browser behaviors.`,
    checks,
  };
}

function runSpriteTransitionRuntime() {
  const checks = [];
  const helperFile = "scripts/client-experience-sprite-transition-runtime-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Sprite-transition runtime helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }

  const reportFile = "output/playwright/client-experience-enhancement/sprite-transition-runtime/runtime-report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Sprite-transition runtime report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 27, "Sprite-transition runtime report has insufficient checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));

  const layerFile = "GameCli_framework/src/components/player/SpriteLayer.tsx";
  const cssFile = "GameCli_framework/src/styles/player.css";
  const layerSource = readRequiredFile(layerFile, checks);
  const cssSource = readRequiredFile(cssFile, checks);
  requireMatch(layerSource, /sprite-replacement-frame/, "SpriteLayer renders explicit replacement frames", layerFile, checks);
  requireMatch(layerSource, /data-sprite-role/, "replacement frames expose stable previous/current roles", layerFile, checks);
  requireMatch(layerSource, /onAnimationEnd/, "SpriteLayer cleans replacement from animation completion", layerFile, checks);
  requireMatch(layerSource, /window\.setTimeout/, "SpriteLayer has replacement cleanup fallback", layerFile, checks);
  requireMatch(cssSource, /--sprite-switch-duration/, "sprite switch duration uses a CSS variable", cssFile, checks);
  requireMatch(cssSource, /--sprite-switch-easing/, "sprite switch easing uses a CSS variable", cssFile, checks);
  requireMatch(cssSource, /sprite-switch-reveal_center/, "sprite center reveal has runtime CSS", cssFile, checks);
  requireMatch(cssSource, /sprite-switch-wipe_left_to_right/, "sprite left-to-right wipe has runtime CSS", cssFile, checks);
  requireMatch(cssSource, /sprite-switch-wipe_right_to_left/, "sprite right-to-left wipe has runtime CSS", cssFile, checks);
  requireMatch(cssSource, /sprite-switch-blur/, "sprite blur switch has runtime CSS", cssFile, checks);

  return {
    summary: `Verified ${report.checks.length} sprite replacement runtime behaviors.`,
    checks,
  };
}

function runTransitionInterruption() {
  const checks = [];
  const helperFile = "scripts/client-experience-sprite-transition-runtime-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath, "--interruption"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Sprite-transition interruption helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }

  const reportFile = "output/playwright/client-experience-enhancement/sprite-transition-runtime/interruption-report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Sprite-transition interruption report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 27, "Sprite-transition interruption report has insufficient checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));

  const layerFile = "GameCli_framework/src/components/player/SpriteLayer.tsx";
  const layerSource = readRequiredFile(layerFile, checks);
  requireMatch(
    layerSource,
    /replacementIsVisible\s*=\s*phase\s*===\s*"present"/,
    "SpriteLayer suppresses replacement frames outside present phase",
    layerFile,
    checks,
  );
  requireMatch(layerSource, /generation/, "sprite replacement cleanup remains generation-scoped", layerFile, checks);
  requireMatch(layerSource, /window\.clearTimeout/, "sprite replacement cleanup cancels fallback timers", layerFile, checks);

  return {
    summary: `Verified ${report.checks.length} rapid sprite replacement, hide, placement, and cleanup behaviors.`,
    checks,
  };
}

function runReducedMotion() {
  const checks = [];
  const helperFile = "scripts/client-experience-reduced-motion-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Reduced-motion Playwright helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }

  const reportFile = "output/playwright/client-experience-enhancement/reduced-motion/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Reduced-motion Playwright report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 10, "Reduced-motion Playwright report has insufficient checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));

  const cssFile = "GameCli_framework/src/styles/player.css";
  const cssSource = readRequiredFile(cssFile, checks);
  requireMatch(cssSource, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, "runtime CSS detects reduced-motion preference", cssFile, checks);
  requireMatch(cssSource, /background-layer\.is-transitioning[\s\S]*background-transition-fade-in/, "reduced-motion background transitions use fade keyframes", cssFile, checks);
  requireMatch(cssSource, /sprite-replacement-stack\.is-switching[\s\S]*background-transition-fade-in/, "reduced-motion sprite transitions use fade keyframes", cssFile, checks);
  requireMatch(cssSource, /90ms\s*!important/, "reduced-motion transition duration is capped at 90ms", cssFile, checks);

  return {
    summary: `Verified ${report.checks.length} normal/reduced motion browser behaviors.`,
    checks,
  };
}

function runBackwardCompatibility() {
  const checks = [];
  const helperFile = "scripts/client-experience-backward-compatibility-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Backward compatibility Playwright helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-3000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-3000))}`,
    );
  }

  const reportFile = "output/playwright/client-experience-enhancement/backward-compatibility/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Backward compatibility Playwright report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 23, "Backward compatibility report has insufficient checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));

  return {
    summary: `Verified ${report.checks.length} legacy project, cartridge, and runtime compatibility behaviors.`,
    checks,
  };
}

function runFinalE2E() {
  const checks = [];
  const helperFile = "scripts/client-experience-final-e2e-playwright.cjs";
  const helperPath = requireFile(helperFile, checks);
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Final E2E Playwright helper failed with exit ${String(result.status)}.`
      + ` stdout=${JSON.stringify((result.stdout || "").slice(-5000))}`
      + ` stderr=${JSON.stringify((result.stderr || "").slice(-5000))}`,
    );
  }

  const reportFile = "output/playwright/client-experience-enhancement/final-e2e/report.json";
  const reportPath = requireFile(reportFile, checks);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  expect(report.ok === true, "Final E2E Playwright report is not successful", JSON.stringify(report));
  expect(Array.isArray(report.checks) && report.checks.length >= 24, "Final E2E report has insufficient checks");
  checks.push(...report.checks.map((check) => ({
    assertion: check.assertion,
    file: check.file || helperFile,
  })));

  return {
    summary: `Verified ${report.checks.length} Editor-save/export-to-GameCli runtime behaviors.`,
    checks,
  };
}

function runFinalDocs() {
  const checks = [];
  const docFile = "docs/client-experience-enhancements.md";
  const formatFile = "docs/CARTRIDGE_FORMAT.md";
  const exportFile = "docs/CARTRIDGE_EXPORT.md";
  const docs = readRequiredFile(docFile, checks);
  readRequiredFile(formatFile, checks);
  readRequiredFile(exportFile, checks);

  const requiredPatterns = [
    [/main_menu_custom_button/, "documents custom title button component type"],
    [/main_menu_custom_button_container/, "documents editable custom button container"],
    [/lower-left[\s\S]*x=5[\s\S]*y=87/, "documents lower-left desktop container default"],
    [/asset:<asset_id>/, "documents stable asset:<asset_id> button image references"],
    [/blob:[\s\S]*data:/, "documents temporary preview URLs are not persisted"],
    [/external_url/, "documents external URL action shape"],
    [/noopener,noreferrer/, "documents safe web external-link opening"],
    [/system-browser opener|system_browser/, "documents desktop system-browser opener"],
    [/transition_config/, "documents background transition_config"],
    [/switch_transition/, "documents sprite switch_transition"],
    [/crossfade[\s\S]*slide_left[\s\S]*slide_right[\s\S]*blur/, "documents supported transition kinds"],
    [/slide_up[\s\S]*slide_down/, "documents vertical sprite replacement transitions"],
    [/background\.transition/, "documents legacy background.transition compatibility"],
    [/sprite `animation`|sprite animation/, "documents legacy sprite animation compatibility"],
    [/animation_config/, "documents animation_config separation and compatibility"],
    [/Sprite Layer Ordering[\s\S]*-1000[\s\S]*1000[\s\S]*appearance order/, "documents sprite layer range and legacy ordering"],
    [/`layer` controls overlap[\s\S]*`animation_config` controls entry\/exit\/emphasis[\s\S]*`switch_transition` controls/, "documents separation of sprite depth and motion responsibilities"],
    [/reduced-motion|Reduced-motion/, "documents reduced-motion transition behavior"],
    [/--all[\s\S]*zero pending cases/, "documents final full-regression gate"],
  ];

  for (const [pattern, description] of requiredPatterns) {
    requireMatch(docs, pattern, description, docFile, checks);
  }

  const pendingCases = CASES
    .filter((testCase) => testCase.status !== "implemented" || typeof testCase.run !== "function")
    .map((testCase) => testCase.id);
  expect(
    pendingCases.length === 0,
    "all client experience acceptance cases are implemented before final regression",
    JSON.stringify(pendingCases),
  );
  checks.push({
    assertion: "all client experience acceptance cases are implemented before final regression",
    file: "scripts/client-experience-enhancement-acceptance.cjs",
  });

  return {
    summary: "Verified final client-experience documentation and no-pending regression readiness.",
    checks,
  };
}

function listCases() {
  const width = Math.max(...CASES.map((testCase) => testCase.id.length));
  console.log("Client experience enhancement acceptance cases:");
  for (const testCase of CASES) {
    console.log(`  ${testCase.id.padEnd(width)}  ${testCase.status.padEnd(11)}  ${testCase.title}`);
  }
}

function executeCase(testCase) {
  if (testCase.status !== "implemented" || typeof testCase.run !== "function") {
    console.error(`[PENDING] ${testCase.id}: ${testCase.title}`);
    return { id: testCase.id, status: "pending", ok: false };
  }

  try {
    const result = testCase.run();
    console.log(`[PASS] ${testCase.id}: ${result.summary}`);
    for (const check of result.checks) {
      console.log(`  - ${check.assertion} (${check.file})`);
    }
    return { id: testCase.id, status: "passed", ok: true };
  } catch (error) {
    console.error(`[FAIL] ${testCase.id}: ${error instanceof Error ? error.message : String(error)}`);
    return { id: testCase.id, status: "failed", ok: false };
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.mode) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.mode === "list") {
    listCases();
    return;
  }
  if (options.mode === "case") {
    const testCase = CASES.find((candidate) => candidate.id === options.caseId);
    if (!testCase) {
      console.error(`Unknown case: ${options.caseId}`);
      console.error(`Use --list to see the ${CASES.length} known cases.`);
      process.exitCode = 2;
      return;
    }
    if (!executeCase(testCase).ok) process.exitCode = 1;
    return;
  }

  const results = CASES.map(executeCase);
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const pending = results.filter((result) => result.status === "pending").length;
  console.log(`Summary: ${passed} passed, ${failed} failed, ${pending} pending.`);
  if (failed > 0 || pending > 0) process.exitCode = 1;
}

main();
