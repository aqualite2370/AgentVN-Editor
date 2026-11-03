"use strict";
// Serial continuation of one already-live native run. Never restart it, retry a
// failed product test, or let different suites share the native profile.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { rows } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = path.resolve(__dirname, ".."), directory = "F:/AgentVN/QA/Functional-Continuation-20261101";
const [pid, created, attempt = "01"] = process.argv.slice(2);
assert(/^\d{2}$/.test(attempt));
const target = path.join(directory, `functional-followup-runtime-20261102-${attempt}.json`);
const settings = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/settings-effects-1935-01/report.json";
const title = "F:/AgentVN/QA/Title-Text-1.9.35-20261102-01/editor-01/report.json";
const player = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/title-text-1935-01/report.json";
const opening = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/opening-functional-1935-01/report.json";
const assetsAuthor = "F:/AgentVN/QA/Assets-Frozen-1.9.35-20261102-01/editor-01/report.json";
const assetsPlayer = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/installed-assets-frozen-01/report.json";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
assert(/^\d+$/.test(pid) && typeof created === "string");
assert(!fs.existsSync(target)); assert(!fs.existsSync(title) && !fs.existsSync(player) && !fs.existsSync(opening));
const live = rows().find(p => p.ProcessId === Number(pid) && p.Created === created);
assert(live && /current-settings-effects\.cjs\s+run\s+01/.test(live.CommandLine), "Must observe the original live process");
assert.equal(read(settings).status, "RUNNING");
const frozen = ["scripts/current-settings-effects.cjs", "scripts/current-title-text-closure.cjs",
  "scripts/current-opening-functional.cjs", "scripts/current-assets-closure.cjs", __filename]
  .map(f => desc(path.resolve(root, f)));
const report = { status: "WAITING_EXISTING_SETTINGS", startedAt: new Date().toISOString(),
  originalProcess: live, settingsReport: settings, frozen, stages: [], modelRequests: 0, productChanges: 0, builds: 0,
  scope: "SERIAL_QA_CONTINUATION_NO_REPLAY_NO_PRODUCT_FIXES" };
const save = () => fs.writeFileSync(target, JSON.stringify(report, null, 2));
const verify = () => { for (const f of frozen) assert.equal(sha(f.path), f.sha256, "Queued QA changed: " + f.path); };
const idle = () => assert(!rows().some(p => /^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)),
  "Another native session is active; do not reuse or terminate it");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function command(label, args) {
  verify(); idle();
  const log = path.join(directory, "functional-followup-" + label + "-20261102-" + attempt + ".log");
  const fd = fs.openSync(log, "wx"), entry = { label, command: [process.execPath, ...args], log,
    startedAt: new Date().toISOString(), status: "RUNNING" };
  report.stages.push(entry); report.status = label.toUpperCase(); save(); console.log("START " + label);
  let child;
  try {
    child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd] });
  } finally { fs.closeSync(fd); }
  entry.pid = child.pid; save();
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  entry.exitCode = code; entry.finishedAt = new Date().toISOString(); entry.status = code === 0 ? "PASS" : "FAILED";
  entry.output = desc(log); verify(); save(); console.log(entry.status + " " + label);
  return entry.status === "PASS";
}
function restored(file, field) {
  const r = read(file), proof = r[field];
  assert(r.finishedAt && r.status !== "RUNNING", "Run has not reached its final cleanup");
  assert(!r.cleanupError && !r.cacheError, "Preserve cleanup failure; do not start another suite");
  assert(proof, "No profile/cache restoration evidence");
  const evidence = typeof proof.path === "string" ? read(proof.path) : proof;
  assert.equal(evidence.status, "PASS"); idle(); return r;
}
(async () => {
  save(); console.log("WAIT original settings PID " + pid + "; no replacement run");
  let milestone = -1;
  while (rows().some(p => p.ProcessId === Number(pid) && p.Created === created)) {
    const r = read(settings), completed = r.cells.filter(c => c.status === "PASS").length;
    if (Math.floor(completed / 4) > milestone) {
      milestone = Math.floor(completed / 4); console.log("SETTINGS completed " + completed + "/24");
    }
    await delay(15000);
  }
  verify();
  const settingsResult = restored(settings, "profileRestoration");
  report.settingsResult = desc(settings); report.settingsStatus = settingsResult.status; save();
  if (settingsResult.status === "PASS")
    await command("settings-audit", ["scripts/current-settings-effects.cjs", "audit", "01"]);
  else assert.equal(settingsResult.status, "FAILED", "Unknown terminal status; investigate instead of continuing");
  const authorPassed = await command("title-editor", ["scripts/current-title-text-closure.cjs", "editor"]);
  restored(title, "cacheRestoration");
  if (authorPassed) {
    await command("title-player", ["scripts/current-title-text-closure.cjs", "player"]);
    restored(player, "profileRestoration");
  } else report.titlePlayer = { status: "BLOCKED", reason: "Authoring chain failed; no fabricated consumer input" };
  await command("opening", ["scripts/current-opening-functional.cjs", "run"]);
  restored(opening, "profileRestoration");
  const assetsPassed = await command("assets-editor", ["scripts/current-assets-closure.cjs", "editor"]);
  restored(assetsAuthor, "cacheRestoration");
  if (assetsPassed) {
    const mediaPassed = await command("assets-player", ["scripts/current-assets-closure.cjs", "player"]);
    restored(assetsPlayer, "profileRestoration");
    if (mediaPassed) await command("assets-audit", ["scripts/current-assets-closure.cjs", "audit"]);
  } else report.assetsPlayer = { status: "BLOCKED", reason: "No current-candidate replacement export after author failure" };
  report.status = report.settingsStatus === "PASS" && report.stages.every(s => s.status === "PASS")
    ? "PASS_LIMITED_FUNCTIONAL_GROUPS" : "COMPLETED_WITH_FAILURES";
})().catch(e => {
  report.status = "STOPPED_REQUIRES_REVIEW"; report.error = String(e.stack || e); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, report: target, error: report.error }));
});
