"use strict";

// QA launcher for the already sealed 1.9.35 NSIS installation.
// It owns only the isolated F: drive run directory and never changes product
// sources, the default profile, or the shared database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const { rows } = require("./lib/current-native-editor-session.cjs");

const root = path.resolve(__dirname, "..");
const runRoot = path.resolve(process.argv[2] || "");
const evidence = path.resolve(process.argv[3] || "");
const sourceReceipt = "F:/AgentVN/QA/Functional-Continuation-20261101/installed-editor-20261101-02/installer-resource-report.json";
assert(runRoot && evidence, "Pass <owned-installed-session> <fresh-output>");
assert(runRoot.startsWith("F:\\AgentVN\\QA\\") && evidence.startsWith(`${runRoot}${path.sep}`),
  "Use a fresh owned F: QA run with evidence below the run root");
assert(!fs.existsSync(runRoot), `Never overwrite an earlier run: ${runRoot}`);
fs.mkdirSync(runRoot, { recursive: true });
assert(!fs.existsSync(evidence), `Never overwrite earlier evidence: ${evidence}`);
fs.copyFileSync(sourceReceipt, path.join(runRoot, "installer-resource-report.json"), fs.constants.COPYFILE_EXCL);
const receipt = JSON.parse(fs.readFileSync(sourceReceipt, "utf8"));
const deployment = receipt.deployments.find(item => item.kind === "NSIS actual isolated installation");
assert(deployment, "Current 1.9.35 isolated installation deployment is missing");
const installRoot = path.resolve(deployment.installedRoot);
const editorExe = path.resolve(deployment.executable.path);
assert(fs.existsSync(editorExe), editorExe);

function writeState(state) {
  fs.writeFileSync(path.join(runRoot, "installed-processes.json"),
    JSON.stringify(state, null, 2), { flag: "wx" });
}

async function main() {
  let host;
  try {
    host = await startInstalledEditor(runRoot);
    const childEnv = {
      ...process.env,
      AGENTVN_TEST_PROJECT: path.join(evidence, "安装资源闭环.vnproj"),
      AGENTVN_WORKSPACE_OUTPUT: evidence,
    };
    const child = spawn(process.execPath, [
      path.join(root, "scripts", "installed-editor-resources-flow-playwright.cjs"),
      runRoot,
      evidence,
    ], {
      cwd: root,
      env: childEnv,
      windowsHide: true,
      stdio: "inherit",
    });
    const exitCode = await new Promise(resolve => child.once("exit", code => resolve(code ?? 1)));
    fs.writeFileSync(path.join(runRoot, "launcher-result.json"), JSON.stringify({
      status: exitCode === 0 ? "PASS" : "FAILED",
      exitCode,
      at: new Date().toISOString(),
      runRoot,
      evidence,
    }, null, 2), { flag: "wx" });
    if (exitCode !== 0) process.exitCode = exitCode;
  } finally {
    if (host) {
      const result = await host.stop();
      fs.writeFileSync(path.join(runRoot, "launcher-cleanup.json"),
        JSON.stringify(result, null, 2), { flag: "wx" });
    }
    fs.writeFileSync(path.join(runRoot, "cleanup.json"), JSON.stringify({
      at: new Date().toISOString(),
      remainingAgentProcesses: rows().filter(item => /^(agentvn-editor|creator-backend|agentvn-player)\.exe$/i.test(item.Name)),
    }, null, 2), { flag: "wx" });
  }
}

main().catch(error => {
  fs.writeFileSync(path.join(runRoot, "launcher-error.txt"), String(error.stack || error), { flag: "wx" });
  console.error(error);
  process.exitCode = 1;
});
