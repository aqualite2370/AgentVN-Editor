"use strict";
const assert = require("node:assert/strict");
const { collectTraceCapabilities } = require("./lib/android-trace-capabilities.cjs");
const seen = [];
const result = collectTraceCapabilities({
  expectedBootId: "test-boot",
  execute(args, input) {
    seen.push({ args, input });
    if (args.includes("/proc/sys/kernel/random/boot_id"))
      return { status: 0, stdout: "test-boot\n", stderr: "" };
    if (input.includes("simpleperf record"))
      return { status: 0, stdout: "", stderr: "Usage: simpleperf record --call-graph fp,dwarf" };
    if (input.includes("simpleperf list"))
      return { status: 0, stdout: "syscalls:sys_enter_unlinkat\n", stderr: "" };
    return { status: 0, stdout: "read-only observation", stderr: "" };
  },
});
assert.equal(result.status, "CAPABILITIES_RECORDED");
assert.equal(result.simpleperfCallGraphAdvertised, true);
assert.equal(result.unlinkTracepointAdvertised, true);
assert.equal(result.commands.length, 5);
assert.equal(result.commands[1].exitCode, 0, "Normal stderr is not command failure");
assert.match(result.commands[1].stderr, /Usage:/);
for (const { input } of seen.filter(item => item.input)) {
  assert(!/setenforce|chmod|chown|rm |kill |setprop|pm |push|install/.test(input));
  assert(!/simpleperf record(?! --help)/.test(input), "Capability query must not start profiling");
}
assert.throws(() => collectTraceCapabilities({ expectedBootId: "expected",
  execute() { return { status: 0, stdout: "different-boot", stderr: "" }; } }), /BOOT_ID_MISMATCH/);
assert.throws(() => collectTraceCapabilities({ expectedBootId: "expected",
  execute() { return { status: 1, stdout: "", stderr: "error: device offline" }; } }), /device offline/);
const unavailable = collectTraceCapabilities({ expectedBootId: "test-boot",
  execute(args) { return args.includes("/proc/sys/kernel/random/boot_id")
    ? { status: 0, stdout: "test-boot" }
    : { status: 127, stdout: "", stderr: "simpleperf: not found" }; } });
assert.equal(unavailable.simpleperfCallGraphAdvertised, false);
assert.equal(unavailable.unlinkTracepointAdvertised, false);
assert.equal(unavailable.commands[0].exitCode, 127);
assert.match(unavailable.commands[0].stderr, /not found/);
console.log("android-trace-capabilities: PASS (read-only, boot identity, stderr, original errors, unavailable tools)");
