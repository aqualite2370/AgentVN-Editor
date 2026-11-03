"use strict";
// Real retained installed Player, unmodified new cartridges, old supported control.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const [oldReceipt, authorFile, controlFile, output] = process.argv.slice(2), out = path.resolve(output || "");
assert(oldReceipt && authorFile && controlFile && !fs.existsSync(out));
assert.equal(path.dirname(out), "F:\\AgentVN\\QA\\Native-Runtime-State-20261020-01");
assert(/^player-aspect-old-20261102-\d{2}$/.test(path.basename(out)));
const root = path.resolve(__dirname, "..");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ file: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const old = verifiedInstalledCandidate(oldReceipt), author = read(authorFile), controls = read(controlFile);
assert.equal(old.executable.version, "1.9.35"); assert.equal(author.status, "PASS"); assert.equal(author.cleanup, "PASS");
assert.equal(controls.status, "PASS");
const exe = path.join(old.installRoot, "agentvn-player.exe");
assert.equal(old.resources.find(f => f.path === exe)?.sha256, sha(exe));
assert.equal(sha(exe), "66945ed6a9d026ab2f17370c9fe1fa207cdc741b7005f61f1ccd539c56e46b0e");
assert.equal(author.cartridges.length, 2);
const control = controls.cartridges.find(c => c.layout === "agentvn"); assert(control);
const games = [...author.cartridges.map(c => ({ ...c, expected: "REJECT" })),
  { ...control, type: "control", expected: "ACCEPT" }];
for (const g of games) assert.equal(sha(g.path), g.sha256);
fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "REAL_1_9_35_INSTALLED_PLAYER_REFUSES_CURRENT_0_27_CARTRIDGES_WITH_OLD_POSITIVE_CONTROL",
  oldInstallation: desc(oldReceipt), author: desc(authorFile), controls: desc(controlFile), executable: desc(exe),
  cases: [], launches: [], screenshots: [], errors: [], modelRequests: 0, cleanup: "PENDING",
  limitations: ["Actual native preview, not standalone installation/upgrade or Android",
    "WebView 1080p/1440p/4K DPR/media emulation, not physical4K",
    "Attributed termination, not natural exit; no new model requests"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
report.testIdentity = desc(path.join(out, "executed-test.cjs"));
let child, launch, browser, page, cdp, protectedProfile = false;
const known = new Map(), id = p => `${p.ProcessId}:${p.Created}`;
function remember() {
  if (child) {
    const tree = ownedProcessTree(rows(), child.pid, launch.created);
    if (tree.length) launch.created = tree[0].Created;
    for (const p of tree) known.set(id(p), p);
  }
  report.knownProcesses = [...known.values()]; save();
}
function profile(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, `profile-${action}.log`), (r.stdout || "") + (r.stderr || ""), { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function metrics(m) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: m.width, height: m.height,
    deviceScaleFactor: m.dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: m.reduced ? "reduce" : "no-preference" });
  await readInstalledViewport(page, m);
  // A refused cartridge intentionally keeps the boot error overlay mounted.
  // Never require the successful-game boot dismissal on this failure path.
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function start(game) {
  assert(!child && !rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
  assert.equal(sha(exe), report.executable.sha256);
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
  });
  assert.equal(listeners([port]).length, 0);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, `webview-${game.type}`),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, AGENTVN_WORKSPACE_OUTPUT: out });
  const log = fs.openSync(path.join(out, `${game.type}.log`), "wx");
  child = spawn(exe, ["--mode", "preview", "--cartridge", game.path],
    { cwd: old.installRoot, env, windowsHide: true, stdio: ["ignore", log, log] });
  fs.closeSync(log); launch = { pid: child.pid, port, type: game.type, cartridge: desc(game.path),
    executable: report.executable, at: new Date().toISOString() };
  report.launches.push(launch); remember();
  await until(async () => {
    assert.equal(child.exitCode, null);
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, "retained installed Player CDP", 60000);
  remember();
  assert(listeners([port]).every(l => [...known.values()].some(p => p.ProcessId === l.OwningProcess)));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())),
    "retained native page");
  page.setDefaultTimeout(30000); page.on("pageerror", e => { report.errors.push(String(e)); save(); });
  cdp = await page.context().newCDPSession(page);
  await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
}
async function stop() {
  if (!child) return;
  remember(); await browser?.close().catch(() => {}); browser = undefined;
  for (const p of [...known.values()].reverse()) stopOwnedProcess(p, ps);
  await until(() => !rows().some(p => known.has(id(p))) && listeners([launch.port]).length === 0,
    "retained Player owned cleanup", 20000);
  launch.cleanup = { status: "PASS", method: "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE" };
  child = undefined; page = undefined; cdp = undefined; save();
}
(async () => {
  save(); protectedProfile = true; profile("Prepare");
  for (const game of games) {
    const zip = await JSZip.loadAsync(fs.readFileSync(game.path), { checkCRC32: true });
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    await start(game);
    if (game.expected === "REJECT") {
      assert.equal(manifest.runtime_version, "0.27.0");
      assert.equal(JSON.parse(await zip.file("ui/layout.json").async("string")).gameViewport.aspectRatio, "4:3");
      await page.getByRole("alert").filter({ hasText: "GameCLI 版本过低" }).waitFor();
      const text = await page.getByRole("alert").innerText();
      assert(/卡带要求\s*0\.27\.0/.test(text)); assert(/当前 GameCLI 为\s*0\.26\.0/.test(text));
      const matrix = [];
      for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const m = { width, height: width * 9 / 16, dpr, reduced }; await metrics(m);
        const geometry = await page.getByRole("alert").evaluate(n => {
          const rect = n.getBoundingClientRect().toJSON();
          const buttons = [...n.querySelectorAll("button")].map(b => {
            const r = b.getBoundingClientRect();
            return { rect: r.toJSON(), text: b.textContent,
              hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
          });
          return { rect, buttons, overflow: document.documentElement.scrollWidth - innerWidth };
        });
        const bounded = r => r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1
          && r.right <= m.width + 1 && r.bottom <= m.height + 1;
        assert(bounded(geometry.rect) && geometry.overflow <= 1);
        assert.equal(geometry.buttons.length, 2); assert(geometry.buttons.every(b => b.hit && bounded(b.rect)));
        assert.equal(await page.getByTestId("game-state-playing").count(), 0);
        const start = page.getByTestId("start-new-game");
        assert(!(await start.isVisible() && await start.isEnabled()));
        await page.getByRole("button", { name: "重试", exact: true }).focus();
        assert(await page.getByRole("button", { name: "重试", exact: true }).evaluate(n => n === document.activeElement));
        matrix.push({ ...m, geometry, status: "PASS" });
        if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)
          report.screenshots.push(await captureInstalledWebview(page, cdp,
            path.join(out, `${game.type}-${width}-${dpr}-${reduced}.png`), m));
      }
      report.cases.push({ name: "real-old-runtime-refuses-authored-aspect-capability", type: game.type,
        cartridge: desc(game.path), requiredRuntime: manifest.runtime_version, actualRuntime: "0.26.0",
        refusalText: text, matrix, storyMounted: false, status: "PASS" });
    } else {
      assert.equal(manifest.runtime_version, "0.25.0");
      await page.getByTestId("start-new-game").click();
      await page.getByTestId("game-state-playing").waitFor();
      assert.equal(await page.getByRole("alert").count(), 0);
      const script = JSON.parse(await zip.file("script.json").async("string"));
      report.cases.push({ name: "unchanged-old-supported-cartridge-actually-plays", type: "control",
        cartridge: desc(game.path), requiredRuntime: manifest.runtime_version, scriptSchema: script.schema_version,
        playing: true, status: "PASS" });
      report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, "supported-control-playing.png"),
        { width: 1920, height: 1080, dpr: 1, reduced: false }));
    }
    console.log(`PASS ${game.type}: ${game.expected}`); save(); await stop();
  }
  assert.equal(report.cases.length, 3); assert.equal(report.launches.length, 3);
  assert.equal(report.screenshots.length, 5); assert.deepEqual(report.errors, []);
  for (const game of games) assert.equal(sha(game.path), game.sha256);
  assert.equal(sha(exe), report.executable.sha256); report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page && !page.isClosed()) report.failureDOM = await page.locator("body").innerText().catch(String);
}).finally(async () => {
  try {
    await stop();
    if (protectedProfile && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profile("Restore"); report.profileRestoration = desc(path.join(out, "profile-restoration.json"));
      assert.equal(read(report.profileRestoration.file).status, "PASS");
    }
    report.cleanup = "PASS";
  } catch (error) {
    report.cleanup = "FAILED"; report.cleanupError = String(error.stack || error); report.status = "FAILED"; process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, cleanup: report.cleanup,
    error: report.error, cleanupError: report.cleanupError, out }));
});
