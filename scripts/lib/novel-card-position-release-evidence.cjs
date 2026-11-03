"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const A = require("./installed-acceptance.cjs");

// A later Editor-only repair has a new Dev identity. Link the original Runtime
// proof explicitly; never mutate its historical Dev field to make it current.
function validateCardPositionRelease(file, { root, runtimeFile, runtime, runtimeBytes }) {
  const output = path.join(root, "output");
  assert(A.inside(output, file), "Card gate must be an independently recorded acceptance report");
  const bytes = fs.readFileSync(file), card = JSON.parse(bytes);
  assert.equal(card.status, "NOVEL_CARD_POSITION_SOURCE_AND_DEV_PASS");
  assert.equal(card.scope, "EDITOR_CARD_POSITION_SOURCE_BEHAVIOR_AND_DEV_NOT_INSTALLED_OR_POWER_LOSS");
  const required = [
    "position-controller", "native-position-files", "card-position-browser-matrix",
    ...["ownership", "initial-refresh", "controller", "local-actions"].map(n => `floating-${n}`),
    ...["normal", "dpr2", "reduced", "reduced-dpr2"].flatMap(n => [`floating-ui-${n}`, `floating-handoff-${n}`]),
    "novel-processing-core-test", "novel-import-append-graph-contract-test",
    "novel-import-chapter-idempotence-playwright", "runtime-save-queue-test",
    "runtime-exit-flow-test", "runtime-system-back-test", "runtime-window-close-test",
    "editor-typecheck", "editor-build", "GameCli_framework-build",
    "editor-workspace-contract", "editor-workspace-playwright", "full-dev-build",
  ];
  assert.equal(card.steps.length, required.length);
  assert.equal(new Set(card.steps.map(s => s.name)).size, required.length);
  for (const name of required) {
    const step = card.steps.find(s => s.name === name);
    assert(step && step.status === "PASS" && step.exitCode === 0, `Missing completed card gate: ${name}`);
    if (name.startsWith("floating-") || name === "card-position-browser-matrix") {
      assert(step.evidence && A.inside(output, step.evidence.path));
      const evidenceBytes = fs.readFileSync(step.evidence.path);
      assert.equal(A.sha256(evidenceBytes), step.evidence.sha256);
      const evidence = JSON.parse(evidenceBytes);
      assert.equal(evidence.status, "PASS");
      assert(evidence.cases.length > 0 && evidence.cases.every(c => c.status === "PASS"));
      assert.equal(step.evidence.cases, evidence.cases.length);
      if (name.startsWith("floating-handoff-"))
        assert.equal(evidence.browser.headless, false, "Motion gate must record its visible browser");
      if (name === "card-position-browser-matrix") validateMatrix(evidence);
    }
  }
  const requiredSources = [
    "editor/src/components/novel-import/NovelTaskCard.tsx",
    "editor/src/components/novel-import/novel-task-floating.css",
    "editor/src/components/novel-import/NovelProcessTaskWorkbench.tsx",
    "editor/src/novel-import/novelCardPosition.ts", "editor/src/store/novelImportStore.ts",
    "editor/src-tauri/src/novel_card_position.rs", "editor/src-tauri/src/main.rs",
  ];
  assert(card.sources.length > 0 && new Set(card.sources.map(s => s.file)).size === card.sources.length);
  for (const name of requiredSources) assert(card.sources.some(s => s.file === name), `Missing card source: ${name}`);
  for (const source of card.sources) {
    const target = path.resolve(root, source.file);
    assert(A.inside(root, target));
    assert.equal(A.sha256(fs.readFileSync(target)), source.sha256, `Changed card source: ${source.file}`);
  }
  assert.equal(path.resolve(card.inheritedRuntime.path), runtimeFile);
  assert.equal(card.inheritedRuntime.sha256, A.sha256(runtimeBytes));
  assert.equal(card.inheritedRuntime.status, runtime.status);
  assert.deepEqual(card.inheritedRuntime.originalDev, runtime.dev, "Preserve historical Runtime Dev identity");
  assert.equal(card.devBefore.sha256, runtime.dev.sha256);
  assert.equal(card.devBefore.modifiedAt, runtime.dev.modifiedAt);
  assert.equal(path.resolve(card.dev.path), path.join(root, "AgentVN Dev.exe"));
  assert.equal(card.dev.pending, false);
  assert.equal(card.dev.compiledSha256, card.dev.sha256);
  assert.notEqual(card.dev.sha256, card.devBefore.sha256, "Old Runtime Dev cannot prove the later Editor repair");
  assert.notEqual(card.dev.modifiedAt, card.devBefore.modifiedAt);
  return { card, evidence: { path: file, sha256: A.sha256(bytes), status: card.status,
    scope: card.scope, originalRuntimeDev: runtime.dev, deliveryDev: card.dev } };
}

function validateMatrix(evidence) {
  assert.equal(evidence.scope, "REAL_COMPONENT_AND_CONTROLLER_BROWSER_WITH_CONTROLLED_NATIVE_IPC_NOT_INSTALLED_ACCEPTANCE");
  assert.equal(evidence.cases.length, 12);
  assert.equal(evidence.errors.length, 0);
  assert(evidence.cleanup.browserClosed && evidence.cleanup.serverStopped);
  const expected = new Set([[1920, 1080], [2560, 1440], [3840, 2160]]
    .flatMap(([w, h]) => [1, 2].flatMap(d => [false, true].map(r => `${w}/${h}/${d}/${r}`))));
  const checks = [
    "real-drag-threshold-and-native-commit", "late-initial-read-cannot-jump-current-drag",
    "unmounted-project-write-does-not-change-next-project",
    "visible-write-error-preserves-old-bytes-and-real-retry",
    "durable-reset-tombstone-beats-stale-browser-cache",
    "damaged-native-record-shows-error-read-retry-not-write",
  ];
  for (const row of evidence.cases) {
    assert(expected.delete(`${row.width}/${row.height}/${row.dpr}/${row.reduced}`), "Duplicate or unexpected card matrix");
    assert.deepEqual(row.geometry.actual, { width: row.width, height: row.height, dpr: row.dpr, reduced: row.reduced });
    assert(row.geometry.hit && row.geometry.overflow <= 1);
    assert(row.geometry.x >= 12 && row.geometry.y >= 12
      && row.geometry.right <= row.width - 12 && row.geometry.bottom <= row.height - 12);
    for (const name of checks) assert(row.checks.includes(name), `Missing card behavior: ${name}`);
  }
  assert.equal(expected.size, 0);
}
module.exports = { validateCardPositionRelease };
