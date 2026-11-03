"use strict";
// The unmodified UI-exported cartridge in the same actual NSIS installed Player.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { captureInstalledWebview, validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const currentCandidate = process.argv.includes("--candidate=1.9.22"), expectedVersion = currentCandidate ? "1.9.22" : "1.9.14";
const qa = currentCandidate ? "F:/AgentVN/QA/Installed-Assistant-Export-1922-20261022-01" :
  "F:/AgentVN/QA/Installed-Assistant-Export-20261021-01", root = path.resolve(__dirname, "..");
const editorAttempt = process.argv[2] || "01", attempt = process.argv[3] || "01";
assert.match(editorAttempt, /^\d{2}$/); assert.match(attempt, /^\d{2}$/);
// Existing strict original-profile protection permits this established Runtime evidence root.
const out = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-assistant-export-${currentCandidate ? "1922-" : ""}${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const sourceFile = path.join(qa, `editor-${editorAttempt}/report.json`), source = read(sourceFile);
assert.equal(source.status, "PASS"); assert.equal(source.steps.length, 3);
assert.equal(source.version, expectedVersion);
assert(source.steps.every(s => s.status === "PASS")); assert.equal(source.cases.length, 12);
assert.equal(sha(source.cartridge.path), source.cartridge.sha256);
const installationFile = currentCandidate ?
  "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json" :
  "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01/installation.json";
const installation = read(installationFile); assert.equal(installation.status, "PASS");
if (currentCandidate) assert.equal(installation.version, expectedVersion);
const exe = path.join(installation.installRoot, "agentvn-player.exe");
const expectedExe = installation.resources.find(f => path.resolve(f.path) === path.resolve(exe)); assert(expectedExe);
assert.equal(sha(exe), expectedExe.sha256);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), version: source.version, source: desc(sourceFile),
  installation: desc(installationFile), executable: desc(exe), input: source.input, cartridge: source.cartridge,
  products: source.products, tools: [__filename, "scripts/native-dev-preview-profile.ps1",
    "scripts/lib/current-native-capture.cjs", "scripts/lib/owned-process-tree.cjs"].map(f => desc(path.resolve(root, f))),
  cases: [], checks: [], launches: [], screenshots: [], cleanups: [], errors: [], modelRequests: 0,
  scope: "ACTUAL_NSIS_INSTALLED_PLAYER_UI_EXPORTED_ASSISTANT_COMPONENTS_PREVIEW_MODE",
  notProven: ["Windows standalone/setup", "Android", "Upgrade", "Normal native close", "Physical4K", "Full motion", "Real model"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const identity = p => `${p.ProcessId}:${p.Created}`, known = new Map();
let child, browser, page, cdp, current, protectedProfiles = false;
let metrics = { width: 1920, height: 1080, dpr: 1, reduced: false };
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
    ps(`$owned=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
      `if($owned -and $owned.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
    killed.push(identity(p));
  }
  await until(() => !rows().some(p => known.has(identity(p))) && listeners([current.port]).length === 0, "exact Player cleanup", 15000);
  report.cleanups.push({ status: "PASS", killed, port: current.port, normalCloseClaimed: false }); child = undefined; save();
}
async function ready(screen) {
  await page.waitForFunction(screen => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-presented-screen") === screen &&
      n?.getAttribute("data-runtime-screen-transition") === "idle" && !document.querySelector('[data-testid="game-launch-blackout"]');
  }, screen); await settleRuntime(page);
}
async function componentInfo(component) {
  return component.evaluate(async node => {
    const box = node.getBoundingClientRect(), button = node.querySelector("button"), r = button.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2), images = [];
    for (const img of node.querySelectorAll("img")) {
      await img.decode(); const bytes = await (await fetch(img.currentSrc)).arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      images.push({ id: img.dataset.assetId, width: img.naturalWidth, height: img.naturalHeight,
        sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("") });
    }
    return { id: node.dataset.componentId, box: box.toJSON(), button: r.toJSON(), hit: hit === button || button.contains(hit),
      title: node.querySelector('[data-binding="project.title"]')?.textContent, images,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches },
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
}
(async () => {
  save(); for (const f of report.tools) fs.copyFileSync(f.path, path.join(out, path.basename(f.path)), fs.constants.COPYFILE_EXCL);
  for (const f of source.products) assert.equal(sha(f.path), f.sha256);
  protectedProfiles = true; profiles("Prepare");
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
  const port = await new Promise(resolve => {
    const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  }); assert.equal(listeners([port]).length, 0);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    AGENTVN_TEST_PROJECT: source.input.path, AGENTVN_WORKSPACE_OUTPUT: out });
  const fd = fs.openSync(path.join(out, "player.log"), "wx");
  child = spawn(exe, ["--mode", "preview", "--cartridge", source.cartridge.path],
    { cwd: installation.installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd] }); fs.closeSync(fd);
  current = { pid: child.pid, port, executable: desc(exe), at: new Date().toISOString(),
    args: ["--mode", "preview", "--cartridge", source.cartridge.path],
    isolation: { AGENTVN_TEST_PROJECT: source.input.path, AGENTVN_WORKSPACE_OUTPUT: out, webview: env.WEBVIEW2_USER_DATA_FOLDER } };
  report.launches.push(current); remember();
  await until(async () => {
    assert.equal(child.exitCode, null); remember();
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
  }, "actual installed Player WebView", 60000);
  const tree = ownedProcessTree(rows(), child.pid, current.created);
  assert(listeners([port]).every(l => tree.some(p => p.ProcessId === l.OwningProcess)));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())), "Player document");
  page.setDefaultTimeout(30000); page.on("pageerror", e => { report.errors.push(String(e)); save(); });
  cdp = await page.context().newCDPSession(page);
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    metrics = { width, height: width * 9 / 16, dpr, reduced };
    const item = { ...metrics, status: "RUNNING", components: [], actions: [] }; report.cases.push(item); save();
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: metrics.height, deviceScaleFactor: dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await page.getByTestId("game-state-title").waitFor(); await ready("title_menu");
    const components = page.getByTestId("runtime-custom-component"); assert.equal(await components.count(), 2);
    for (const component of await components.all()) {
      const c = await componentInfo(component); validateNativeViewport(c.viewport, metrics);
      assert.equal(c.title, source.cartridge.manifest.title); assert.equal(c.images.length, 1);
      assert(c.images[0].width === 1 && c.images[0].height === 1 && source.cartridge.assets.some(a => a.id === c.images[0].id && a.sha256 === c.images[0].sha256));
      assert(c.hit && c.overflow <= 1 && c.box.left >= 0 && c.box.top >= 0 && c.box.right <= width + 1 && c.box.bottom <= metrics.height + 1);
      assert(c.button.left >= c.box.left && c.button.top >= c.box.top && c.button.right <= c.box.right + 1 && c.button.bottom <= c.box.bottom + 1);
      item.components.push(c);
    }
    const [a, b] = item.components.map(c => c.box);
    assert(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, "Applied components overlap");
    if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)
      report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `components-${width}-${dpr}-${reduced}.png`), metrics));
    for (const [name, target] of [["关于", "about"], ["帮助", "help"]]) {
      await page.getByRole("button", { name: `审核${name}卡操作`, exact: true }).click();
      await page.getByTestId(`${target}-screen`).waitFor(); await ready(target);
      assert.equal(await page.getByTestId("runtime-custom-component").count(), 0);
      assert(!await page.evaluate(() => {
        const n = document.activeElement;
        return n instanceof HTMLElement && n !== document.body && (!n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || !!n.closest("[inert]"));
      }));
      await page.getByTestId("renpy-menu-return").click(); await ready("title_menu");
      assert.equal(await page.getByTestId("runtime-custom-component").count(), 2);
      item.actions.push({ action: name, target, returned: true, status: "PASS" });
    }
    item.status = "PASS"; save(); console.log(`PASS actual installed components ${width}/${dpr}/${reduced}`);
  }
  await page.getByTestId("start-new-game").click(); await ready("playing");
  await page.locator(".dialog-text").filter({ hasText: "本轮独立 UI 验收" }).waitFor();
  report.story = { text: await page.locator(".dialog-text").innerText(), advancedIntoActualStory: true };
  report.checks.push({ name: "Actual game still playable after 24 component menu actions", status: "PASS" });
  assert.equal(report.cases.length, 12); assert(report.cases.every(c => c.status === "PASS" && c.actions.length === 2));
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.failureText = await page.locator("body").innerText().catch(String);
    await captureInstalledWebview(page, cdp, path.join(out, "failure.png"), metrics)
      .then(s => report.screenshots.push(s)).catch(e => { report.captureError = String(e); });
  }
}).finally(async () => {
  try {
    await stop();
    if (protectedProfiles && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profiles("Restore"); report.profileRestoration = desc(path.join(out, "profile-restoration.json"));
      assert.equal(read(report.profileRestoration.path).status, "PASS");
    }
    for (const f of [...source.products, source.cartridge, report.source]) assert.equal(sha(f.path), f.sha256);
  } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
