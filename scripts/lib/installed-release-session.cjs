"use strict";
// Explicit sealed install receipt. No fallback to workspace binaries or services.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const { chromium } = require("../../editor/node_modules/playwright");
const { rows, listeners, ps, until } = require("./current-native-editor-session.cjs");
const { ownedProcessTree } = require("./owned-process-tree.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./current-native-capture.cjs");
const { controlledCreationGuard } = require("./installed-controlled-provider-guard.cjs");
const { stopOwnedProcess } = require("./owned-process-stop.cjs");
const { verifiedInstalledCandidate } = require("./verified-installed-candidate.cjs");
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const identity = p => `${p.ProcessId}:${p.Created}`;
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(e => e ? reject(e) : resolve(p)); });
});
function installedReleaseSession({ installationFile, out, report, save, input, previewPort, controlledCreation, beforeHostStart, preferredBackendPort }) {
  assert(previewPort === undefined || Number.isInteger(previewPort) && previewPort > 1024 && previewPort <= 65535);
  assert(preferredBackendPort === undefined || Number.isInteger(preferredBackendPort) && preferredBackendPort > 1024 && preferredBackendPort <= 65535);
  const installation = verifiedInstalledCandidate(installationFile);
  assert.equal(installation.status, "PASS");
  const exe = installation.executable.path;
  const boundary = path.resolve("F:/AgentVN/QA") + path.sep;
  assert(path.resolve(out).startsWith(boundary) && path.resolve(exe).startsWith(boundary));
  const known = new Map();
  const guard = controlledCreationGuard(controlledCreation);
  const modelPath = /\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/;
  let host, current, browser, page, cdp;
  let expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
  function allowModelWrite(request) {
    if (guard.allows(request, `http://127.0.0.1:${current.ports[0]}`)) {
      (report.controlledWrites ??= []).push({ at: new Date().toISOString(), method: request.method,
        path: new URL(request.url).pathname, projectId: request.body?.project_id,
        endpoint: controlledCreation.endpoint });
      save(); return true;
    }
    report.blockedModelRequests = (report.blockedModelRequests || 0) + 1;
    if (typeof report.modelRequests === "number") report.modelRequests++;
    save(); return false;
  }
  async function rawApi(route, body) {
    assert(route.startsWith("/api/") && !route.startsWith("//"));
    const url = `http://127.0.0.1:${current.ports[0]}${route}`;
    if (body !== undefined && modelPath.test(route))
      assert(allowModelWrite({ method: "POST", url, body }), "Unapproved model write blocked");
    const r = await fetch(url, { ...(body === undefined ? {} : {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), signal: AbortSignal.timeout(20000) });
    assert(r.ok, `${route} HTTP ${r.status}`); return r.json();
  }
  function verify() {
    assert.equal(sha(exe), installation.executable.sha256);
    for (const f of installation.resources) assert.equal(sha(f.path), f.sha256);
  }
  function remember() {
    if (host) {
      const tree = ownedProcessTree(rows(), host.pid, current.created);
      if (tree.length) current.created = tree[0].Created;
      for (const p of tree) known.set(identity(p), p);
    }
    report.knownProcesses = [...known.values()]; save();
  }
  return {
    installation, get cdp() { return cdp; }, get current() { return current; },
    async start() {
      assert(!host);
      assert(!rows().some(p => /^(AgentVN Dev|agentvn-editor|agentvn-player|creator-backend)\.exe$/i.test(p.Name)));
      verify();
      const ports = [preferredBackendPort ?? await freePort(), await freePort()];
      assert.notEqual(ports[0], ports[1]); assert.equal(listeners(ports).length, 0);
      if (beforeHostStart) await beforeHostStart({ backendPort: ports[0], cdpPort: ports[1] });
      if (previewPort !== undefined) {
        assert(!ports.includes(previewPort)); assert.equal(listeners([previewPort]).length, 0);
      }
      const data = path.join(out, "data"), webview = path.join(out, "webview"), temp = path.join(out, "temporary");
      fs.mkdirSync(path.join(data, "backend"), { recursive: true }); fs.mkdirSync(temp, { recursive: true });
      const decision = path.join(data, "backend/database-migration-decision.json");
      if (!fs.existsSync(decision)) fs.writeFileSync(decision, JSON.stringify({ approved: false, sources: [] }), { flag: "wx" });
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
      Object.assign(env, { AGENTVN_EDITOR_DATA_DIR: data, AGENTVN_BACKEND_PORT: String(ports[0]),
        AGENTVN_LEGACY_DATABASE_PATHS: "", WEBVIEW2_USER_DATA_FOLDER: webview, TEMP: temp, TMP: temp,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${ports[1]}`,
        AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out });
      if (previewPort !== undefined) env.AGENTVN_GAMECLI_PREVIEW_CDP_PORT = String(previewPort);
      const fd = fs.openSync(path.join(out, `host-${report.launches.length + 1}.log`), "wx");
      host = spawn(exe, [], { cwd: installation.installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd] }); fs.closeSync(fd);
      current = { pid: host.pid, ports, data, webview, at: new Date().toISOString(), executable: installation.executable,
        isolation: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out },
        dataDirectoryOverride: true, webviewDirectoryOverride: true, sourceServer: false, manualBackendSpawn: false };
      if (previewPort !== undefined) current.previewCdpPort = previewPort;
      report.launches.push(current); remember();
      await until(async () => {
        assert.equal(host.exitCode, null); remember();
        try { const r = await fetch(`http://127.0.0.1:${ports[0]}/api/health`, { signal: AbortSignal.timeout(1000) });
          return r.ok && (await r.json()).service === "agentvn-backend"; } catch { return false; }
      }, "installed host backend", 60000);
      await until(async () => {
        assert.equal(host.exitCode, null);
        try { return (await fetch(`http://127.0.0.1:${ports[1]}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
        catch { return false; }
      }, "installed WebView", 60000);
      remember();
      const tree = ownedProcessTree(rows(), host.pid, current.created), backend = tree.find(p => p.Name === "creator-backend.exe");
      assert(backend); assert.equal(path.resolve(backend.ExecutablePath), path.resolve(installation.installRoot, "creator-backend.exe"));
      current.backend = { ...backend, sha256: sha(backend.ExecutablePath) }; current.listeners = listeners(ports);
      assert.equal(current.listeners.length, 2); assert(current.listeners.every(l => tree.some(p => p.ProcessId === l.OwningProcess)));
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${ports[1]}`);
      page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())), "installed page");
      page.setDefaultTimeout(30000); cdp = await page.context().newCDPSession(page);
      page.on("pageerror", e => { report.errors.push(String(e)); save(); });
      await page.context().route(modelPath, r => {
        if (r.request().method() !== "POST") return r.continue();
        let body; try { body = r.request().postDataJSON(); } catch { /* default deny */ }
        return allowModelWrite({ method: "POST", url: r.request().url(), body }) ? r.continue() : r.abort();
      });
      await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: out, eventsEnabled: true });
      await this.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
      await page.locator(".project-home").waitFor({ timeout: 60000 }); return page;
    },
    async metrics(m) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: m.width, height: m.height, deviceScaleFactor: m.dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: m.reduced ? "reduce" : "no-preference" });
      const actual = await readInstalledViewport(page, m); expected = { ...m }; return actual;
    },
    rawApi,
    async api(route) {
      const p = await rawApi(route); assert(p.ok); return p.data;
    },
    async shot(name) {
      const shot = await captureInstalledWebview(page, cdp, path.join(out, name + ".png"),
        expected);
      report.screenshots.push(shot); save(); return shot;
    },
    async stop(reason) {
      if (!host) return;
      remember(); await browser?.close().catch(() => {}); browser = undefined;
      const killed = [];
      for (const p of [...known.values()].reverse()) {
        if (!rows().some(n => identity(n) === identity(p))) continue;
        stopOwnedProcess(p, ps);
        killed.push(identity(p));
      }
      await until(() => !rows().some(p => known.has(identity(p))) && listeners(current.ports).length === 0, "installed owned cleanup", 15000);
      report.cleanups.push({ reason, status: "PASS", killed, ports: current.ports, normalCloseClaimed: false });
      host = undefined; verify(); save();
    },
  };
}
module.exports = { installedReleaseSession };
