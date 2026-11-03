"use strict";
// QA process cleanup. Exact CIM identity first, then hold an OS process handle
// across the stop so PID reuse and normal parent/child exit races stay safe.
const assert = require("node:assert/strict");
function stopOwnedProcess(expected, execute, { afterOpenDelayMs = 0 } = {}) {
  assert(Number.isSafeInteger(expected.ProcessId) && expected.ProcessId > 0);
  assert.match(expected.Created, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/);
  assert(Number.isSafeInteger(afterOpenDelayMs) && afterOpenDelayMs >= 0 && afterOpenDelayMs <= 3000);
  const script = `$expected='${expected.Created}';$id=${expected.ProcessId};` +
    `$actual=Get-CimInstance Win32_Process -Filter "ProcessId=$id";` +
    `if(!$actual){'ALREADY_EXITED';exit 0};` +
    `if($actual.CreationDate.ToUniversalTime().ToString('o') -cne $expected){'NOT_OWNED';exit 0};` +
    `$owned=Get-Process -Id $id -ErrorAction SilentlyContinue;` +
    `if(!$owned){'ALREADY_EXITED';exit 0};` +
    `try{$null=$owned.Handle;` +
    `if([Math]::Abs($owned.StartTime.ToUniversalTime().Ticks-[DateTime]::Parse($expected).ToUniversalTime().Ticks) -ge 10){throw 'PROCESS_HANDLE_IDENTITY_MISMATCH'};` +
    (afterOpenDelayMs ? `Start-Sleep -Milliseconds ${afterOpenDelayMs};` : "") +
    `try{$owned.Kill()}catch{if(!$owned.HasExited){throw}};` +
    `$null=$owned.WaitForExit(10000);if(!$owned.HasExited){throw 'OWNED_PROCESS_STOP_TIMEOUT'};'STOPPED'` +
    `}finally{$owned.Dispose()}`;
  const result = execute(script).trim();
  assert(["STOPPED", "ALREADY_EXITED", "NOT_OWNED"].includes(result), result);
  return result;
}
module.exports = { stopOwnedProcess };
