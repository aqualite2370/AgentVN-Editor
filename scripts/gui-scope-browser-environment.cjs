"use strict";
// Preload for a controlled headful/headless comparison. It records environment
// and child ownership only; it does not alter launch arguments, DOM or assertions.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
// fork() inherits execArgv/--require. Only the actual suite, never its Vite
// worker, may own this receipt.
if (["renpy-gui-reimport-playwright.cjs", "editor-gui-import-dialog-playwright.cjs"]
  .includes(path.basename(process.argv[1] ?? ""))) {
const { chromium } = require("../editor/node_modules/playwright");
const output = process.env.AGENTVN_WORKSPACE_OUTPUT;
if (!output) throw Error("Explicit output required");
const file = path.join(output, "browser-environment.json");
if (fs.existsSync(file)) throw Error(`Preserve ${file}`);
const report = { startedAt: new Date().toISOString(), processes: [], browsers: [] };
const spawn = cp.spawn;
cp.spawn = function (...args) {
  const child = spawn.apply(this, args);
  if (Array.isArray(args[1]) && args[1].includes("backend_launcher.py")) {
    const options = args[2] ?? {}, item = { pid: child.pid, exe: args[0], cwd: options.cwd,
      dataDir: options.env?.AGENTVN_EDITOR_DATA_DIR, backendPort: options.env?.AGENTVN_BACKEND_PORT };
    report.processes.push(item);
    child.once("exit", (code, signal) => { item.exitCode = code; item.signal = signal; item.exitedAt = new Date().toISOString(); });
  }
  return child;
};
const launch = chromium.launch;
chromium.launch = async function (options) {
  const browser = await launch.call(this, options), session = await browser.newBrowserCDPSession();
  const info = await session.send("SystemInfo.getInfo");
  report.browsers.push({ headless: options?.headless !== false, version: browser.version(),
    gpu: { devices: info.gpu.devices, featureStatus: info.gpu.featureStatus,
      glRenderer: info.gpu.auxAttributes?.glRenderer, glVendor: info.gpu.auxAttributes?.glVendor } });
  await session.detach();
  return browser;
};
process.once("exit", () => {
  for (const item of report.processes) {
    try { process.kill(item.pid, 0); item.presentAtExit = true; }
    catch (error) { item.presentAtExit = error.code !== "ESRCH"; }
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
});
}
