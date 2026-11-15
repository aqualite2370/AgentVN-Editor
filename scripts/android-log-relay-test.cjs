"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { pairStderrRelays, parseThreadtime } = require("./lib/android-log-relay.cjs");
const output = process.argv[2];
assert(output && !fs.existsSync(output), "An unused immutable test report is required");
const r = { at: new Date().toISOString(), cases: [], inputs: [] };
const test = (name, fn) => {
  try { fn(); r.cases.push({ name, status: "PASS" }); }
  catch (e) { r.cases.push({ name, status: "FAILED", error: e.message }); }
};
const body = "[WARNING:dns_config_service_android.cc(81)] Failed to read DnsConfig.";
const line = (time = "14:34:30.296", tid = 2261, tag = "chromium", severity = "W", pid = 2180, msg = body, date = "11-14") =>
  `${date} ${time} ${pid} ${tid} ${severity} ${tag}: ${msg}`;
const native = line(), relay = line("14:34:30.297", 2227, "RustStdoutStderr", "I");
test("renderer tags retain their colon and full message", () => {
  const p = parseThreadtime(line(undefined, 2261, "ocessService0:0", "W", 2180, "Not starting debugger: jdwp agent unavailable"));
  assert.equal(p.tag, "ocessService0:0");
  assert.equal(p.message, "Not starting debugger: jdwp agent unavailable");
});
test("colons in the body never become tag text", () => {
  const p = parseThreadtime(line(undefined, 2261, "chromium", "E", 2180, "Entry not found: assets: cache"));
  assert.equal(p.tag, "chromium"); assert.equal(p.message, "Entry not found: assets: cache");
});
test("padded renderer tag keeps intentional message indentation", () => {
  const p = parseThreadtime(line("14:34:30.296123", 2261, "ocessService0:0   ", "W", 2180, "  indented: details"));
  assert.equal(p.tag, "ocessService0:0"); assert.equal(p.message, "  indented: details");
  assert.equal(p.timeMs, parseThreadtime(native).timeMs);
});
test("cross-thread stderr forwarding is one original event", () => assert.equal(pairStderrRelays([native, relay], [2180]).length, 1));
test("same-thread recording remains supported", () => assert.equal(pairStderrRelays([native, line("14:34:30.296", 2261, "RustStdoutStderr", "I")], [2180]).length, 1));
test("wrong PID cannot pair", () => assert.equal(pairStderrRelays([native, line("14:34:30.297", 2227, "RustStdoutStderr", "I", 2190)], [2180, 2190]).length, 0));
test("unowned PID cannot pair", () => assert.equal(pairStderrRelays([native, relay], [9999]).length, 0));
test("body must be identical", () => assert.equal(pairStderrRelays([native, line("14:34:30.297", 2261, "RustStdoutStderr", "I", 2180, body + " changed")], [2180]).length, 0));
test("relay cannot precede the native event", () => assert.equal(pairStderrRelays([native, line("14:34:30.295", 2261, "RustStdoutStderr", "I")], [2180]).length, 0));
test("late relay remains unknown", () => assert.equal(pairStderrRelays([native, line("14:34:30.547", 2261, "RustStdoutStderr", "I")], [2180]).length, 0));
test("window endpoint is inclusive", () => assert.equal(pairStderrRelays([native, line("14:34:30.546", 2261, "RustStdoutStderr", "I")], [2180]).length, 1));
test("ambiguous original events cannot pair", () => assert.equal(pairStderrRelays([native, native, relay], [2180]).length, 0));
test("one original cannot explain two relays", () => assert.equal(pairStderrRelays([native, relay, relay], [2180]).length, 0));
test("wrong native severity or tag cannot pair", () => {
  for (const n of [line(undefined, 2261, "other"), line(undefined, 2261, "chromium", "I")])
    assert.equal(pairStderrRelays([n, relay], [2180]).length, 0);
});
test("midnight crossover remains directional", () => assert.equal(pairStderrRelays([
  line("23:59:59.999"), line("00:00:00.000", 2227, "RustStdoutStderr", "I", 2180, body, "11-15")], [2180]).length, 1));
test("invalid window rejects", () => assert.throws(() => pairStderrRelays([], [2180], Infinity)));
test("all eight preserved current DNS relays pair without deleting records", () => {
  const file = "F:/testavn/Client-Presentation-Android-1973-20261114-device-01/report.json";
  const bytes = fs.readFileSync(file), d = JSON.parse(bytes);
  r.inputs.push({ path: file, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
  let count = 0;
  for (const c of d.cases) {
    const lines = c.logReview.messages;
    const pairs = pairStderrRelays(lines, [c.pid, ...c.restarts.map(e => e.pid)]);
    const dns = pairs.filter(p => p.relay.message === body);
    assert.equal(dns.length, 4, c.type);
    assert(dns.every(p => p.native.tid !== p.relay.tid && p.delayMs <= 6));
    count += dns.length;
  }
  assert.equal(count, 8);
});
r.status = r.cases.length > 0 && r.cases.every(e => e.status === "PASS") ? "PASS" : "FAILED";
r.finishedAt = new Date().toISOString();
r.implementationSha256 = crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "lib/android-log-relay.cjs"))).digest("hex");
fs.writeFileSync(output, JSON.stringify(r, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: r.status, tests: r.cases.length, failures: r.cases.filter(e => e.status !== "PASS"), output }));
if (r.status !== "PASS") process.exitCode = 1;
