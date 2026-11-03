"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const run = path.resolve(process.argv[2] || ""), playerRoot = path.resolve(process.argv[3] || "");
assert(process.argv[2] && process.argv[3] && A.inside("F:/AgentVN/QA", run) && A.inside("F:/AgentVN/QA", playerRoot));
const out = path.join(run, "closure-audit.json"); assert(!fs.existsSync(out));
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const main = read(path.join(run, "session-report.json")), author = read(main.creationReport.path);
const persistence = read(path.join(run, "persistence-followup/report.json"));
const player = read(path.join(playerRoot, "report.json"));
const securityRoots = [
  run,
  path.join(path.dirname(run), "real-control-20261102-01"),
  path.join(path.dirname(run), "real-component-20261102-03"),
  path.join(path.dirname(run), "real-knowledge-20261102-01"),
];
const report = { status: "RUNNING", auditedAt: new Date().toISOString(), checks: [], scope: {
  functional: "One authorized existing-title-control label edit, process restart, portable save/reimport and installed Player",
  security: "Associated real-model sessions; literal selected-provider credential scan and cleanup evidence",
  notCovered: ["All AI capabilities", "Windows setup", "Android", "Final user project", "Motion polish"],
} };
function check(name, fn) { const detail = fn(); report.checks.push({ name, status: "PASS", detail }); }
(async () => {
  check("candidate-identity-and-original-evidence-unchanged", () => {
    assert.equal(A.sha256(fs.readFileSync(main.creationReport.path)), main.creationReport.sha256);
    for (const [name, hash] of [["agentvn-editor.exe", main.editorSha256],
      ["creator-backend.exe", main.backendSha256], ["agentvn-player.exe", main.playerSha256]])
      assert.equal(A.sha256(fs.readFileSync(path.join(main.installRoot, name))), hash);
    return { editor: main.editorSha256, backend: main.backendSha256, player: main.playerSha256 };
  });
  check("one-authorized-task-five-metered-requests-and-exact-label-only-proposal", () => {
    assert.equal(author.requests.length, 1); assert.equal(author.requests[0].authorizedTargets.length, 1);
    assert.deepEqual(author.process.result, { components: [], edits: [{ target_id: "target-1", screen_id: "title", label: "开始创作" }] });
    const meter = read(path.join(run, "provider-usage.json"));
    assert.equal(meter.requests.length, 5); assert(meter.requests.every(row => row.status === "PASS"));
    const tokens = meter.requests.reduce((sum, row) => sum + row.usage.total_tokens, 0);
    assert.equal(tokens, 22507);
    assert.equal(author.cases.length, 5); assert(author.cases.every(row => row.status === "PASS"));
    assert.equal(author.matrix.length, 12); return { uiTasks: 1, providerRequests: 5, providerTokens: tokens };
  });
  check("restart-portable-reopen-and-real-player-functional-evidence", () => {
    assert.equal(persistence.status, "PASS"); assert.equal(persistence.cases.length, 3);
    assert.equal(persistence.modelRequests, 0); assert.equal(player.modelRequests, 0);
    assert.equal(player.status, "PASS"); assert.equal(player.cases.length, 12);
    assert.equal(player.profileRestoration, "PASS"); assert.equal(player.cleanupExitCode, 0);
    assert.equal(persistence.downloadCleanup.userFilesDeleted, 0);
    assert(!fs.existsSync(persistence.downloadCleanup.removed));
    for (const record of [persistence.portable, main.creationReport.cartridgeArtifact])
      assert.equal(A.sha256(fs.readFileSync(record.path)), record.sha256);
    return { restartAndPortableCases: 3, playerDisplayCombinations: 12, playerStoryStarted: !!player.storyText };
  });
  const artifact = main.creationReport.cartridgeArtifact;
  const card = await JSZip.loadAsync(fs.readFileSync(artifact.path), { checkCRC32: true });
  const layout = JSON.parse(await card.file("ui/layout.json").async("string"));
  const portable = await JSZip.loadAsync(fs.readFileSync(persistence.portable.path), { checkCRC32: true });
  const project = JSON.parse(await portable.file("project.json").async("string"));
  check("portable-exported-layout-and-approved-target-agree", () => {
    assert.deepEqual(layout, project.editor_settings.runtimeUILayout);
    const edited = layout.screens.flatMap(screen => screen.components).filter(c => c.label === "开始创作");
    assert.equal(edited.length, 1); assert.deepEqual(edited[0].rect, author.requests[0].authorizedTargets[0].rect);
    return { cartridge: artifact.sha256, portable: persistence.portable.sha256 };
  });
  check("all-eight-pngs-have-recorded-hash-real-dimensions-and-unchanged-metrics", () => {
    const screenshots = [...author.screenshots, ...persistence.screenshots, ...player.screenshots];
    assert.equal(screenshots.length, 8);
    for (const s of screenshots) {
      const bytes = fs.readFileSync(s.path); assert.equal(A.sha256(bytes), s.sha256);
      assert.deepEqual(s.before, s.after);
      assert.equal(bytes.readUInt32BE(16), s.png.width); assert.equal(bytes.readUInt32BE(20), s.png.height);
      assert.equal(s.png.width, Math.round(s.before.width * s.before.dpr));
      assert.equal(s.png.height, Math.round(s.before.height * s.before.dpr));
    }
    return { pngs: screenshots.length };
  });
  check("associated-credential-cache-failures-are-preserved-and-removed", () => {
    return securityRoots.map(directory => {
      const audit = read(path.join(directory, "security-followup-audit.json"));
      assert.equal(audit.status, "FAILED"); assert.equal(audit.findings.length, 1);
      assert.equal(audit.cleanup.webviewProfileRemoved, true);
      assert.equal(audit.outsideProfileFindings.length, 0);
      if (directory !== run) assert(!fs.existsSync(path.join(directory, "webview")));
      return { directory, findings: audit.findings.length, removedOwnedProfile: true };
    });
  });
  const python = [
    "import sqlite3,sys,os,json,pathlib",
    "root=pathlib.Path(sys.argv[1])",
    "p=os.path.join(os.environ['APPDATA'],'com.agentvn.editor','backend','vn_engine.db')",
    "c=sqlite3.connect('file:'+p.replace(chr(92),'/')+'?mode=ro',uri=True)",
    "d={k:json.loads(v) for k,v in c.execute('SELECT key,value FROM editor_shared_state WHERE key IN (?,?,?,?)',('provider_connections','provider_models','provider_selections','provider_secrets'))}",
    "m=next(m for m in d['provider_models'] if m['provider_id']==d['provider_selections']['text_generation'])",
    "x=next(x for x in d['provider_connections'] if x['connection_id']==m['connection_id'])",
    "secret=d['provider_secrets'].get(x['connection_id']);c.close()",
    "assert secret",
    "needle=secret.encode()",
    "paths=json.loads(sys.argv[2])",
    "findings=[str(f) for r in paths for f in pathlib.Path(r).rglob('*') if f.is_file() and needle in f.read_bytes()]",
    "dbs=list(root.rglob('vn_engine.db'))",
    "results=[]",
    "for db in dbs:",
    " c=sqlite3.connect('file:'+str(db).replace(chr(92),'/')+'?mode=ro',uri=True)",
    " v=c.execute(\"SELECT value FROM editor_shared_state WHERE key='provider_secrets'\").fetchone()",
    " results.append({'database':str(db),'secretsEmpty':not v or json.loads(v[0])=={}});c.close()",
    "print(json.dumps({'defaultConfiguredCredentialPreserved':bool(secret),'remainingLiteralMatches':findings,'isolatedDatabases':results}))",
  ].join("\n");
  report.credentialRescan = JSON.parse(execFileSync("python", ["-c", python, run, JSON.stringify(securityRoots)], {
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
  }));
  assert.deepEqual(report.credentialRescan.remainingLiteralMatches, []);
  assert(report.credentialRescan.isolatedDatabases.every(row => row.secretsEmpty));
  const processesText = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    "Get-CimInstance Win32_Process | Where-Object {$_.Name -in @('agentvn-editor.exe','creator-backend.exe','agentvn-player.exe')} | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"],
  { encoding: "utf8", windowsHide: true });
  const processes = processesText.trim() ? JSON.parse(processesText) : [];
  report.remainingInstalledProcesses = (Array.isArray(processes) ? processes : [processes])
    .filter(row => row.ExecutablePath?.toLowerCase().startsWith(main.installRoot.toLowerCase()));
  assert.equal(report.remainingInstalledProcesses.length, 0);
  const ports = new Set([player.process.port, ...persistence.launches.flatMap(row => [row.backendPort, row.cdpPort])]);
  for (const name of fs.readdirSync(run).filter(n => /^owned-launch-\d+$/.test(n))) {
    const p = read(path.join(run, name, "installed-processes.json")); ports.add(p.backendPort); ports.add(p.cdpPort);
  }
  const listeners = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in @(${[...ports].join(",")})}).Count`],
  { encoding: "utf8", windowsHide: true }).trim();
  assert.equal(listeners, "0"); report.checkedClosedPorts = [...ports];
  report.functionalStatus = "PASS";
  report.cleanupStatus = "PASS";
  report.securityStatus = "FAILED";
  report.status = "FAILED";
  report.failureReason = "Real model credentials were persisted in WebView cache; literal residue has been removed but the product defect is not fixed.";
})().catch(error => {
  report.status = "FAILED"; report.auditError = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, functionalStatus: report.functionalStatus,
    cleanupStatus: report.cleanupStatus, securityStatus: report.securityStatus,
    auditError: report.auditError, report: out }));
});
