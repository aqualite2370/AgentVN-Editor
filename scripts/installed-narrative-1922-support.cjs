"use strict";
// Raw outputs of QA-only checks, kept apart from product business conclusions.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const attempt = process.argv[2], exported = process.argv[3];
assert.match(attempt, /^\d{2}$/); assert.match(exported, /^\d{2}$/);
const out = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/narrative-1922-support-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const syntaxFiles = ["installed-narrative-1922.cjs", "installed-narrative-1922-export.cjs",
  "installed-narrative-1922-playwright.cjs", "installed-narrative-1922-audit.cjs",
  "lib/installed-narrative-player.cjs", "lib/installed-narrative-1922-policy.cjs", "lib/installed-narrative-1922-fixture.cjs"];
const commands = [
  ...syntaxFiles.map(f => ["--check", `scripts/${f}`]),
  ["scripts/installed-narrative-1922-fixture-test.cjs"],
  ["scripts/installed-narrative-1922-policy-test.cjs", exported],
  ["scripts/voice-runtime-observer-test.cjs"],
];
const report = { status: "RUNNING", startedAt: new Date().toISOString(), commands: [],
  scope: "QA_SYNTAX_INPUT_SOURCE_AND_OBSERVATION_GUARDS_NOT_PRODUCT_ACCEPTANCE",
  productStarts: 0, modelRequests: 0, productChanges: 0 };
for (const [i, args] of commands.entries()) {
  const result = spawnSync(process.execPath, args, { cwd: path.resolve(__dirname, ".."),
    encoding: "utf8", windowsHide: true, timeout: 30000 });
  const log = path.join(out, `${String(i + 1).padStart(2, "0")}.log`);
  fs.writeFileSync(log, (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
  report.commands.push({ command: [process.execPath, ...args], exitCode: result.status,
    error: result.error ? String(result.error) : null, status: result.status === 0 ? "PASS" : "FAILED",
    log, sha256: sha(log) });
}
report.status = report.commands.every(c => c.status === "PASS") ? "PASS" : "FAILED";
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, commands: commands.length, out }));
if (report.status !== "PASS") process.exitCode = 1;
