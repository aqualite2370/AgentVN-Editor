"use strict";
// Review every scoped warning from both failed boots and the successful tail.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const { parseThreadtime, pairStderrRelays } = require("./lib/android-log-relay.cjs");
const { matchVolatileIdentityMessage } = require("./lib/android-log-volatile-identity.cjs");
const base = "F:/testavn/Renpy-Quick-Placement-Android-1981-20261116-01";
const output = path.join(base, "current-log-review-01.json"); assert(!fs.existsSync(output));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
const referenceFile = "F:/testavn/Client-Presentation-Android-1975-20261116-04/current-log-review-02.json";
const reference = read(referenceFile); assert.equal(reference.records, 271); assert.equal(reference.unresolved, 92);
const result = { status: "RUNNING", at: new Date().toISOString(), rows: [], cases: [], inputs: [desc(referenceFile)], sources: {},
  productStarts: 0, builds: 0, models: 0, historicalAcceptanceApplied: false, original271Unresolved92Unchanged: true,
  scope: "THREE_ACTUAL_NATIVE032_CUSTOM_BAR_BOOTS_OFFLINE_LOG_REVIEW_NOT_EVENT_RECOVERY_OR_PHYSICAL_PHONE" };
try {
  for (const [rule, probes] of Object.entries({
    "art-x86-variant": ["Unexpected CPU variant for x86:", "return Create(x86_64"],
    "art-x86-known-variants": ["Known variants:", "return Create(x86_64"],
    "art-jdwp-unavailable": ["Not starting debugger since process cannot load the jdwp agent.", "IsDebuggableOrProfilable()"],
    "framework-jank-config": ["Initializing without READ_DEVICE_CONFIG permission.", "context.getPackageName()"],
    "provider-optional-dex-metadata": ['kDmExtension = ".dm"', "if (dm_file != nullptr)"],
  })) {
    const source = reference.rows.find(r => r.rule === rule && r.reference)?.reference; assert(source, rule);
    assert.equal(sha(source.path), source.sha256); assert(source.url.includes("refs/tags/android-15.0.0_r1/"));
    const text = fs.readFileSync(source.path, "utf8"); for (const probe of probes) assert(text.includes(probe));
    result.sources[rule] = source; result.inputs.push(source);
  }
  for (const session of ["device-01", "device-02", "device-03"]) {
    const reportFile = path.join(base, session, "report.json"), report = read(reportFile), c = report.cases[0];
    const passed = session === "device-03";
    assert.equal(report.environment.sdk, "35"); assert.equal(report.environment.abi, "x86_64");
    if (passed) { assert.equal(c.status, "PASS"); assert(report.status.startsWith("PASS1981")); }
    else assert.equal(report.status, "FAILED");
    const log = passed ? c.logcat : desc(path.join(base, session, "failure-logcat.txt")); assert.equal(sha(log.path), log.sha256);
    result.inputs.push(desc(reportFile), log);
    const raw = fs.readFileSync(log.path, "utf8"), hostPids = [c.pid, c.restartPid].filter(Boolean).map(Number);
    const scoped = scopedRuntimeLog(raw, c.package, hostPids); assert.deepEqual(scoped.fatal, []);
    if (passed) assert.deepEqual(scoped.messages, c.logReview.messages);
    const context = { sdk: report.environment.sdk, abi: report.environment.abi, packageName: c.package,
      presentationPassed: passed, hostPids, rendererNames: {}, providerLoads: {} };
    const ownershipLines = [], providerLines = [];
    for (const line of raw.split(/\r?\n/)) {
      const p = parseThreadtime(line); if (!p) continue;
      const proc = /^Start proc (\d+):([^/\s]+)\/\S+ for\s+\{([^/]+)\/[^}]+\}/.exec(p.message);
      if (p.tag === "ActivityManager" && proc && proc[3] === c.package && proc[2].includes(":sandboxed_process")) {
        context.rendererNames[+proc[1]] = proc[2]; ownershipLines.push(line);
      }
      const provider = /^Loading (com\.google\.android\.webview) version ([\d.]+) \(code (\d+)\)$/.exec(p.message);
      if (p.tag === "WebViewFactory" && provider) {
        context.providerLoads[p.pid] = { name: provider[1], version: provider[2], code: provider[3] }; providerLines.push(line);
      }
    }
    const pairs = pairStderrRelays(scoped.messages, scoped.pids);
    const rows = scoped.messages.map((line, i) => {
      const record = parseThreadtime(line); assert(record);
      const rule = matchVolatileIdentityMessage(record, context), pair = pairs.find(p => p.relayIndex === i);
      return { key: session + "#" + (i + 1), line, ...record,
        status: rule ? "NON_BLOCKING_CURRENT_LOCAL_FUNCTION_SCOPE" : "UNRESOLVED_CURRENT_EVENT",
        ...(rule ? { rule, source: result.sources[rule], reason: "Exact source and actual host/provider identity; current rotation/NVL/restart only. No original-event recovery claim." }
          : { reason: passed ? "Causal/recovery evidence missing; no historical exemption." : "Original FAILED session lacks a complete functional outcome." }),
        ...(pair ? { parentKey: session + "#" + (pair.nativeIndex + 1), relayDelayMs: pair.delayMs } : {}) };
    });
    assert.deepEqual(rows.map(r => r.line), scoped.messages); result.rows.push(...rows);
    result.cases.push({ session, originalStatus: report.status, caseStatus: c.status, context, ownershipLines, providerLines,
      log, records: rows.length, mirrors: pairs.length, unresolved: rows.filter(r => r.status === "UNRESOLVED_CURRENT_EVENT").length, fatal: scoped.fatal });
  }
  assert.equal(result.cases.length, 3); assert.equal(new Set(result.rows.map(r => r.key)).size, result.rows.length);
  result.records = result.rows.length; result.unresolved = result.rows.filter(r => r.status === "UNRESOLVED_CURRENT_EVENT").length;
  result.nonBlockingCurrentLocalScope = result.records - result.unresolved; result.mirrors = result.cases.reduce((n, r) => n + r.mirrors, 0);
  assert(result.records > 0 && result.unresolved > 0);
  for (const f of result.inputs) assert.equal(sha(f.path), f.sha256);
  result.status = "CUSTOM_BAR_FUNCTIONS_PASS_CURRENT_LOG_EVENTS_UNRESOLVED_ORIGINAL_FAILURES_RETAINED";
} catch (e) { result.status = "FAILED"; result.error = e.stack; process.exitCode = 1; }
finally {
  result.finishedAt = new Date().toISOString(); fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, records: result.records, unresolved: result.unresolved,
    localScope: result.nonBlockingCurrentLocalScope, mirrors: result.mirrors, error: result.error, output }));
}
