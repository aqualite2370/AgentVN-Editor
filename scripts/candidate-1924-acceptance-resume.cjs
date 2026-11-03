"use strict";
// One serial owner, explicit original receipts, no retry and no product build.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { rows } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";
assert.equal(process.argv[2], "01");
const out = path.join(base, "acceptance-resume-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const stages = [
  ["readiness-guard", "scripts/candidate-1924-export-consume-ready.cjs", ["--self-test"]],
  ["fresh-consumption", "scripts/candidate-1924-export-consume-ready.cjs", ["02"],
    "F:/AgentVN/QA/Native-Runtime-State-20261020-01/fresh-export-installed-1924-02/report.json"],
  ["fresh-audit", "scripts/candidate-1924-export-consume-ready-audit.cjs", ["02"], `${base}/fresh-export-audit-02/report.json`],
  ["abilities", "scripts/candidate-1924-abilities-session.cjs", ["02"],
    "F:/AgentVN/QA/Native-Runtime-State-20261020-01/abilities-installed-1924-02/session.json"],
  ["abilities-audit", "scripts/candidate-1924-abilities-audit.cjs", ["02"], `${base}/abilities-audit-02/report.json`],
  ["quick-exceptions", "scripts/candidate-1924-quick-session.cjs", ["02"],
    "F:/AgentVN/QA/Native-Runtime-State-20261020-01/quick-installed-1924-02/session.json"],
  ["quick-audit", "scripts/candidate-1924-quick-audit.cjs", ["02"], `${base}/quick-audit-02/report.json`],
  ["old-runtime", "scripts/renpy-title-old-runtime-native.cjs", ["01"],
    "F:/AgentVN/QA/Native-Runtime-State-20261020-01/title-old-026-01/report.json"],
  ["old-runtime-audit", "scripts/renpy-title-old-runtime-audit.cjs", ["01"], `${base}/title-old-audit-01/report.json`],
];
const tools = [...new Set([__filename, ...stages.map(s => s[1]),
  "scripts/candidate-1924-export-consume.cjs", "scripts/candidate-1924-export-consume-audit.cjs",
  "scripts/candidate-1924-choice-entry-probe.cjs", "scripts/candidate-1924-abilities-flow.cjs",
  "scripts/candidate-1924-abilities-adapter-test.cjs", "scripts/lib/candidate-1924-abilities-adapter.cjs",
  "scripts/installed-runtime-abilities-playwright.cjs", "scripts/candidate-1924-quick-flow.cjs",
  "scripts/candidate-1924-quick-adapter-test.cjs", "scripts/candidate-1924-quick-lock.ps1",
  "scripts/lib/candidate-1924-quick-adapter.cjs", "scripts/lib/renpy-title-old-runtime-evidence.cjs",
  "scripts/lib/dev-narrative-player.cjs", "scripts/native-dev-preview-profile.ps1",
  "scripts/lib/current-native-editor-session.cjs", "scripts/lib/current-native-capture.cjs",
  "scripts/lib/installed-runtime-session.cjs", "scripts/lib/installed-acceptance.cjs",
  "scripts/lib/owned-process-tree.cjs", "scripts/lib/owned-process-stop.cjs",
  "scripts/lib/runtime-story-observer.cjs"])].map(desc);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), out, commands: [], tools,
  scope: "SERIAL_CURRENT_INSTALLED_CONSUMPTION_ABILITIES_QUICK_AND_OLD_PROTOCOL_NOT_FULL_REGRESSION",
  builds: 0, modelRequests: 0, productChanges: 0,
  diagnosis: desc("F:/AgentVN/QA/Native-Runtime-State-20261020-01/choice-entry-probe-1924-01/report.json"),
  originalFailed: desc("F:/AgentVN/QA/Native-Runtime-State-20261020-01/fresh-export-installed-1924-01/report.json") };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function verify() { for (const t of [...tools, report.diagnosis, report.originalFailed]) assert.equal(sha(t.path), t.sha256, t.path); }
(async () => {
  save(); verify();
  assert.equal(read(report.diagnosis.path).status, "PASS");
  assert.equal(read(report.originalFailed.path).status, "FAILED");
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  for (const item of tools) {
    const copy = path.join(out, "tools", path.relative(root, item.path));
    fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(item.path, copy, fs.constants.COPYFILE_EXCL);
  }
  for (const [name, script, args, result] of stages) {
    verify();
    if (result) assert(!fs.existsSync(result), `No overwriting historical results: ${result}`);
    const c = { name, command: [process.execPath, script, ...args], status: "RUNNING",
      startedAt: new Date().toISOString(), log: path.join(out, `${name}.log`) };
    report.commands.push(c); save();
    const fd = fs.openSync(c.log, "wx");
    try {
      const child = spawn(process.execPath, [script, ...args], { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd] });
      c.pid = child.pid; c.identity = rows().find(p => p.ProcessId === child.pid); save();
      c.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      assert.equal(c.exitCode, 0, c.log);
      if (result) {
        const r = read(result); assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.cleanupError);
        c.receipt = desc(result);
      }
      c.status = "PASS"; console.log(`PASS ${name}`);
    } catch (error) { c.status = "FAILED"; throw error; }
    finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); }
  }
  verify(); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => {
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, commands: report.commands.length, error: report.error }));
  });
