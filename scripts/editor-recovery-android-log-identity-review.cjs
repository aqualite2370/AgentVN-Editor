"use strict";
// Additive, offline source review. Never edits the original logs or dispositions.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { parseThreadtime } = require("./lib/android-log-relay.cjs");
const { matchVolatileIdentityMessage } = require("./lib/android-log-volatile-identity.cjs");
const base = "F:/testavn/Client-Presentation-Android-1975-20261116-04";
const originalFile = path.join(base, "current-log-review-01.json");
const output = path.join(base, "current-log-review-02.json");
const referenceFile = "F:/testavn/Windows-Isolated-1974-20261115-01/current-log-review-01.json";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file) });
assert(!fs.existsSync(output), "Keep all previous results");
const original = read(originalFile), reference = read(referenceFile);
assert.equal(original.records, original.rows.length);
const retained = [desc(originalFile), desc(referenceFile)];
for (const input of original.inputs) { assert.equal(sha(input.path), input.sha256); retained.push(input); }
const probes = {
  "art-x86-variant": [/Unexpected CPU variant for x86:/, /Known variants:/, /return Create\(x86_64/],
  "art-x86-known-variants": [/Unexpected CPU variant for x86:/, /Known variants:/, /return Create\(x86_64/],
  "art-jdwp-unavailable": [/if \(IsDebuggableOrProfilable\(\)\)/, /Not starting debugger since process cannot load the jdwp agent\./],
  "framework-jank-config": [/Initializing without READ_DEVICE_CONFIG permission\./, /context\.getPackageName\(\)/, /return;/],
  "provider-optional-dex-metadata": [/kDmExtension = "\.dm"/, /filename_\.ends_with\(kDmExtension\)/,
    /if \(dm_file != nullptr\)/],
};
const findReference = {
  "art-x86-variant": row => row.message === "Unexpected CPU variant for x86: x86_64.",
  "art-x86-known-variants": row => row.message === "Unexpected CPU variant for x86: x86_64.",
  "art-jdwp-unavailable": row => row.message === "Not starting debugger since process cannot load the jdwp agent.",
  "framework-jank-config": row => row.tag === "InteractionJankMonitor"
    && row.message.startsWith("Initializing without READ_DEVICE_CONFIG permission."),
  "provider-optional-dex-metadata": row => row.tag === "ziparchive"
    && row.message.endsWith("/TrichromeLibrary.dm': No such file or directory"),
};
const sources = {};
for (const [rule, predicate] of Object.entries(findReference)) {
  const row = reference.rows.find(row => row.reference && predicate(parseThreadtime(row.line)));
  assert(row?.reference, rule);
  const source = row.reference;
  assert.equal(sha(source.path), source.sha256);
  assert(source.url.includes("refs/tags/android-15.0.0_r1/"));
  const text = fs.readFileSync(source.path, "utf8");
  for (const probe of probes[rule]) assert.match(text, probe);
  sources[rule] = source; retained.push(source);
}
const contexts = new Map();
for (const session of [...original.cases, ...original.supplemental]) {
  const reportFile = `F:/testavn/Client-Presentation-Android-1975-20261116-${session.session}/report.json`;
  const report = read(reportFile), c = report.cases.find(c => c.type === session.type);
  assert(c); assert.equal(report.environment.sdk, "35");
  assert.equal(sha(session.logcat.path), session.logcat.sha256);
  const raw = fs.readFileSync(session.logcat.path, "utf8"), rendererNames = {}, providerLoads = {};
  const ownershipLines = [], providerLines = [];
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseThreadtime(line);
    if (!parsed) continue;
    const proc = /^Start proc (\d+):([^/\s]+)\/\S+ for\s+\{([^/]+)\/[^}]+\}/.exec(parsed.message);
    if (parsed.tag === "ActivityManager" && proc && proc[3] === c.package
      && proc[2].includes(":sandboxed_process")) {
      rendererNames[+proc[1]] = proc[2]; ownershipLines.push(line);
    }
    const provider = /^Loading (com\.google\.android\.webview) version ([\d.]+) \(code (\d+)\)$/.exec(parsed.message);
    if (parsed.tag === "WebViewFactory" && provider) {
      providerLoads[parsed.pid] = { name: provider[1], version: provider[2], code: provider[3] };
      providerLines.push(line);
    }
  }
  const context = { sdk: report.environment.sdk, abi: report.environment.abi,
    packageName: c.package, presentationPassed: c.result?.status === "PASS",
    hostPids: [c.pid, ...(c.restarts || []).map(row => row.pid)].map(Number),
    rendererNames, providerLoads };
  contexts.set(session.session + "/" + session.type, { ...context, ownershipLines, providerLines });
  retained.push(desc(reportFile), session.logcat);
}
const changes = [];
const rows = original.rows.map(row => {
  if (row.status !== "UNRESOLVED_CURRENT_EVENT") return row;
  const key = row.key.slice(0, row.key.indexOf("#")), context = contexts.get(key); assert(context);
  const rule = matchVolatileIdentityMessage(row, context);
  if (!rule) return row;
  assert(sources[rule]);
  const sender = context.hostPids.includes(row.pid) ? { kind: "host", name: context.packageName }
    : { kind: "renderer", name: context.rendererNames[row.pid] };
  assert(sender.name);
  changes.push({ key: row.key, rule, previousStatus: row.status, sender });
  return { ...row, previousStatus: row.status, status: "NON_BLOCKING_CURRENT_LOCAL_FUNCTION_SCOPE",
    rule, reference: sources[rule], sender,
    reason: rule.startsWith("art-x86") ? "Exact Android15 ART variant warning branch continues Create(features); emulator local functions passed. No physical CPU claim."
      : rule === "art-jdwp-unavailable" ? "Exact ART branch skips JDWP for nondebuggable/nonprofileable process; production game and native persistence passed. No Java debugger acceptance."
      : rule === "framework-jank-config" ? "Exact framework branch skips privileged DeviceConfig subscription. Current local functions passed; performance remains deferred."
      : "Exact loaded Chromium124 provider's optional .dm is absent. ART only uses it when present; local provider/game functions passed. Separate Entry records stay unresolved." };
});
assert.deepEqual(rows.map(row => row.line), original.rows.map(row => row.line));
assert(changes.length > 0, "No empty review");
const changedKeys = new Set(changes.map(c => c.key));
for (const row of original.rows) if (!changedKeys.has(row.key))
  assert.deepEqual(rows.find(current => current.key === row.key), row);
const unresolved = rows.filter(row => row.status === "UNRESOLVED_CURRENT_EVENT");
const result = { status: "FUNCTIONS_PASS_CURRENT_LOG_EVENTS_UNRESOLVED", at: new Date().toISOString(),
  original: desc(originalFile), sources, contexts: Object.fromEntries(contexts), rows, changes,
  records: rows.length, previouslyUnresolved: original.unresolved, unresolved: unresolved.length,
  nonBlocking: rows.length - unresolved.length, mirrors: [...original.cases, ...original.supplemental].reduce((n, c) => n + c.mirrors, 0),
  retainedInputs: retained, productLaunches: 0, builds: 0, modelRequests: 0, userDatabaseWrites: 0,
  scope: "CURRENT_FIVE_CAPTURED_SESSIONS_ONLY_SOURCE_AND_PID_BOUND_DYNAMIC_IDENTITY_MATCHING",
  boundary: "Original reports and failure events unchanged; no source match proves historical or current cache, drawing, Entry, seed, resource lifetime or lock recovery." };
assert.equal(result.previouslyUnresolved - result.unresolved, changes.length);
for (const file of retained) assert.equal(sha(file.path), file.sha256);
fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: result.status, records: result.records, changes: changes.length,
  byRule: Object.fromEntries(Object.keys(probes).map(rule => [rule, changes.filter(row => row.rule === rule).length])),
  unresolved: result.unresolved, nonBlocking: result.nonBlocking, output }));
