"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const net = require("node:net");
const { execFileSync, spawn, spawnSync } = require("node:child_process");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const A = require("./lib/installed-acceptance.cjs");

const auditFile = path.resolve(process.argv[2] || "");
const runRoot = path.resolve(process.argv[3] || "");
const qaRoot = path.resolve("F:/AgentVN/QA");
assert(process.argv[2] && process.argv[3], "Pass the frozen installer receipt and a new QA run directory");
assert(A.inside(qaRoot, runRoot) && !fs.existsSync(runRoot), "Run directory must be new and inside F:/AgentVN/QA");
assert(fs.existsSync(auditFile), "Frozen installer resource receipt is required");

const root = path.resolve(__dirname, "..");
const sourceDatabase = path.join(process.env.APPDATA, "com.agentvn.editor", "backend", "vn_engine.db");
const readProvider = () => {
  const python = [
    "import sqlite3,os,json",
    "p=os.path.join(os.environ['APPDATA'],'com.agentvn.editor','backend','vn_engine.db')",
    "c=sqlite3.connect('file:'+p.replace(chr(92),'/')+'?mode=ro',uri=True)",
    "d={k:json.loads(v) for k,v in c.execute('SELECT key,value FROM editor_shared_state WHERE key IN (?,?,?,?)',('provider_connections','provider_models','provider_selections','provider_secrets'))}",
    "m=next(m for m in d['provider_models'] if m['provider_id']==d['provider_selections']['text_generation'])",
    "x=next(x for x in d['provider_connections'] if x['connection_id']==m['connection_id'])",
    "print(json.dumps({'model':m,'connection':x,'secret':d['provider_secrets'].get(x['connection_id'])}))",
    "c.close()",
  ].join("\n");
  const selected = JSON.parse(execFileSync("python", ["-c", python], {
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
  }));
  assert(selected.secret && /^deepseek/i.test(selected.model.model_id));
  const endpoint = new URL(selected.connection.base_url);
  assert.equal(endpoint.protocol, "https:");
  assert(!endpoint.username && !endpoint.password, "Credentials must not be embedded in the provider URL");
  return selected;
};

const provider = readProvider();
const upstream = new URL(provider.connection.base_url);
const expectedPath = `${upstream.pathname.replace(/\/$/, "")}/chat/completions`;
const usageRows = [];
const bodyHashes = new Set();
let owner, child, providerConfigured = false;
let runRootCreated = false;
const report = {
  status: "RUNNING",
  scope: "Current frozen installed Editor: one live existing-control proposal, review, save/reload and export",
  startedAt: new Date().toISOString(),
  model: provider.model.model_id,
  modelCallLimit: 12,
  duplicateRequestRetriesForwarded: 0,
  sourceDatabaseUsedReadOnly: sourceDatabase,
  installerReceipt: { path: auditFile, sha256: A.sha256(fs.readFileSync(auditFile)) },
  usageLog: path.join(runRoot, "provider-usage.json"),
  productChanges: 0,
  builds: 0,
};
const saveMeter = () => fs.writeFileSync(path.join(runRoot, "provider-usage.json"),
  JSON.stringify({ model: provider.model.model_id, requests: usageRows }, null, 2));
const meter = http.createServer(async (request, response) => {
  let row;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      assert(size <= 10 * 1024 * 1024, "Provider request exceeds the acceptance limit");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const body = JSON.parse(bytes);
    assert.equal(request.method, "POST");
    assert.equal(request.url, expectedPath);
    assert.equal(body.model, provider.model.model_id);
    assert.notEqual(body.stream, true, "Streaming responses are not accepted by this meter");
    assert(request.headers.authorization, "Provider authorization is missing");
    assert(usageRows.length < report.modelCallLimit, "Live control-edit request cap reached; no more calls are forwarded");
    const bodyHash = A.sha256(bytes);
    assert(!bodyHashes.has(bodyHash), "Duplicate provider request blocked; no retry is forwarded");
    bodyHashes.add(bodyHash);
    row = { startedAt: new Date().toISOString(), requestBytes: bytes.length, status: "RUNNING" };
    usageRows.push(row);
    saveMeter();
    const result = await fetch(new URL(request.url, upstream.origin), {
      method: "POST",
      headers: {
        "content-type": request.headers["content-type"] || "application/json",
        authorization: request.headers.authorization,
      },
      body: bytes,
      signal: AbortSignal.timeout(180000),
      redirect: "error",
    });
    const resultBytes = Buffer.from(await result.arrayBuffer());
    let payload;
    try { payload = JSON.parse(resultBytes); } catch {}
    const usage = payload?.usage;
    const safeUsage = usage && typeof usage === "object" && !Array.isArray(usage)
      ? Object.fromEntries(["prompt_tokens", "completion_tokens", "total_tokens", "prompt_cache_hit_tokens",
        "prompt_cache_miss_tokens", "input_tokens", "output_tokens"]
        .filter(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
        .map(key => [key, usage[key]]))
      : {};
    Object.assign(row, {
      httpStatus: result.status,
      status: result.ok ? "PASS" : "FAILED",
      usage: safeUsage,
      usageStatus: Object.keys(safeUsage).length ? "PROVIDER_REPORTED" : "NOT_RETURNED_BY_PROVIDER",
      responseBytes: resultBytes.length,
      finishedAt: new Date().toISOString(),
    });
    saveMeter();
    response.writeHead(result.status, {
      "content-type": result.headers.get("content-type") || "application/json",
    });
    response.end(resultBytes);
  } catch (error) {
    if (row) Object.assign(row, { status: "FAILED", finishedAt: new Date().toISOString() });
    saveMeter();
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: `Live-session meter stopped (${error.name || "Error"}); no retry` } }));
  }
});

function isPidAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Measure-Object).Count`],
  { windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 && result.stdout.trim() === "1";
}

function writeReport() {
  const file = path.join(runRoot, "session-report.json");
  if (runRootCreated && !fs.existsSync(file))
    fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
}

(async () => {
  fs.mkdirSync(runRoot);
  runRootCreated = true;
  fs.copyFileSync(auditFile, path.join(runRoot, "installer-resource-report.json"), fs.constants.COPYFILE_EXCL);
  const project = fixture("installed_creation_smoke_20261014");
  project.project_id = "installed_creation_smoke_20261014";
  project.title = "当前候选真实控件修改隔离工程";
  const projectFile = path.join(runRoot, "fixture.vnproj");
  fs.writeFileSync(projectFile, JSON.stringify(project), { flag: "wx" });
  const out = path.join(runRoot, "session");
  process.env.AGENTVN_TEST_PROJECT = projectFile;
  process.env.AGENTVN_WORKSPACE_OUTPUT = out;

  await new Promise((resolve, reject) => {
    meter.once("error", reject);
    meter.listen(0, "127.0.0.1", resolve);
  });
  report.meterPort = meter.address().port;
  const proxyBase = `http://127.0.0.1:${report.meterPort}${upstream.pathname.replace(/\/$/, "")}`;
  owner = await startInstalledEditor(runRoot);
  report.installRoot = owner.state.installRoot;
  report.editorSha256 = A.sha256(fs.readFileSync(path.join(owner.state.installRoot, "agentvn-editor.exe")));
  report.backendSha256 = A.sha256(fs.readFileSync(path.join(owner.state.installRoot, "creator-backend.exe")));
  report.playerSha256 = A.sha256(fs.readFileSync(path.join(owner.state.installRoot, "agentvn-player.exe")));
  report.isolatedDatabase = owner.state.databasePath;

  const connectionId = "qa-real-control-edit";
  const providerId = "qa-real-control-edit-model";
  const configuredState = {
    provider_connections: [{ ...provider.connection, connection_id: connectionId,
      base_url: proxyBase, display_name: "隔离真实控件修改验收", enabled: true }],
    provider_models: [{ ...provider.model, provider_id: providerId, connection_id: connectionId,
      enabled: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
    provider_selections: { text_generation: providerId },
    provider_secrets: { [connectionId]: provider.secret },
  };
  const configured = await fetch(`http://127.0.0.1:${owner.state.backendPort}/api/project/state`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(configuredState),
    signal: AbortSignal.timeout(15000),
  });
  assert(configured.ok, "Cannot configure the isolated live provider");
  providerConfigured = true;

  const env = { ...process.env };
  child = spawn(process.execPath, [
    path.join(root, "scripts", "installed-editor-creation-playwright.cjs"),
    runRoot, projectFile, out,
  ], { cwd: root, env, windowsHide: true, stdio: "ignore" });
  const childResult = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  report.creationScriptExit = childResult;
  const childReportPath = path.join(out, "report.json");
  assert(fs.existsSync(childReportPath), "Installed control-edit script must leave a report");
  const childReport = JSON.parse(fs.readFileSync(childReportPath, "utf8"));
  report.creationReport = { path: childReportPath, sha256: A.sha256(fs.readFileSync(childReportPath)),
    status: childReport.status, cases: childReport.cases, matrix: childReport.matrix.length,
    requests: childReport.requests, processStatus: childReport.process?.status,
    cartridgeArtifact: childReport.cartridgeArtifact };
  assert.equal(childResult.code, 0, "Installed control-edit acceptance failed; inspect its raw report");
  assert.equal(childReport.status, "PASS");
  assert.equal(childReport.requests.length, 1, "Exactly one UI creation task is allowed");
  assert(childReport.cases.every(row => row.status === "PASS"));
  assert.equal(childReport.matrix.length, 12);
  assert(usageRows.length > 0 && usageRows.every(row => row.status === "PASS"));
  report.status = "PASS";
})().catch(error => {
  const message = `${error.name || "Error"}: ${error.message}`;
  report.status = "FAILED";
  report.error = provider.secret ? message.split(provider.secret).join("[redacted]") : message;
  process.exitCode = 1;
}).finally(async () => {
  if (owner?.state) {
    const backendAlive = isPidAlive(owner.state.backendPid);
    if (providerConfigured && backendAlive) {
      try {
        const response = await fetch(`http://127.0.0.1:${owner.state.backendPort}/api/project/state`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider_secrets: {} }),
          signal: AbortSignal.timeout(10000),
        });
        assert(response.ok);
      } catch {
        report.status = "FAILED";
        report.credentialCleanup = "API_CLEAR_FAILED";
        process.exitCode = 1;
      }
    }
    if (isPidAlive(owner.state.editorPid) || isPidAlive(owner.state.backendPid)) {
      report.cleanup = await owner.stop();
    } else {
      report.cleanup = { editor: "EXITED", backend: "EXITED" };
    }
    report.cleanupVerification = {
      editorPidAlive: isPidAlive(owner.state.editorPid),
      backendPidAlive: isPidAlive(owner.state.backendPid),
      openPorts: [],
    };
    for (const port of [owner.state.backendPort, owner.state.cdpPort]) {
      const open = await new Promise(resolve => {
        const socket = net.connect(port, "127.0.0.1");
        socket.setTimeout(500);
        socket.once("connect", () => { socket.destroy(); resolve(true); });
        socket.once("timeout", () => { socket.destroy(); resolve(false); });
        socket.once("error", () => resolve(false));
      });
      if (open) report.cleanupVerification.openPorts.push(port);
    }
    if (report.cleanupVerification.editorPidAlive || report.cleanupVerification.backendPidAlive
      || report.cleanupVerification.openPorts.length) {
      report.status = "FAILED";
      process.exitCode = 1;
    }
    try {
      const python = [
        "import sqlite3,sys,json",
        "p=sys.argv[1]",
        "c=sqlite3.connect(p)",
        "c.execute('PRAGMA secure_delete=ON')",
        "c.execute(\"UPDATE editor_shared_state SET value='{}' WHERE key='provider_secrets'\")",
        "c.commit()",
        "c.execute('PRAGMA wal_checkpoint(TRUNCATE)')",
        "c.execute('VACUUM')",
        "v=c.execute(\"SELECT value FROM editor_shared_state WHERE key='provider_secrets'\").fetchone()",
        "print(json.dumps({'secretsEmpty':json.loads(v[0])=={} if v else False}))",
        "c.close()",
      ].join("\n");
      report.credentialVacuum = JSON.parse(execFileSync("python", ["-c", python, owner.state.databasePath], {
        encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
      }));
      assert.equal(report.credentialVacuum.secretsEmpty, true);
    } catch {
      report.status = "FAILED";
      report.credentialVacuum = { secretsEmpty: false };
      process.exitCode = 1;
    }
  }
  provider.secret = undefined;
  if (meter.listening)
    await new Promise(resolve => { meter.closeAllConnections(); meter.close(resolve); });
  if (runRootCreated) saveMeter();
  report.usage = {
    requestCount: usageRows.length,
    providerReportedTokens: usageRows.reduce((sum, row) => sum + (row.usage?.total_tokens || 0), 0),
    statuses: usageRows.map(row => row.status),
  };
  report.finishedAt = new Date().toISOString();
  writeReport();
  let auditedStatus = report.status;
  let credentialAudit;
  if (owner?.state && runRootCreated) {
    const audit = spawnSync(process.execPath, [
      path.join(root, "scripts", "audit-installed-provider-credential-cache.cjs"), runRoot,
    ], { cwd: root, windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const auditPath = path.join(runRoot, "security-followup-audit.json");
    credentialAudit = { exitCode: audit.status, path: auditPath };
    if (fs.existsSync(auditPath)) credentialAudit.status = JSON.parse(fs.readFileSync(auditPath, "utf8")).status;
    if (audit.status !== 0 || credentialAudit.status !== "PASS") {
      auditedStatus = "FAILED";
      process.exitCode = 1;
    }
  }
  console.log(JSON.stringify({ status: auditedStatus, functionalRunnerStatus: report.status, credentialAudit,
    requests: report.usage.requestCount,
    providerReportedTokens: report.usage.providerReportedTokens,
    report: runRootCreated ? path.join(runRoot, "session-report.json") : null }));
});
