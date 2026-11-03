"use strict";
// Read-only recovery of the original installed failure's frame and timestamp.
// Never upgrades the original product failure or rewrites earlier audit evidence.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const qa = "F:/AgentVN/QA/Installed-Portrait-20261021-01";
const out = path.join(qa, "native-log-supplement-01");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const output = path.join(out, "report.json");
assert(!fs.existsSync(output), "Do not overwrite evidence");
const original = path.join(qa, "editor-03/report.json"), author = read(original);
const auditFile = path.join(qa, "audit-01/report.json"), audit = read(auditFile);
assert.equal(author.status, "FAILED");
assert.equal(audit.status, "EVIDENCE_AUDIT_PASS_PRODUCT_FAILED");
assert(author.errors.some(e => e.includes("#185")));
const logfile = path.join(out, "editor-frontend.log");
const events = fs.readFileSync(logfile, "utf8").split(/\r?\n/).flatMap((line, i) => {
  const m = line.match(/^\[(\d+)\] \[([^\]]+)\] (.+)$/);
  if (!m) return [];
  const data = JSON.parse(m[3]);
  return JSON.stringify(data.error).includes("Minified React error #185")
    ? [{ line: i + 1, hostTimestamp: Number(m[1]), channel: m[2], ...data }] : [];
});
assert.equal(events.length, 2);
assert.deepEqual(events.map(e => e.channel).sort(), ["player.console", "player.window"]);
for (const e of events) {
  assert(e.page.startsWith("http://tauri.localhost/gamecli-preview/"));
  assert(Date.parse(e.time) >= Date.parse(author.startedAt) && Date.parse(e.time) <= Date.parse(author.finishedAt));
}
const stack = events.find(e => e.channel === "player.window").error.stack;
assert(stack.includes("StoryPlayer-CN3mkFec.js:2:7678"));
const chunk = path.resolve(__dirname, "../editor/dist/gamecli-preview/assets/StoryPlayer-CN3mkFec.js");
const line = fs.readFileSync(chunk, "utf8").split("\n")[1], column = 7678;
const context = line.slice(column - 180, column + 260);
assert(context.includes('closest(".story-player")'));
assert(context.includes("Bt(null)"));
const report = {
  status: "PASS_EVIDENCE_RECOVERY_PRODUCT_FAILURE_REMAINS_OPEN",
  capturedAt: new Date().toISOString(),
  source: desc(original), previousAudit: desc(auditFile), nativeLogCopy: desc(logfile),
  failureId: "INSTALLED-LAYOUT-REACT185-01",
  productStatus: "FAILED",
  events,
  layer: "EMBEDDED_GAMECLI_RUNTIME_PREVIEW",
  firstErrorAt: events[0].time,
  localSameNamedChunkObservation: { ...desc(chunk), line: 2, column, context,
    sourceCandidate: "GameCli_framework/src/components/player/DialogBox.tsx bubble placement layout effect",
    limitation: "Same named local build chunk, not extracted from installed EXE; surfaced setter is not proof of initiating cause" },
  claim: "Original QA pageerror included child frames; do not describe this as proven outer Editor React failure",
  previousAuditUnchanged: true, productModification: false, runtimeOrEditorAcceptance: false,
};
fs.copyFileSync(__filename, path.join(out, "executed-supplement.cjs"), fs.constants.COPYFILE_EXCL);
fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, layer: report.layer, firstErrorAt: report.firstErrorAt, out }));
