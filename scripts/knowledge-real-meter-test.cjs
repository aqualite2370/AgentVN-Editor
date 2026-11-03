"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { createRealKnowledgeMeter, sanitizeUsage } = require("./lib/knowledge-real-meter.cjs");
const out = path.resolve(process.argv[2] || "");
assert(process.argv[2] && out.startsWith("F:\\AgentVN\\QA\\") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "LOCAL_HTTP_CONTROLLED_TRANSPORT_NO_REAL_MODEL", realModelRequests: 0,
  cases: [], upstreamRequests: [] };
const prompts = [0, 1, 2].map(i => [`topic-${i}`, `受控问询${i}`]);
const secret = "controlled-secret-DO-NOT-LOG";
let armed = 0, transportCalls = 0, failure = false, responseStatus = 200;
const meter = createRealKnowledgeMeter({ upstreamBase: "https://never-contact.invalid/v1",
  model: "controlled", prompts, report, armedQuestion: () => armed, changed() {},
  async forward(url, options) {
    transportCalls++;
    assert.equal(url.href, "https://never-contact.invalid/v1/chat/completions");
    assert.equal(options.headers.authorization, `Bearer ${secret}`); assert.equal(options.redirect, "error");
    assert.equal(JSON.parse(options.body).messages[0].content, prompts[armed][1]);
    if (failure) throw new Error(`transport message includes ${secret}`);
    return new Response(JSON.stringify({ choices: [{ message: { content: "受控响应" } }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, private_field: secret } }),
    { status: responseStatus, headers: { "content-type": "application/json" } });
  } });
const post = (base, payload = {}, route = "/v1/chat/completions") => fetch(base + route, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
  body: JSON.stringify({ model: "controlled", messages: [{ role: "user", content: prompts[armed]?.[1] }], ...payload }) });
(async () => {
  await new Promise(resolve => meter.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${meter.address().port}`;
  assert.equal((await post(base, { model: "other" })).status, 502);
  assert.equal((await post(base, {}, "/v1/other")).status, 502);
  assert.equal(transportCalls, 0);
  report.cases.push({ name: "wrong-model-and-route-blocked-before-forward", status: "PASS" });
  const [a, b] = await Promise.all([post(base), post(base)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 502]); assert.equal(transportCalls, 1);
  assert.deepEqual(report.upstreamRequests[0].usage, { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
  report.cases.push({ name: "concurrent-duplicate-reserved-once-real-usage-filtered", status: "PASS" });
  armed = 1; failure = true;
  assert.equal((await post(base)).status, 502); failure = false;
  assert.equal(report.upstreamRequests[1].status, "FAILED");
  assert.equal((await post(base)).status, 502); assert.equal(transportCalls, 2);
  report.cases.push({ name: "failed-forward-cannot-be-paid-retried", status: "PASS" });
  armed = 2; responseStatus = 429;
  assert.equal((await post(base)).status, 429);
  assert.equal(report.upstreamRequests[2].status, "FAILED");
  assert.equal((await post(base)).status, 502);
  armed = 3; assert.equal((await post(base)).status, 502);
  assert.equal(transportCalls, 3); assert.equal(report.upstreamRequests.length, 3);
  report.cases.push({ name: "provider-error-preserved-and-fourth-request-denied", status: "PASS" });
  assert.equal(sanitizeUsage({ total_tokens: -1, input_tokens: "5", nested: secret }), null);
  assert(!JSON.stringify(report).includes(secret));
  report.cases.push({ name: "no-secret-or-arbitrary-usage-object-in-evidence", status: "PASS" });
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(async () => {
    meter.closeAllConnections(); await new Promise(resolve => meter.close(resolve));
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, realModelRequests: 0, out }));
  });
