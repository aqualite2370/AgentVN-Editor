"use strict";
const assert = require("node:assert/strict"), http = require("node:http");

/** Transparent, bounded meter. Production callers use fetch; tests inject only
 * a controlled transport, without contacting any configured model. */
function createRealKnowledgeMeter({ upstreamBase, model, prompts, report, armedQuestion, changed,
  forward = fetch }) {
  const upstream = new URL(upstreamBase);
  assert.equal(upstream.protocol, "https:");
  const expectedPath = `${upstream.pathname.replace(/\/$/, "")}/chat/completions`;
  return http.createServer(async (request, response) => {
    let row;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        assert(size <= 2 * 1024 * 1024, "Meter request exceeds the test conversation limit");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks), body = JSON.parse(bytes), index = armedQuestion();
      assert.equal(request.method, "POST");
      assert.equal(request.url, expectedPath);
      assert.equal(body.model, model);
      assert(Number.isInteger(index) && index >= 0 && index < Math.min(3, prompts.length));
      assert(report.upstreamRequests.length < 3, "At most three authorized upstream requests");
      assert(!report.upstreamRequests.some(r => r.questionIndex === index), "No automatic paid retries");
      assert(JSON.stringify(body.messages).includes(prompts[index][1]));
      assert(request.headers.authorization, "Provider authorization required");
      row = { questionIndex: index, startedAt: new Date().toISOString(),
        requestBytes: bytes.length, status: "RUNNING" };
      // Reserve the question before yielding to the transport: concurrent
      // duplicates cannot both reach the provider.
      report.upstreamRequests.push(row); changed();
      const result = await forward(new URL(request.url, upstream.origin), { method: "POST", headers: {
        "content-type": "application/json", authorization: request.headers.authorization,
      }, body: bytes, signal: AbortSignal.timeout(180000), redirect: "error" });
      const resultBytes = Buffer.from(await result.arrayBuffer());
      let payload; try { payload = JSON.parse(resultBytes); } catch {}
      row.httpStatus = result.status;
      row.usage = sanitizeUsage(payload?.usage);
      row.usageStatus = row.usage ? "PROVIDER_REPORTED" : "NOT_RETURNED_BY_PROVIDER";
      row.responseBytes = resultBytes.length; row.status = result.ok ? "PASS" : "FAILED";
      row.finishedAt = new Date().toISOString(); changed();
      response.writeHead(result.status, { "content-type": result.headers.get("content-type") || "application/json" });
      response.end(resultBytes);
    } catch (error) {
      // Error messages can contain remote URLs or credentials. Keep only a
      // fixed diagnostic category, never the request or transport exception.
      if (row) { row.status = "FAILED"; row.finishedAt = new Date().toISOString(); }
      report.meterError = error.name || "Error"; changed();
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Real-session meter refused or failed; no retry permitted" } }));
    }
  });
}

function sanitizeUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  // A provider's arbitrary response object is not a safe log schema.
  const keys = ["prompt_tokens", "completion_tokens", "total_tokens", "prompt_cache_hit_tokens",
    "prompt_cache_miss_tokens", "input_tokens", "output_tokens"];
  const result = Object.fromEntries(keys.filter(key => Number.isSafeInteger(value[key]) && value[key] >= 0)
    .map(key => [key, value[key]]));
  return Object.keys(result).length ? result : null;
}
module.exports = { createRealKnowledgeMeter, sanitizeUsage };
