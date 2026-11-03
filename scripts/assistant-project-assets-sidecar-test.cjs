"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { startOwnedCreationSidecar } = require("./lib/owned-creation-api.cjs");
const root = path.resolve(__dirname, "..");
assert(process.env.AGENTVN_WORKSPACE_OUTPUT, "Independent output required");
const output = path.join(process.env.AGENTVN_WORKSPACE_OUTPUT, "sidecar-api", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const report = { status: "RUNNING", cases: [],
  scope: "new packaged backend, real persistent queue/native tool HTTP; controlled external response, NOT installed Editor/live-model evidence" };
async function main() {
  let host;
  const previousProposal = process.env.AGENTVN_CREATION_PROPOSAL_REPORT;
  try {
    process.env.AGENTVN_CREATION_PROPOSAL_REPORT = path.join(root, "scripts/fixtures/assistant-project-image-proposal.json");
    host = await startOwnedCreationSidecar(output, path.join(root, "editor/src-tauri/binaries/creator-backend.exe"));
    report.host = { apiUrl: host.apiUrl, exeSha256: host.exeSha256, pid: host.pid, database: host.database };
    for (const authorized of [true, false]) {
      host.assertAlive();
      const id = `project-image-${authorized}`;
      const response = await fetch(`${host.apiUrl}/api/assistant/creation/processes`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          id, project_id: "isolated-project", project_title: "隔离素材工程", conversation_id: `conversation-${id}`,
          request: { user_request: "构建图片组件", authorized_assets: authorized
            ? [{ id: "project-asset-1", filename: "授权图片.png", mime_type: "image/png" }] : [] },
        }), signal: AbortSignal.timeout(10000),
      });
      assert.equal(response.status, 202);
      const deadline = Date.now() + 30000;
      let result;
      do {
        result = await (await fetch(`${host.apiUrl}/api/assistant/creation/processes/${id}`, { signal: AbortSignal.timeout(5000) })).json();
        if (["completed", "failed", "cancelled"].includes(result.status)) break;
        host.assertAlive();
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      assert.equal(result.status, authorized ? "completed" : "failed");
      if (authorized) assert.equal(result.result.components[0].name, "工程图片受控组件");
      else { assert.equal(result.errorCode, "proposal_not_authorized"); assert(!result.result); }
      assert(!JSON.stringify(result).includes("test-only-secret"));
      report.cases.push({ authorized, status: "PASS", processStatus: result.status });
    }
    report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = error.stack || String(error); process.exitCode = 1; }
  finally {
    if (host) { report.cleanup = await host.stop(); if (report.cleanup.code !== 0) { report.status = "FAILED"; process.exitCode = 1; } }
    if (previousProposal === undefined) delete process.env.AGENTVN_CREATION_PROPOSAL_REPORT;
    else process.env.AGENTVN_CREATION_PROPOSAL_REPORT = previousProposal;
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, output, cases: report.cases.length, cleanup: report.cleanup, error: report.error }));
  }
}
main();
