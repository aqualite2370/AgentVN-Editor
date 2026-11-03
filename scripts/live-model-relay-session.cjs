"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { startAuditedLiveModelRelay } = require("./lib/audited-live-model-relay.cjs");
(async () => {
  const out = process.argv[2], taskFile = process.argv[3];
  assert(out && taskFile && !fs.existsSync(out)); fs.mkdirSync(out);
  const relay = await startAuditedLiveModelRelay({ upstream: "https://api.deepseek.com", out, taskFile });
  fs.writeFileSync(path.join(out, "ready.json"), JSON.stringify({ pid: process.pid,
    baseUrl: relay.baseUrl, originalBaseUrl: "https://api.deepseek.com", at: new Date().toISOString() }), { flag: "wx" });
  console.log(JSON.stringify({ status: "READY_NO_PAID_CALL", pid: process.pid, baseUrl: relay.baseUrl }));
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async data => { if (data.trim() === "stop") { await relay.stop(); process.exit(0); } });
  process.on("SIGINT", async () => { await relay.stop(); process.exit(0); });
})().catch(e => { console.error(e); process.exitCode = 1; });
