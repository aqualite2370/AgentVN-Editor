"use strict";
// Additive offline review of this exact normal-embedded run. Retain failed
// startup/gameplay observations; source attribution never proves event recovery.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const { parseThreadtime, pairStderrRelays } = require("./lib/android-log-relay.cjs");
const { matchVolatileIdentityMessage } = require("./lib/android-log-volatile-identity.cjs");
const base = "F:/testavn/Sprite-Embedded-Android-1975-20261116-01";
const output = path.join(base, "current-log-review-01.json");
assert(!fs.existsSync(output), "Preserve earlier evidence");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file) });
const referenceFile = "F:/testavn/Client-Presentation-Android-1975-20261116-04/current-log-review-02.json";
const reference = read(referenceFile);
assert.equal(reference.records, 271); assert.equal(reference.unresolved, 92);
const result = { status: "RUNNING", at: new Date().toISOString(), rows: [], cases: [],
  inputs: [desc(referenceFile)], sources: {}, productStarts: 0, builds: 0, models: 0,
  original271Unresolved92Unchanged: true, historicalAcceptanceApplied: false,
  scope: "EXACT_THREE_EMBEDDED_SESSIONS_OFFLINE_REVIEW_NOT_PHYSICAL_PHONE_OR_EVENT_RECOVERY" };
const expectedSources = {
  "art-x86-variant": ["Unexpected CPU variant for x86:", "return Create(x86_64"],
  "art-x86-known-variants": ["Known variants:", "return Create(x86_64"],
  "art-jdwp-unavailable": ["Not starting debugger since process cannot load the jdwp agent.", "IsDebuggableOrProfilable()"],
  "framework-jank-config": ["Initializing without READ_DEVICE_CONFIG permission.", "context.getPackageName()"],
  "provider-optional-dex-metadata": ['kDmExtension = ".dm"', "if (dm_file != nullptr)"],
};
for (const [rule, probes] of Object.entries(expectedSources)) {
  const sample = reference.rows.find(row => row.rule === rule && row.reference);
  assert(sample, rule);
  const source = sample.reference;
  assert.equal(sha(source.path), source.sha256);
  assert(source.url.includes("refs/tags/android-15.0.0_r1/"));
  const text = fs.readFileSync(source.path, "utf8");
  for (const probe of probes) assert(text.includes(probe), rule + ": " + probe);
  result.sources[rule] = source; result.inputs.push(source);
}
try {
  for (const [session, type, failed] of [
    ["device-01", "agentvn", false], ["device-01", "renpy", true], ["device-02", "renpy", false],
  ]) {
    const reportFile = path.join(base, session, "report.json"), report = read(reportFile);
    const c = report.cases.find(row => row.type === type);
    assert(c?.pid && c.package);
    assert.equal(report.environment.sdk, "35"); assert.equal(report.environment.abi, "x86_64");
    if (failed) assert.equal(report.status, "FAILED"); else assert.equal(c.status, "PASS");
    const log = failed ? desc(path.join(base, session, "failure-logcat.txt")) : c.logcat;
    assert.equal(sha(log.path), log.sha256);
    result.inputs.push(desc(reportFile), log);
    const raw = fs.readFileSync(log.path, "utf8");
    const scoped = scopedRuntimeLog(raw, c.package, [c.pid]);
    if (!failed) assert.deepEqual(scoped.messages, c.logReview.messages);
    assert.deepEqual(scoped.fatal, []);
    const context = { sdk: report.environment.sdk, abi: report.environment.abi,
      packageName: c.package, presentationPassed: !failed, hostPids: [+c.pid],
      rendererNames: {}, providerLoads: {} };
    const ownershipLines = [], providerLines = [];
    for (const line of raw.split(/\r?\n/)) {
      const parsed = parseThreadtime(line); if (!parsed) continue;
      const proc = /^Start proc (\d+):([^/\s]+)\/\S+ for\s+\{([^/]+)\/[^}]+\}/.exec(parsed.message);
      if (parsed.tag === "ActivityManager" && proc && proc[3] === c.package
        && proc[2].includes(":sandboxed_process")) {
        context.rendererNames[+proc[1]] = proc[2]; ownershipLines.push(line);
      }
      const provider = /^Loading (com\.google\.android\.webview) version ([\d.]+) \(code (\d+)\)$/.exec(parsed.message);
      if (parsed.tag === "WebViewFactory" && provider) {
        context.providerLoads[parsed.pid] = { name: provider[1], version: provider[2], code: provider[3] };
        providerLines.push(line);
      }
    }
    const pairs = pairStderrRelays(scoped.messages, scoped.pids);
    const rows = scoped.messages.map((line, i) => {
      const record = parseThreadtime(line); assert(record);
      const rule = matchVolatileIdentityMessage(record, context);
      const pair = pairs.find(pair => pair.relayIndex === i);
      return { key: session + "/" + type + "#" + (i + 1), line, ...record,
        status: rule ? "NON_BLOCKING_CURRENT_LOCAL_FUNCTION_SCOPE" : "UNRESOLVED_CURRENT_EVENT",
        ...(rule ? { rule, source: result.sources[rule],
          reason: "Exact emitter source and current host/provider identity bound; local sprite functions passed. No original-event recovery or global compatibility claim." } : {
          reason: failed ? "Original FAILED session remains without complete functional evidence."
            : "Current call/recovery boundary is unproven; no historical exemption applied.",
        }),
        ...(pair ? { parentKey: session + "/" + type + "#" + (pair.nativeIndex + 1),
          relayDelayMs: pair.delayMs } : {}) };
    });
    assert.deepEqual(rows.map(row => row.line), scoped.messages);
    result.rows.push(...rows);
    result.cases.push({ session, type, originalStatus: report.status, caseStatus: c.status,
      context, ownershipLines, providerLines, log, records: rows.length, mirrors: pairs.length,
      unresolved: rows.filter(row => row.status === "UNRESOLVED_CURRENT_EVENT").length, fatal: scoped.fatal });
  }
  assert.equal(result.cases.length, 3);
  assert.equal(new Set(result.rows.map(row => row.key)).size, result.rows.length);
  result.records = result.rows.length;
  result.unresolved = result.rows.filter(row => row.status === "UNRESOLVED_CURRENT_EVENT").length;
  result.nonBlockingCurrentLocalScope = result.records - result.unresolved;
  result.mirrors = result.cases.reduce((n, c) => n + c.mirrors, 0);
  assert(result.records > 0 && result.unresolved > 0);
  for (const file of result.inputs) assert.equal(sha(file.path), file.sha256);
  result.status = "FUNCTIONS_PASS_CURRENT_LOG_EVENTS_UNRESOLVED_ORIGINAL_FAILURE_RETAINED";
} catch (error) { result.status = "FAILED"; result.error = error.stack; process.exitCode = 1; }
finally {
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, records: result.records, unresolved: result.unresolved,
    localScope: result.nonBlockingCurrentLocalScope, mirrors: result.mirrors, error: result.error, output }));
}
