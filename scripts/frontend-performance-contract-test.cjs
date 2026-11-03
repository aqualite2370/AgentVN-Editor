const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const novelImportStore = read("editor/src/store/novelImportStore.ts");
const visualNovelEditor = read("editor/src/components/editor/VisualNovelEditor.tsx");
const novelProcessTaskWorkbench = read("editor/src/components/novel-import/NovelProcessTaskWorkbench.tsx");
const advancedToolsPanel = read("editor/src/components/advanced/AdvancedToolsPanel.tsx");
const editorToolbar = read("editor/src/components/editor/EditorToolbar.tsx");
const layoutCss = read("editor/src/styles/layout.css");
const variablesCss = read("editor/src/styles/variables.css");

function keyframeBlock(source, name) {
  const match = source.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`));
  return match?.[0] ?? "";
}

assert(
  !/appendModelTranscript\([^)]*JSON\.stringify\(payload,\s*null,\s*2\)/s.test(novelImportStore),
  "novel import realtime log should not pretty-stringify full structured payloads on the UI thread",
);
assert(
  /appendStructuredModelTranscript/.test(novelImportStore),
  "novel import realtime log should use a shallow structured payload transcript",
);
assert(
  /const eagerDocumentEditChunkLimit = 60_000;/.test(novelImportStore) &&
    /shouldRefreshChunksImmediatelyAfterEdit/.test(novelImportStore),
  "large document text edits should avoid eager full-document rechunking on every keystroke",
);
assert(
  !/JSON\.stringify\(payload,\s*null,\s*2\)/.test(`${novelImportStore}\n${novelProcessTaskWorkbench}`),
  "novel import and task workbench previews should not pretty-stringify full payload objects",
);
assert(
  /shallowPayloadPreview/.test(novelProcessTaskWorkbench),
  "task workbench event payload previews should use shallow payload summaries",
);
assert(
  !/new MutationObserver\(applyChineseLabels\)/.test(visualNovelEditor),
  "editor label translation observer should be frame-throttled",
);
assert(
  !/observer\.observe\(document\.body/.test(visualNovelEditor),
  "editor label translation observer should not observe the whole document body",
);
assert(
  /new MutationObserver\(scheduleApplyChineseLabels\)/.test(visualNovelEditor) &&
    /window\.requestAnimationFrame/.test(visualNovelEditor),
  "editor label translation observer should coalesce updates with requestAnimationFrame",
);
assert(
  !/transition-property:[^;]*(filter|transform)/.test(variablesCss),
  "global body transition should not include filter or transform because it makes large tab switches expensive",
);
assert(
  /\.toolbar-popover\.advanced \.advanced-tools-panel[\s\S]*transition:\s*none\s*!important/.test(layoutCss),
  "advanced tools panel should opt out of inherited global transitions while switching tabs",
);
assert(
  /\.toolbar-popover\.advanced\s*\{[^}]*transition:\s*none/.test(layoutCss),
  "advanced tools popover should not transition height during internal tab switches",
);
assert(
  !/filter:\s*blur/.test(keyframeBlock(layoutCss, "toolbar-popover-content-morph")) &&
    !/filter:\s*blur/.test(keyframeBlock(layoutCss, "advanced-tab-leave")) &&
    !/filter:\s*blur/.test(keyframeBlock(layoutCss, "advanced-tab-enter")),
  "advanced tools switching should not reintroduce blur filters",
);
assert(
  !/Math\.max\(layoutMorphMs/.test(advancedToolsPanel) &&
    /waitForAdvancedTabReady/.test(advancedToolsPanel) &&
    /syncLayoutMode\(/.test(advancedToolsPanel),
  "advanced tools tab switching should use real readiness and compositor mode transitions, not serialized layout timers",
);
assert(
  /is-inactive/.test(advancedToolsPanel) &&
    /shouldKeepWarmTab/.test(advancedToolsPanel) &&
    /is-warm/.test(advancedToolsPanel) &&
    /aria-hidden=\{!isActive\}/.test(advancedToolsPanel) &&
    /hidden=\{!isActive && !keepWarm && !isLeaving\}/.test(advancedToolsPanel) &&
    /mountedTabs/.test(advancedToolsPanel),
  "advanced tools tabs should stay mounted after first visit to avoid remounting heavy panels on every switch",
);
assert(
  /options\.animate === false/.test(editorToolbar) &&
    /classList\.remove\("is-morphing"\)/.test(editorToolbar) &&
    /syncLayoutMode\(\s*isWideModeTab\(nextTab\),\s*!options\.instant,\s*\)/.test(advancedToolsPanel) &&
    /syncLayoutMode\(isWideModeTab\(activeTab\), false\)/.test(advancedToolsPanel),
  "only deliberate pointer-driven wide/narrow mode boundaries should run the container morph",
);

console.log("frontend-performance-contract-test: ok");
