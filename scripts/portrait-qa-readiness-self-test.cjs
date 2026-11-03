"use strict";
// Tool self-check only: no product data, service, sleeps, or model calls.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const qa = "F:/AgentVN/QA/Dialog-Portrait-Authoring-20261020-01";
const out = path.join(qa, "readiness-self-test-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", scope: "PLAYWRIGHT_PREDICATE_SELF_TEST_NOT_PRODUCT", checks: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage(); await page.setContent("<main>QA readiness self-test</main>");
    const handle = await page.waitForFunction(async () => false, null, { timeout: 1000 });
    const actual = await handle.jsonValue(); assert.equal(actual, false);
    report.checks.push({ name: "Async predicate resolves false without polling (reproduces invalid wait)", actual, status: "PASS" });
    await page.evaluate(() => { window.__qaPolls = 0; });
    await page.waitForFunction(() => ++window.__qaPolls >= 4);
    const count = await page.evaluate(() => window.__qaPolls); assert.equal(count, 4);
    report.checks.push({ name: "Synchronous predicate actually polls until fourth evaluation", count, status: "PASS" });
    fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"));
    report.status = "PASS";
  } finally { await browser.close(); }
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out, error: report.error })); });
