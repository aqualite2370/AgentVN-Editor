"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const source = fs.readFileSync(`${__dirname}/android-apk-runtime-qa.cjs`, "utf8");
async function scenario(outcomes) {
  const calls = [];
  let attempt = -1;
  const context = vm.createContext({
    require: createRequire(__filename), __dirname, process, console, Buffer,
    setTimeout, clearTimeout, AbortSignal,
    command(args) {
      calls.push(args);
      if (args.includes("dump")) return outcomes[++attempt];
      if (args.includes("test")) return { status: outcomes[attempt]?.file ? 0 : 1, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  vm.runInContext(source.slice(0, source.indexOf("\nmain().catch(")) + `
    waitFor = async () => true;
    delay = async () => {};
    dom = async () => ({ screen: 'title' });
    captureScreenshot = () => 'title.png';
    runQuiet = command;
    run = args => {
      const result = command(args);
      if (result.status !== 0 || result.error) throw Error(result.stderr || 'ADB_COMMAND_FAILED');
      return result.stdout;
    };
    globalThis.capture = () => captureState({}, 'trial');
    globalThis.reportResult = report;
  `, context);
  let error;
  try { await context.capture(); } catch (caught) { error = caught; }
  return { calls, error, report: context.reportResult };
}
(async () => {
  const recovered = await scenario([
    { status: 1, stdout: "UI hierarchy dumped", stderr: "transport interrupted", file: true },
    { status: 0, stdout: "dumped", stderr: "", file: true },
  ]);
  assert.ifError(recovered.error);
  assert.equal(recovered.calls.filter(args => args.includes("dump")).length, 2, "nonzero export must retry, not escape the retry loop");
  assert.equal(recovered.calls.filter(args => args.includes("pull")).length, 1);
  const missing = await scenario([
    { status: 0, file: false }, { status: 0, file: true },
  ]);
  assert.ifError(missing.error);
  assert.equal(missing.calls.filter(args => args.includes("dump")).length, 2);
  const exhausted = await scenario(Array.from({ length: 4 }, () => ({
    status: 1, stderr: "device offline", file: false,
  })));
  assert.match(exhausted.error?.message || "", /UIAUTOMATOR_CAPTURE_UNAVAILABLE.*device offline/);
  assert.equal(exhausted.calls.filter(args => args.includes("pull")).length, 0);
  assert.equal(exhausted.report.uiAutomatorRetries.length, 4);
  // A leftover XML must be removed before every attempt, never mistaken for fresh evidence.
  for (const result of [recovered, missing, exhausted]) {
    result.calls.forEach((args, index) => {
      if (args.includes("dump")) assert.ok(result.calls[index - 1].includes("rm"));
    });
  }
  console.log("android-uiautomator-capture: PASS (nonzero exit, missing XML, stale XML, exhausted retries preserve cause)");
})().catch(error => { console.error(error); process.exitCode = 1; });
