"use strict";
// Offline adapter contracts; never starts an Editor, Player or model request.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { build } = require("./candidate-1930-preview.cjs");

test("preview resolves the Player boundary from the verified installation receipt", () => {
  const input = fs.readFileSync(path.join(__dirname, "installed-preview-current.cjs"), "utf8");
  const source = build("run", input).source;
  assert(source.includes("path.resolve(installation.installRoot)"));
  assert(!source.includes('path.resolve(qa, "install-01/installed-nsis")'));
  assert(source.includes("assert.equal(report.steps.length, 5)"));
  assert(source.includes("assert.equal(report.cases.length, 12)"));
});

test("ownership validates explicit attempt before loading any upstream evidence", () => {
  for (const attempt of ["../05", "5", "006", "06/../05"]) {
    const result = spawnSync(process.execPath,
      [path.join(__dirname, "candidate-1924-preview-ownership.cjs"), "--self-test"],
      { env: { ...process.env, AGENTVN_PREVIEW_ATTEMPT: attempt },
        encoding: "utf8", windowsHide: true, timeout: 60000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Preview attempt must be exactly two digits/);
    assert(!result.stderr.includes("open '"), "Invalid attempt must fail before evidence reads");
  }
});

test("hide runtime adapter uses the current payload resource report", () => {
  const { resolveDeployment } = require("./candidate-1930-hide.cjs");
  const candidateRoot = "F:/AgentVN/QA/Editor-1.9.34-20261029-01";
  assert.equal(resolveDeployment(candidateRoot, "1.9.34"),
    path.join(candidateRoot, "payload-01/deployments/installer-resource-report.json"));
  assert.throws(() => resolveDeployment(candidateRoot, "1.9.33"));
  assert.throws(() => resolveDeployment(path.join(candidateRoot, "absent-report-root"), "1.9.34"));
});

test("hide protects the real Dev linked by this candidate packaging receipt", () => {
  const { rootDevProtection } = require("./candidate-1930-hide.cjs");
  const protection = rootDevProtection();
  assert.equal(protection.sha256, "ac9cf0ad9cba5f6dc18eee4d137856df5bb20cb4109d6136ee9f36c9cde8aee5");
  assert.equal(path.resolve(protection.build.path),
    path.resolve("F:/AgentVN/QA/Settings-Rendering-20261029-01/gates-01/report.json"));
  assert.equal(path.resolve(protection.packaging.path),
    path.resolve("F:/AgentVN/QA/Editor-1.9.34-20261029-01/package-01/report.json"));
});
