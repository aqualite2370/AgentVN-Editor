"use strict";
// Real retained old binary and current UI-exported bytes. No rebuilt old
// versions, store injection, resource edits or version overrides.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const net = require("node:net"), { spawn, spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip"), { chromium } = require("../editor/node_modules/playwright");
const { assertTitleProtocolRefusal, readHistoricalTitlePlayer, describe } =
  require("./lib/renpy-title-old-runtime-evidence.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { readInstalledViewport, captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt || "", /^\d{2}$/);
const base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";
const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/title-old-026-${attempt}`);
const preflight = process.argv.includes("--preflight");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const tools = [__filename, "scripts/lib/renpy-title-old-runtime-evidence.cjs",
  "scripts/lib/current-native-capture.cjs", "scripts/lib/current-native-editor-session.cjs",
  "scripts/lib/owned-process-tree.cjs", "scripts/lib/owned-process-stop.cjs",
  "scripts/native-dev-preview-profile.ps1"].map(describe);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), preflight,
  scope: preflight ? "HISTORICAL_BINARY_PROVENANCE_ONLY_NOT_NATIVE_BEHAVIOR" :
    "RETAINED_REAL_025_PLAYER_REFUSES_CURRENT_UI_EXPORTED_026_TITLE_NOT_UPGRADE_OR_ANDROID",
  tools, cases: [], launches: [], screenshots: [], pageErrors: [], commands: [],
  modelRequests: 0, productChanges: 0, builds: 0, normalCloseClaimed: false };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let protectedProfile = false;
function verify() {
  for (const item of [report.old.installation, report.old.payload, report.old.executable, ...tools])
    assert.equal(sha(item.path), item.sha256, item.path);
}
function profile(action) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "scripts/native-dev-preview-profile.ps1", "-Action", action, "-RunDirectory", out,
    "-CodexCacheView", "-Storage", "Junction"];
  const result = spawnSync("powershell.exe", args, { cwd: root, windowsHide: true,
    encoding: "utf8", timeout: 45000 });
  const log = path.join(out, `profile-${action}.log`);
  fs.writeFileSync(log, result.stdout + result.stderr, { flag: "wx" });
  report.commands.push({ command: ["powershell.exe", ...args], exitCode: result.status, log }); save();
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
async function cartridge(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const json = async name => JSON.parse(await zip.file(name).async("string"));
  return { ...describe(file), manifest: await json("manifest.json"), script: await json("script.json"),
    layout: await json("ui/layout.json") };
}
async function runCase(artifact, expected, control) {
  verify(); assert.equal(sha(artifact.path), artifact.sha256);
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)),
    "Never share a current product session");
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => {
      const n = s.address().port; s.close(e => e ? reject(e) : resolve(n));
    });
  });
  assert.equal(listeners([port]).length, 0);
  const key = `${control ? "supported-control" : "title-026"}-${expected.width}-${expected.dpr}-${expected.reduced}`;
  const webview = path.join(out, `webview-${key}`), temporary = path.join(out, `temporary-${key}`);
  fs.mkdirSync(temporary);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$)/i.test(k)) delete env[k];
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: webview, TEMP: temporary, TMP: temporary,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    AGENTVN_TEST_PROJECT: report.authorFixture, AGENTVN_WORKSPACE_OUTPUT: out });
  const log = path.join(out, `${key}.log`), fd = fs.openSync(log, "wx");
  const child = spawn(report.old.executable.path, ["--mode", "fixed", "--cartridge", artifact.path], {
    cwd: path.dirname(report.old.executable.path), env, windowsHide: true, stdio: ["ignore", fd, fd] });
  let spawnError;
  child.on("error", error => { spawnError = error; });
  fs.closeSync(fd);
  const launch = { pid: child.pid, port, webview, temporary, key, expected, log,
    executable: report.old.executable, cartridge: describe(artifact.path) };
  const result = { key, expected, control, status: "RUNNING" };
  report.launches.push(launch); report.cases.push(result); save();
  let browser, page, cdp;
  const known = new Map();
  const remember = () => {
    const processes = ownedProcessTree(rows(), child.pid, launch.identity?.Created);
    if (processes.length) {
      launch.identity ??= processes[0];
      assert.equal(path.resolve(processes[0].ExecutablePath), path.resolve(report.old.executable.path));
    }
    for (const p of processes) known.set(`${p.ProcessId}:${p.Created}`, p);
    launch.known = [...known.values()]; save();
  };
  try {
    remember();
    await until(async () => {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null); remember();
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`,
          { signal: AbortSignal.timeout(500) });
        return response.ok;
      } catch { return false; }
    }, "exact historical WebView");
    remember();
    const owner = listeners([port]); assert.equal(owner.length, 1);
    assert(launch.known.some(p => p.ProcessId === owner[0].OwningProcess)); launch.listener = owner[0];
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page = await until(() => browser.contexts().flatMap(c => c.pages())
      .find(p => /^(https?:\/\/tauri\.localhost|tauri:)/.test(p.url())), "historical native page");
    page.setDefaultTimeout(30000);
    page.on("pageerror", e => report.pageErrors.push(String(e)));
    cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: expected.width, height: expected.height,
      deviceScaleFactor: expected.dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: expected.reduced ? "reduce" : "no-preference" });
    if (control) await page.getByRole("button", { name: "开始游戏", exact: true }).waitFor();
    else await page.getByRole("alert").filter({ hasText: "卡带要求 0.26.0" }).waitFor();
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => {})));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    const start = page.getByRole("button", { name: "开始游戏", exact: true });
    result.viewport = await readInstalledViewport(page, expected);
    result.bodyText = await page.locator("body").innerText();
    result.start = { visible: await start.isVisible(), enabled: await start.isEnabled().catch(() => false) };
    if (control) {
      assert(result.start.visible && result.start.enabled && result.bodyText.includes(artifact.manifest.title));
      await start.click();
      const entry = artifact.script.scenes.find(s => s.scene_id === artifact.script.entry_scene_id);
      const first = entry.commands.find(c => ["dialog", "narration"].includes(c.type) && c.text);
      assert(first); await page.getByText(first.text, { exact: true }).waitFor();
      result.sentinel = first.text;
    } else {
      result.text = await page.getByRole("alert").innerText();
      result.playingCount = await page.locator('[data-testid="game-state-playing"]').count();
      result.overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      result.alert = await page.getByRole("alert").evaluate(n => ({
        rect: n.getBoundingClientRect().toJSON(), buttons: [...n.querySelectorAll("button")].map(b => {
          const r = b.getBoundingClientRect();
          return { rect: r.toJSON(), hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
            text: b.textContent };
        }),
      }));
      result.protocol = assertTitleProtocolRefusal(result, expected);
    }
    report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${key}.png`), expected));
    remember(); result.status = "PASS"; save();
    console.log(`PASS ${key}`);
  } catch (error) {
    result.status = "FAILED"; result.error = String(error.stack || error);
    if (page) {
      try {
        result.failureBodyText = await page.locator("body").innerText();
        result.failureAccessibility = await page.locator("body").ariaSnapshot();
        result.failureScreenshot = await captureInstalledWebview(page, cdp, path.join(out, `${key}-failed.png`), expected);
      } catch (diagnostic) { result.failureDiagnosticError = String(diagnostic.stack || diagnostic); }
    }
    save(); throw error;
  } finally {
    remember(); await browser?.close().catch(() => {});
    const cleanup = [];
    for (const process of [...known.values()].reverse()) {
      const still = rows().find(p => p.ProcessId === process.ProcessId && p.Created === process.Created);
      if (still) cleanup.push({ ...process, outcome: stopOwnedProcess(process, ps) });
    }
    await until(() => !listeners([port]).length && !rows().some(p =>
      known.has(`${p.ProcessId}:${p.Created}`)), "exact old process and port cleanup", 20000);
    launch.cleanup = { status: "PASS", cleanup, method: "OWNED_TERMINATION_NOT_NORMAL_CLOSE" }; save();
  }
}
(async () => {
  save(); report.old = readHistoricalTitlePlayer(); verify(); save();
  if (preflight) {
    report.status = "PASS"; report.runtimeBehavior = "NOT_RUN"; return;
  }
  report.author = describe(path.join(base, `author-export-${attempt}/report.json`));
  const author = read(report.author.path);
  assert.equal(author.status, "PASS"); assert(author.finishedAt && !author.cleanupError);
  assert.equal(author.scope, "ACTUAL_INSTALLED_1_9_24_FRESH_UI_EXPORT_NARRATIVE_AND_TITLE_NOT_STANDALONE_OR_ANDROID");
  const selected = author.cartridges.find(c => c.layout === "renpy"); assert(selected);
  assert.equal(sha(selected.path), selected.sha256);
  const candidate = await cartridge(selected.path);
  assert.equal(candidate.manifest.runtime_version, "0.26.0");
  assert.equal(candidate.layout.layout_type, "renpy");
  const authoredTitle = author.steps.find(s => s.detail?.expectedTitle)?.detail.expectedTitle;
  assert(authoredTitle); assert.deepEqual(candidate.layout.renpyTitleText, authoredTitle);
  const prior = read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-49/report.json");
  assert.equal(prior.status, "PASS");
  const controlRef = prior.cartridges.find(c => c.layout === "renpy"); assert(controlRef);
  assert.equal(sha(controlRef.path), controlRef.sha256);
  const control = await cartridge(controlRef.path);
  assert.equal(control.manifest.runtime_version, "0.25.0"); assert.equal(control.layout.renpyTitleText, undefined);
  report.authorFixture = author.fixture.input; report.cartridges = [control, candidate]; save();
  const copy = path.join(out, "historical-player"); fs.mkdirSync(copy);
  const target = path.join(copy, "agentvn-player.exe");
  fs.copyFileSync(report.old.executable.path, target, fs.constants.COPYFILE_EXCL);
  report.originalOldExecutable = report.old.executable; report.old.executable = describe(target);
  assert.equal(report.old.executable.sha256, report.originalOldExecutable.sha256); save();
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
  protectedProfile = true; profile("Prepare");
  await runCase(control, { width: 1920, height: 1080, dpr: 1, reduced: false }, true);
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of [1, 2]) for (const reduced of [false, true])
      await runCase(candidate, { width, height, dpr, reduced }, false);
  assert.equal(report.cases.length, 13); assert(report.cases.every(c => c.status === "PASS"));
  assert.deepEqual(report.pageErrors, []); report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  if (protectedProfile) {
    try { profile("Restore"); report.profileRestoration = "PASS"; }
    catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, scope: report.scope, cases: report.cases.length,
    out, error: report.error, cleanupError: report.cleanupError }));
});
