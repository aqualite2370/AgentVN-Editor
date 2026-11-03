#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const {
  T0_PATHS,
  attachBrowserDiagnostics,
  collectHiddenGrowthBaseline,
  copyFixtureToIsolation,
  stopProcessTree,
  waitForPortBusy,
  waitForPortFree,
} = require("./t0-baseline-harness.cjs");

const root = path.resolve(__dirname, "..");
void main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  const baseline = collectHiddenGrowthBaseline(root);

  assert.equal(baseline.project.project_id, "project_msiz08p7_0_89ebc8a8cb");
  assert.equal(baseline.project.title, "隐忍的成长");
  assert.equal(baseline.project.nodeCount, 19);
  assert.equal(baseline.project.edgeCount, 21);
  assert.equal(baseline.project.assetCount, 143);
  assert.equal(baseline.source.bytes, 1580089);
  assert.equal(baseline.source.sha256, "e1c43983ae8b7488c080c55889727d38915602596d873180e6062fff5a3df250");
  assert.equal(baseline.assets.missing, 0);
  assert.equal(baseline.assets.hashMismatches, 0);
  assert.equal(baseline.assets.unsafePaths, 0);
  assert.equal(baseline.assets.inventorySha256, "c258d296fa0e5a2164496ff70b008541f6b953c4cd168c7d866da9d6ec3157a4");

  const isolation = copyFixtureToIsolation(root);
  try {
    assert.notEqual(isolation.copyPath, isolation.sourcePath);
    assert.equal(fs.readFileSync(isolation.copyPath).equals(fs.readFileSync(isolation.sourcePath)), true);
    assert.equal(fs.existsSync(T0_PATHS.failureReport), true);
    assert.equal(fs.existsSync(T0_PATHS.baselineManifest), true);

    const port = 47823;
    const child = spawn(process.execPath, ["-e", `require('net').createServer().listen(${port})`], {
      cwd: root,
      windowsHide: true,
      stdio: "ignore",
    });
    try {
      await new Promise((resolve, reject) => {
        child.once("error", reject);
        setTimeout(resolve, 100);
      });
      assert.equal(await waitForPortBusy(port), true);
    } finally {
      await stopProcessTree(child);
    }
    await waitForPortFree(port);

    const listeners = new Map();
    const page = {
      on(event, callback) {
        listeners.set(event, callback);
      },
    };
    const diagnostics = attachBrowserDiagnostics(page);
    listeners.get("console")({ type: () => "error", text: () => "console boom" });
    listeners.get("pageerror")(new Error("page boom"));
    listeners.get("requestfailed")({
      url: () => "http://127.0.0.1:6767/missing.js",
      failure: () => ({ errorText: "net::ERR_ABORTED" }),
    });
    listeners.get("response")({ url: () => "http://127.0.0.1:6767/missing.js", status: () => 404 });
    assert.deepEqual(diagnostics.consoleErrors, ["console boom"]);
    assert.equal(diagnostics.pageErrors.length, 1);
    assert.equal(diagnostics.failedRequests[0].url, "http://127.0.0.1:6767/missing.js");
    assert.equal(diagnostics.httpErrors[0].status, 404);
  } finally {
    // Keep the deterministic copy available for the following acceptance tasks.
  }

  console.log("t0-baseline-harness-test: PASS");
}

function awaitChildExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
}
