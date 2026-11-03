#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputPath = path.resolve(process.argv[2] || path.join(root, "output", "hidden-growth", "online-provider-spot-check.json"));
const baseUrl = process.env.AGENTVN_ONLINE_PROVIDER_URL || process.env.AGENTVN_PROVIDER_BASE_URL;
const apiKey = process.env.AGENTVN_ONLINE_PROVIDER_KEY || process.env.AGENTVN_PROVIDER_API_KEY;
const modelId = process.env.AGENTVN_ONLINE_PROVIDER_MODEL || "gpt-4o-mini";

function redact(value) {
  return String(value ?? "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "***")
    .replace(/(bearer|authorization|api[_-]?key|token|secret|password)[=: ]+[^\s,;]+/gi, "$1=***");
}

async function postJson(url, body, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 2000) }; }
    return { status: response.status, ok: response.ok, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  const startedAt = Date.now();
  let report;
  if (!baseUrl || !apiKey) {
    report = {
      status: "NOT_CONFIGURED",
      mode: "online-provider-spot-check",
      reason: "AGENTVN_ONLINE_PROVIDER_URL/KEY not configured; deterministic tests remain the blocking gate.",
      elapsed_ms: Date.now() - startedAt,
    };
  } else {
    const connection = await postJson(`${baseUrl.replace(/\/$/, "")}/api/providers/test_connection`, {
      base_url: baseUrl,
      api_key: apiKey,
    });
    const generation = await postJson(`${baseUrl.replace(/\/$/, "")}/api/providers/test_generation`, {
      provider_selection: {
        connection_id: "hidden-growth-online",
        model_id: modelId,
        base_url: baseUrl,
        api_key: apiKey,
        parameters: {
          structured_mode: "json_object",
          max_tokens: 256,
          request_timeout_seconds: 30,
          system_prompt: "Return a minimal JSON scene object for a smoke test.",
        },
      },
    });
    report = {
      status: connection.ok && generation.ok ? "ONLINE_PASS" : "ONLINE_FAIL",
      mode: "online-provider-spot-check",
      model: modelId,
      elapsed_ms: Date.now() - startedAt,
      connection: { status: connection.status, ok: connection.ok, body: redact(JSON.stringify(connection.body)) },
      generation: { status: generation.status, ok: generation.ok, body: redact(JSON.stringify(generation.body)) },
    };
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`hidden-growth-online-provider-spot-check: ${report.status} (${outputPath})`);
  if (report.status === "ONLINE_FAIL") process.exitCode = 0;
})().catch((error) => {
  const report = {
    status: "ONLINE_FAIL",
    mode: "online-provider-spot-check",
    elapsed_ms: 0,
    error: redact(error?.stack || error),
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(`hidden-growth-online-provider-spot-check: ONLINE_FAIL (${outputPath})`);
  process.exitCode = 0;
});

