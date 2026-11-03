"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFile } = require("node:child_process"), { promisify } = require("node:util");
const { sha } = require("./installed-runtime-session.cjs");
const { rows, listeners, until } = require("./current-native-editor-session.cjs");
const close = require("./editor-upgrade-wm-close.cjs");
const script = path.resolve(__dirname, "../editor-migration-consent-uia.ps1");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: file, sha256: sha(file) });
const normalize = text => String(text).replaceAll("/", "\\").replaceAll("\\\\?\\", "").toLowerCase();
function validateConsent(request, result) {
  assert.equal(result.status, "PASS"); assert.equal(result.method, "Windows UI Automation owned migration Yes");
  assert.equal(result.pid, request.pid); assert.equal(result.created, request.created);
  assert.equal(result.physicalInput, false);
  assert.equal(sha(result.helper.path), result.helper.sha256);
  assert.equal(path.resolve(result.helperScript.path), script);
  assert.equal(sha(script), result.helperScript.sha256);
  const helper = read(result.helper.path);
  assert.equal(helper.status, "PASS"); assert.equal(helper.ownerPid, request.pid);
  assert.equal(helper.created, request.created); assert.equal(helper.method, result.method);
  assert.equal(helper.expectedSource, request.source); assert.equal(helper.physicalInput, false);
  assert.equal(helper.title, "迁移 AgentVN 项目数据"); assert(helper.handle);
  assert(normalize(helper.text).includes(normalize(request.source)));
  assert(helper.controls.length > 0 && helper.inputAt && helper.button);
  assert.equal(sha(request.source), request.sourceSha256);
}
async function consent(request, out) {
  const helperFile = path.join(out, "migration-uia.json");
  const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
  // Windows PowerShell 5.1 otherwise reads BOM-less UTF-8 source as the ACP.
  // Parse the exact, hashed helper explicitly as UTF-8, without rewriting it.
  const command = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);" +
    `& ([scriptblock]::Create([IO.File]::ReadAllText(${quote(script)},[Text.Encoding]::UTF8))) ` +
    `-OwnerPid ${request.pid} -Created ${quote(request.created)} ` +
    `-ExpectedSource ${quote(request.source)} -ReportPath ${quote(helperFile)}`;
  const result = await promisify(execFile)("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
    "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")],
  { windowsHide: true, encoding: "utf8", timeout: 50000 });
  fs.writeFileSync(path.join(out, "migration-uia.log"), result.stdout + result.stderr, { flag: "wx" });
  const receipt = { status: "PASS", pid: request.pid, created: request.created,
    method: "Windows UI Automation owned migration Yes", physicalInput: false,
    helper: describe(helperFile), helperScript: describe(script) };
  validateConsent(request, receipt);
  fs.writeFileSync(request.completion, JSON.stringify(receipt, null, 2), { flag: "wx" });
  return receipt;
}
async function closeInstalled({ launch, known, out }) {
  try { return await close.close({ launch, known, out }); }
  catch (error) {
    const evidenceFile = path.join(out, `editor-${launch.label}-normal-close-wm-close.json`);
    const requestFile = path.join(out, launch.label + "-close-request.json");
    // Preserve a failure only after a real, accepted WM_CLOSE. Attribution
    // failures remain fatal and cannot become a historical-product exception.
    const sent = read(evidenceFile);
    assert.equal(sent.ownerPid, launch.pid); assert.equal(sent.created, launch.created);
    assert.equal(sent.accepted, true);
    const live = rows(), remaining = known.filter(p => live.some(q => p.ProcessId === q.ProcessId && p.Created === q.Created));
    const observation = {
      status: "FAILED", normalClose: false, physicalInput: false, method: close.METHOD,
      label: launch.label, pid: launch.pid, created: launch.created, hostExited:
        !live.some(p => p.ProcessId === launch.pid && p.Created === launch.created),
      remainingBackend: remaining.filter(p => p.Name === "creator-backend.exe"),
      remainingOwned: remaining, remainingPorts: listeners(launch.ports),
      request: describe(requestFile), nativeEvidence: describe(evidenceFile),
      error: String(error.stack || error), finishedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(out, launch.label + "-close-native.json"), JSON.stringify(observation, null, 2), { flag: "wx" });
    fs.writeFileSync(path.join(out, "old-close-observation.json"), JSON.stringify(observation, null, 2), { flag: "wx" });
    throw error;
  }
}
function validateFailedOld(observation, launch) {
  assert.equal(observation.status, "FAILED"); assert.equal(observation.normalClose, false);
  assert.equal(observation.physicalInput, false); assert.equal(observation.method, close.METHOD);
  assert.equal(observation.pid, launch.pid); assert.equal(observation.created, launch.created);
  assert.equal(observation.hostExited, true);
  assert(observation.remainingBackend.length > 0 && observation.remainingPorts.length > 0);
  for (const file of [observation.request, observation.nativeEvidence]) assert.equal(sha(file.path), file.sha256);
  const sent = read(observation.nativeEvidence.path);
  assert.equal(sent.ownerPid, launch.pid); assert.equal(sent.created, launch.created); assert.equal(sent.accepted, true);
}
function business(input) {
  let source = input;
  const one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after);
  };
  const start = source.indexOf("async function closeNormally(label){"), end = source.indexOf("async function forceCleanup()", start);
  assert(start > 0 && end > start);
  one(source.slice(start, end), `async function closeNormally(label){
  assert.equal(label,current.label);remember();
  const result=await require("./lib/editor-cross-repository-native.cjs").closeInstalled({launch:current,known:report.known,out});
  fs.writeFileSync(path.join(out,label+"-close-native.json"),JSON.stringify(result,null,2),{flag:"wx"});
  await browser.close().catch(()=>{});browser=null;child=null;
  report.cleanups.push({label,status:"PASS",normalClose:true,method:result.method,killed:[],ports:current.ports});save();
  return result;
}
`);
  one('await until(()=>fs.existsSync(request.completion),"real native migration consent receipt",120000);',
    'await require("./lib/editor-cross-repository-native.cjs").consent(request,out);');
  one('assert.equal(consent.pid,child.pid);assert.equal(consent.method,"Computer Use native Yes");',
    'require("./lib/editor-cross-repository-native.cjs").validateConsent(request,consent);');
  one('  productChanges:0,modelRequests:0,steps:[]',
    '  nativeInput:"WINDOWS_UI_AUTOMATION_AND_WM_CLOSE_NOT_COMPUTER_USE",productChanges:0,modelRequests:0,steps:[]');
  return source;
}
module.exports = { business, consent, validateConsent, closeInstalled, validateFailedOld };
