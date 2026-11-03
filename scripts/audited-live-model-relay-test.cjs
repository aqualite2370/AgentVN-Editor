"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const os = require("node:os"), http = require("node:http");
const { startAuditedLiveModelRelay } = require("./lib/audited-live-model-relay.cjs");
(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-relay-selftest-"));
  const taskFile = path.join(out, "task.json"); fs.writeFileSync(taskFile, JSON.stringify({ task: "self-test" }));
  const original = '{"model":"self-test-model","messages":[{"role":"user","content":"PRIVATE_PROMPT_SENTINEL"}]}';
  const reply = '{"choices":[{"message":{"content":"PRIVATE_RESPONSE_SENTINEL"},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}';
  let hits = 0;
  const upstream = http.createServer(async (req, res) => {
    hits++; const chunks = []; for await (const chunk of req) chunks.push(chunk);
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer PRIVATE_SECRET_SENTINEL");
    const bytes = Buffer.concat(chunks).toString();
    if (hits === 1) { assert.equal(bytes, original); res.writeHead(200, { "content-type": "application/json" }); res.end(reply); }
    else { res.writeHead(429, { "content-type": "application/json" }); res.end('{"error":"PRIVATE_ERROR_SENTINEL"}'); }
  });
  await new Promise(r => upstream.listen(0, "127.0.0.1", r));
  const relay = await startAuditedLiveModelRelay({ upstream: `http://127.0.0.1:${upstream.address().port}/v1`,
    out, taskFile, testOnly: true });
  try {
    const request = () => fetch(`${relay.baseUrl}/chat/completions`, { method: "POST",
      headers: { authorization: "Bearer PRIVATE_SECRET_SENTINEL", "content-type": "application/json" }, body: original });
    const a = await request(); assert.equal(await a.text(), reply);
    const b = await request(); assert.equal(b.status, 429); await b.text();
    fs.writeFileSync(taskFile, JSON.stringify({ task: "not-authorized" }));
    const c = await request(); assert.equal(c.status, 403); await c.text();
    assert.equal(hits, 2, "Rejected calls must not be retried or reach upstream");
    const logged = fs.readFileSync(relay.evidenceFile, "utf8");
    for (const sentinel of ["PRIVATE_SECRET", "PRIVATE_PROMPT", "PRIVATE_RESPONSE", "PRIVATE_ERROR"])
      assert(!logged.includes(sentinel), `Sensitive sentinel persisted: ${sentinel}`);
    const audit = JSON.parse(logged); assert.equal(audit.attempts.length, 2);
    assert.equal(audit.attempts[0].usage.total_tokens, 10); assert.equal(audit.attempts[1].status, "UPSTREAM_REJECTED");
    assert(audit.attempts.every(r => r.requestSha256 === r.forwardedRequestSha256
      && r.responseSha256 === r.forwardedResponseSha256));
    console.log(JSON.stringify({ status: "PASS", checks: ["exact bytes", "provider usage", "429 no retry", "task guard",
      "credential/prompt/response/error exclusion"], paidCalls: 0, evidence: relay.evidenceFile }));
  } finally { await relay.stop(); await new Promise(r => upstream.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
