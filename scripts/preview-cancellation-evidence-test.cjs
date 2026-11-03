#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("../editor/node_modules/playwright");
const { verifyDetachedPreviewCancellation } = require("./lib/preview-cancellation-evidence.cjs");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = process.env.AGENTVN_WORKSPACE_OUTPUT
  ? path.join(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), `preview-cancellation-${runId}`)
  : path.resolve(__dirname, "../output/playwright/preview-cancellation-evidence", runId);
const report = { runId, status: "RUNNING", cases: [] };
const hostHtml = "<!doctype html><title>Owned preview cancellation fixture</title>";
let browser, server, page;
let scenario;
const pending = new Set();

async function requestInFrame(origin, resource, detach) {
  const requestSeen = new Promise(resolve => { scenario.seen = resolve; });
  await page.goto(origin);
  await page.evaluate(resource => {
    const frame = document.createElement("iframe");
    frame.src = `/gamecli-preview/index.html?resource=${encodeURIComponent(resource)}`;
    document.body.append(frame);
  }, resource);
  await requestSeen;
  const failed = page.waitForEvent("requestfailed", { predicate: request => new URL(request.url()).pathname === resource });
  if (detach) {
    await page.evaluate(() => document.querySelector("iframe").remove());
  } else {
    for (const response of pending) response.destroy();
  }
  const request = await failed;
  // The recheck is independent from the already cancelled browser request.
  scenario.hold = false;
  for (const response of pending) response.destroy();
  pending.clear();
  assert(detach ? request.frame().isDetached() : !request.frame().isDetached());
  return request;
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/gamecli-preview/index.html") {
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><script>fetch(${JSON.stringify(url.searchParams.get("resource"))}).catch(() => {});</script>`);
    } else if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(hostHtml);
    } else if (scenario?.resource === url.pathname && scenario.hold) {
      pending.add(response);
      response.on("close", () => pending.delete(response));
      scenario.seen?.();
    } else {
      response.statusCode = scenario?.status ?? 200;
      response.setHeader("Content-Type", scenario?.mime ?? "text/html");
      response.end(scenario?.body ?? hostHtml);
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  page = await browser.newPage();

  for (const resource of ["/release-package.json", "/runtime-mode.json", "/fixed-only.json"]) {
    scenario = { resource, hold: true };
    const request = await requestInFrame(origin, resource, true);
    const result = await verifyDetachedPreviewCancellation(request, page, origin);
    assert(result, `Verified detached optional probe must retain lifecycle evidence: ${resource}`);
    assert.equal(result.originalError, "net::ERR_ABORTED");
    assert.equal(result.validation, "optional-probe-spa-fallback");
    assert.equal(result.bytes, Buffer.byteLength(hostHtml));
    report.cases.push({ name: `detached-spa-fallback:${resource}`, status: "PASS", evidence: result });
  }
  scenario = { resource: "/release-package.json", hold: true,
    mime: "application/json", body: '{"presentationMode":"development"}' };
  const json = await requestInFrame(origin, scenario.resource, true);
  assert.equal((await verifyDetachedPreviewCancellation(json, page, origin)).validation, "optional-probe-json");
  report.cases.push({ name: "detached-valid-json-retains-evidence", status: "PASS" });

  scenario = { resource: "/release-package.json", hold: true, status: 404, body: "Not found" };
  const missing = await requestInFrame(origin, scenario.resource, true);
  assert.equal((await verifyDetachedPreviewCancellation(missing, page, origin)).validation, "optional-probe-absent");
  report.cases.push({ name: "detached-optional-404-retains-evidence", status: "PASS" });

  for (const invalid of [
    { status: 500, body: "Internal error" },
    { mime: "application/json", body: "{broken-json" },
    { mime: "application/json", body: '{"presentationMode":"unknown"}' },
    { mime: "text/html", body: "<!doctype html><title>Different error document</title>" },
  ]) {
    scenario = { resource: "/release-package.json", hold: true, ...invalid };
    const request = await requestInFrame(origin, scenario.resource, true);
    await assert.rejects(verifyDetachedPreviewCancellation(request, page, origin));
    report.cases.push({ name: `bad-recheck-is-failure:${JSON.stringify(invalid)}`, status: "PASS" });
  }
  for (const resource of ["/unrelated.json", "/gamecli-preview/missing.json"]) {
    scenario = { resource, hold: true };
    const request = await requestInFrame(origin, resource, true);
    assert.equal(await verifyDetachedPreviewCancellation(request, page, origin), undefined);
    report.cases.push({ name: `unapproved-request-remains-failure:${resource}`, status: "PASS" });
  }
  scenario = { resource: "/release-package.json", hold: true };
  // A request aborted in a still-mounted preview is not a lifecycle cancellation.
  await page.route("**/release-package.json", route => route.abort("aborted"));
  const liveFailed = page.waitForEvent("requestfailed", { predicate: request =>
    new URL(request.url()).pathname === "/release-package.json" });
  await page.goto(origin);
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.src = "/gamecli-preview/index.html?resource=%2Frelease-package.json";
    document.body.append(frame);
  });
  const live = await liveFailed;
  assert.equal(live.failure()?.errorText, "net::ERR_ABORTED");
  assert.equal(live.frame().isDetached(), false);
  assert.equal(await verifyDetachedPreviewCancellation(live, page, origin), undefined);
  report.cases.push({ name: "live-frame-abort-remains-failure", status: "PASS" });
  // Exercise the real caller order: requestfailed reaches the listener while
  // the frame is still attached, then the matching detach event follows.
  await page.unroute("**/release-package.json");
  await page.goto(origin);
  scenario = { resource: "/release-package.json", hold: true };
  const seen = new Promise(resolve => { scenario.seen = resolve; });
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.src = "/gamecli-preview/index.html?resource=%2Frelease-package.json";
    document.body.append(frame);
  });
  await seen;
  const cancel = page.waitForEvent("requestfailed", { predicate: request =>
    new URL(request.url()).pathname === "/release-package.json" });
  await page.evaluate(() => {
    document.querySelector("iframe").contentWindow.stop();
  });
  const early = await cancel;
  assert.equal(early.frame().isDetached(), false);
  const verified = verifyDetachedPreviewCancellation(early, page, origin);
  await page.evaluate(() => document.querySelector("iframe").remove());
  scenario.hold = false;
  for (const response of pending) response.destroy();
  pending.clear();
  const evidence = await verified;
  assert.equal(evidence?.frameDetached, true);
  report.cases.push({ name: "early-requestfailed-awaits-matching-detach-event", status: "PASS", evidence });
  assert(report.cases.length >= 12, "Cancellation regression cannot pass with no behaviors");
  report.status = "PASS";
}

main().catch(error => {
  report.status = "FAILED";
  report.error = String(error.stack || error);
  console.error(report.error);
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  for (const response of pending) response.destroy();
  server?.closeAllConnections();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`preview-cancellation-evidence-test: ${report.status} (${path.join(output, "report.json")})`);
});
