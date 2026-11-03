"use strict";
// Actual installed P1 pickers; never replace Tauri dialogs or mock their values.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const A = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const runRoot = path.resolve(process.argv[2] || "");
const mode = process.argv[3];
assert(process.argv[2] && ["open", "request"].includes(mode),
  "node script <installed-session> open <isolated.vnproj> <fresh-output> | request <native-input-request.json>");

async function complete(request, out, state) {
  assert.equal(request.ownerPid, state.editorPid);
  assert(["project-open", "p1-save-directory"].includes(request.name));
  assert(A.inside(runRoot, request.selectedPath) && A.inside(out, request.completion));
  assert.equal(request.cancel, false);
  assert(!fs.existsSync(request.completion));
  const evidence = path.join(out, `native-${request.requestId}.json`);
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/gui-directory-picker-uia.ps1"), "-OwnerPid", String(state.editorPid),
    "-ReportPath", evidence, "-Directory", request.selectedPath, "-TitlePattern",
    request.name === "project-open" ? "^选择 AgentVN 工程文件$" : "^选择当前工程的 \\.vnproj 保存目录$"];
  if (request.name === "project-open") args.push("-File");
  const result = await new Promise((resolve, reject) => {
    const helper = spawn("powershell.exe", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    helper.stdout.on("data", data => { log += data; });
    helper.stderr.on("data", data => { log += data; });
    helper.on("error", reject);
    helper.on("close", code => resolve({ code, log }));
  });
  if (result.code !== 0) {
    fs.writeFileSync(request.completion, JSON.stringify({
      status: "NATIVE_INPUT_FAILED", requestId: request.requestId, ownerPid: request.ownerPid,
      error: result.log, evidence,
    }, null, 2), { flag: "wx" });
  }
  assert.equal(result.code, 0, result.log);
  const native = JSON.parse(fs.readFileSync(evidence, "utf8"));
  assert.equal(native.status, "PASS");
  assert.equal(native.ownerPid, request.ownerPid);
  assert.equal(path.resolve(native.directory), path.resolve(request.selectedPath));
  fs.writeFileSync(request.completion, JSON.stringify({
    status: "INPUT_COMPLETED", requestId: request.requestId, ownerPid: request.ownerPid,
    selectedPath: request.selectedPath, cancelled: false,
    interaction: "Repository Windows UI Automation / owned native dialog input", evidence,
  }, null, 2), { flag: "wx" });
  return { request, evidence };
}

(async () => {
  const { state, exeSha256 } = A.readInstalledSession(runRoot);
  if (mode === "request") {
    const file = path.resolve(process.argv[4]);
    assert(A.inside(runRoot, file));
    console.log(JSON.stringify(await complete(JSON.parse(fs.readFileSync(file, "utf8")), path.dirname(file), state)));
    return;
  }
  const input = path.resolve(process.argv[4]), out = path.resolve(process.argv[5]);
  assert(A.inside(runRoot, input) && A.inside(runRoot, out) && !fs.existsSync(out));
  process.env.AGENTVN_TEST_PROJECT = input;
  process.env.AGENTVN_WORKSPACE_OUTPUT = out;
  fs.mkdirSync(out);
  const report = { status: "RUNNING", input, inputSha256: A.sha256(fs.readFileSync(input)), exeSha256, state,
    environment: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out } };
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
    const page = browser.contexts()[0].pages().find(p => p.url().startsWith("http://tauri.localhost"));
    assert(page, "Actual installed WebView required");
    const pending = A.nativeInput({ page, trigger: page.getByLabel("创建或打开项目").getByRole("button", { name: "导入项目", exact: true }),
      out, name: "project-open", ownerPid: state.editorPid, selectedPath: input });
    const request = JSON.parse(fs.readFileSync(path.join(out, "native-input-request.json"), "utf8"));
    [report.native] = await Promise.all([pending, complete(request, out, state)]);
    await page.locator(".editor-toolbar").waitFor({ timeout: 120000 });
    await A.settleEditor(page);
    report.project = await A.projectSnapshot(state.backendPort);
    assert(report.project.projectId.startsWith("installed_resource_flow_"));
    await page.screenshot({ path: path.join(out, "installed-imported.png") });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); throw error;
  } finally {
    await browser?.close();
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, out }));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
