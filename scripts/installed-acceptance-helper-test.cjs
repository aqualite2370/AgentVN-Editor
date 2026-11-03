"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { EventEmitter } = require("node:events");
const { validateNativeResult, inside, settleRuntime, dismissEnvironmentCompletion, realDownload, assertProjectContentUnchanged }
  = require("./lib/installed-acceptance.cjs");
async function main() {
  const request = { requestId: "owned", ownerPid: 77, cancel: false, selectedPath: "D:/测试/输入.vnproj" };
  const result = { status: "INPUT_COMPLETED", requestId: "owned", ownerPid: 77, cancelled: false,
    selectedPath: request.selectedPath, interaction: "Computer Use" };
  validateNativeResult(request, result);
  for (const change of [{ requestId: "stale" }, { ownerPid: 78 }, { cancelled: true },
    { selectedPath: "D:/其他/输入.vnproj" }, { interaction: "" }])
    assert.throws(() => validateNativeResult(request, { ...result, ...change }));
  assert(inside("D:/run", "D:/run/中文/file"));
  assert(!inside("D:/run", "D:/run-other/file"));
  assert(!inside("D:/run", "D:/run"));
  const project = { projectId: "owned", title: "测试", updatedAt: "earlier", settings: { x: 7 }, assetManifest: [] };
  assertProjectContentUnchanged({ ...project, updatedAt: "later" }, project);
  for (const change of [{ projectId: "other" }, { title: "changed" }, { settings: { x: 8 } }, { assetManifest: [{ asset_id: "new" }] }])
    assert.throws(() => assertProjectContentUnchanged({ ...project, ...change }, project));
  const events = [];
  await settleRuntime({ locator: selector => ({ waitFor: async args => events.push([selector, args.state]) }),
    waitForFunction: async () => events.push(["idle"]), evaluate: async () => events.push(["finite-animations"]) });
  assert.deepEqual(events, [[".boot-overlay", "detached"], ['[data-testid="game-launch-blackout"]', "detached"],
    ["idle"], ["finite-animations"]]);
  const modal = [];
  await dismissEnvironmentCompletion({ getByRole: () => ({ filter: () => ({ isVisible: async () => true,
    getByRole: () => ({ click: async () => modal.push("real-complete-click") }),
    waitFor: async () => modal.push("hidden") }) }) });
  assert.deepEqual(modal, ["real-complete-click", "hidden"]);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-download-helper-"));
  const session = new EventEmitter();
  let actualDirectory;
  session.send = async (method, parameters) => {
    assert.equal(method, "Browser.setDownloadBehavior");
    actualDirectory = parameters.downloadPath;
  };
  let clicked = false;
  try {
    await assert.rejects(realDownload({ waitForEvent: async () => ({ suggestedFilename: () => "../outside.zip" }) },
      session, directory, { click: async () => { clicked = true; } }), /filename must not contain paths/);
    assert(clicked, "Download checks must follow a real trigger");
    const file = path.join(directory, "中文.vncart"), contents = Buffer.from("controlled-download");
    fs.writeFileSync(file, contents, { flag: "wx" });
    const run = (state, fields = {}) => realDownload(
      { waitForEvent: async () => ({ suggestedFilename: () => "中文.vncart" }) },
      session, directory.replaceAll("\\", "/"), { click: async () => {
        session.emit("Browser.downloadWillBegin", { guid: "owned", suggestedFilename: "中文.vncart" });
        session.emit("Browser.downloadProgress", { guid: "unrelated", state: "canceled" });
        session.emit("Browser.downloadProgress", { guid: "owned", state, filePath: file,
          totalBytes: contents.length, receivedBytes: contents.length, ...fields });
      } });
    const artifact = await run("completed");
    assert.equal(artifact.path, file);
    assert.equal(artifact.bytes, contents.length);
    assert.equal(actualDirectory, path.resolve(directory), "CDP must receive a native absolute path");
    await assert.rejects(run("canceled"), /ended as canceled/);
    await assert.rejects(run("completed", { receivedBytes: 1 }), /Downloaded bytes must match CDP/);
    await assert.rejects(run("completed", { filePath: path.join(directory, "../outside.vncart") }), /escaped/);
    assert.equal(session.listenerCount("Browser.downloadProgress"), 0);
    assert.equal(session.listenerCount("Browser.downloadWillBegin"), 0);
  } finally {
    // This directory was created exclusively by this test.
    fs.rmSync(directory, { recursive: true });
  }
  console.log("installed-acceptance-helper-test: PASS (ownership, Runtime/modal readiness, download cancellation, native path, bytes, containment, listener cleanup)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
