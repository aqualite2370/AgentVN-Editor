"use strict";
// Native renderer/refusal supplement, not a fresh installation or an Editor GUI export.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const assert = require("node:assert/strict"), { createRequire } = require("node:module");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { processIdentity, pause } = require("./lib/installed-runtime-session.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Layout-Opacity-Split-20261020-01";
const mode = process.argv[2], iteration = process.argv[3] || "01";
assert(["prepare", "old", "current"].includes(mode)); assert(/^\d{2}$/.test(iteration));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size,
  generatedAt: fs.statSync(file).mtime.toISOString() });
const prepFile = path.join(qa, "native-artifacts.json");
async function prepare() {
  assert(!fs.existsSync(prepFile));
  const req = createRequire(path.join(root, "editor/package.json")), m = { exports: {} };
  new Function("module", "exports", "require", req("esbuild").buildSync({
    stdin: { resolveDir: root, loader: "ts", contents: `
      export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";
      export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";
      export { exportEditorCartridge } from "./editor/src/cartridge/exportCartridge";
    ` }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  }).outputFiles[0].text)(m, m.exports, req);
  const artifacts = [];
  for (const type of ["control", "agentvn", "renpy"]) {
    const skin = type === "renpy" ? m.exports.createRenpyUILayout() : m.exports.getDefaultUISkinLayout();
    if (type !== "control") for (const screen of skin.screens) for (const component of screen.components) {
      if (["main_menu_hero", "settings_group", "save_slot_grid", "history_list", "about_panel", "help_panel", "gallery_grid"].includes(component.component_type))
        component.style = { ...component.style, backgroundColor: "#24384c", backgroundOpacity: .4, contentOpacity: .7 };
    }
    const title = `透明度分层 ${type} 原生隔离`;
    const result = await m.exports.exportEditorCartridge({
      gameId: `qa-native-opacity-${type}`, title, author: "QA", uiSkin: skin, projectAssets: [], projectAssetRefs: [],
      script: { schema_version: "1.1.0", game_id: `qa-native-opacity-${type}`, title,
        entry_scene_id: "qa", characters: [], scenes: [{ scene_id: "qa", title: "隔离", chapter: 1, tags: [],
          commands: [{ type: "narration", text: "OPACITY_NATIVE_CONTROL：真实旧程序支持此对照。" }] }] },
    });
    assert.deepEqual(result.errors, []);
    const target = path.join(qa, `native-${type}.vncart`);
    fs.writeFileSync(target, Buffer.from(await result.blob.arrayBuffer()), { flag: "wx" });
    const zip = await req("jszip").loadAsync(fs.readFileSync(target));
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    if (type !== "control") assert.equal(manifest.runtime_version, "0.23.0");
    artifacts.push({ type, title, ...desc(target), manifest });
  }
  const old = desc("F:/AgentVN/Checkpoints/Layout-Opacity-Split-20261020-01/runtime-0.22-player.exe");
  assert.equal(old.sha256, "aea59161fda6279d5a494bcb6a2936b9f20b79c1324e7d9e2c94227dc63cdc1e");
  fs.writeFileSync(prepFile, JSON.stringify({ status: "PASS", at: new Date().toISOString(),
    scope: "Controlled cartridges produced by the current real export API, not a GUI export", old, artifacts }, null, 2), { flag: "wx" });
  console.log(`PASS prepare ${artifacts.length} real cartridge ZIPs`);
}
async function run() {
  const prep = read(prepFile), out = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/opacity-${mode}-${iteration}`;
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const executable = mode === "old" ? prep.old : desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
  assert.equal(sha(executable.path), executable.sha256);
  const report = { status: "RUNNING", at: new Date().toISOString(), executable,
    scope: mode === "old" ? "REAL_SAVED_0_22_BINARY_REFUSAL_NOT_REBUILT_OLD_VERSION" : "CURRENT_NATIVE_PLAYER_NOT_INSTALLED_RELEASE",
    cases: [], launches: [], modelRequests: 0, cleanupError: null,
    testSha256: sha(__filename),
    input: "Controlled real API ZIPs; fixed-mode native launch; WebView CDP input, not Computer Use" };
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  const profileScript = path.join(root, "scripts/native-dev-preview-profile.ps1");
  function profiles(action) {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      profileScript, "-Action", action, "-RunDirectory", out], { cwd: root, windowsHide: true, encoding: "utf8", timeout: 120000 });
    assert.equal(r.status, 0, `${action}: ${r.stdout}\n${r.stderr}`); return r.stdout;
  }
  let protectedProfile = false;
  try {
    protectedProfile = true; report.profilePreparation = profiles("Prepare"); save();
    for (const artifact of prep.artifacts.filter(a => mode === "old" || a.type !== "control")) {
      assert.equal(sha(artifact.path), artifact.sha256);
      const item = { type: artifact.type, artifact, status: "RUNNING" }; report.cases.push(item); save();
      const port = await new Promise(resolve => {
        const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
      });
      const profile = path.join(out, `webview-${artifact.type}`);
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(key)) delete env[key];
      Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: profile,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` });
      const logFile = path.join(out, `${artifact.type}.log`), fd = fs.openSync(logFile, "wx");
      const child = spawn(executable.path, ["--mode", "fixed", "--cartridge", artifact.path], {
        cwd: path.dirname(executable.path), windowsHide: true, env, stdio: ["ignore", fd, fd] });
      fs.closeSync(fd); let browser, identity, page;
      const launch = { pid: child.pid, port, profile, logFile, executable, args: ["--mode", "fixed", "--cartridge", artifact.path] };
      report.launches.push(launch); save();
      try {
        identity = processIdentity(child.pid); assert(identity);
        assert.equal(path.resolve(identity.ExecutablePath).toLowerCase(), executable.path.toLowerCase()); launch.identity = identity;
        let online = false; const deadline = Date.now() + 45000;
        while (Date.now() < deadline) {
          assert.equal(child.exitCode, null);
          try { online = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
          if (online) break; await pause(100);
        }
        assert(online);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const context = browser.contexts()[0]; page = context.pages()[0] || await context.waitForEvent("page");
        await page.waitForURL(url => url.hostname === "tauri.localhost" || url.protocol === "tauri:");
        page.setDefaultTimeout(20000);
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
        if (mode === "old" && artifact.type !== "control") {
          // The saved 0.22 implementation validates ui/layout.json before its
          // manifest compatibility prompt. Its explicit field refusal satisfies
          // "do not silently ignore"; it is NOT evidence of a 0.23 version prompt.
          const fieldRefusal = process.argv.includes("--schema-refusal");
          const alert = page.getByRole("alert").filter({ hasText: fieldRefusal
            ? "界面样式字段不支持（backgroundOpacity）" : "卡带要求 0.23.0" });
          await alert.waitFor();
          item.message = await alert.innerText();
          if (fieldRefusal) {
            assert.match(item.message, /界面样式字段不支持（backgroundOpacity）/);
            assert.match(item.message, /界面样式字段不支持（contentOpacity）/);
            item.refusalStage = "LEGACY_STYLE_VALIDATION_BEFORE_VERSION_PROMPT";
            item.minimumVersionPrompt = "NOT_REACHED_NOT_PASS";
          } else {
            assert.match(item.message, /当前.*0\.22\.0/);
            item.refusalStage = "MINIMUM_RUNTIME_VERSION";
          }
          assert(!/Unrecognized key|ui_layout_version|Invalid literal/.test(item.message));
          assert.equal(await page.getByTestId("game-state-playing").count(), 0);
          assert(!await page.getByTestId("start-new-game").isEnabled().catch(() => false));
          item.refusedBeforePlay = true;
        } else {
          await page.getByTestId("game-state-title").waitFor(); await settleRuntime(page);
          if (artifact.type === "control") {
            await page.getByTestId("start-new-game").click(); await settleRuntime(page);
            await page.getByText("OPACITY_NATIVE_CONTROL：真实旧程序支持此对照。", { exact: true }).waitFor();
            item.controlPlayed = true;
          } else {
            item.title = await page.locator(".main-menu-title-hero-background").evaluate(n => {
              const root = n.closest(".main-menu, .renpy-title-view");
              return { background: Number(getComputedStyle(n).opacity),
                navigation: Number(getComputedStyle(root.querySelector('[data-testid="main-menu-actions"]')).opacity) };
            });
            assert.equal(item.title.background, .4); assert.equal(item.title.navigation, .7);
            await page.getByTestId("open-settings").click(); await settleRuntime(page);
            item.settings = await page.locator(".settings-renpy").evaluate(n => ({
              background: Number(getComputedStyle(n.querySelector("[data-ui-opacity-layer=background]")).opacity),
              content: Number(getComputedStyle(n.querySelector("[data-ui-opacity-layer=content]")).opacity),
              tabs: n.querySelectorAll(".settings-tabs button").length,
            }));
            assert.deepEqual(item.settings, { background: .4, content: .7, tabs: 5 });
            await page.locator(".settings-tabs").getByRole("button", { name: "音频", exact: true }).click();
            await page.locator('[data-settings-tab-current="audio"]').waitFor();
            await page.waitForFunction(() =>
              document.querySelector(".settings-content")?.getAttribute("data-settings-transition") === "idle");
            await settleRuntime(page);
            item.categoryFinal = await page.locator(".settings-content").evaluate(n => ({
              transition: n.getAttribute("data-settings-transition"),
              activeCategories: n.querySelectorAll("[data-settings-tab-current=audio]").length,
              snapshots: n.querySelectorAll("[data-runtime-transition-snapshot]").length,
              opacity: Number(getComputedStyle(n.querySelector("[data-settings-tab-current=audio]")).opacity),
            }));
            assert.deepEqual(item.categoryFinal, { transition: "idle", activeCategories: 1, snapshots: 0, opacity: 1 });
            item.realCategoryClick = true;
          }
        }
        const file = path.join(out, `${artifact.type}.png`);
        const before = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
        const bytes = Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64");
        const after = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
        assert.deepEqual(before, after); assert(Math.abs(before.dpr - 1) < 1e-6);
        assert.equal(before.width, 1920); assert.equal(before.height, 1080);
        assert.equal(bytes.readUInt32BE(16), 1920); assert.equal(bytes.readUInt32BE(20), 1080);
        fs.writeFileSync(file, bytes, { flag: "wx" }); item.screenshot = { ...desc(file), before, after };
        item.status = "PASS";
      } catch (error) {
        item.body = await page?.locator("body").innerText().catch(() => "");
        item.error = String(error.stack || error); item.status = "FAILED";
        throw error;
      } finally {
        await browser?.close().catch(() => {});
        if (child.exitCode === null && child.signalCode === null) {
          assert.deepEqual(processIdentity(child.pid), identity);
          const killed = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
          assert.equal(killed.status, 0); launch.termination = "OWNED_PROCESS_TREE_NOT_NORMAL_WINDOW_CLOSE";
        }
        const until = Date.now() + 10000; let online = true;
        while (Date.now() < until) {
          try { online = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(300) })).ok; } catch { online = false; }
          if (!online && !processIdentity(child.pid)) break; await pause(100);
        }
        assert(!online && !processIdentity(child.pid)); launch.cleanup = "PASS"; save();
      }
      console.log(`PASS ${mode}: ${artifact.type}`);
    }
    assert.equal(report.cases.length, mode === "old" ? 3 : 2);
    assert(report.cases.every(c => c.status === "PASS")); report.status = "PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    const pending = report.cases.at(-1); if (pending?.status === "RUNNING") pending.status = "FAILED";
  } finally {
    if (protectedProfile && fs.existsSync(path.join(out, "profile-protection.json"))) try {
      report.profileRestoration = profiles("Restore");
      assert.equal(read(path.join(out, "profile-restoration.json")).status, "PASS");
    } catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
  }
}
(mode === "prepare" ? prepare() : run()).catch(e => { console.error(e); process.exitCode = 1; });
