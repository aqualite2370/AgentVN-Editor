"use strict";
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const { rows, ps } = require("./lib/current-native-editor-session.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { once } = require("node:events");
(async () => {
  const child = spawn(process.execPath, ["-e", "console.log('ready');setInterval(()=>{},1000)"],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await once(child.stdout, "data");
    const row = rows().find(p => p.ProcessId === child.pid); assert(row);
    const reused = { ...row, Created: new Date(Date.parse(row.Created) + 1000).toISOString().replace("Z", "0000Z") };
    assert.equal(stopOwnedProcess(reused, ps), "NOT_OWNED");
    assert(rows().some(p => p.ProcessId === child.pid), "Reused PID refusal must preserve live process");
    assert.equal(stopOwnedProcess(row, ps), "STOPPED");
    assert.equal(stopOwnedProcess(row, ps), "ALREADY_EXITED");
    assert.throws(() => stopOwnedProcess({ ProcessId: -1, Created: row.Created }, ps));
    assert.throws(() => stopOwnedProcess({ ...row, Created: "';secret" }, ps));
    // Force the real observed process to exit after its handle is opened. This
    // is the parent/child race, not a mocked "success" from Stop-Process.
    const race = spawn(process.execPath, ["-e", "console.log('ready');setTimeout(()=>process.exit(0),1300)"],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    try {
      await once(race.stdout, "data");
      const r = rows().find(p => p.ProcessId === race.pid); assert(r);
      assert(["STOPPED", "ALREADY_EXITED"].includes(stopOwnedProcess(r, ps, { afterOpenDelayMs: 2000 })));
      assert(!rows().some(p => p.ProcessId === race.pid));
    } finally { if (race.exitCode === null) race.kill(); }
    console.log("owned-process-stop: PASS (real live, exited, reused PID, handle exit race and invalid arguments)");
  } finally { if (child.exitCode === null) child.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
