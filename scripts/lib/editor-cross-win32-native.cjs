"use strict";
// Use bounded Win32 dialog access instead of a potentially blocked UIA provider.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { promisify } = require("node:util"), { execFile } = require("node:child_process");
const { sha } = require("./installed-runtime-session.cjs");
const base = require("./editor-cross-repository-native.cjs");
const script = path.resolve(__dirname, "../editor-migration-consent-win32.ps1");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const method = "Windows Win32 owned migration Yes BM_CLICK";
const norm = s => String(s).replaceAll("/", "\\").replaceAll("\\\\?\\", "").toLowerCase();
function validateConsent(request, result) {
  assert.equal(result.status, "PASS"); assert.equal(result.method, method);
  assert.equal(result.pid, request.pid); assert.equal(result.created, request.created);
  assert.equal(result.physicalInput, false);
  assert.equal(result.helper.sha256, sha(result.helper.path));
  assert.equal(path.resolve(result.helperScript.path), script);
  assert.equal(result.helperScript.sha256, sha(script));
  const helper = read(result.helper.path);
  assert.equal(helper.status, "PASS"); assert.equal(helper.method, method);
  assert.equal(helper.ownerPid, request.pid); assert.equal(helper.created, request.created);
  assert.equal(helper.expectedSource, request.source); assert.equal(helper.physicalInput, false);
  assert.equal(helper.title, "迁移 AgentVN 项目数据"); assert(helper.handle);
  assert(norm(helper.text).includes(norm(request.source)));
  assert(helper.controls.length > 0); assert.equal(helper.button.id, 6);
  assert.equal(helper.button.className, "Button"); assert.equal(helper.button.enabled, true);
  assert.equal(helper.inputMethod, "Owned Win32 Button ID6 BM_CLICK");
  assert.equal(sha(request.source), request.sourceSha256);
}
async function consent(request, out) {
  const helperFile = path.join(out, "migration-win32.json");
  const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
  const command = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';" +
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);" +
    `& ([scriptblock]::Create([IO.File]::ReadAllText(${quote(script)},[Text.Encoding]::UTF8))) ` +
    `-OwnerPid ${request.pid} -Created ${quote(request.created)} ` +
    `-ExpectedSource ${quote(request.source)} -ReportPath ${quote(helperFile)}`;
  const output = await promisify(execFile)("powershell.exe", ["-NoProfile", "-EncodedCommand",
    Buffer.from(command, "utf16le").toString("base64")],
  { windowsHide: true, encoding: "utf8", timeout: 50000 });
  fs.writeFileSync(path.join(out, "migration-win32.log"), output.stdout + output.stderr, { flag: "wx" });
  const result = { status: "PASS", method, pid: request.pid, created: request.created,
    physicalInput: false, helper: { path: helperFile, sha256: sha(helperFile) },
    helperScript: { path: script, sha256: sha(script) } };
  validateConsent(request, result);
  fs.writeFileSync(request.completion, JSON.stringify(result, null, 2), { flag: "wx" });
  return result;
}
function business(source) {
  return base.business(source).replaceAll("./lib/editor-cross-repository-native.cjs",
    "./lib/editor-cross-win32-native.cjs").replace("WINDOWS_UI_AUTOMATION_AND_WM_CLOSE_NOT_COMPUTER_USE",
    "WIN32_BM_CLICK_AND_WM_CLOSE_NOT_COMPUTER_USE");
}
module.exports = { ...base, business, consent, validateConsent };
