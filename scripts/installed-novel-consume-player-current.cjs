"use strict";
// Exact UI-exported novel cartridge, actual Player from the same sealed Editor installation.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { qa, desc, read, sha } = require("./installed-novel-consume-current.cjs");
const { cartridgeEvidence } = require("./native-novel-consume.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, "..");
async function run(editorAttempt, attempt) {
  assert.match(editorAttempt, /^\d{2}$/); assert.match(attempt, /^\d{2}$/);
  const sourceFile = path.join(qa, `session-${editorAttempt}`, "report.json"), source = read(sourceFile);
  assert.equal(source.status, "PASS"); assert.equal(source.version, "1.9.22");
  assert.equal(source.steps.length, 4); assert(source.steps.every(s => s.status === "PASS"));
  assert.equal(source.cases.length, 12); assert.equal(sha(source.cartridge.path), source.cartridge.sha256);
  const out = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-novel-consume-1922-${attempt}`;
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const installation = read(source.installation.path), exe = path.join(installation.installRoot, "agentvn-player.exe");
  const installedExe = installation.resources.find(f => path.resolve(f.path) === path.resolve(exe)); assert(installedExe);
  assert.equal(sha(exe), installedExe.sha256);
  assert.equal(installedExe.sha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");
  const exeVersion = ps(`(Get-Item -LiteralPath '${exe.replaceAll("'", "''")}').VersionInfo | Select-Object FileVersion,ProductVersion | ConvertTo-Json`);
  const report = { status: "RUNNING", version: "1.9.22", playerVersion: JSON.parse(exeVersion),
    scope: "ACTUAL_SAME_INSTALL_PLAYER_PREVIEW_CONNECTED_NOVEL_TEXT_AND_ASSET_CONSUMPTION",
    startedAt: new Date().toISOString(), source: desc(sourceFile), installation: source.installation,
    executable: desc(exe), input: source.connectedBundle, cartridge: source.cartridge, exported: source.exported,
    protectedFiles: source.protectedFiles, cases: [], launches: [], cleanups: [], screenshots: [], errors: [],
    modelRequests: 0, realModelRequests: 0, productChanges: 0,
    notProven: ["New Player release (actual PE1.9.1)", "Standalone/setup", "Android", "Upgrade", "Physical4K",
      "Normal close", "Full runtime motion", "Real model quality", "Final background asset quality"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  const tools = [__filename, "scripts/installed-novel-consume-current.cjs", "scripts/native-novel-consume.cjs",
    "scripts/native-dev-preview-profile.ps1", "scripts/lib/current-native-capture.cjs",
    "scripts/lib/owned-process-tree.cjs", "scripts/lib/owned-process-stop.cjs"];
  report.tools = tools.map(f => desc(path.resolve(root, f)));
  for (const f of report.tools) fs.copyFileSync(f.path, path.join(out, path.basename(f.path)), fs.constants.COPYFILE_EXCL);
  const identity = p => `${p.ProcessId}:${p.Created}`, known = new Map();
  let child, browser, page, cdp, current, protectedProfiles = false;
  let metrics = { width: 1920, height: 1080, dpr: 1, reduced: false };
  function immutable() {
    for (const f of [...report.tools, ...report.protectedFiles, report.source, report.executable, report.cartridge, report.input])
      assert.equal(sha(f.path), f.sha256, f.path);
  }
  function profiles(action) {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out],
    { encoding: "utf8", windowsHide: true, timeout: 60000 });
    fs.writeFileSync(path.join(out, `profiles-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  function remember() {
    if (child) {
      const tree = ownedProcessTree(rows(), child.pid, current.created);
      if (tree.length) current.created = tree[0].Created;
      for (const p of tree) known.set(identity(p), p);
    }
    report.knownProcesses = [...known.values()]; save();
  }
  async function stop() {
    if (!child) return;
    remember(); await browser?.close().catch(() => {}); browser = undefined; const killed = [];
    for (const p of [...known.values()].reverse()) {
      if (!rows().some(n => identity(n) === identity(p))) continue;
      killed.push({ identity: identity(p), result: stopOwnedProcess(p, ps) });
    }
    await until(() => !rows().some(p => known.has(identity(p))) && listeners([current.port]).length === 0, "exact Player cleanup", 15000);
    report.cleanups.push({ status: "PASS", killed, port: current.port, normalCloseClaimed: false });
    child = undefined; save();
  }
  async function ready(screen) {
    await page.waitForFunction(screen => {
      const n = document.querySelector("[data-runtime-screen-transition]");
      return n?.getAttribute("data-runtime-presented-screen") === screen &&
        n?.getAttribute("data-runtime-screen-transition") === "idle" && !document.querySelector('[data-testid="game-launch-blackout"]');
    }, screen); await settleRuntime(page);
  }
  try {
    immutable(); save();
    const originalNovel = source.connected.nodes.filter(n => n.data.editorMeta?.importSessionId);
    const inspected = await cartridgeEvidence(source.cartridge.path, { id: source.connected.project_id,
      expected: source.connected, novelNodeIds: originalNovel.map(n => n.id) });
    assert.deepEqual(inspected, source.exported);
    protectedProfiles = true; profiles("Prepare");
    assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
    const port = await new Promise(resolve => {
      const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    });
    assert.equal(listeners([port]).length, 0);
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
    const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
    Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, TEMP: temporary, TMP: temporary,
      AGENTVN_TEST_PROJECT: source.connectedBundle.path, AGENTVN_WORKSPACE_OUTPUT: out });
    const fd = fs.openSync(path.join(out, "player.log"), "wx");
    child = spawn(exe, ["--mode", "preview", "--cartridge", source.cartridge.path],
      { cwd: installation.installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd] }); fs.closeSync(fd);
    current = { pid: child.pid, port, executable: desc(exe), at: new Date().toISOString(),
      args: ["--mode", "preview", "--cartridge", source.cartridge.path], webview: env.WEBVIEW2_USER_DATA_FOLDER };
    report.launches.push(current); remember();
    await until(async () => {
      assert.equal(child.exitCode, null); remember();
      try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
      catch { return false; }
    }, "actual same-installation Player", 60000);
    assert(listeners([port]).every(l => ownedProcessTree(rows(), child.pid, current.created).some(p => p.ProcessId === l.OwningProcess)));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())), "Player document");
    page.setDefaultTimeout(30000); page.on("pageerror", e => { report.errors.push(String(e)); save(); });
    cdp = await page.context().newCDPSession(page);
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      metrics = { width, height: width * 9 / 16, dpr, reduced };
      const item = { ...metrics, status: "RUNNING", playback: [] }; report.cases.push(item); save();
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: metrics.height, deviceScaleFactor: dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      item.viewport = await readInstalledViewport(page, metrics);
      await page.getByTestId("game-state-title").waitFor(); await ready("title_menu");
      await page.getByTestId("start-new-game").click(); await ready("playing");
      for (const [i, expected] of inspected.playback.entries()) {
        await page.waitForFunction(({ sceneId, text }) => {
          const n = document.querySelector('[data-testid="game-state-playing"]'), b = document.querySelector(".dialog-box");
          return n?.getAttribute("data-current-scene-id") === sceneId && b?.getAttribute("aria-label")?.includes(text);
        }, expected);
        const dialog = page.locator("button.dialog-box");
        if (await page.getByTestId("game-state-playing").getAttribute("data-is-typing") === "true") await dialog.click();
        await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
        const observed = await dialog.evaluate(n => {
          const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          const s = document.querySelector('[data-testid="game-state-playing"]');
          return { text: n.querySelector(".dialog-text")?.textContent, scene: s?.getAttribute("data-current-scene-id"),
            type: s?.getAttribute("data-current-command-type"), pages: n.getAttribute("data-dialog-pages"),
            done: n.getAttribute("data-dialog-page-done"), rect: r.toJSON(), hit: hit === n || n.contains(hit),
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert.equal(observed.text, expected.text); assert.equal(observed.scene, expected.sceneId);
        assert.equal(observed.type, expected.type); assert.equal(observed.pages, "1"); assert.equal(observed.done, "true");
        assert(observed.hit && observed.overflow <= 1 && observed.rect.left >= 0 && observed.rect.top >= 0 &&
          observed.rect.right <= width + 1 && observed.rect.bottom <= metrics.height + 1);
        item.playback.push({ expected, observed }); save();
        if (i < inspected.playback.length - 1) await dialog.click();
      }
      item.background = await page.locator('.background-layer[data-background-id="agentvn_placeholder_background"]').evaluate(async n => {
        const frames = [n, ...n.querySelectorAll("*")], values = frames.map(n => getComputedStyle(n).backgroundImage);
        const images = values.filter(s => s.startsWith('url("')).map(s => s.slice(5, -2)); const loaded = [];
        for (const url of [...new Set(images)]) {
          const bytes = await (await fetch(url)).arrayBuffer(), digest = await crypto.subtle.digest("SHA-256", bytes);
          const img = new Image(); img.src = url; await img.decode();
          loaded.push({ bytes: bytes.byteLength, width: img.naturalWidth, height: img.naturalHeight,
            sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("") });
        }
        return loaded;
      });
      assert.equal(item.background.length, 1);
      assert.equal(item.background[0].sha256, inspected.assets.find(a => a.id === "agentvn_placeholder_background").sha256);
      assert(item.background[0].width > 0 && item.background[0].height > 0);
      if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)
        report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `novel-${width}-${dpr}-${reduced}.png`), metrics));
      item.status = "PASS"; save(); console.log(`PASS novel text and image ${width}/${dpr}/${reduced}`);
      // Return through the real game menu, then reload the same untouched cartridge for the next case.
      await page.keyboard.press("Escape"); await ready("main_menu");
      await page.reload(); await page.getByTestId("game-state-title").waitFor(); await ready("title_menu");
    }
    assert.equal(report.cases.length, 12);
    assert(report.cases.every(c => c.status === "PASS" && c.playback.length === 2 && c.background.length === 1));
    assert.deepEqual(report.errors, []); report.status = "PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureText = await page.locator("body").innerText().catch(String);
      await captureInstalledWebview(page, cdp, path.join(out, "failure.png"), metrics)
        .then(s => report.screenshots.push(s)).catch(e => { report.captureError = String(e); });
    }
  } finally {
    try {
      await stop();
      if (protectedProfiles && fs.existsSync(path.join(out, "profile-protection.json"))) {
        profiles("Restore"); report.profileRestoration = desc(path.join(out, "profile-restoration.json"));
        assert.equal(read(report.profileRestoration.path).status, "PASS");
      }
      immutable();
    } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, error: report.error, cleanupError: report.cleanupError }));
  }
}
if (require.main === module) run(process.argv[2], process.argv[3]).catch(e => { console.error(e.stack || e); process.exitCode = 1; });
