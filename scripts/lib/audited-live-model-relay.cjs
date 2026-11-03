"use strict";
// Transparent QA-only relay. Never persist headers, credentials, prompts,
// completion text or tool arguments. No retries, replay or response mutation.
const http = require("node:http"), https = require("node:https");
const crypto = require("node:crypto"), fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict");
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
async function startAuditedLiveModelRelay({ upstream, out, taskFile, testOnly = false }) {
  const target = new URL(upstream);
  assert(!target.username && !target.password && !target.search && !target.hash);
  assert(testOnly ? target.hostname === "127.0.0.1" : target.origin === "https://api.deepseek.com");
  assert(fs.statSync(out).isDirectory());
  const evidenceFile = path.join(out, "http-accounting.json");
  assert(!fs.existsSync(evidenceFile));
  const report = { scope: testOnly ? "LOCAL_SELF_TEST_NO_PAID_MODEL" : "REAL_DEEPSEEK_TRANSPARENT_HTTP_RELAY",
    startedAt: new Date().toISOString(), upstream: target.href, attempts: [], denied: [],
    credentialsLogged: false, requestBodiesLogged: false, responseBodiesLogged: false,
    automaticRetries: 0 };
  const save = () => {
    const temp = `${evidenceFile}.pending`;
    fs.writeFileSync(temp, JSON.stringify(report, null, 2));
    fs.renameSync(temp, evidenceFile);
  };
  const server = http.createServer(async (req, res) => {
    let task;
    try { task = JSON.parse(fs.readFileSync(taskFile, "utf8")); } catch {}
    if (req.method !== "POST" || req.url !== "/deepseek/chat/completions"
      || !["existing-control-edit", "new-component-agent", "novel-parse", "self-test"].includes(task?.task)) {
      report.denied.push({ at: new Date().toISOString(), reason: "UNAUTHORIZED_ROUTE_OR_TASK" });
      save(); res.writeHead(403); res.end('{"error":"QA relay requires an active allowed task"}'); return;
    }
    const chunks = []; let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length; assert(size <= 16 * 1024 * 1024, "Request limit");
        chunks.push(chunk);
      }
    } catch { res.writeHead(413); res.end(); return; }
    const body = Buffer.concat(chunks), parsed = (() => { try { return JSON.parse(body); } catch { return {}; } })();
    const row = { sequence: report.attempts.length + 1, task: task.task, startedAt: new Date().toISOString(),
      method: "POST", upstreamPath: `${target.pathname.replace(/\/$/, "")}/chat/completions`,
      model: typeof parsed.model === "string" ? parsed.model : null, streaming: parsed.stream === true,
      requestBytes: body.length, requestSha256: hash(body), forwardedRequestSha256: hash(body),
      status: "IN_FLIGHT", usage: null, usageStatus: "NOT_YET_AVAILABLE" };
    report.attempts.push(row); save();
    const transport = target.protocol === "https:" ? https : http;
    const headers = { ...req.headers, host: target.host, "accept-encoding": "identity" };
    delete headers.connection; delete headers["transfer-encoding"];
    headers["content-length"] = String(body.length);
    const upstreamReq = transport.request({ protocol: target.protocol, hostname: target.hostname,
      port: target.port || undefined, path: row.upstreamPath, method: "POST", headers }, response => {
      row.httpStatus = response.statusCode;
      const responseHeaders = { ...response.headers };
      delete responseHeaders.connection; delete responseHeaders["transfer-encoding"];
      res.writeHead(response.statusCode, responseHeaders);
      const received = [], digest = crypto.createHash("sha256"); let responseSize = 0;
      response.on("data", chunk => {
        responseSize += chunk.length; digest.update(chunk);
        if (responseSize <= 16 * 1024 * 1024) received.push(chunk);
        if (!res.destroyed) res.write(chunk);
      });
      response.on("end", () => {
        row.responseBytes = responseSize; row.responseSha256 = digest.digest("hex");
        row.forwardedResponseSha256 = row.responseSha256;
        if (responseSize <= 16 * 1024 * 1024) {
          const raw = Buffer.concat(received).toString("utf8");
          const messages = row.streaming ? raw.split(/\r?\n/).filter(l => l.startsWith("data: "))
            .map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean)
            : [(() => { try { return JSON.parse(raw); } catch { return null; } })()].filter(Boolean);
          row.usage = messages.map(m => m.usage).findLast(Boolean) || null;
          row.usageStatus = row.usage ? "PROVIDER_REPORTED" : "NOT_EXPOSED_BY_PROVIDER";
          row.finishReasons = messages.flatMap(m => (m.choices || []).map(c => c.finish_reason).filter(Boolean));
        } else row.usageStatus = "AUDIT_BODY_LIMIT";
        row.status = response.statusCode >= 200 && response.statusCode < 300 ? "SUCCEEDED" : "UPSTREAM_REJECTED";
        row.finishedAt = new Date().toISOString(); save(); if (!res.destroyed) res.end();
      });
      response.on("error", () => {
        row.status = "UPSTREAM_RESPONSE_INTERRUPTED"; row.finishedAt = new Date().toISOString();
        save(); res.destroy();
      });
    });
    upstreamReq.setTimeout(600000, () => upstreamReq.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    upstreamReq.on("error", error => {
      row.status = "TRANSPORT_FAILED"; row.errorCode = /^[A-Z0-9_]+$/.test(error.code || "") ? error.code : "NETWORK_ERROR";
      row.finishedAt = new Date().toISOString(); save();
      if (!res.headersSent) res.writeHead(502);
      if (!res.destroyed) res.end('{"error":"Audited relay upstream transport failed; not retried"}');
    });
    upstreamReq.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  save();
  return { report, evidenceFile, baseUrl: `http://127.0.0.1:${server.address().port}/deepseek`,
    async stop() { await new Promise(resolve => server.close(resolve)); report.stoppedAt = new Date().toISOString(); save(); } };
}
module.exports = { startAuditedLiveModelRelay };
