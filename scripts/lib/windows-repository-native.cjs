"use strict";
// Actual owned Windows dialogs/WM_CLOSE. Never label these as Computer Use.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { rows, listeners, ps, until } = require("./current-native-editor-session.cjs");
const { validateNativeResult } = require("./installed-acceptance.cjs");
const exec = promisify(execFile);
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file) });
const pickerScript = path.resolve(__dirname, "../gui-directory-picker-uia.ps1");
const PICKER = "Windows UI Automation owned native directory picker";
const CLOSE = "Windows Process.CloseMainWindow (WM_CLOSE), not physical input";
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
function owned(pid, created) {
  assert(Number.isSafeInteger(pid) && pid > 0);
  const row = rows().find(p => p.ProcessId === pid);
  assert(row && (!created || row.Created === created), "Native target identity must be live and owned");
  return row;
}
function freshRequest(out, name, identity, fields = {}) {
  const relative = path.relative(path.resolve("F:/AgentVN/QA"), path.resolve(out));
  assert(relative && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..");
  const request = { name, requestId: crypto.randomUUID(), ownerPid: identity.ProcessId,
    created: identity.Created, executable: identity.ExecutablePath, requestedAt: new Date().toISOString(),
    completion: path.join(out, `${name}-completed.json`), ...fields };
  assert(!fs.existsSync(request.completion), "Never reuse a previous native completion");
  fs.writeFileSync(path.join(out, "native-input-request.json"), JSON.stringify(request, null, 2));
  return request;
}
function validatePicker(request, result) {
  validateNativeResult(request, result);
  assert.equal(result.interaction, PICKER);
  assert.equal(result.created, request.created);
  assert.equal(result.helper.sha256, sha(result.helper.path));
  const helper = read(result.helper.path);
  assert.equal(helper.status, "PASS"); assert.equal(helper.ownerPid, request.ownerPid);
  assert.equal(helper.method, "Windows UI Automation"); assert.equal(helper.cancel, false);
  assert.equal(helper.file, false); assert(helper.handle && helper.controls.length > 0);
  assert.equal(path.resolve(helper.directory), path.resolve(request.selectedPath));
  assert.equal(result.helperScript.sha256, sha(pickerScript));
  assert.equal(path.resolve(result.helperScript.path), pickerScript);
  assert(fs.existsSync(helper.screenshot));
}
function validateClose(request, receipt) {
  assert.equal(receipt.status, "INPUT_COMPLETED"); assert.equal(receipt.interaction, CLOSE);
  for (const key of ["requestId", "ownerPid", "created"]) assert.equal(receipt[key], request[key]);
  assert.equal(receipt.method, "REPOSITORY_WM_CLOSE_NATURAL_EXIT");
  assert.equal(receipt.physicalInputVerified, false);
  assert.equal(receipt.requestEvidence.sha256, sha(receipt.requestEvidence.path));
  const sent = read(receipt.requestEvidence.path);
  assert.equal(sent.ownerPid, request.ownerPid); assert.equal(sent.created, request.created);
  assert.equal(sent.executable, request.executable);
  assert.equal(sent.accepted, true); assert.notEqual(sent.handle, 0);
  assert.equal(receipt.naturalExitObserved, true);
  assert.deepEqual(receipt.survivingOwned, []); assert.deepEqual(receipt.remainingListeners, []);
  assert(Date.parse(receipt.finishedAt) >= Date.parse(sent.at));
}
async function nativeInput({ page, trigger, out, name, ownerPid, selectedPath, cancel = false, completionProbe }) {
  assert.equal(cancel, false, "This publishing adapter only selects a real output directory");
  const identity = owned(ownerPid), request = freshRequest(out, name, identity, { selectedPath, cancel });
  const helperFile = path.join(out, `${name}-uia.json`);
  assert(!fs.existsSync(helperFile));
  const before = await completionProbe.inputValue();
  assert.notEqual(path.resolve(before || "."), path.resolve(selectedPath));
  await trigger.click();
  const { stdout, stderr } = await exec("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", pickerScript, "-OwnerPid", String(ownerPid), "-ReportPath", helperFile,
    "-Directory", selectedPath, "-TitlePattern", "输出|选择|目录|文件夹|Select|Folder"],
  { windowsHide: true, encoding: "utf8", timeout: 45000 });
  fs.writeFileSync(path.join(out, `${name}-uia.log`), stdout + stderr, { flag: "wx" });
  await until(async () => path.resolve(await completionProbe.inputValue()) === path.resolve(selectedPath),
    "actual native output selection reflected in installed UI", 15000);
  owned(ownerPid, identity.Created);
  const result = { status: "INPUT_COMPLETED", requestId: request.requestId, ownerPid,
    created: identity.Created, interaction: PICKER, cancelled: false, selectedPath,
    helper: describe(helperFile), helperScript: describe(pickerScript), observedAt: new Date().toISOString() };
  validatePicker(request, result);
  fs.writeFileSync(request.completion, JSON.stringify(result, null, 2), { flag: "wx" });
  return { request, result };
}
function sendClose(request, out) {
  owned(request.ownerPid, request.created);
  const evidence = path.join(out, `${request.name}-wm-close.json`);
  assert(!fs.existsSync(evidence));
  const result = JSON.parse(ps(
    `$c=Get-CimInstance Win32_Process -Filter 'ProcessId=${request.ownerPid}';` +
    `if(!$c -or $c.CreationDate.ToUniversalTime().ToString('o') -cne ${quote(request.created)}){throw 'PID identity changed'};` +
    `$p=Get-Process -Id ${request.ownerPid} -ErrorAction Stop;` +
    `if($p.MainWindowHandle -eq 0){throw 'Native main window missing'};` +
    `$h=$p.MainWindowHandle.ToInt64();$accepted=$p.CloseMainWindow();` +
    `@{ownerPid=${request.ownerPid};created=$c.CreationDate.ToUniversalTime().ToString('o');` +
    "executable=$c.ExecutablePath;handle=$h;accepted=$accepted;at=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress"));
  fs.writeFileSync(evidence, JSON.stringify(result, null, 2), { flag: "wx" });
  assert.equal(result.accepted, true);
  return describe(evidence);
}
async function normalEditorClose({ owner, out, report }) {
  const launch = owner.current, identity = owned(launch.pid, launch.created);
  const request = freshRequest(out, "windows-editor-normal-close", identity);
  const requestEvidence = sendClose(request, out);
  await until(() => !rows().some(p => p.ProcessId === launch.pid && p.Created === launch.created)
    && listeners(launch.ports).length === 0, "real WM_CLOSE Editor/backend exit", 45000);
  const known = report.knownProcesses;
  const live = rows(), survivingOwned = known.filter(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
  const receipt = { status: "INPUT_COMPLETED", requestId: request.requestId, ownerPid: request.ownerPid,
    created: request.created, interaction: CLOSE, method: "REPOSITORY_WM_CLOSE_NATURAL_EXIT",
    physicalInputVerified: false, requestEvidence, naturalExitObserved: true, survivingOwned,
    remainingListeners: listeners(launch.ports), finishedAt: new Date().toISOString() };
  validateClose(request, receipt);
  fs.writeFileSync(request.completion, JSON.stringify(receipt, null, 2), { flag: "wx" });
  await owner.stop("Observed real WM_CLOSE natural exit");
  assert.deepEqual(report.cleanups.at(-1).killed, []);
  return { request, receipt };
}
module.exports = { nativeInput, normalEditorClose, validatePicker, validateClose, freshRequest, sendClose, CLOSE };
