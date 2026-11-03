"use strict";
// QA only. Real Dev startup, isolated DB/WebView, exact process ownership.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const net = require("node:net"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../../editor/node_modules/playwright");
const { ownedProcessTree } = require("./owned-process-tree.cjs");
const { readInstalledViewport, captureInstalledWebview } = require("./current-native-capture.cjs");
const root = path.resolve(__dirname, "../..");
function ps(script) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);" + script],
  { encoding: "utf8", windowsHide: true, timeout: 20000, maxBuffer: 12 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr); return r.stdout.replace(/^\uFEFF/, "").trim();
}
const rows = () => JSON.parse(ps("ConvertTo-Json -Depth 4 -Compress -InputObject @(" +
  "Get-CimInstance Win32_Process|Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine," +
  "@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}})"));
const id = p => `${p.ProcessId}:${p.Created}`;
const listeners = ports => JSON.parse(ps("ConvertTo-Json -Compress -InputObject @(" +
  `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}` +
  "|Select-Object LocalPort,OwningProcess)"));
async function until(fn, label, timeout = 45000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = String(e); }
    await new Promise(r => setTimeout(r, 150));
  }
  throw Error(`Timeout ${label}: ${last || "not ready"}`);
}
async function freePort() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); }); });
}
function nativeSession({ out, input, report, save, profileRoot = out }) {
  let host, launch, browser, page, cdp;
  let expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
  const known = new Map((report.known || []).map(p => [id(p), p]));
  const remember = () => {
    const now = rows();
    if (host && launch) {
      const tree = ownedProcessTree(now, host.pid, launch.created);
      if (tree.length) launch.created = tree[0].Created;
      for (const p of tree) known.set(id(p), p);
    }
    report.known = [...known.values()]; save(); return now;
  };
  async function metrics(v) {
    expected = v;
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: v.width, height: v.height,
      deviceScaleFactor: v.dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: v.reduced ? "reduce" : "no-preference" });
    return readInstalledViewport(page, v);
  }
  return {
    get page() { return page; }, get cdp() { return cdp; }, get current() { return launch; },
    async start() {
      const ports = [await freePort(), await freePort(), 6767];
      assert.equal(listeners(ports).length, 0, "Do not reuse unknown services");
      assert(!rows().some(p => /^(AgentVN Dev|agentvn-editor)\.exe$/i.test(p.Name)), "Another Editor is active");
      const data = path.join(profileRoot, "data"), webview = path.join(profileRoot, "webview"), temp = path.join(out, "temporary");
      fs.mkdirSync(path.join(data, "backend"), { recursive: true }); fs.mkdirSync(temp, { recursive: true });
      const decision = path.join(data, "backend/database-migration-decision.json");
      if (!fs.existsSync(decision)) fs.writeFileSync(decision, JSON.stringify({ approved: false, sources: [] }), { flag: "wx" });
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/.test(k)) delete env[k];
      Object.assign(env, { AGENTVN_EDITOR_DATA_DIR: data, AGENTVN_BACKEND_PORT: String(ports[0]), AGENTVN_LEGACY_DATABASE_PATHS: "",
        VITE_BACKEND_URL: `http://127.0.0.1:${ports[0]}`, WEBVIEW2_USER_DATA_FOLDER: webview,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${ports[1]}`, TEMP: temp, TMP: temp,
        AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out });
      const log = fs.openSync(path.join(out, `host-${report.launches.length + 1}.log`), "wx");
      host = spawn(path.join(root, "AgentVN Dev.exe"), [], { cwd: out, env, windowsHide: true, stdio: ["ignore", log, log] });
      fs.closeSync(log);
      launch = { pid: host.pid, ports, data, webview, temp, at: new Date().toISOString(),
        environment: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out } };
      report.launches.push(launch); save(); remember();
      await until(() => { assert.equal(host.exitCode, null); remember(); return listeners(ports).length === 3; }, "owned services", 120000);
      launch.listeners = listeners(ports);
      const tree = ownedProcessTree(rows(), host.pid, launch.created);
      assert(launch.listeners.every(l => tree.some(p => p.ProcessId === l.OwningProcess)));
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${ports[1]}`);
      page = await until(() => browser.contexts().flatMap(c => c.pages())
        .find(p => p.url().startsWith("http://127.0.0.1:6767")), "native document");
      page.setDefaultTimeout(30000);
      page.on("pageerror", e => report.errors.push(String(e)));
      cdp = await page.context().newCDPSession(page);
      await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
      await page.locator(".project-home").waitFor();
      remember(); return page;
    },
    async api(route, body) {
      const r = await fetch(`http://127.0.0.1:${launch.ports[0]}${route}`, {
        ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000) });
      assert(r.ok, `${route} HTTP ${r.status}`); return r.json();
    },
    metrics,
    async shot(name) {
      const s = await captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), expected);
      report.screenshots.push(s); save(); return s;
    },
    async stop(reason) {
      if (!host) return;
      await browser?.close().catch(() => {}); browser = undefined;
      remember(); const killed = [];
      for (const p of [...known.values()].reverse()) {
        if (!rows().some(a => id(a) === id(p))) continue;
        ps(`$owned=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
          `if($owned -and $owned.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
        killed.push(id(p));
      }
      const now = rows(), cleanup = { reason, killed, normalExitClaimed: false, ports: launch.ports,
        survivors: [...known.values()].filter(p => now.some(a => id(a) === id(p))), listeners: listeners(launch.ports) };
      report.cleanups.push(cleanup); save();
      assert.equal(cleanup.survivors.length, 0); assert.equal(cleanup.listeners.length, 0); host = undefined;
    },
  };
}
module.exports = { nativeSession, until, rows, listeners, ps };
