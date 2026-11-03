"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { createHash } = require("node:crypto");
const { startPresentedFrames, colorOpacity } = require("./lib/opening-presented-frames.cjs");
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const out = path.join("F:/AgentVN/QA/Runtime-Opening-Time-20261024-01", `presented-selftest-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", cases: [], scope: "OBSERVER_SELFTEST_CONTROLLED_NOT_PRODUCT_ACCEPTANCE" };
report.sources = [__filename, path.join(__dirname, "lib/opening-presented-frames.cjs")].map(file => ({
  path: file, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
}));
for (const file of report.sources) fs.copyFileSync(file.path, path.join(out, path.basename(file.path)), fs.constants.COPYFILE_EXCL);
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let browser;
(async () => {
  for (const d3d11 of [false, true]) {
    browser = await chromium.launch(d3d11 ? { args: ["--use-angle=d3d11", "--enable-gpu"] } : {});
    const diagnostic = await browser.newBrowserCDPSession();
    const { gpu } = await diagnostic.send("SystemInfo.getInfo");
    const renderer = { d3d11, features: gpu.featureStatus, devices: gpu.devices,
      renderer: gpu.auxAttributes.glRenderer };
    await diagnostic.detach();
    if (d3d11) assert.equal(renderer.features.gpu_compositing, "enabled");
    for (const duration of [180, .18]) {
    const row = { duration, renderer, status: "RUNNING" }; report.cases.push(row); save();
    const context = await browser.newContext({ viewport: { width: 3840, height: 2160 },
      reducedMotion: "reduce" });
    const page = await context.newPage();
    let capture;
    try {
      await page.setContent('<style>body{margin:0;background:black}#media{position:fixed;inset:0;background:rgb(36,87,121);opacity:0}</style><div id="media"></div>');
      capture = await startPresentedFrames(page, path.join(out, `${d3d11 ? "hardware" : "default"}-duration-${duration}`));
      await page.evaluate(duration => {
        window.__frames = [];
        const tick = () => {
          window.__frames.push({ at: performance.now(), opacity: Number(getComputedStyle(document.querySelector("#media")).opacity) });
          if (!window.__done) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        const animation = document.querySelector("#media").animate([{ opacity: 0 }, { opacity: 1 }],
          { duration, easing: "cubic-bezier(0.23,1,0.32,1)", fill: "both" });
        window.__animation = animation;
        void animation.finished.then(() => { window.__done = true; });
      }, duration);
      await page.waitForFunction(() => window.__done === true);
      await capture.waitForFrameCount(2);
      row.raf = await page.evaluate(() => window.__frames);
      row.capture = await capture.stop();
      const pixels = row.capture.frames.map(frame => ({ at: frame.at, ...colorOpacity(frame.rgb, [[36, 87, 121]]) }));
      row.intermediate = pixels.filter(f => f.alpha > .02 && f.alpha < .98 && f.error < 2.5);
      row.acceptedContinuous = row.intermediate.length >= 2;
      assert.equal(row.acceptedContinuous, duration === 180,
        "Observer must accept real fade and reject the actual release-unit hard-cut duration");
      assert(row.capture.frames.length >= 2);
      assert.equal(row.capture.before.reduced, true); assert.equal(row.capture.after.reduced, true);
      assert.deepEqual(row.capture.errors, []);
      row.status = "PASS";
    } catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); }
    finally {
      if (capture) await capture.stop().catch(error => { row.cleanupError = String(error); });
      await context.close(); row.contextClosed = true; save();
    }
  }
    await browser.close(); browser = undefined;
  }
  assert.equal(report.cases.length, 4); assert(report.cases.every(c => c.status === "PASS"));
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); report.browserClosed = true; report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.map(c => ({
    duration: c.duration, status: c.status, intermediate: c.intermediate?.length, error: c.error,
  })) }));
});
