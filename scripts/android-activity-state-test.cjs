"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process"), { createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."), out = process.env.AGENTVN_ACTIVITY_STATE_OUTPUT;
assert(out && path.resolve(out).toLowerCase().startsWith("f:\\agentvn\\qa\\") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const source = path.join(root, "GameCli_framework/src-tauri/src/android_activity_state.rs");
const r = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ACTUAL_RUST_OWNERSHIP_COORDINATOR_NOT_ANDROID_ACCEPTANCE",
  source, sha256: createHash("sha256").update(fs.readFileSync(source)).digest("hex"), commands: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
function run(label, exe, args) {
  const v = spawnSync(exe, args, { cwd: root, windowsHide: true, encoding: "utf8", timeout: 60000 });
  fs.writeFileSync(path.join(out, label + ".log"), (v.stdout || "") + "\n" + (v.stderr || ""));
  r.commands.push({ label, exe, args, exitCode: v.status, error: v.error?.message }); save();
  assert.equal(v.status, 0, label); return v.stdout;
}
try {
  save();
  const exe = path.join(out, "activity-state-test.exe");
  run("compile", "rustc.exe", ["--edition=2021", "--test", source, "-o", exe]);
  const result = run("test", exe, ["--test-threads=1"]);
  assert.match(result, /test result: ok\. 8 passed; 0 failed/);
  r.cases = 8; r.status = "PASS";
} catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
finally { r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(r)); }
