const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const root = path.resolve(__dirname, "..");
const version = JSON.parse(fs.readFileSync(path.join(root, "editor/src-tauri/tauri.conf.json"), "utf8")).version;
const out = path.join(root, "output/playwright/project-home-version", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const report = { version, ok: false, cases: [], errors: [], consoleErrors: [] };
let server, browser;
(async () => {
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "6789", "--strictPort"],
    { cwd: path.join(root, "editor"), windowsHide: true, stdio: "pipe" });
  let serverLog = "";
  for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { serverLog += data; });
  const deadline = Date.now() + 30_000;
  while (true) {
    assert(server.exitCode === null, `Vite exited: ${serverLog}`);
    try { if ((await fetch("http://127.0.0.1:6789/")).ok) break; } catch {}
    assert(Date.now() < deadline, `Vite not ready: ${serverLog}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", error => report.errors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
  // Mount the real homepage component without a backend or a user's database.
  await page.route("**/__version_test.html", route => route.fulfill({
    contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
    window.__vite_plugin_react_preamble_installed__=true;
    const {default: React} = await import('/node_modules/.vite/deps/react.js');
    const {default: ReactDOM} = await import('/node_modules/.vite/deps/react-dom_client.js');
    await import('/src/app/App.css');
    const {ProjectHome} = await import('/src/components/project/ProjectHome.tsx');
    const noop=()=>{};
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(ProjectHome,{
      recentProjects:[],onCreateProject:noop,onOpenDraft:noop,onOpenProject:noop,
      onDeleteProject:noop,onImportProject:noop
    }));
    </script></body></html>`
  }));
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 757, height: 299 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("http://127.0.0.1:6789/__version_test.html");
    const button = page.locator(".home-action-qq");
    await button.waitFor();
    assert.equal(await button.locator("small").innerText(), `当前版本[${version}]`, "homepage must show current Tauri build version");
    assert((await button.getAttribute("aria-label")).includes(`当前版本 ${version}`));
    await button.scrollIntoViewIfNeeded();
    const geometry = await button.evaluate(el => {
      const r = el.getBoundingClientRect(), t = el.querySelector("small").getBoundingClientRect();
      return { visible: t.left >= r.left && t.right <= r.right && t.top >= r.top && t.bottom <= r.bottom,
        clickable: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
        overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert(geometry.visible && geometry.clickable && geometry.overflow <= 1, JSON.stringify(geometry));
    await button.click();
    assert.equal(await button.getAttribute("aria-expanded"), "true");
    await page.screenshot({ path: path.join(out, `${viewport.width}x${viewport.height}.png`) });
    report.cases.push({ viewport, geometry });
  }
  assert.deepEqual(report.errors, [], "homepage raised a runtime exception");
  report.ok = true;
})().catch(error => {
  report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server?.pid) spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true });
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, out }));
});
