"use strict";
function perfSelfcheckScript(runId) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) throw Error("RUN_ID_INVALID");
  const directory = `/data/local/tmp/agentvn-perf-self-${runId}`;
  const cases = [
    ["plain", "-e raw_syscalls:sys_enter"],
    ["realtime", "-e raw_syscalls:sys_enter --clockid realtime"],
    ["dwarf", "-e raw_syscalls:sys_enter --call-graph dwarf,8192"],
    ["fp", "-e raw_syscalls:sys_enter --call-graph fp"],
    ["cpu", "-e cpu-clock --call-graph dwarf,8192"],
  ];
  return [`mkdir '${directory}' || exit 2`, ...cases.flatMap(([name, options]) => [
    `echo 'SELF_CASE|${name}'`,
    `timeout -s INT 4 simpleperf record ${options} --size-limit 1M --no-dump-kernel-symbols -o '${directory}/${name}.data' -- /system/bin/sleep 0.1 2>&1`,
    'echo "SELF_EXIT|$?"',
    `rm -f '${directory}/${name}.data'`,
    'echo "SELF_FILE_CLEANUP|$?"',
  ]), `rmdir '${directory}'`, 'echo "SELF_DIRECTORY_CLEANUP|$?"', "exit 0"].join("\n");
}
function parseSelfcheck(text) {
  const cases = [...text.matchAll(/SELF_CASE\|([a-z]+)\r?\n([\s\S]*?)SELF_EXIT\|(\d+)/g)]
    .map(match => ({ name: match[1], output: match[2].trim(), exitCode: Number(match[3]) }));
  const cleanup = [...text.matchAll(/SELF_(?:FILE|DIRECTORY)_CLEANUP\|(\d+)/g)].map(m => Number(m[1]));
  return { cases, cleanupStatus: cleanup.length === 6 && cleanup.every(code => code === 0) ? "PASS" : "FAILED" };
}
module.exports = { perfSelfcheckScript, parseSelfcheck };
