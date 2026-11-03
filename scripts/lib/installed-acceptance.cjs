"use strict";
// Shared seams for actual installed Release acceptance. No Tauri/store mocks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function inside(parent, file) {
  const relative = path.relative(path.resolve(parent), path.resolve(file));
  return !!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}
function readInstalledSession(runRoot) {
  const state = JSON.parse(fs.readFileSync(path.join(runRoot, "installed-processes.json"), "utf8"));
  const installation = JSON.parse(fs.readFileSync(path.join(runRoot, "installer-resource-report.json"), "utf8"));
  assert.equal(installation.status, "PASS");
  const deployed = installation.deployments.find(item =>
    path.resolve(item.installedRoot) === path.resolve(state.installRoot));
  assert(deployed, "The explicit running installation must be among verified deployments");
  assert(inside(runRoot, state.databasePath), "Database must be explicitly isolated inside this session");
  assert(state.webviewRoot && inside(runRoot, state.webviewRoot), "WebView profile must be explicitly isolated");
  assert.notEqual(state.cdpPort, state.backendPort);
  const executable = path.join(state.installRoot, "agentvn-editor.exe");
  assert.equal(sha256(fs.readFileSync(executable)), deployed.executable.sha256);
  const rows = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(state.editorPid)}" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress`],
  { windowsHide: true, encoding: "utf8" }));
  assert.equal(rows.ProcessId, state.editorPid, "The owned installed Editor must still be alive");
  assert.equal(rows.ExecutablePath.toLowerCase(), executable.toLowerCase(), "Editor process ownership mismatch");
  return { state, installation, executable, exeSha256: deployed.executable.sha256 };
}
async function projectSnapshot(backendPort) {
  const response = await fetch(`http://127.0.0.1:${backendPort}/api/project/state`, { signal: AbortSignal.timeout(10000) });
  assert(response.ok, `Installed backend state HTTP ${response.status}`);
  const payload = await response.json();
  assert(payload.ok && payload.data?.project_metadata);
  return payload.data.project_metadata;
}
function assertProjectContentUnchanged(actual, expected, message = "Project content changed") {
  // Idempotent background persistence may legitimately bump only updatedAt.
  // Keep every identity/configuration/resource field in the equality check.
  const content = ({ updatedAt, ...value }) => value;
  assert.deepEqual(content(actual), content(expected), message);
}
async function assetBytes(backendPort, asset) {
  if (asset.metadata?.data_url?.startsWith("data:"))
    return Buffer.from(asset.metadata.data_url.slice(asset.metadata.data_url.indexOf(",") + 1), "base64");
  const route = asset.metadata?.backend_asset_path;
  assert(route && !route.split(/[\\/]/).includes(".."), `Missing/unsafe backend-owned asset path: ${asset.asset_id}`);
  const response = await fetch(`http://127.0.0.1:${backendPort}/api/project/assets/${route.split("/").map(encodeURIComponent).join("/")}`,
    { signal: AbortSignal.timeout(10000) });
  assert(response.ok, `Installed asset HTTP ${response.status}: ${asset.asset_id}`);
  return Buffer.from(await response.arrayBuffer());
}
async function settleEditor(page) {
  await page.waitForFunction(() => {
    const panel = document.querySelector(".workspace-task-panel.is-open");
    const tools = panel?.querySelector(".advanced-tools-panel");
    return !document.querySelector(".app-transition-stage.is-switching")
      && !panel?.classList.contains("is-morphing") && (!tools || tools.classList.contains("is-tab-idle"));
  });
}
async function settleRuntime(frame) {
  await frame.locator(".boot-overlay").waitFor({ state: "detached" });
  await frame.locator('[data-testid="game-launch-blackout"]').waitFor({ state: "detached" });
  await frame.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle");
  await frame.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function dismissEnvironmentCompletion(page) {
  const dialog = page.getByRole("dialog").filter({ hasText: "环境检测已完成" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "完成", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }
}
async function select(page, name, value) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("listbox", { name, exact: true }).getByRole("option", { name: value, exact: true }).click();
}
function validateNativeResult(request, result) {
  assert.equal(result.status, "INPUT_COMPLETED");
  assert.equal(result.requestId, request.requestId, "Native completion belongs to a different request");
  assert.equal(result.ownerPid, request.ownerPid, "Native completion must reference this installed process");
  assert(result.interaction && typeof result.interaction === "string", "Record actual native input method");
  assert.equal(result.cancelled, request.cancel, "Native result must match the requested cancel/select operation");
  if (!request.cancel) assert.equal(path.resolve(result.selectedPath), path.resolve(request.selectedPath));
}
async function nativeInput({
  page, trigger, out, name, ownerPid, selectedPath, cancel = false,
  completionProbe, timeoutMs = 600000
}) {
  const request = { requestId: crypto.randomUUID(), name, ownerPid, selectedPath, cancel,
    requestedAt: new Date().toISOString(), completion: path.join(out, `${name}-completed.json`) };
  assert(!fs.existsSync(request.completion), "Never reuse an earlier native input completion");
  fs.writeFileSync(path.join(out, "native-input-request.json"), JSON.stringify(request, null, 2));
  const initialProbeValue = completionProbe
    ? await completionProbe.inputValue().catch(() => null)
    : null;
  await trigger.click();
  console.log(JSON.stringify({ stage: "NATIVE_INPUT_REQUIRED", out, ...request }));
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(request.completion) && Date.now() < deadline) {
    if (!cancel && completionProbe) {
      const observedValue = await completionProbe.inputValue().catch(() => null);
      const normaliseWindowsPath = value => value == null ? null
        : path.resolve(String(value)).toLowerCase();
      if (normaliseWindowsPath(observedValue)
        && normaliseWindowsPath(observedValue) === normaliseWindowsPath(selectedPath)
        && normaliseWindowsPath(observedValue) !== normaliseWindowsPath(initialProbeValue)) {
        const observedCompletion = {
          status: "INPUT_COMPLETED",
          requestId: request.requestId,
          ownerPid: request.ownerPid,
          interaction: "Computer Use observed native picker completion",
          cancelled: false,
          selectedPath: observedValue,
          observedAt: new Date().toISOString()
        };
        fs.writeFileSync(request.completion, JSON.stringify(observedCompletion, null, 2), { flag: "wx" });
        break;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(fs.existsSync(request.completion), `Native ${name} input not completed before its deadline`);
  const result = JSON.parse(fs.readFileSync(request.completion, "utf8"));
  validateNativeResult(request, result);
  return { request, result };
}
async function realDownload(page, session, out, trigger) {
  // CDP passes the path to native WebView file APIs. Resolve slash-separated
  // fixture roots to a native absolute Windows path before starting a download.
  out = path.resolve(out);
  assert(fs.statSync(out).isDirectory(), "Download evidence directory must already exist");
  await session.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: out, eventsEnabled: true });
  const downloadEvents = [];
  const terminalResolvers = new Map();
  const onWillBegin = event => {
    downloadEvents.push({ type: "willBegin", ...event, at: new Date().toISOString() });
  };
  const onProgress = event => {
    downloadEvents.push({ type: "progress", ...event, at: new Date().toISOString() });
    if ((event.state === "completed" || event.state === "canceled")
      && terminalResolvers.has(event.guid)) {
      terminalResolvers.get(event.guid)(event);
      terminalResolvers.delete(event.guid);
    }
  };
  session.on("Browser.downloadWillBegin", onWillBegin);
  session.on("Browser.downloadProgress", onProgress);
  const pending = page.waitForEvent("download");
  try {
    await trigger.click();
    const download = await pending;
    const filename = download.suggestedFilename();
    assert.equal(path.basename(filename), filename, "Download filename must not contain paths");
    const begin = await new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const poll = () => {
        const item = downloadEvents.find(event => event.type === "willBegin");
        if (item) return resolve(item);
        if (Date.now() >= deadline) return reject(new Error("WebView downloadWillBegin was not observed"));
        setTimeout(poll, 20);
      };
      poll();
    });
    const guid = begin.guid;
    const alreadyTerminal = [...downloadEvents].reverse()
      .find(event => event.type === "progress" && event.guid === guid &&
        (event.state === "completed" || event.state === "canceled"));
    const progress = alreadyTerminal || await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        terminalResolvers.delete(guid);
        reject(new Error(`WebView download did not reach a terminal state: ${JSON.stringify(downloadEvents)}`));
      }, 60000);
      terminalResolvers.set(guid, event => {
        clearTimeout(timer);
        resolve(event);
      });
    });
    assert(progress && progress.guid === guid, "WebView download progress belonged to another download");
    assert.equal(progress.state, "completed",
      `WebView download ended as ${progress.state}: ${JSON.stringify(downloadEvents)}`);
    const requestedPath = path.resolve(out, filename);
    const reportedPath = progress.filePath ? path.resolve(progress.filePath) : requestedPath;
    assert(inside(out, reportedPath), `WebView download escaped its evidence directory: ${reportedPath}`);
    const file = reportedPath;
    const deadline = Date.now() + 10000;
    while ((!fs.existsSync(file) || fs.existsSync(`${file}.crdownload`)) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 100));
    assert(fs.existsSync(file) && !fs.existsSync(`${file}.crdownload`),
      `WebView reported completed but file is missing: ${JSON.stringify({ file, requestedPath, downloadEvents })}`);
    assert.equal(fs.statSync(file).size, progress.receivedBytes, "Downloaded bytes must match CDP");
    assert.equal(progress.receivedBytes, progress.totalBytes, "WebView must receive the entire artifact");
    return { path: file, sha256: sha256(fs.readFileSync(file)), bytes: fs.statSync(file).size,
      generatedAt: fs.statSync(file).mtime.toISOString(), source: "actual installed WebView download",
      cdp: { guid, suggestedFilename: filename, targetPath: file,
        progress: downloadEvents.filter(event => event.guid === guid) } };
  } finally {
    session.off("Browser.downloadWillBegin", onWillBegin);
    session.off("Browser.downloadProgress", onProgress);
  }
}
module.exports = { sha256, inside, readInstalledSession, projectSnapshot, assertProjectContentUnchanged, assetBytes, settleEditor,
  settleRuntime, dismissEnvironmentCompletion, select, nativeInput, validateNativeResult, realDownload };
