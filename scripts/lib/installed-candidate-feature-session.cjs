"use strict";
// QA only: actual NSIS installation, isolated explicit DB/WebView directories.
// Does not claim default-path, native picker, clean-machine or normal-close acceptance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), net = require("node:net");
const { spawn } = require("node:child_process");
const { chromium } = require("../../editor/node_modules/playwright");
const { rows, listeners, ps, until } = require("./current-native-editor-session.cjs");
const { ownedProcessTree } = require("./owned-process-tree.cjs");
const { captureInstalledWebview } = require("./current-native-capture.cjs");
const { verifiedInstalledCandidate } = require("./verified-installed-candidate.cjs");
const hash = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const identity = p => `${p.ProcessId}:${p.Created}`;
async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
  });
}
function installedFeatureSession({ out, report, save, profileRoot = out,
  testProject = path.join(out, "installed-layout-test.vnproj") }) {
  const installationFile = process.env.AGENTVN_INSTALLED_INSTALLATION_FILE
    ? path.resolve(process.env.AGENTVN_INSTALLED_INSTALLATION_FILE)
    : "F:/AgentVN/QA/Installed-Candidate-20261021-01/installation.json";
  const installation = verifiedInstalledCandidate(installationFile);
  const exe = installation.executable.path;
  assert.equal(hash(exe), installation.executable.sha256);
  let child, current, browser, page, cdp;
  const known = new Map();
  function remember() {
    const now = rows();
    if (child) {
      const tree = ownedProcessTree(now, child.pid, current.created);
      if (tree.length) current.created = tree[0].Created;
      for (const p of tree) known.set(identity(p), p);
    }
    report.knownProcesses = [...known.values()]; save();
  }
  return {
    installation,
    get current() { return current; }, get page() { return page; }, get cdp() { return cdp; },
    async start() {
      assert(!child, "Stop the recorded session before starting another");
      assert(!rows().some(p => /^(AgentVN Dev|agentvn-editor|creator-backend)\.exe$/i.test(p.Name)),
        "Do not reuse another Editor/backend");
      assert.equal(hash(exe), installation.executable.sha256);
      const ports = [await freePort(), await freePort()];
      assert.equal(listeners(ports).length, 0);
      const allowedProfileRoots = [
        "Installed-Layout-20261021-01",
        "Installed-GUI-20261021-01",
        "Installed-Portrait-20261021-01",
        ...(process.env.AGENTVN_INSTALLED_QA_ROOT
          ? [path.resolve(process.env.AGENTVN_INSTALLED_QA_ROOT)]
          : []),
      ].map(name => path.isAbsolute(name) ? name : path.resolve("F:/AgentVN/QA", name));
      assert(allowedProfileRoots.some(name => path.resolve(profileRoot).startsWith(name + path.sep)));
      const data = path.join(profileRoot, "data"), webview = path.join(profileRoot, "webview");
      fs.mkdirSync(path.join(data, "backend"), { recursive: true });
      const decision = path.join(data, "backend/database-migration-decision.json");
      if (!fs.existsSync(decision)) fs.writeFileSync(decision, JSON.stringify({ approved: false, sources: [] }), { flag: "wx" });
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
      Object.assign(env, {
        AGENTVN_EDITOR_DATA_DIR: data, AGENTVN_BACKEND_PORT: String(ports[0]), AGENTVN_LEGACY_DATABASE_PATHS: "",
        WEBVIEW2_USER_DATA_FOLDER: webview, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${ports[1]}`,
        AGENTVN_TEST_PROJECT: testProject, AGENTVN_WORKSPACE_OUTPUT: out,
      });
      const fd = fs.openSync(path.join(out, `host-${report.launches.length + 1}.log`), "wx");
      child = spawn(exe, [], { cwd: installation.installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd] });
      fs.closeSync(fd);
      current = { pid: child.pid, ports, data, webview, at: new Date().toISOString(), executable: installation.executable,
        isolation: { AGENTVN_TEST_PROJECT: env.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: out },
        dataDirectoryOverride: true, webviewDirectoryOverride: true, sourceServer: false, manualBackendSpawn: false };
      report.launches.push(current); remember();
      await until(async () => {
        assert.equal(child.exitCode, null); remember();
        try {
          const r = await fetch(`http://127.0.0.1:${ports[0]}/api/health`, { signal: AbortSignal.timeout(1000) });
          return r.ok && (await r.json()).service === "agentvn-backend";
        } catch { return false; }
      }, "installed host auto-started packaged backend", 60000);
      await until(async () => {
        try { return (await fetch(`http://127.0.0.1:${ports[1]}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
        catch { return false; }
      }, "installed WebView", 60000);
      remember();
      const tree = ownedProcessTree(rows(), child.pid, current.created);
      const backend = tree.find(p => p.Name === "creator-backend.exe"); assert(backend);
      assert.equal(path.resolve(backend.ExecutablePath), path.resolve(installation.installRoot, "creator-backend.exe"));
      current.listeners = listeners(ports);
      assert.equal(current.listeners.length, 2);
      assert(current.listeners.every(l => tree.some(p => p.ProcessId === l.OwningProcess)));
      current.backend = { ...backend, sha256: hash(backend.ExecutablePath) };
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${ports[1]}`);
      page = await until(() => browser.contexts().flatMap(c => c.pages())
        .find(p => /tauri\.localhost|^tauri:/.test(p.url())), "installed document");
      page.setDefaultTimeout(30000); cdp = await page.context().newCDPSession(page);
      page.on("pageerror", e => {
        report.errors.push(String(e));
        (report.errorEvents ??= []).push({ at: new Date().toISOString(), action: report.currentAction,
          message: String(e), stack: e.stack });
        save();
      });
      await page.context().route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/, route => {
        if (route.request().method() !== "POST") return route.continue();
        report.modelRequests++; save(); return route.abort();
      });
      await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: out, eventsEnabled: true });
      await this.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
      await page.locator(".project-home").waitFor({ timeout: 60000 });
      save(); return page;
    },
    async metrics(m) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: m.width, height: m.height, deviceScaleFactor: m.dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: m.reduced ? "reduce" : "no-preference" });
    },
    async api(route) {
      const r = await fetch(`http://127.0.0.1:${current.ports[0]}${route}`, { signal: AbortSignal.timeout(15000) });
      assert(r.ok, `${route}: ${r.status}`); const payload = await r.json(); assert(payload.ok); return payload.data;
    },
    async shot(name, m = { width: 1920, height: 1080, dpr: 1, reduced: false }) {
      const shot = await captureInstalledWebview(page, cdp, path.join(out, name + ".png"), m);
      report.screenshots.push(shot); save(); return shot;
    },
    async stop(reason) {
      if (!child) return;
      remember(); await browser?.close().catch(() => {}); browser = undefined;
      const killed = [];
      for (const p of [...known.values()].reverse()) {
        if (!rows().some(r => identity(r) === identity(p))) continue;
        ps(`$owned=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
          `if($owned -and $owned.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){` +
          `Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
        killed.push(identity(p));
      }
      await until(() => !rows().some(p => known.has(identity(p))) && listeners(current.ports).length === 0,
        "owned installed processes and ports exit", 15000);
      report.cleanups.push({ reason, killed, status: "PASS", ports: current.ports, normalCloseClaimed: false });
      child = undefined; save();
    },
  };
}
module.exports = { installedFeatureSession };
