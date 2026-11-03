"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const A = require("./lib/installed-acceptance.cjs");

const runRoot = path.resolve(process.argv[2] || "");
const qaRoot = path.resolve("F:/AgentVN/QA");
assert(process.argv[2] && A.inside(qaRoot, runRoot) && fs.existsSync(runRoot));
const reportFile = path.join(runRoot, "security-followup-audit.json");
assert(!fs.existsSync(reportFile), "Never overwrite security follow-up evidence");
const sessionFile = fs.existsSync(path.join(runRoot, "session-report.json"))
  ? path.join(runRoot, "session-report.json") : path.join(runRoot, "report.json");
const session = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
const installedState = JSON.parse(fs.readFileSync(path.join(runRoot, "installed-processes.json"), "utf8"));
const installRoot = session.installRoot || installedState.installRoot;
assert(installRoot, "The tested install root must be known");
const sourceDatabase = path.join(process.env.APPDATA, "com.agentvn.editor", "backend", "vn_engine.db");
const python = [
  "import sqlite3,os,json",
  "p=os.path.join(os.environ['APPDATA'],'com.agentvn.editor','backend','vn_engine.db')",
  "c=sqlite3.connect('file:'+p.replace(chr(92),'/')+'?mode=ro',uri=True)",
  "d={k:json.loads(v) for k,v in c.execute('SELECT key,value FROM editor_shared_state WHERE key IN (?,?,?,?)',('provider_connections','provider_models','provider_selections','provider_secrets'))}",
  "m=next(m for m in d['provider_models'] if m['provider_id']==d['provider_selections']['text_generation'])",
  "x=next(x for x in d['provider_connections'] if x['connection_id']==m['connection_id'])",
  "print(json.dumps({'modelId':m['model_id'],'connectionId':x['connection_id'],'secret':d['provider_secrets'].get(x['connection_id'])}))",
  "c.close()",
].join("\n");
const configured = JSON.parse(execFileSync("python", ["-c", python], {
  encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
}));
assert(configured.secret && configured.modelId === session.model,
  "The selected credential must match the tested model before residue inspection");

function scan(root, needle, exclude = new Set()) {
  const findings = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (exclude.has(path.resolve(file))) continue;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(file);
        const offset = bytes.indexOf(needle);
        if (offset >= 0) findings.push({
          path: path.relative(root, file),
          offset,
          bytes: bytes.length,
          sha256: A.sha256(bytes),
        });
      }
    }
  };
  visit(root);
  return findings;
}

const webviewRoot = path.join(runRoot, "webview");
const profileExists = fs.existsSync(webviewRoot);
const profileIsOwnedDirectory = profileExists
  && A.inside(runRoot, webviewRoot)
  && fs.lstatSync(webviewRoot).isDirectory()
  && !fs.lstatSync(webviewRoot).isSymbolicLink();
assert(!profileExists || profileIsOwnedDirectory, "Refusing to remove an unowned or redirected WebView path");
const needle = Buffer.from(configured.secret);
const findings = scan(runRoot, needle);
const webviewFindings = findings.filter(row => row.path.startsWith("webview" + path.sep));
const outsideProfileFindings = findings.filter(row => !row.path.startsWith("webview" + path.sep));

const processRows = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('agentvn-editor.exe','creator-backend.exe','agentvn-player.exe') } | Select-Object ProcessId,Name,ExecutablePath | ConvertTo-Json -Compress"],
{ windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) || "[]");
const processes = (Array.isArray(processRows) ? processRows : [processRows])
  .filter(row => row.ExecutablePath && path.resolve(row.ExecutablePath).toLowerCase()
    .startsWith(path.resolve(installRoot).toLowerCase()));
const cleanup = { webviewProfileRemoved: false, reason: "No sensitive profile residue found" };
if (webviewFindings.length && profileExists) {
  assert.equal(processes.length, 0, "Refusing to remove a WebView profile while its installed app is running");
  fs.rmSync(webviewRoot, { recursive: true, force: false });
  cleanup.webviewProfileRemoved = true;
  cleanup.reason = "Removed this run's dedicated WebView profile after preserving hashes and offsets";
}

const report = {
  status: findings.length ? "FAILED" : "PASS",
  scope: "Read-only scan of this installed real-model run for the configured model credential",
  runRoot,
  sourceDatabase,
  modelId: configured.modelId,
  connectionId: configured.connectionId,
  runnerReportStatus: session.status,
  runnerReportSha256: A.sha256(fs.readFileSync(sessionFile)),
  providerRequests: session.usage?.requestCount ?? session.upstreamRequests?.length,
  providerReportedTokens: session.usage?.providerReportedTokens,
  findings: findings.map(row => ({
    ...row,
    surface: row.path.startsWith("webview" + path.sep)
      ? "Isolated Chromium WebView profile"
      : "Other run artifact",
    likelyPayload: "provider_secrets entry for the isolated provider connection",
  })),
  outsideProfileFindings,
  sourceEvidence: {
    route: "GET /api/project/state",
    handler: "backend/app/api/routes_project.py:load_project_state",
    stateLoader: "backend/app/services/project_state_service.py:ProjectStateService.load_state",
    finding: "Shared state response includes provider_secrets; installed WebView cache contains the selected credential.",
  },
  cleanup,
  processesForInstallRoot: processes.length,
  completedAt: new Date().toISOString(),
};
if (outsideProfileFindings.length) report.status = "FAILED";
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { flag: "wx" });
configured.secret = undefined;
console.log(JSON.stringify({
  status: report.status,
  findingCount: findings.length,
  webviewProfileRemoved: cleanup.webviewProfileRemoved,
  report: reportFile,
}));
if (report.status !== "PASS") process.exitCode = 1;
