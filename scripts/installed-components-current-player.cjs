"use strict";
// Actual installed Player, unmodified UI-exported cartridge, real input actions.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { validate } = require("./lib/installed-components-current-evidence.cjs");
const candidate = require("./lib/installed-components-candidate.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { validateNativeViewport, captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Components-20261021-01";
const editorAttempt = process.argv[2] || "02", attempt = process.argv[3] || "01";
assert.match(editorAttempt, /^\d{2}$/); assert.match(attempt, /^\d{2}$/);
const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-components-current-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const sourceFile = path.join(qa, `editor-${editorAttempt}/report.json`), source = read(sourceFile); validate(source, candidate.expected);
assert.equal(path.resolve(source.installation.path), path.resolve(candidate.installationFile));
const installation = read(source.installation.path); assert.equal(sha(source.installation.path), source.installation.sha256);
const exe = path.join(installation.installRoot, "agentvn-player.exe");
const declared = installation.resources.find(f => path.resolve(f.path) === path.resolve(exe)); assert(declared);
assert.equal(sha(exe), declared.sha256); assert.equal(sha(source.cartridge.path), source.cartridge.sha256);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), version: candidate.expected.version,
  scope: "CURRENT_INSTALLED_PLAYER_COMPONENT_ZIP_UNMODIFIED_UI_CARTRIDGE",
  source: desc(sourceFile), installation: source.installation, executable: desc(exe), cartridge: source.cartridge,
  protectedFiles: source.protectedFiles, tools: [], cases: [], screenshots: [], launches: [], cleanups: [], errors: [],
  modelRequests: 0, productChanges: 0,
  notProven: ["Windows standalone/setup", "MSI/upgrade", "Android", "Full motion", "Normal native close", "Physical4K"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const identity = p => `${p.ProcessId}:${p.Created}`, known = new Map();
let child, browser, page, cdp, launch, protectedProfiles = false;
let metrics = { width: 1920, height: 1080, dpr: 1, reduced: false };
function profiles(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, `profiles-${action}.log`), r.stdout + r.stderr, { flag: "wx" }); assert.equal(r.status, 0, r.stdout + r.stderr);
}
function remember() {
  if (child) {
    const tree = ownedProcessTree(rows(), child.pid, launch.created);
    if (tree.length) launch.created = tree[0].Created;
    for (const p of tree) known.set(identity(p), p);
  }
  report.knownProcesses = [...known.values()]; save();
}
async function ready(screen) {
  await page.waitForFunction(s => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-presented-screen") === s && n?.getAttribute("data-runtime-screen-transition") === "idle"
      && !document.querySelector('[data-testid="game-launch-blackout"]');
  }, screen); await settleRuntime(page);
}
function unchanged() {
  for (const f of [...source.protectedFiles, source.cartridge, report.source]) assert.equal(sha(f.path), f.sha256);
}
async function stop() {
  if (!child) return;
  remember(); await browser?.close().catch(() => {}); browser = undefined; const killed = [];
  for (const p of [...known.values()].reverse()) {
    if (!rows().some(n => identity(n) === identity(p))) continue;
    stopOwnedProcess(p, ps);
    killed.push(identity(p));
  }
  await until(() => !rows().some(p => known.has(identity(p))) && listeners([launch.port]).length === 0, "owned component Player cleanup", 15000);
  report.cleanups.push({ status: "PASS", killed, port: launch.port, normalCloseClaimed: false }); child = undefined; save();
}
(async () => {
  unchanged(); save();
  for (const f of [__filename, "scripts/native-dev-preview-profile.ps1", "scripts/lib/current-native-capture.cjs",
    "scripts/lib/owned-process-tree.cjs", "scripts/lib/installed-components-current-evidence.cjs"]) {
    const file = path.resolve(root, f), copy = path.join(out, path.basename(f));
    fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL); report.tools.push({ source: desc(file), copy: desc(copy) });
  }
  protectedProfiles = true; profiles("Prepare");
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => {
    const p = s.address().port; s.close(() => resolve(p)); }); }); assert.equal(listeners([port]).length, 0);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    AGENTVN_TEST_PROJECT: source.input.path, AGENTVN_WORKSPACE_OUTPUT: out });
  const fd = fs.openSync(path.join(out, "player.log"), "wx");
  child = spawn(exe, ["--mode", "preview", "--cartridge", source.cartridge.path],
    { cwd: installation.installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd] }); fs.closeSync(fd);
  launch = { pid: child.pid, port, at: new Date().toISOString(), executable: desc(exe),
    args: ["--mode", "preview", "--cartridge", source.cartridge.path],
    isolation: { AGENTVN_TEST_PROJECT: source.input.path, AGENTVN_WORKSPACE_OUTPUT: out, webview: env.WEBVIEW2_USER_DATA_FOLDER } };
  report.launches.push(launch); remember();
  await until(async () => {
    assert.equal(child.exitCode, null); remember();
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
  }, "installed component Player CDP", 60000);
  assert(listeners([port]).every(l => ownedProcessTree(rows(), child.pid, launch.created).some(p => p.ProcessId === l.OwningProcess)));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())), "Player document");
  page.setDefaultTimeout(30000); cdp = await page.context().newCDPSession(page);
  page.on("pageerror", e => { report.errors.push(String(e)); save(); });
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    metrics = { width, height: width * 9 / 16, dpr, reduced };
    const item = { ...metrics, status: "RUNNING", components: [], actions: [] }; report.cases.push(item); save();
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: metrics.height, deviceScaleFactor: dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" }); await ready("title_menu");
    const cs = page.getByTestId("runtime-custom-component"); assert.equal(await cs.count(), 3);
    for (const c of await cs.all()) {
      const value = await c.evaluate(async n => {
        const box = n.getBoundingClientRect(), b = n.querySelector("button"), r = b.getBoundingClientRect();
        const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2), images = [];
        for (const i of n.querySelectorAll("img")) {
          await i.decode(); const bytes = await (await fetch(i.currentSrc)).arrayBuffer();
          images.push({ id: i.dataset.assetId, width: i.naturalWidth, height: i.naturalHeight,
            sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(b => b.toString(16).padStart(2, "0")).join("") });
        }
        return { id: n.dataset.componentId, title: n.querySelector('[data-binding="project.title"]')?.textContent, images,
          box: box.toJSON(), button: r.toJSON(), actionLabel: b.getAttribute("aria-label"), hit: b === h || b.contains(h),
          overflow: document.documentElement.scrollWidth - innerWidth,
          viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches } };
      });
      validateNativeViewport(value.viewport, metrics);
      assert.equal(value.title, source.cartridge.manifest.title); assert.equal(value.images.length, 2);
      for (const i of value.images) assert(i.width === 48 && i.height === 32
        && source.cartridge.assetEntries.some(a => a.id === i.id && a.sha256 === i.sha256));
      assert(value.hit && value.overflow <= 1 && value.box.left >= 0 && value.box.top >= 0
        && value.box.right <= width + 1 && value.box.bottom <= metrics.height + 1);
      assert(value.button.left >= value.box.left && value.button.top >= value.box.top
        && value.button.right <= value.box.right + 1 && value.button.bottom <= value.box.bottom + 1);
      item.components.push(value);
    }
    assert.equal(new Set(item.components.map(c => c.id)).size, 3);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      const a = item.components[i].box, b = item.components[j].box;
      assert(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, "Components overlap");
    }
    if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)
      report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `components-${width}-${dpr}-${reduced}.png`), metrics));
    for (const c of item.components) {
      const target = c.actionLabel.includes("关于") ? "about" : "help";
      await page.locator(`[data-testid="runtime-custom-component"][data-component-id="${c.id}"]`).getByRole("button").click();
      await page.getByTestId(`${target}-screen`).waitFor(); await ready(target);
      assert.equal(await cs.count(), 0);
      assert(!await page.evaluate(() => {
        const n = document.activeElement; return n instanceof HTMLElement && n !== document.body
          && (!n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || !!n.closest("[inert]"));
      }));
      await page.getByTestId("renpy-menu-return").click(); await ready("title_menu"); assert.equal(await cs.count(), 3);
      item.actions.push({ component: c.id, target, returned: true, status: "PASS" });
    }
    item.status = "PASS"; save(); console.log(`PASS actual installed ZIP components ${width}/${dpr}/${reduced}`);
  }
  await page.getByTestId("start-new-game").click(); await ready("playing");
  await page.locator(".dialog-text").filter({ hasText: "QA_COMPONENT_ZIP_CURRENT_STORY" }).waitFor();
  report.story = { text: await page.locator(".dialog-text").innerText(), actualStoryEntered: true };
  assert.equal(report.cases.length, 12); assert(report.cases.every(c => c.status === "PASS" && c.actions.length === 3));
  assert.deepEqual(report.errors, []); unchanged(); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.failureText = await page.locator("body").innerText().catch(String);
    await captureInstalledWebview(page, cdp, path.join(out, "failure.png"), metrics).then(s => report.screenshots.push(s)).catch(String);
  }
}).finally(async () => {
  try {
    await stop();
    if (protectedProfiles && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profiles("Restore"); report.profileRestoration = desc(path.join(out, "profile-restoration.json"));
      assert.equal(read(report.profileRestoration.path).status, "PASS"); report.profileRestored = true;
    }
    unchanged(); report.protectedUnchanged = true;
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error, cleanupError: report.cleanupError }));
});
