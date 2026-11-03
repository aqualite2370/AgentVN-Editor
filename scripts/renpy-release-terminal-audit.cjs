"use strict";
// Read-only terminal checks. Preserve every earlier FAIL/BLOCKED and never
// turn the incomplete native-picker workflow into a release acceptance PASS.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const qa = path.resolve(process.argv[2] || ""), out = path.resolve(process.argv[3] || "");
assert(process.argv[2] && process.argv[3] && qa.startsWith("F:\\AgentVN\\QA\\") && !fs.existsSync(out));
assert(out.startsWith(qa + path.sep)); fs.mkdirSync(out);
const read = relative => JSON.parse(fs.readFileSync(path.join(qa, relative)));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [],
  releaseAcceptance: "BLOCKED_NATIVE_PICKER_AND_NORMAL_WINDOW_CLOSE" };
function check(name, action) { const detail = action(); report.cases.push({ name, status: "PASS", detail }); }
try {
  check("same-built-dev-installed-and-archived-installer-bytes", () => {
    const built = read("release-package-01/report.json"); assert.equal(built.status, "PASS");
    const dev = "D:\\AgentVN\\AgentVN Dev.exe", debug = "D:\\AgentVN\\editor\\src-tauri\\target\\debug\\agentvn-editor.exe";
    assert.equal(sha256(fs.readFileSync(dev)), built.beforeDev.sha256);
    assert.equal(sha256(fs.readFileSync(dev)), sha256(fs.readFileSync(debug)));
    const installer = built.newInstallers[0];
    assert.equal(sha256(fs.readFileSync(installer.path)), installer.sha256);
    const installation = read("release-install-01/actual-installation.json");
    assert.equal(installation.status, "PASS"); assert.equal(installation.registryRestored, true);
    assert.equal(sha256(fs.readFileSync(installation.executable.path)), installation.executable.sha256);
    assert.equal(sha256(fs.readFileSync(installation.installer.path)), installer.sha256);
    return { devSha256: built.beforeDev.sha256, installer, installedEditor: installation.executable };
  });
  check("default-shared-database-unchanged", () => {
    const file = path.join(process.env.APPDATA, "com.agentvn.editor/backend/vn_engine.db");
    const hash = sha256(fs.readFileSync(file));
    assert.equal(hash, "984d7a62038312040b8d510312bb01ef0268e8d9c9987ea04181db531f4ab1e3");
    return { file, sha256: hash };
  });
  check("paid-session-exactly-three-and-isolated-secrets-empty", () => {
    const result = read("real-knowledge-01/report.json");
    assert.equal(result.status, "PASS"); assert.equal(result.questionsSubmitted, 3);
    assert.equal(result.upstreamRequests.length, 3); assert.equal(result.cases.length, 3);
    assert(result.upstreamRequests.every(row => row.status === "PASS" && row.httpStatus === 200));
    assert.equal(result.credentialCleanup, "CLEARED_AND_VACUUMED_ISOLATED_DB");
    const state = read("real-knowledge-01/installed-processes.json");
    const cleared = execFileSync("python", ["-c",
      "import sqlite3,sys,json;c=sqlite3.connect('file:'+sys.argv[1].replace(chr(92),'/')+'?mode=ro',uri=True);rows=c.execute(\"SELECT value FROM editor_shared_state WHERE key='provider_secrets'\").fetchall();print(json.dumps({'cleared':all(json.loads(v[0])=={} for v in rows),'rows':len(rows)}));c.close()",
      state.databasePath], { windowsHide: true, encoding: "utf8" });
    const proof = JSON.parse(cleared); assert(proof.cleared && proof.rows === 1);
    const totals = result.upstreamRequests.reduce((sum, row) => {
      for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) sum[key] += row.usage[key];
      return sum;
    }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    return { model: result.model, requests: 3, totals, isolatedSecrets: proof };
  });
  check("installed-behavior-matrix-and-native-gap-kept-distinct", () => {
    const result = read("installed-flow-03/report.json"), persistence = read("installed-persistence-02/report.json");
    assert.equal(result.status, "BLOCKED"); assert.equal(result.matrix.length, 12);
    assert.equal(result.cases.filter(row => row.status === "PASS").length, 5);
    assert.equal(result.cases.filter(row => row.status === "BLOCKED").length, 1);
    assert.equal(persistence.status, "PASS"); assert.equal(persistence.cases.length, 3);
    assert.equal(persistence.boundaries.nativePicker, "BLOCKED_NOT_EXERCISED");
    assert.equal(persistence.boundaries.normalWindowClose, "NOT_EXERCISED");
    assert.equal(persistence.boundaries.portableReimport, "PUBLIC_BACKEND_API_THEN_REAL_RECENT_PROJECT_BUTTON");
    return { mainCasesPassed: 5, displayCombinations: 12, persistenceCasesPassed: 3, nativePicker: "BLOCKED" };
  });
  check("owned-downloads-retained-in-F-and-removed-from-downloads", () => {
    return ["installed-persistence-01/report.json", "installed-persistence-02/report.json"].map(name => {
      const proof = read(name).downloadCleanup; assert.equal(proof.status, "PASS");
      assert(!fs.existsSync(proof.originalPath));
      assert.equal(sha256(fs.readFileSync(proof.retainedPath)), proof.sha256);
      return proof;
    });
  });
  check("owned-processes-and-ports-have-no-residue", () => {
    const launches = [];
    for (const name of ["installed-flow-01", "installed-flow-02", "installed-flow-03", "real-knowledge-01"])
      for (const child of fs.readdirSync(path.join(qa, name)).filter(name => /^owned-launch-\d+$/.test(name)))
        launches.push(read(`${name}/${child}/installed-processes.json`));
    const pids = [...new Set(launches.flatMap(row => [row.editorPid, row.backendPid]))];
    const ports = [...new Set(launches.flatMap(row => [row.backendPort, row.cdpPort]))];
    const player = read("installed-flow-03/report.json").player; pids.push(player.pid); ports.push(player.port);
    const text = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `$qaProcessIds=@(${pids.join(",")}); $qaPorts=@(${ports.join(",")}); [pscustomobject]@{processes=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in $qaProcessIds } | Select-Object ProcessId,ExecutablePath);listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $qaPorts } | Select-Object LocalPort,OwningProcess)} | ConvertTo-Json -Depth 4 -Compress`],
      { windowsHide: true, encoding: "utf8" });
    const result = JSON.parse(text); assert.equal(result.processes.length, 0); assert.equal(result.listeners.length, 0);
    return { launches: launches.length, pids: pids.length, ports: ports.length, result };
  });
  assert.equal(report.cases.length, 6); report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
