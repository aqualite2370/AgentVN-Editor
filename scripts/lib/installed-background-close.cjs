"use strict";
// QA-only public native window close. No focus, OS input or renderer/store writes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../../editor/node_modules/playwright");
const { rows, listeners, until } = require("./current-native-editor-session.cjs");
const { sha } = require("./installed-runtime-session.cjs");
async function closeInstalledWindow(launch) {
  assert(Number.isSafeInteger(launch.pid) && Number.isSafeInteger(launch.ports?.[1]));
  assert(launch.exe && launch.sha256 && launch.created);
  const identity = rows().find(p => p.ProcessId === launch.pid && p.Created === launch.created);
  assert(identity, "Exact owned Editor must still be running");
  assert.equal(path.resolve(identity.ExecutablePath), path.resolve(launch.exe));
  assert.equal(sha(launch.exe), launch.sha256);
  assert(listeners([launch.ports[1]]).length, "Owned CDP must be listening");
  let browser;
  const result = { method: "Installed native window.close via public Tauri IPC", startedAt: new Date().toISOString(),
    pid: launch.pid, created: launch.created, physicalInput: false, focusRequested: false, normalClose: false };
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.ports[1]}`);
    const page = await until(() => browser.contexts().flatMap(c => c.pages())
      .find(p => /tauri\.localhost|^tauri:/.test(p.url())), "owned Editor close target");
    result.before = await page.evaluate(() => ({ url: location.href, title: document.title,
      blockingDialog: Boolean(document.querySelector('[role="dialog"],[aria-modal="true"]')) }));
    assert(!result.before.blockingDialog, "Do not close a blocked or unreviewed dialog");
    try {
      await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }));
    } catch (error) {
      result.closeResponse = String(error);
      if (!/Target.*closed|has been closed|browser has been closed|Execution context was destroyed/i.test(result.closeResponse))
        throw new Error(`Public close command rejected: ${result.closeResponse}`);
    }
    await until(() => !rows().some(p => p.ProcessId === launch.pid && p.Created === launch.created)
      && listeners(launch.ports).length === 0, "native IPC close and host-owned backend shutdown", 30000);
    result.normalClose = true; result.status = "PASS";
  } catch (error) {
    error.closeEvidence = result;
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    result.finishedAt = new Date().toISOString();
  }
  return result;
}
async function main() {
  const [runArg, outputArg, notify] = process.argv.slice(2);
  const run = path.resolve(runArg || ""), output = path.resolve(outputArg || "");
  assert(run === path.resolve("F:/AgentVN/QA/Editor-Upgrade-1930-20261026-01"));
  assert(path.dirname(output) === run && !fs.existsSync(output));
  assert.equal(notify, "--notify-deferred-input");
  const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
  const request = read(path.join(run, "computer-use-request.json")), report = read(path.join(run, "report.json"));
  const launch = report.launches.find(l => l.pid === request.pid && l.created === request.created); assert(launch);
  let result;
  try { result = await closeInstalledWindow(launch); }
  catch (error) { result = { ...error.closeEvidence, status: "FAILED", method: "Installed native window.close via public Tauri IPC",
    error: String(error.stack || error), physicalInput: false, focusRequested: false }; process.exitCode = 1; }
  fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
  // Wake the old physical-input oracle honestly. Its original assertion remains
  // unchanged and will terminate/restore; this receipt never claims an Alt+F4.
  fs.writeFileSync(request.completion, JSON.stringify({ ...result, label: request.label, pid: request.pid,
    physicalInputStatus: "DEFERRED_BY_USER", reason: "User is gaming; no Computer Use or focus changes",
    evidence: output }, null, 2), { flag: "wx" });
  console.log(JSON.stringify(result, null, 2));
}
module.exports = { closeInstalledWindow };
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
