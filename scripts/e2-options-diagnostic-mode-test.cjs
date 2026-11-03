"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const cases = [
  { flags: { NATIVE_STYLE_TRACE: "1" }, error: "native style trace requires isolated attribution" },
  { flags: { FONT_TRACE: "1" }, error: "font attribution requires native tracing" },
  { flags: { STYLE_TRACE: "1", NATIVE_STYLE_TRACE: "1", FONT_TRACE: "1" },
    error: "font attribution requires native tracing without per-node invalidation overhead" },
  { flags: { STRUCTURE: "1", ASSERT_PERFORMANCE: "1" },
    error: "computed structure inspection is separate attribution" },
  { flags: { LAYOUT_CONTROL: "warm-display-grid" },
    error: "warm display control requires structural geometry and ownership evidence" },
  { flags: { FRAME_TASK_TRACE: "1" },
    error: "frame task attribution requires isolated tracing" },
  { flags: { NATIVE_CPU_TRACE: "1" },
    error: "native CPU sampling requires the owned frame task attribution trace" },
  { flags: { LAYOUT_CONTROL: "layout-native-appearance-none" },
    error: "native appearance control requires explicit control geometry evidence" },
  { flags: { CONTROLS: "1", ASSERT_PERFORMANCE: "1" },
    error: "control geometry is separate attribution" },
  { flags: { LAYOUT_CONTROL: "layout-explicit-cjk-fallback" },
    error: "explicit font fallback control requires actual rendered font evidence" },
  { flags: { LAYOUT_CONTROL: "layout-columns-flex" },
    error: "column layout control requires actual geometry and ownership evidence" },
  { flags: { OMIT_SECTION: "center" },
    error: "layout section omission is restricted to its explicit diagnostic mode" },
  { flags: { LAYOUT_CONTROL: "layout-section-omitted", OMIT_SECTION: "" },
    error: "layout section omission must be one of" },
  { flags: { LAYOUT_CONTROL: "layout-section-omitted", OMIT_SECTION: "body" },
    error: "layout section omission must be one of" },
  { flags: { LAYOUT_CONTROL: "layout-section-omitted", OMIT_SECTION: "center", STRUCTURE: "1" },
    error: "omitted section diagnosis cannot substitute" },
  { flags: { LAYOUT_CONTROL: "layout-designer-static-glass", LAYOUT_PRODUCTION: "0" },
    error: "static glass probe requires the exact production designer module" },
];
for (const [index, test] of cases.entries()) {
  const output = path.join(root, "output/playwright", `e2-mode-guard-${process.pid}-${index}`);
  assert(!fs.existsSync(output), "guard check must use an unused report path");
  const flags = {
    LAYOUT_CONTROL: "current", LAYOUT_PRODUCTION: "1", ASSERT_INERT_OWNERSHIP: "0",
    DOM_READS: "0", STYLE_TRACE: "0", NATIVE_STYLE_TRACE: "0", FONT_TRACE: "0",
    TRACE_INVALIDATIONS: "1", STRUCTURE: "0", ASSERT_PERFORMANCE: "0",
    ASSERT_MOUNT_READS: "0", CPU_COUNTERS: "0", CONTROLS: "0",
    FRAME_TASK_TRACE: "0", NATIVE_CPU_TRACE: "0", PLATFORM_FONTS: "0", OMIT_SECTION: "", ...test.flags,
  };
  const run = spawnSync(process.execPath, ["scripts/e2-options-layout-sequence-diagnostic.cjs"], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 10000,
    env: {
      ...process.env,
      AGENTVN_TEST_PROJECT: path.join(root, "scripts/fixtures/editor-isolated-small.vnproj"),
      AGENTVN_WORKSPACE_OUTPUT: output,
      ...Object.fromEntries(Object.entries(flags).map(([key, value]) =>
        [`AGENTVN_E2_OPTIONS_${key}`, value])),
    },
  });
  assert(!run.error, String(run.error));
  assert.equal(run.status, 1);
  assert((run.stderr || "").includes(test.error), `specific rejected mode evidence required: ${test.error}`);
  assert(!fs.existsSync(output), "invalid mode must fail before servers, output or browser startup");
}
console.log(`PASS: ${cases.length} incompatible attribution/performance modes rejected before resource startup`);
