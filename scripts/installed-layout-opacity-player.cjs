"use strict";
// Consume the actual installed Editor's UI exports with the same installation's
// Player. This is preview-player consumption, NOT a Windows setup export.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), net = require("node:net"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright"), JSZip = require("../editor/node_modules/jszip");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Layout-20261021-01";
const inputAttempt = process.argv[2] || "02", attempt = process.argv[3] || "01";
assert.match(inputAttempt, /^\d{2}$/); assert.match(attempt, /^\d{2}$/);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const sourceFile = path.join(qa, `editor-${inputAttempt}/report.json`), source = read(sourceFile);
assert.equal(source.status, "EDITOR_PASS_PLAYER_NOT_RUN"); assert.equal(source.variants.length, 2);
const materialPrepared = source.materialPreparedViaRealAuthorUI === true;
assert.equal(source.steps.length, materialPrepared ? 11 : 8);
assert(source.steps.every(s => s.status === "PASS"));
if (materialPrepared) for (const label of ["agentvn-real-background-material-author",
  "material-real-native-portable-save", "material-real-process-restart-restores-background"])
  assert.equal(source.steps.filter(s => s.label === label && s.status === "PASS").length, 1);
const installation = read("F:/AgentVN/QA/Installed-Candidate-20261021-01/installation.json");
assert.equal(installation.status, "PASS");
const exe = path.join(installation.installRoot, "agentvn-player.exe");
const prep = read(path.join(qa, "preparation.json"));
assert.equal(sha(exe), prep.immutable.find(f => path.resolve(f.path) === path.resolve(exe)).sha256);
// Reuse the existing narrowly guarded protector. No new protection roots.
const out = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-layout-opacity-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: desc(sourceFile),
  executable: desc(exe), cases: [], launches: [], screenshots: [], cleanups: [], errors: [], modelRequests: 0,
  scope: "ACTUAL_NSIS_INSTALLED_EDITOR_UI_EXPORT_AND_INSTALLED_PLAYER_PREVIEW_CONSUMPTION",
  notProven: ["Standalone Windows portable/setup build", "Android export/run/upgrade", "Native file picker",
    "Normal native close", "Physical 4K", "Complete motion audit", "All feature groups or final user project"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const known = new Map(), identity = p => `${p.ProcessId}:${p.Created}`;
let player, current, browser, page, cdp, protectedProfile = false;
function profiles(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, `profile-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
  assert.equal(r.status, 0, `${action}: ${r.stdout}\n${r.stderr}`); return r.stdout;
}
function remember() {
  if (player) {
    const tree = ownedProcessTree(rows(), player.pid, current.created);
    if (tree.length) current.created = tree[0].Created;
    for (const p of tree) known.set(identity(p), p);
  }
  report.knownProcesses = [...known.values()]; save();
}
async function stop(reason) {
  if (!player) return;
  remember(); await browser?.close().catch(() => {}); browser = undefined;
  const killed = [];
  for (const p of [...known.values()].reverse()) {
    if (!rows().some(r => identity(r) === identity(p))) continue;
    ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
      `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){` +
      `Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
    killed.push(identity(p));
  }
  await until(() => !rows().some(p => known.has(identity(p))) && listeners([current.port]).length === 0,
    "installed Player process/port cleanup", 15000);
  report.cleanups.push({ status: "PASS", reason, killed, port: current.port, normalCloseClaimed: false });
  player = undefined; save();
}
async function metrics(m) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: m.width, height: m.height,
    deviceScaleFactor: m.dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: m.reduced ? "reduce" : "no-preference" });
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  save(); protectedProfile = true; profiles("Prepare");
  for (const variant of source.variants) {
    assert.equal(sha(variant.cartridge.path), variant.cartridge.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(variant.cartridge.path), { checkCRC32: true });
    const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer");
    assert.equal(crypto.createHash("sha256").update(layoutBytes).digest("hex"), variant.layoutSha256);
    assert.deepEqual(JSON.parse(layoutBytes), variant.layout);
    if (materialPrepared) assert.equal(variant.layout.screens.find(s => s.screen_id === "title")
      .components.find(c => c.component_id === "title_hero").style.backgroundColor, "#24384c");
    const script = JSON.parse(await zip.file(variant.manifest.entry_script).async("string"));
    const result = { type: variant.type, cartridge: variant.cartridge, layoutSha256: variant.layoutSha256,
      status: "RUNNING", matrix: [] }; report.cases.push(result); save();
    const port = await new Promise(resolve => {
      const server = net.createServer(); server.listen(0, "127.0.0.1", () => {
        const p = server.address().port; server.close(() => resolve(p));
      });
    });
    assert.equal(listeners([port]).length, 0);
    assert(!rows().some(p => p.Name === "agentvn-player.exe"), "Another Player is running");
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
    Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, `webview-${variant.type}`),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      AGENTVN_TEST_PROJECT: source.portable.path, AGENTVN_WORKSPACE_OUTPUT: out });
    const fd = fs.openSync(path.join(out, `${variant.type}.log`), "wx");
    player = spawn(exe, ["--mode", "preview", "--cartridge", variant.cartridge.path],
      { cwd: installation.installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd] });
    fs.closeSync(fd);
    current = { pid: player.pid, port, at: new Date().toISOString(), executable: desc(exe),
      args: ["--mode", "preview", "--cartridge", variant.cartridge.path] };
    report.launches.push(current); remember();
    await until(async () => {
      assert.equal(player.exitCode, null); remember();
      try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
      catch { return false; }
    }, "installed Player WebView", 60000);
    const owned = ownedProcessTree(rows(), player.pid, current.created);
    assert(listeners([port]).every(l => owned.some(p => p.ProcessId === l.OwningProcess)));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page = await until(() => browser.contexts().flatMap(c => c.pages())
      .find(p => /tauri\.localhost|^tauri:/.test(p.url())), "installed Player document");
    page.setDefaultTimeout(30000); page.on("pageerror", e => { report.errors.push(String(e)); save(); });
    cdp = await page.context().newCDPSession(page);
    await page.getByTestId("game-state-title").waitFor(); await settleRuntime(page);
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const m = { width, height: width * 9 / 16, dpr, reduced }; await metrics(m); await settleRuntime(page);
      const shown = await page.locator(".main-menu-title-hero-background").evaluate(n => {
        const root = n.closest(".main-menu, .renpy-title-view");
        const navigation = root.querySelector('[data-testid="main-menu-actions"]');
        const controls = [...navigation.querySelectorAll("button:not(:disabled)")].filter(b => {
          const r = b.getBoundingClientRect(), s = getComputedStyle(b);
          return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
        }).map(b => {
          const r = b.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { text: b.textContent, rect: r.toJSON(), hit: top === b || b.contains(top),
            bounded: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
        });
        return { background: Number(getComputedStyle(n).opacity), content: Number(getComputedStyle(navigation).opacity),
          controls, overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert.equal(shown.background, variant.type === "agentvn" ? .4 : .5);
      assert.equal(shown.content, variant.type === "agentvn" ? .7 : .8);
      assert(shown.controls.length >= 4 && shown.controls.every(c => c.hit && c.bounded));
      assert(shown.overflow <= 1);
      result.matrix.push({ ...m, shown, status: "PASS" }); save();
      if ((width === 1920 && dpr === 1 && !reduced) || (width === 3840 && dpr === 2 && reduced)) {
        const shot = await captureInstalledWebview(page, cdp, path.join(out, `${variant.type}-${width}-${dpr}-${reduced}.png`), m);
        report.screenshots.push(shot); save();
      }
    }
    await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
    await page.getByTestId("start-new-game").click();
    await page.getByTestId("game-state-playing").waitFor(); await settleRuntime(page);
    const first = script.scenes.find(s => s.scene_id === script.entry_scene_id);
    assert(first);
    const textCommand = first.commands.find(c => ["dialog", "narration"].includes(c.type)); assert(textCommand);
    const dialog = page.locator("button.dialog-box"); await dialog.waitFor();
    await page.waitForFunction(text => document.querySelector(".dialog-box")?.getAttribute("aria-label")?.includes(text), textCommand.text);
    if (await page.getByTestId("game-state-playing").getAttribute("data-is-typing") === "true") await dialog.click();
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
    result.played = await dialog.evaluate(n => ({ text: n.querySelector(".dialog-text")?.textContent,
      done: n.getAttribute("data-dialog-page-done") }));
    assert.equal(result.played.text, textCommand.text); assert.equal(result.played.done, "true");
    assert.equal(result.matrix.length, 12); result.status = "PASS"; save();
    await stop(`${variant.type} actual export consumed`);
    console.log(`PASS installed Player ${variant.type}: 12 display cases, actual story text`);
  }
  assert.equal(report.cases.length, 2); assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) report.failureDOM = await page.locator("body").innerText().catch(String);
}).finally(async () => {
  try {
    await stop("Final installed Player cleanup");
    if (protectedProfile && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profiles("Restore");
      assert.equal(read(path.join(out, "profile-restoration.json")).status, "PASS");
      report.profileRestoration = desc(path.join(out, "profile-restoration.json"));
    }
    for (const f of prep.immutable) assert.equal(sha(f.path), f.sha256, f.path);
  } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
