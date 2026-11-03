"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const qaRoot = "F:/AgentVN/QA/Windows-Package-20261021-01";
const sourceDir = path.join(qaRoot, "editor-13");
const reportPath = path.join(sourceDir, "report.json");
const runName = process.argv[2] || "runtime-20";
assert.match(runName, /^runtime-\d{2}$/);
const out = path.join(qaRoot, runName);
assert(!fs.existsSync(out), `Refuse to reuse existing QA directory: ${out}`);
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(out, "temporary"));
fs.mkdirSync(path.join(out, "webview"));

const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const save = value => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(value, null, 2));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {
  status: "RUNNING",
  scope: "ACTUAL_1_9_28_WINDOWS_NSIS_INSTALL_PLAYER_SAVE_UNINSTALL_SMOKE",
  startedAt: new Date().toISOString(),
  source: { path: reportPath, sha256: sha(reportPath) },
  checks: [],
  launches: [],
  artifacts: [],
  errors: [],
  cleanup: [],
  notRun: ["credible old-game upgrade", "Android", "final user project"],
};

let player;
let browser;
let page;

async function check(name, fn) {
  const row = { name, status: "RUNNING", startedAt: new Date().toISOString() };
  report.checks.push(row);
  save(report);
  console.log(`START ${name}`);
  try {
    row.result = await fn();
    row.status = "PASS";
  } catch (error) {
    row.status = "FAILED";
    row.error = String(error.stack || error);
    report.errors.push(row.error);
    throw error;
  } finally {
    row.finishedAt = new Date().toISOString();
    save(report);
    console.log(`${row.status} ${name}`);
  }
}

function run(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: options.cwd || out,
    env: { ...process.env, ...options.env },
    windowsHide: true,
    encoding: "utf8",
    timeout: options.timeout || 180000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(file)} exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return { stdout: result.stdout || "", stderr: result.stderr || "", status: result.status };
}

async function freePort() {
  const net = require("node:net");
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForPort(port) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(700),
      });
      if (response.ok) return;
    } catch {}
    await pause(200);
  }
  throw new Error(`WebView CDP port did not become ready: ${port}`);
}

async function waitForPlayerPage(targetBrowser) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const candidate = targetBrowser.contexts().flatMap(context => context.pages())
      .find(current => current.url().includes("tauri.localhost"));
    if (candidate) return candidate;
    await pause(200);
  }
  const pages = targetBrowser.contexts().flatMap(context => context.pages())
    .map(current => current.url());
  throw new Error(`Installed Player document was not found; observed pages: ${JSON.stringify(pages)}`);
}

async function waitForMissing(file) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (!fs.existsSync(file)) return;
    await pause(250);
  }
  throw new Error(`File remained after bounded uninstall wait: ${file}`);
}

async function ready(screen) {
  await page.waitForFunction(expected => {
    const node = document.querySelector("[data-runtime-screen-transition]");
    return node?.getAttribute("data-runtime-presented-screen") === expected
      && node.getAttribute("data-runtime-screen-transition") === "idle";
  }, screen);
}

async function startPlayer(exe, installRoot) {
  const port = await freePort();
  const env = {
    ...process.env,
    TEMP: path.join(out, "temporary"),
    TMP: path.join(out, "temporary"),
    WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`,
  };
  const logPath = path.join(out, `player-${report.launches.length + 1}.log`);
  const fd = fs.openSync(logPath, "w");
  player = spawn(exe, [], { cwd: installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd] });
  fs.closeSync(fd);
  report.launches.push({
    pid: player.pid,
    port,
    executable: exe,
    executableSha256: sha(exe),
    installRoot,
    log: logPath,
  });
  await waitForPort(port);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await waitForPlayerPage(browser);
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => report.errors.push(String(error)));
  await page.getByTestId("game-state-title").waitFor();
  await ready("title_menu");
  return { port };
}

async function stopPlayer() {
  if (browser) await browser.close().catch(() => {});
  browser = undefined;
  page = undefined;
  if (player && player.exitCode === null) {
    player.kill();
    await new Promise(resolve => player.once("close", resolve));
  }
  if (player) report.cleanup.push({ pid: player.pid, exitCode: player.exitCode, method: "scoped-test-cleanup" });
  player = undefined;
}

async function saveManual() {
  if (await page.getByTestId("quick-menu-toggle").count()) {
    const toggle = page.getByTestId("quick-menu-toggle");
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    await page.getByRole("button", { name: "打开存档读档", exact: true }).click();
  } else {
    await page.getByTestId("open-save-load").click();
  }
  await ready("save_load");
  await page.getByRole("tab", { name: "手动", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
  await page.waitForFunction(() => document.querySelector(".save-operation-status")?.classList.contains("is-saved"));
}

async function main() {
  save(report);
  const source = read(reportPath);
  assert.equal(source.status, "PASS");
  const installer = source.windowsInstaller?.path;
  const portable = source.windowsPortable?.path;
  assert(installer && portable);
  assert.equal(sha(installer), source.windowsInstaller.sha256);
  assert.equal(sha(portable), source.windowsPortable.sha256);
  report.artifacts.push(
    { kind: "installer", path: installer, sha256: sha(installer), bytes: fs.statSync(installer).size },
    { kind: "portable", path: portable, sha256: sha(portable), bytes: fs.statSync(portable).size },
  );

  const installRoot = path.join(out, "installed-client");
  const installerRun = path.join(out, "installer-run.log");
  await check("NSIS silent install into isolated directory", async () => {
    const result = spawnSync(installer, ["/S", `/D=${installRoot}`], {
      cwd: out,
      env: { ...process.env, TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary") },
      windowsHide: true,
      encoding: "utf8",
      timeout: 180000,
    });
    fs.writeFileSync(installerRun, `${result.stdout || ""}${result.stderr || ""}`);
    assert.ifError(result.error);
    assert.equal(result.status, 0);
    const exe = path.join(installRoot, "agentvn-player.exe");
    assert(fs.existsSync(exe), `Missing installed Player: ${exe}`);
    const manifest = read(path.join(installRoot, "embedded-cartridge", "manifest.json"));
    report.installation = { installRoot, executable: exe, executableSha256: sha(exe), installerRun };
    report.installation.manifest = {
      gameId: manifest.game_id,
      title: manifest.title,
      sha256: sha(path.join(installRoot, "embedded-cartridge", "manifest.json")),
    };
    return report.installation;
  });

  await check("Installed Player starts and reports EXE-side save storage", async () => {
    const exe = report.installation.executable;
    const launch = await startPlayer(exe, installRoot);
    const storage = await page.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke("get_save_storage_info", { installId: "preview_gamecli" }));
    report.launches.at(-1).storage = storage;
    assert.equal(storage.portable, true);
    const gameId = report.installation.manifest.gameId;
    assert.equal(path.resolve(storage.targetDirectory), path.join(installRoot, "saves", gameId, "preview_gamecli"));
    assert(!path.resolve(storage.targetDirectory).startsWith(path.resolve(out, "webview")));
    return { launch, storage };
  });

  await check("Actual gameplay save writes beside installed EXE and survives restart", async () => {
    await page.getByTestId("start-new-game").click();
    await ready("playing");
    await saveManual();
    const storage = report.launches.at(-1).storage;
    const saveDir = path.resolve(storage.targetDirectory);
    const saveFile = path.join(saveDir, "slot-01.json");
    assert(fs.existsSync(saveFile), `Missing EXE-side save: ${saveFile}`);
    const saved = read(saveFile);
    assert.equal(saved.install_id, "preview_gamecli");
    assert.equal(saved.game_id, report.installation.manifest.gameId);
    report.save = { path: saveFile, sha256: sha(saveFile), bytes: fs.statSync(saveFile).size, saved };
    await stopPlayer();
    await startPlayer(report.installation.executable, installRoot);
    const afterRestart = fs.readFileSync(saveFile);
    assert.equal(sha(saveFile), report.save.sha256);
    return { saveDir, sha256: sha(saveFile), bytes: afterRestart.length };
  });

  await check("Uninstall removes installed program while retaining isolated saves", async () => {
    await stopPlayer();
    const uninstaller = path.join(installRoot, "uninstall.exe");
    assert(fs.existsSync(uninstaller), "Missing installed uninstaller");
    const result = run(uninstaller, ["/S"]);
    assert.equal(result.status, 0);
    await waitForMissing(path.join(installRoot, "agentvn-player.exe"));
    assert(fs.existsSync(report.save.path), "Uninstall removed the EXE-side save");
    report.uninstallation = { uninstaller, status: result.status, saveRetained: true };
    return report.uninstallation;
  });

  report.status = "PASS";
}

main().catch(async error => {
  report.status = "FAILED";
  report.error = String(error.stack || error);
  await stopPlayer().catch(cleanupError => report.errors.push(String(cleanupError.stack || cleanupError)));
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  save(report);
  console.log(JSON.stringify({ status: report.status, out }, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
});
