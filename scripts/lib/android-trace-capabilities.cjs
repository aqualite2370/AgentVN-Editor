"use strict";
const commands = [
  ["tools", "id; id -Z; uname -a; command -v simpleperf; command -v debuggerd; command -v perfetto; command -v strace"],
  ["simpleperf-help", "simpleperf record --help"],
  ["simpleperf-tracepoints", "simpleperf list tracepoint"],
  ["kernel-tracepoints", "ls -l /sys/kernel/tracing/events/syscalls/sys_enter_unlinkat/id /sys/kernel/debug/tracing/events/syscalls/sys_enter_unlinkat/id /sys/kernel/tracing/options/userstacktrace"],
  ["kernel-policy", "cat /proc/sys/kernel/perf_event_paranoid; cat /proc/sys/kernel/kptr_restrict; cat /sys/fs/selinux/enforce"],
];
function collectTraceCapabilities({ expectedBootId, execute }) {
  if (!expectedBootId) throw Error("OWNED_BOOT_ID_REQUIRED");
  const boot = execute(["shell", "cat", "/proc/sys/kernel/random/boot_id"]);
  if (boot.status !== 0 || boot.error)
    throw Error(`BOOT_QUERY_FAILED:${boot.status}:${boot.error || ""}:${boot.stdout || ""}:${boot.stderr || ""}`);
  if ((boot.stdout || "").trim() !== expectedBootId) throw Error("BOOT_ID_MISMATCH");
  const records = commands.map(([name, script]) => {
    const startedAt = new Date().toISOString();
    const result = execute(["shell", "su", "0", "sh"], script + "\n");
    return { name, script, startedAt, finishedAt: new Date().toISOString(),
      exitCode: result.status, stdout: result.stdout || "", stderr: result.stderr || "",
      error: result.error ? String(result.error) : null };
  });
  const text = name => { const r = records.find(c => c.name === name);
    return r.exitCode === 0 && !r.error ? `${r.stdout}\n${r.stderr}` : ""; };
  return { status: "CAPABILITIES_RECORDED", diagnosticOnly: true, bootId: expectedBootId,
    commands: records, simpleperfCallGraphAdvertised: /--call-graph/.test(text("simpleperf-help")),
    unlinkTracepointAdvertised: /syscalls:sys_enter_unlinkat/.test(text("simpleperf-tracepoints")),
    limitation: "Read-only advertised capabilities, not successful stack capture or product acceptance" };
}
module.exports = { collectTraceCapabilities };
