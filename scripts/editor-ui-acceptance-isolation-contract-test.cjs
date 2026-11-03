#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveAcceptancePaths } = require("./lib/editor-ui-acceptance.cjs");

const root = path.resolve(__dirname, "..");
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-editor-acceptance-"));
const fixtureDir = path.join(runRoot, "fixture");
const reportDir = path.join(runRoot, "report");
const fixturePath = path.join(fixtureDir, "isolated.vnproj");
const runnerSources = [
  path.join(root, "scripts", "editor-workbench-container-morph-playwright.cjs"),
  path.join(root, "scripts", "advanced-tools-switch-perf-audit.cjs"),
  path.join(root, "scripts", "advanced-layout-transition-audit.cjs"),
];

fs.mkdirSync(fixtureDir, { recursive: true });
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(fixturePath, JSON.stringify({ project_id: "isolated_fixture_test" }), "utf8");

function withEnv(values, callback) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function expectFailure(label, callback, expectedText) {
  assert.throws(callback, error => {
    assert.match(String(error?.message ?? error), expectedText, label);
    return true;
  }, label);
}

for (const runnerPath of runnerSources) {
  const source = fs.readFileSync(runnerPath, "utf8");
  assert.match(
    source,
    /resolveAcceptancePaths/,
    `${path.basename(runnerPath)} must resolve its report directory through the isolation helper`,
  );
  assert.doesNotMatch(
    source,
    /const\s+(?:output|OUT_DIR)\s*=\s*path\.join\(\s*(?:root|ROOT)\s*,\s*["']output\/playwright/,
    `${path.basename(runnerPath)} must not write reports to a fixed historical output path`,
  );
}

withEnv({
  AGENTVN_TEST_PROJECT: fixturePath,
  AGENTVN_WORKSPACE_OUTPUT: reportDir,
}, () => {
  const resolved = resolveAcceptancePaths();
  assert.equal(resolved.input, path.resolve(fixturePath));
  assert.equal(resolved.output, path.resolve(reportDir));
  assert.equal(resolved.fixtureProjectId, "isolated_fixture_test");
  assert.equal(resolved.isolated, true);
});

withEnv({ AGENTVN_TEST_PROJECT: undefined, AGENTVN_WORKSPACE_OUTPUT: reportDir }, () => {
  expectFailure("missing fixture", () => resolveAcceptancePaths(), /AGENTVN_TEST_PROJECT/);
});

withEnv({ AGENTVN_TEST_PROJECT: root, AGENTVN_WORKSPACE_OUTPUT: reportDir }, () => {
  expectFailure("fixture must be a file", () => resolveAcceptancePaths(), /regular \.vnproj file/);
});

withEnv({ AGENTVN_TEST_PROJECT: fixturePath, AGENTVN_WORKSPACE_OUTPUT: undefined }, () => {
  expectFailure("missing output", () => resolveAcceptancePaths(), /AGENTVN_WORKSPACE_OUTPUT/);
});

withEnv({ AGENTVN_TEST_PROJECT: fixturePath, AGENTVN_WORKSPACE_OUTPUT: fixturePath }, () => {
  expectFailure("input/output collision", () => resolveAcceptancePaths(), /must be different/);
});

withEnv({
  AGENTVN_TEST_PROJECT: path.join(root, "data", "backup-timeline", "legacy.vnproj"),
  AGENTVN_WORKSPACE_OUTPUT: reportDir,
}, () => {
  expectFailure("historical fixture", () => resolveAcceptancePaths(), /historical|backup|user project/i);
});

fs.writeFileSync(path.join(reportDir, "old-report.json"), "{}", "utf8");
withEnv({
  AGENTVN_TEST_PROJECT: fixturePath,
  AGENTVN_WORKSPACE_OUTPUT: reportDir,
}, () => {
  expectFailure("reused report output", () => resolveAcceptancePaths(), /new or empty directory/);
});

console.log("PASS editor-ui-acceptance isolation contract");
