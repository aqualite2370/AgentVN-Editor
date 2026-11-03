"use strict";
// QA runner for the actual 0.1.2/1002 APK. Keep the historical runner intact.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), Module = require("node:module"), vm = require("node:vm");
const original = path.join(__dirname, "android-native-upgrade-device.cjs");
assert.equal(crypto.createHash("sha256").update(fs.readFileSync(original)).digest("hex"),
  "d62dcab26fae9c13a8bee4134fb51df5d0365bb6f96ec1433a9f39d7d3b1a953");
function adapt(input) {
  let source = input;
  for (const [before, after, count] of [
    ['"0.1.1"', '"0.1.2"', 1],
    ["1001", "1002", 2],
    [String.raw`0\.1\.1`, String.raw`0\.1\.2`, 1],
    ["if (require.main === module)", "if (module.qaRun)", 1],
    ['    await idle();\n    const hit = await wait(',
      '    await idle();' +
      '\n    await client.evaluate(' + JSON.stringify(`(() => {
        if (window.__avnUpgradeInputLog) return;
        window.__avnUpgradeInputLog = [];
        for (const type of ["pointerdown", "pointerup", "click"]) {
          document.addEventListener(type, event => {
            const e = event.target, b = e?.closest?.("button");
            window.__avnUpgradeInputLog.push({ type, trusted: event.isTrusted, at: performance.now(),
              x: event.clientX, y: event.clientY, tag: e?.tagName, className: e?.className,
              button: b?.getAttribute("aria-label") || b?.textContent,
              slot: b?.closest("[data-testid]")?.getAttribute("data-testid"), disabled: b?.disabled,
              inert: Boolean(b?.closest("[inert]")),
              mode: document.querySelector(".save-mode-switch [aria-pressed=true]")?.textContent,
              transition: document.querySelector("[data-runtime-screen-transition]")?.dataset.runtimeScreenTransition });
            if (window.__avnUpgradeInputLog.length > 120) window.__avnUpgradeInputLog.shift();
          }, true);
        }
        return true;
      })()`) + ');\n    const hit = await wait(', 1],
    ['    // Observe actual render turns, not a fixed delay that may inspect the old idle page.',
      '    r.inputObservations ??= [];\n' +
      '    r.inputObservations.push({label, at:new Date().toISOString(), events:await client.evaluate("window.__avnUpgradeInputLog")});\n' +
      '    // Observe actual render turns, not a fixed delay that may inspect the old idle page.', 1],
    ['viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}})`);',
      'viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}, inputs:window.__avnUpgradeInputLog,\n' +
      '          slots:[...document.querySelectorAll(".save-card-main")].map(e=>({label:e.getAttribute("aria-label"),disabled:e.disabled,\n' +
      '            rect:e.getBoundingClientRect().toJSON(),inert:Boolean(e.closest("[inert]"))}))})`);', 1],
  ]) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.split(before).join(after);
  }
  new vm.Script(Module.wrap(source), { filename: __filename });
  return source;
}
const input = fs.readFileSync(original, "utf8"), source = adapt(input);
const worker = new Module(__filename, module);
worker.filename = __filename; worker.paths = module.paths;
worker.qaRun = require.main === module && process.argv[2] !== "--self-test";
worker._compile(source, __filename);
module.exports = worker.exports;
if (require.main === module && process.argv[2] === "--self-test") {
  for (const before of ['"0.1.1"', "1001", String.raw`0\.1\.1`, "if (require.main === module)",
    '    await idle();\n    const hit = await wait(', 'viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}})`);'])
    assert.throws(() => adapt(input.replace(before, "SOURCE_DRIFT")));
  const { assertPreservedUpgradeData, runningPackagePid } = worker.exports;
  for (const command of [["uninstall", "com.agentvn.qa.androidcurrent20261021"],
    ["shell", "pm", "clear", "com.agentvn.qa.androidcurrent20261021"]]) {
    assert.throws(() => assertPreservedUpgradeData(command, true, false));
    assert.doesNotThrow(() => assertPreservedUpgradeData(command, true, true));
  }
  assert.doesNotThrow(() => assertPreservedUpgradeData(["install", "-r", "current-staging.apk"], true, false));
  assert.equal(runningPackagePid({ status: 1, stdout: "", stderr: "" }), null);
  assert.throws(() => runningPackagePid({ status: 1, stdout: "", stderr: "device offline" }));
  console.log(JSON.stringify({ status: "PASS", sourceDriftRejected: 6, trustedInputObservation: true,
    preservationGate: "PASS", currentVersion: "0.1.2", versionCode: 1002,
    deviceOperations: 0, productLaunches: 0 }));
}
