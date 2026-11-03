"use strict";
// Controlled QA collector regression; never starts Android or changes product state.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const out = process.env.AGENTVN_EXIT_FAILURE_TEST_OUTPUT;
assert(out && path.resolve(out).toLowerCase().startsWith("f:\\agentvn\\qa\\") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const r = { status: "RUNNING", startedAt: new Date().toISOString(), scope: "CONTROLLED_FAILURE_COLLECTOR_NOT_DEVICE", cases: [] };
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const report = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
(async () => {
  const { captureExitFailure } = require("./lib/android-exit-failure-evidence.cjs");
  const native = read("F:/AgentVN/QA/Android-Exit-20261024-01/device-16/runtime/report.json");
  const image = fs.readFileSync(native.screenshots[0].path), pkg = "com.agentvn.qa.exitagentvn20261024";
  const remote = `/data/user/0/${pkg}/files/error_log/player-desktop.log`;
  for (const mode of ["ordinary", "missing-cdp", "rejected-path", "native-read-error"]) {
    const dir = path.join(out, mode); fs.mkdirSync(dir);
    const commands = [], evaluations = [];
    const result = await captureExitFailure({ outputDir: dir, packageName: pkg, label: "reopen",
      evaluate: mode === "missing-cdp" ? undefined : async expression => {
        evaluations.push(expression);
        return { href: "https://tauri.localhost", readyState: "complete", text: "正在载入游戏", html: "<main>正在载入游戏</main>" };
      },
      getTargets: async () => [{ id: "new-target", url: "https://tauri.localhost" }],
      command: (args, binary) => {
        commands.push({ args, binary });
        if (args[0] === "exec-out" && args[1] === "screencap") return { status: 0, stdout: image };
        if (args[0] === "shell" && args[1] === "find")
          return { status: 0, stdout: (mode === "rejected-path" ? "/data/user/0/other/files/error_log/secret.log" : remote) + "\n" };
        if (args[0] === "exec-out" && args[1] === "cat") {
          if (mode === "native-read-error") return { status: 1, stdout: "", stderr: "permission denied" };
          return { status: 0, stdout: Buffer.from("Android Runtime window restored for Activity 2.\n") };
        }
        if (args[0] === "shell" && args[1] === "dumpsys") return { status: 0, stdout: "live replacement Activity" };
        throw Error("Unexpected command: " + JSON.stringify(args));
      } });
    assert(result.finishedAt); assert.equal(result.scope, "FAILURE_DIAGNOSTIC_NOT_ACCEPTANCE");
    assert(result.screenshot && fs.existsSync(result.screenshot.path));
    assert(result.activity && fs.existsSync(result.activity.path));
    assert(result.targets && fs.existsSync(result.targets.path));
    assert(commands.every(c => !/input|uninstall|force-stop|rm/.test(c.args.join(" "))));
    assert(evaluations.every(s => !/__TAURI_INTERNALS__\.invoke|setState|localStorage/.test(s)));
    if (mode === "ordinary") {
      assert.equal(result.status, "COLLECTED"); assert.equal(result.nativeLogs.length, 1);
      assert(result.dom); assert.equal(read(result.dom.path).text, "正在载入游戏");
    } else {
      assert.equal(result.status, "COLLECTED_WITH_ERRORS"); assert(result.errors.length > 0);
      if (mode === "rejected-path") assert(!commands.some(c => c.args[1] === "cat"));
      if (mode === "native-read-error") assert.equal(result.nativeLogs.length, 0);
    }
    r.cases.push({ name: mode, status: "PASS", result }); report();
  }
  let commands = 0;
  await assert.rejects(captureExitFailure({ outputDir: out, packageName: "../other", label: "bad",
    command: () => { commands++; } }));
  assert.equal(commands, 0); r.cases.push({ name: "invalid package rejected before IO", status: "PASS" });
  r.status = "PASS";
})().catch(error => { r.status = "FAILED"; r.error = String(error.stack || error); process.exitCode = 1; })
.finally(() => { r.finishedAt = new Date().toISOString(); report();
  console.log(JSON.stringify({ status: r.status, out, cases: r.cases.length, error: r.error })); });
