"use strict";
// Run the actual installed flow and service only its declared, owned native picker requests.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { inside } = require("./lib/installed-acceptance.cjs");
assert(process.argv[2] && process.argv[3]);
const audit = path.resolve(process.argv[2]), out = path.resolve(process.argv[3]);
assert(!fs.existsSync(out), "Fresh run root required");
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || ""), out);
const root = path.resolve(__dirname, ".."), handled = new Set(), nativeRecords = [];
const child = spawn(process.execPath, [path.join(__dirname, "installed-assistant-agent-tools-playwright.cjs"), audit, out],
  { cwd: root, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let exited = false, exitCode, output = "", pendingReadAt, pendingReadError, readRetries = 0;
for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { const text = data.toString(); output += text; process.stdout.write(text); });
child.on("error", error => { exited = true; exitCode = 1; output += String(error); });
child.on("exit", code => { exited = true; exitCode = code; });
async function runNative(request) {
  assert(["project-save-directory", "project-open"].includes(request.name));
  assert(inside(out, request.selectedPath) && inside(out, request.completion));
  assert.equal(request.cancel, false);
  const state = JSON.parse(fs.readFileSync(path.join(out, "installed-processes.json"), "utf8"));
  assert.equal(state.editorPid, request.ownerPid);
  const evidence = path.join(out, `native-${request.name}-${request.requestId}.json`);
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/gui-directory-picker-uia.ps1"),
    "-OwnerPid", String(request.ownerPid), "-ReportPath", evidence, "-Directory", request.selectedPath,
    "-TitlePattern", request.name === "project-open" ? "^选择 AgentVN 工程文件$" : "^选择当前工程的 \\.vnproj 保存目录$"];
  if (request.name === "project-open") args.push("-File");
  const result = await new Promise((resolve, reject) => {
    const helper = spawn("powershell.exe", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let log = ""; helper.stdout.on("data", data => { log += data; }); helper.stderr.on("data", data => { log += data; });
    helper.on("error", reject); helper.on("exit", code => resolve({ code, log }));
  });
  const native = fs.existsSync(evidence) ? JSON.parse(fs.readFileSync(evidence, "utf8")) : null;
  nativeRecords.push({ request, evidence, result, status: native?.status || "FAILED" });
  assert.equal(result.code, 0, result.log); assert.equal(native.status, "PASS");
  assert.equal(native.ownerPid, request.ownerPid); assert.equal(path.resolve(native.directory), path.resolve(request.selectedPath));
  assert(!exited && !fs.existsSync(request.completion), "Never replace an earlier native completion");
  fs.writeFileSync(request.completion, JSON.stringify({ status: "INPUT_COMPLETED", requestId: request.requestId,
    ownerPid: request.ownerPid, selectedPath: request.selectedPath, cancelled: false,
    interaction: "Repository Windows UI Automation / owned native input WM_SETTEXT and button BM_CLICK", evidence }, null, 2), { flag: "wx" });
}
(async () => {
  while (!exited) {
    const file = path.join(out, "native-input-request.json");
    if (fs.existsSync(file)) {
      let request;
      try {
        request = JSON.parse(fs.readFileSync(file, "utf8"));
        pendingReadAt = undefined; pendingReadError = undefined;
      } catch (error) {
        // Older publishers rewrite this file in place. A partial snapshot is not
        // a failed native action, but a permanently broken request must fail.
        if (!(error instanceof SyntaxError) && error.code !== "ENOENT") throw error;
        pendingReadAt ??= Date.now(); pendingReadError = String(error);
        readRetries += 1;
        if (Date.now() - pendingReadAt >= 2000) throw error;
        await new Promise(resolve => setTimeout(resolve, 25));
        continue;
      }
      if (!handled.has(request.requestId)) {
        handled.add(request.requestId);
        try { await runNative(request); }
        catch (error) {
          // Let the original runner perform its own finally cleanup; don't fake successful input.
          if (!fs.existsSync(request.completion)) fs.writeFileSync(request.completion,
            JSON.stringify({ status: "NATIVE_INPUT_FAILED", requestId: request.requestId, ownerPid: request.ownerPid,
              error: String(error.stack || error), nativeRecords }, null, 2), { flag: "wx" });
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.equal(exitCode, 0, "Actual installed flow did not pass; retain its raw report");
  assert.equal(nativeRecords.length, 2); assert(nativeRecords.every(record => record.status === "PASS"));
})().catch(async error => {
  output += `\n${error.stack || error}`; process.exitCode = 1;
  // A failed observer must not leave an unowned runner behind. The original
  // runner has its own step deadline and finally cleanup; keep observing it.
  while (!exited) await new Promise(resolve => setTimeout(resolve, 150));
}).finally(() => {
  fs.writeFileSync(path.join(out, "native-wrapper-report.json"), JSON.stringify({ status: process.exitCode ? "FAILED" : "PASS",
    runnerPid: child.pid, runnerExitCode: exitCode, readRetries, pendingReadError, nativeRecords }, null, 2));
  fs.writeFileSync(path.join(out, "native-wrapper.log"), output);
});
