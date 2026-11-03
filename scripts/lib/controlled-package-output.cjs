"use strict";
// QA only, never bundled. User-authorized one-shot substitute for the directory
// picker response; the installed UI's handler, state and APK builder remain real.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
function validateControlledDestination({ out, destination, ownerPid }) {
  const root = path.resolve("F:/AgentVN/QA/Android-Package-20261021-01");
  assert.equal(path.dirname(path.resolve(out)), root);
  assert.match(path.basename(out), /^editor-\d{2}$/);
  assert.equal(path.resolve(destination), path.join(path.resolve(out), "Android 输出"));
  assert(Number.isSafeInteger(ownerPid) && ownerPid > 0);
  for (const file of [root, out, destination]) {
    if (fs.existsSync(file)) assert.equal(fs.realpathSync.native(file).toLowerCase(),
      path.resolve(file).toLowerCase(), "Controlled directory cannot use a junction or symlink");
  }
}
// Self contained so the exact same function is exercised in the VM and WebView.
function oneShotDirectoryResponse({ action, token, destination }) {
  const api = window.__TAURI_INTERNALS__, key = "__agentvnQaDirectory";
  if (!api || typeof api.invoke !== "function" || typeof api.convertFileSrc !== "function")
    throw Error("Real installed Tauri IPC required");
  if (action === "install") {
    if (window[key]) throw Error("Another directory seam is active");
    // Tauri 2.11.2 defines invoke/ipc as non-writable and non-configurable.
    // Substitute only the exact directory command's transport response instead.
    const original = window.fetch, url = api.convertFileSrc("select_package_output_dir", "ipc");
    if (!/^https?:\/\/ipc\.localhost\/select_package_output_dir$/.test(url))
      throw Error("Unexpected directory IPC URL");
    const state = { token, original, calls: 0, destination };
    state.wrapper = function (input, init, ...rest) {
      if (input !== url) return Reflect.apply(original, this, [input, init, ...rest]);
      if (init?.method !== "POST" || init?.body !== "{}")
        return Promise.reject(Error("Unexpected directory picker arguments"));
      if (state.calls || window.fetch !== state.wrapper)
        return Promise.reject(Error("Expired directory seam"));
      state.calls++;
      window.fetch = original;
      return Promise.resolve(new Response(JSON.stringify(destination), {
        status: 200, headers: { "Content-Type": "application/json", "Tauri-Response": "ok" },
      }));
    };
    window[key] = state; window.fetch = state.wrapper;
    if (window.fetch !== state.wrapper) { delete window[key]; throw Error("Directory seam did not install"); }
    return { installed: true };
  }
  const state = window[key];
  if (!state || state.token !== token || state.destination !== destination)
    throw Error("Directory seam belongs to a different request");
  const result = { calls: state.calls, restored: window.fetch === state.original };
  if (action === "inspect") return result;
  if (action !== "cleanup") throw Error("Unknown directory seam operation");
  if (window.fetch === state.wrapper) window.fetch = state.original;
  result.restored = window.fetch === state.original;
  delete window[key]; return result;
}
async function selectControlledPackageOutput({ page, trigger, out, destination, ownerPid }) {
  validateControlledDestination({ out, destination, ownerPid });
  assert(fs.statSync(destination).isDirectory());
  const token = crypto.randomUUID(), startedAt = new Date().toISOString();
  const args = { token, destination };
  await page.evaluate(oneShotDirectoryResponse, { ...args, action: "install" });
  let result, cleanup;
  try {
    await trigger.click();
    await page.waitForFunction(value =>
      document.querySelector('[data-help-key="package.outputDir"]')?.value === value, destination);
    result = await page.evaluate(oneShotDirectoryResponse, { ...args, action: "inspect" });
    assert.equal(result.calls, 1); assert.equal(result.restored, true);
  } finally {
    cleanup = await page.evaluate(oneShotDirectoryResponse, { ...args, action: "cleanup" });
    assert.equal(cleanup.restored, true, "Original native IPC must be restored before building");
  }
  const receipt = { status: "CONTROLLED_DIRECTORY_INJECTED", performedBy: "QA_ONE_SHOT_RESPONSE",
    nativePickerTested: false, productModified: false, persistedHook: false,
    command: "select_package_output_dir", selectedPath: destination, ownerPid,
    startedAt, finishedAt: new Date().toISOString(), result, cleanup };
  fs.writeFileSync(path.join(out, "controlled-output-directory.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  return receipt;
}
module.exports = { validateControlledDestination, oneShotDirectoryResponse, selectControlledPackageOutput };
