"use strict";
// Continue after terminal Editor audit; native stderr is diagnostic data, while
// the actual child exit code and independent evidence determine success.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Editor-1.9.30-20261026-01";
const root = path.resolve(__dirname, ".."), receipt = path.join(base, "derived-components-installation-01.json");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
function child(args, options) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { windowsHide: true, ...options });
    p.once("error", reject); p.once("close", (code, signal) => resolve({ code, signal, pid: p.pid }));
  });
}
async function selfTest() {
  for (const expected of [0, 1]) {
    let out = "", error = "";
    await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ["-e",
        `process.stderr.write("diagnostic warning\\n");process.stdout.write("result\\n");process.exitCode=${expected};`],
      { windowsHide: true });
      p.stdout.on("data", b => { out += b; }); p.stderr.on("data", b => { error += b; });
      p.once("error", reject); p.once("close", code => { try { assert.equal(code, expected); resolve(); } catch (e) { reject(e); } });
    });
    assert.match(error, /diagnostic warning/); assert.match(out, /result/);
  }
  console.log(JSON.stringify({ status: "PASS", nativeWarningNotFailure: true,
    nonzeroExitStillFails: true, modelRequests: 0, nativeApps: 0 }));
}
async function main() {
  const out = path.join(base, "editor-novel-followup-04");
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const previous = path.join(base, "editor-motion-audit-02-01/report.json"), audit = read(previous);
  assert.equal(audit.status, "EVIDENCE_AUDIT_PASS_FEATURE_PASS");
  assert(audit.finishedAt && audit.checks.every(c => c.status === "PASS"));
  require("./candidate-1930-exit.cjs").validateInstallation(receipt);
  const defaults = "F:/AgentVN/QA/Installed-Novel-Default-1930-20261026-01";
  const floating = "F:/AgentVN/QA/Installed-Novel-Floating-1930-20261026-01";
  assert(!fs.existsSync(defaults) && !fs.existsSync(floating), "No duplicate/overwritten novel runs");
  const tools = [__filename, ...["candidate-1930-novel-audit.cjs", "candidate-1930-novel-audit-test.cjs",
    "installed-novel-default-current.cjs", "installed-novel-task-floating-playwright.cjs",
    "candidate-1930-layout-author.cjs", "candidate-1930-layout-author-test.cjs",
    "installed-layout-pages-current.cjs"].map(f => path.join(__dirname, f))].map(desc);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), predecessor: desc(previous),
    preservedFailedWrapper: path.join(base, "editor-novel-followup-03/report.json"),
    tools, commands: [], productChanges: 0, builds: 0, realModelRequests: 0 };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  async function run(label, args, additions = {}) {
    for (const f of tools) assert.equal(sha(f.path), f.sha256);
    assert(!rows().some(p => /^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_)/i.test(k)) delete env[k];
    Object.assign(env, additions);
    const c = { label, status: "RUNNING", startedAt: new Date().toISOString(),
      command: [process.execPath, ...args], log: path.join(out, `${label}.log`) };
    report.commands.push(c); save();
    const fd = fs.openSync(c.log, "wx");
    try {
      const result = await child(args, { cwd: root, env, stdio: ["ignore", fd, fd] });
      Object.assign(c, { exitCode: result.code, signal: result.signal, pid: result.pid });
      assert.equal(result.code, 0, label); assert.equal(result.signal, null, label); c.status = "PASS";
    } catch (e) { c.status = "FAILED"; throw e; }
    finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); }
  }
  try {
    save();
    await run("novel-guard", ["scripts/candidate-1930-novel-audit-test.cjs"]);
    await run("novel-default", ["scripts/installed-novel-default-current.cjs", "01", "--candidate=1.9.30",
      `--qa-root=${defaults}`, "--checkpoint-root=F:/AgentVN/Checkpoints/Installed-Novel-Default-1930-20261026-01",
      `--installation-file=${receipt}`]);
    await run("novel-default-audit", ["scripts/candidate-1930-novel-audit.cjs", "default", "01"]);
    const defaultAudit = read(path.join(base, "novel-default-audit-01/report.json"));
    assert.equal(defaultAudit.status, "PASS"); assert.equal(defaultAudit.featureStatus, "PASS");
    fs.mkdirSync(floating);
    const session = path.join(floating, "session-01");
    await run("novel-floating", ["scripts/installed-novel-task-floating-playwright.cjs",
      path.join(base, "payload-01/installer-resource-report.json"), session,
      "--candidate=1.9.30", `--installation-file=${receipt}`, `--candidate-qa-root=${floating}`], {
      AGENTVN_TEST_PROJECT: path.join(session, "isolated-A.vnproj"), AGENTVN_WORKSPACE_OUTPUT: session,
    });
    await run("novel-floating-audit", ["scripts/candidate-1930-novel-audit.cjs", "floating", "01", "01"]);
    assert.equal(read(path.join(floating, "audit-01/report.json")).status, "PASS");
    await run("all-pages-guard", ["scripts/candidate-1930-layout-author-test.cjs"]);
    const pages = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-68";
    await run("all-pages-author", ["scripts/candidate-1930-layout-author.cjs", "author", "68",
      "--matrix", "--codex-cache-view", "--collapse-health"], {
      AGENTVN_TEST_PROJECT: path.join(pages, "双布局全页面独立工程.vnproj"), AGENTVN_WORKSPACE_OUTPUT: pages,
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(report, null, 2)); }
}
if (require.main === module) (process.argv[2] === "--self-test" ? selfTest() : main())
  .catch(e => { console.error(e); process.exitCode = 1; });
