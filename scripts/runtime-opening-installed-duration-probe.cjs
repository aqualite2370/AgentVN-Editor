"use strict";
// Read-only observation of an already-running owned installed Player.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const root = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/opening-installed-1923-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = `F:/AgentVN/QA/Editor-Repair-Release-20261024-01/opening-duration-probe-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", at: new Date().toISOString(),
  scope: "READ_ONLY_LIVE_INSTALLED_OPENING_TIMING_NO_PRODUCT_CHANGE" };
let browser;
(async () => {
  const launch = await until(() => {
    let source; try { source = JSON.parse(fs.readFileSync(path.join(root, "report.json"), "utf8")); }
    catch { return false; }
    assert.equal(source.status, "RUNNING");
    const current = source.launches.at(-1);
    if (!current?.identity || current.cleanup ||
      Date.now() - Date.parse(current.identity.Created) > 5000) return false;
    return listeners([current.port]).length === 1 && current.knownProcesses.length > 1 ? current : false;
  }, "newly launched owned Player, avoiding prior closing process", 30000);
  const live = rows();
  assert(live.some(p => p.ProcessId === launch.identity.ProcessId && p.Created === launch.identity.Created));
  const sockets = listeners([launch.port]); assert.equal(sockets.length, 1);
  assert(launch.knownProcesses.some(p => p.ProcessId === sockets[0].OwningProcess));
  report.launch = launch;
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.port}`);
  const page = browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost/.test(p.url())); assert(page);
  report.observation = await page.evaluate(() => new Promise(resolve => {
    const started = performance.now();
    function read() {
      const root = document.querySelector(".runtime-opening-screen");
      const media = document.querySelector(".runtime-opening-media");
      if (root && media) {
        const styles = getComputedStyle(root);
        resolve({ at: performance.now(), visibility: document.visibilityState,
          token: styles.getPropertyValue("--opening-fade-duration").trim(),
          reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
          animations: [root, media].flatMap(n => n.getAnimations().map(a => ({
            target: n.className, playState: a.playState, currentTime: a.currentTime,
            timing: a.effect.getTiming(), computed: a.effect.getComputedTiming(),
          }))) });
      } else if (performance.now() - started > 4000) resolve({ unavailable: true });
      else requestAnimationFrame(read);
    }
    read();
  }));
  assert(!report.observation.unavailable, "No opening visible; no timing conclusion");
  report.status = "OBSERVED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out, observation: report.observation, error: report.error }));
});
