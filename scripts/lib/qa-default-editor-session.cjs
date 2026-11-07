"use strict";
// Genuine dedicated Windows profile, installed bytes only. No data/WebView override.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), net = require("node:net"), { spawn } = require("node:child_process");
const { chromium } = require("../../editor/node_modules/playwright");
const { rows, listeners, until } = require("./current-native-editor-session.cjs");
const { ownedProcessTree } = require("./owned-process-tree.cjs");
const { stopOwnedProcess } = require("./owned-process-stop.cjs");
const { captureInstalledWebview } = require("./current-native-capture.cjs");
const { close } = require("./editor-upgrade-wm-close.cjs");
const { ps } = require("./current-native-editor-session.cjs");
const hash = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.once("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
function withToolchainEnvironment(input, dependencies) {
  const env = { ...input }, paths = Object.keys(env).filter(k => /^path$/i.test(k));
  assert.equal(paths.length, 1, "Reject ambiguous Windows PATH aliases");
  const original = env[paths[0]]; assert(typeof original === "string" && original.length > 0);
  delete env[paths[0]];
  env.Path = path.join(dependencies.cargo, "bin") + path.delimiter + original;
  env.CARGO_HOME = dependencies.cargo; env.RUSTUP_HOME = dependencies.rustup;
  assert(!env.Path.includes("undefined"));
  return env;
}
function defaultEditorSession({ installation, out, report, save, label, dependencies,
  expectedQaUser = "AVNQA7A8FAE88", isolatedBackendPort }) {
  assert.match(expectedQaUser, /^AVNQA[0-9A-F]{8}$/);
  assert.equal(require("node:os").userInfo().username, expectedQaUser);
  assert(path.resolve(installation.installRoot).startsWith(path.resolve("F:/AgentVN/QA") + path.sep));
  const known = new Map(); let child, browser, page, cdp, current;
  function remember() {
    if (child) for (const row of ownedProcessTree(rows(), child.pid, current.created)) {
      if (row.ProcessId === child.pid) current.created = row.Created;
      known.set(`${row.ProcessId}:${row.Created}`, row);
    }
    report.editorKnown = [...(report.editorKnown || []), ...known.values()]
      .filter((r, i, a) => a.findIndex(x => x.ProcessId === r.ProcessId && x.Created === r.Created) === i);
    save();
  }
  return {
    get current() { return current; }, get cdp() { return cdp; }, get page() { return page; },
    async start() {
      assert.equal(hash(installation.executable.path), installation.executable.sha256);
      if (isolatedBackendPort === undefined)
        assert(!rows().some(p => /^(AgentVN Dev|agentvn-editor|agentvn-player|creator-backend)\.exe$/i.test(p.Name)));
      else {
        assert(Number.isSafeInteger(isolatedBackendPort) && isolatedBackendPort > 1024 && isolatedBackendPort < 65536);
        assert.notEqual(isolatedBackendPort, 8278, "Preserve the user's live backend");
      }
      const port = await freePort(), backendPort = isolatedBackendPort ?? 8278;
      assert.equal(listeners([port, backendPort]).length, 0);
      let env = { ...process.env };
      for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
      env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port}`;
      if (isolatedBackendPort !== undefined) env.AGENTVN_BACKEND_PORT = String(backendPort);
      if (dependencies) {
        const prefix = path.resolve("F:/AgentVN/QA/Windows-Isolated-1944-20261105-12/dependencies") + path.sep;
        for (const directory of [dependencies.cargo, dependencies.rustup])
          assert(path.resolve(directory).startsWith(prefix), "Only explicit F: QA toolchain is allowed");
        env = withToolchainEnvironment(env, dependencies);
        const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary, { recursive: true });
        env.TEMP = temporary; env.TMP = temporary;
      }
      const fd = fs.openSync(path.join(out, label + "-host.log"), "wx");
      child = spawn(installation.executable.path, [], {
        cwd: installation.installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd],
      }); fs.closeSync(fd);
      const root = await until(() => rows().find(p => p.ProcessId === child.pid), "installed Editor root", 15000);
      current = { label, pid: child.pid, created: root.Created, exe: installation.executable.path,
        ports: [backendPort, port], at: new Date().toISOString(), dataDirectoryOverride: false,
        webviewDirectoryOverride: false, backendPortOverride: isolatedBackendPort !== undefined, sourceServer: false,
        database: path.join(process.env.APPDATA, "com.agentvn.editor/backend/vn_engine.db") };
      if (dependencies) current.dependencies = dependencies;
      report.launches.push(current); remember();
      await until(async () => {
        assert.equal(child.exitCode, null); remember();
        try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) })).ok
          && (await fetch(`http://127.0.0.1:${backendPort}/api/health`, { signal: AbortSignal.timeout(800) })).ok; }
        catch { return false; }
      }, "default installed Editor and managed backend", 90000);
      remember();
      const tree = [...known.values()], backend = tree.find(p => p.Name === "creator-backend.exe");
      assert(backend && path.resolve(backend.ExecutablePath) === path.resolve(installation.installRoot, "creator-backend.exe"));
      current.backend = { ...backend, sha256: hash(backend.ExecutablePath) };
      current.listeners = listeners(current.ports);
      assert.equal(current.listeners.length, 2);
      assert(current.listeners.every(l => tree.some(p => p.ProcessId === l.OwningProcess)));
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())), "installed document");
      page.setDefaultTimeout(30000);
      page.on("pageerror", e => { report.errors.push(String(e)); save(); });
      await page.context().route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/, r => {
        if (r.request().method() !== "POST") return r.continue();
        report.blockedModelRequests = (report.blockedModelRequests || 0) + 1; save(); return r.abort();
      });
      cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.locator(".project-home").waitFor({ timeout: 60000 });
      assert(fs.existsSync(current.database)); return page;
    },
    remember,
    async api(route) {
      const response = await fetch(`http://127.0.0.1:${current.ports[0]}${route}`, { signal: AbortSignal.timeout(15000) });
      assert(response.ok); const result = await response.json(); assert(result.ok); return result.data;
    },
    async shot(name) {
      const s = await captureInstalledWebview(page, cdp, path.join(out, name + ".png"),
        { width: 1920, height: 1080, dpr: 1, reduced: false });
      report.screenshots.push(s); save();
    },
    async naturalClose() {
      remember();
      const receipt = await close({ launch: current, known: [...known.values()], out });
      await browser?.close().catch(() => {}); browser = undefined; child = undefined;
      report.cleanups.push({ status: "PASS", method: "WM_CLOSE", receipt, killed: [] }); save(); return receipt;
    },
    async stop() {
      if (!child) return;
      remember(); await browser?.close().catch(() => {});
      const killed = [];
      for (const p of [...known.values()].reverse()) if (rows().some(r => r.ProcessId === p.ProcessId && r.Created === p.Created)) {
        stopOwnedProcess(p, ps); killed.push(p.ProcessId);
      }
      await until(() => !rows().some(p => known.has(`${p.ProcessId}:${p.Created}`))
        && listeners(current.ports).length === 0, "owned Editor cleanup", 20000);
      report.cleanups.push({ status: "PASS", method: "finally-owned-only", killed }); child = undefined; save();
    },
  };
}
module.exports = { defaultEditorSession, withToolchainEnvironment };
