"use strict";
// Replay the retained paid result byte-for-byte. No generation or store injection.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const net = require("node:net"), assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip"), { chromium } = require("../editor/node_modules/playwright");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const { rows, ps, until, listeners } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { readInstalledViewport, captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const base = path.resolve("F:/AgentVN/QA/Original-Component-Replay-20261103-01");
const old = path.resolve("F:/AgentVN/QA/Installed-Real-Component-20261031-01");
const run = process.argv[2], receipt = path.resolve(process.argv[3]
  || "F:/AgentVN/QA/Novel-Branch-Completion-20261103-01/installation-01/installation.json");
assert.match(run || "", /^\d{2}$/);
const out = path.join(base, `installed-${run}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const desc = file => ({ path: path.resolve(file), sha256: sha(fs.readFileSync(file)), bytes: fs.statSync(file).size });
const input = path.join(old, "new-component-agent-01/qa-installed-real-component-20261031-01-0.1.0.vncart");
assert.equal(desc(input).sha256, "8a4d33b1a3e641b7a2f258f4408aba9088741cc8965a9b8d3a050ec36c5a8f04");
const installed = verifiedInstalledCandidate(receipt);
const exe = installed.resources.find(resource => /agentvn-player\.exe$/i.test(resource.path)); assert(exe);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "EXACT_HISTORICAL_PAID_COMPONENT_CURRENT_INSTALLED_PLAYER_PUBLIC_PREVIEW",
  installation: installed, receipt: desc(receipt), executable: exe, cartridge: desc(input),
  prior: ["independent-audit-06.json", "new-component-agent-overlap-01/report.json",
    "new-component-agent-01/report.json"].map(file => desc(path.join(old, file))),
  tools: [__filename, path.join(__dirname, "lib/current-native-capture.cjs")].map(desc),
  productChanges: 0, productBuilds: 0, modelRequests: 0, paidRequests: 0,
  physical4KClaimed: false, standaloneSetupClaimed: false, normalCloseClaimed: false,
  cases: [], matrix: [], screenshots: [], errors: [], known: [], cleanup: "NOT_RUN" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let child, browser, page, cdp, identity, port, expected;
const known = new Map(), key = p => `${p.ProcessId}:${p.Created}`;
function remember() {
  if (child) for (const item of ownedProcessTree(rows(), child.pid, identity?.Created)) {
    if (item.ProcessId === child.pid) identity ??= item;
    known.set(key(item), item);
  }
  report.known = [...known.values()]; save();
}
async function ready(screen) {
  await page.waitForFunction(screen => {
    const root = document.querySelector("[data-runtime-screen-transition]");
    return root?.getAttribute("data-runtime-presented-screen") === screen
      && root.getAttribute("data-runtime-screen-transition") === "idle";
  }, screen);
  await settleRuntime(page);
}
async function viewport(value) {
  expected = value;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: value.width, height: value.height,
    deviceScaleFactor: value.dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: value.reduced ? "reduce" : "no-preference" });
  await settleRuntime(page);
  return readInstalledViewport(page, value);
}
async function step(name, fn, required = false) {
  const item = { name, status: "RUNNING" }; report.cases.push(item); save();
  console.log("START " + name);
  try { item.detail = await fn(); item.status = "PASS"; console.log("PASS " + name); }
  catch (error) {
    item.status = "FAILED"; item.error = String(error.stack || error); console.log("FAILED " + name);
    if (required) throw error;
  } finally { save(); }
}
async function overlay() {
  return page.evaluate(() => {
    const layers = [...document.querySelectorAll('[data-testid="runtime-custom-component"]')];
    const nav = document.querySelector('[data-testid="main-menu-actions"]');
    if (layers.length !== 1 || !nav) throw Error("Expected exact retained component and menu");
    const component = layers[0], rect = node => node.getBoundingClientRect().toJSON();
    const componentRect = rect(component);
    const intersect = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const controls = [...nav.querySelectorAll("button")].map(button => {
      const chars = [], walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT); let node;
      while ((node = walker.nextNode())) for (let i = 0; i < node.textContent.length; i++) {
        if (!node.textContent[i].trim()) continue;
        const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
        for (const box of range.getClientRects()) {
          const r = box.toJSON(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          chars.push({ character: node.textContent[i], rect: r, overlapArea: intersect(r, componentRect),
            ownsPoint: hit === button || button.contains(hit),
            componentOwnsPoint: hit === component || component.contains(hit) });
        }
      }
      const box = rect(button), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { id: button.dataset.testid, text: button.textContent, rect: box, characters: chars,
        disabled: button.disabled, centerHit: hit === button || button.contains(hit),
        blockedCharacters: chars.filter(c => !c.ownsPoint), overlapCharacters: chars.filter(c => c.overlapArea > 0) };
    });
    return { componentId: component.dataset.componentId, componentRect, navRect: rect(nav), controls,
      componentOverflow: { x: component.scrollWidth - component.clientWidth, y: component.scrollHeight - component.clientHeight },
      overflow: document.documentElement.scrollWidth - innerWidth,
      viewport: { width: innerWidth, height: innerHeight } };
  });
}
async function checkImage() {
  const image = page.getByTestId("runtime-custom-component").getByRole("img", { name: "创作徽章", exact: true });
  await image.evaluate(img => img.decode());
  const evidence = await image.evaluate(img => ({ width: img.naturalWidth, height: img.naturalHeight,
    complete: img.complete, asset: img.dataset.assetId, source: img.currentSrc }));
  assert(evidence.complete && evidence.width === 1 && evidence.height === 1);
  const bytes = await page.evaluate(async () => {
    const image = document.querySelector('[data-testid="runtime-custom-component"] img');
    const response = await fetch(image.currentSrc); if (!response.ok) throw Error("Image fetch failed");
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  });
  const actual = Buffer.from(bytes);
  assert.equal(sha(actual), "31debdf420bfe10225d7ff5b26c10266111d1959d0be97fcfcfca9a33e09f245");
  return { ...evidence, resourceBytes: actual.length, resourceSha256: sha(actual) };
}
(async () => {
  save();
  try {
    await step("original-cartridge-resource-and-installed-native-launch", async () => {
      const zip = await JSZip.loadAsync(fs.readFileSync(input), { checkCRC32: true });
      const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
      const custom = layout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component");
      assert.equal(custom.length, 1); assert.equal(custom[0].label, "创作关于卡");
      assert.deepEqual(custom[0].rect, { x: 8, y: 10, width: 20, height: 30 });
      report.originalComponent = custom[0]; report.layoutSha256 = sha(await zip.file("ui/layout.json").async("nodebuffer"));
      assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)),
        "Do not share a user Player or Editor");
      port = await new Promise((resolve, reject) => { const server = net.createServer();
        server.once("error", reject); server.listen(0, "127.0.0.1", () => {
          const value = server.address().port; server.close(error => error ? reject(error) : resolve(value));
        }); });
      assert.equal(listeners([port]).length, 0);
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$)/i.test(k)) delete env[k];
      const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
      Object.assign(env, { TEMP: temporary, TMP: temporary, WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` });
      const args = ["--mode", "preview", "--cartridge", input], log = fs.openSync(path.join(out, "player.log"), "wx");
      child = spawn(exe.path, args, { cwd: out, env, windowsHide: true, stdio: ["ignore", log, log] }); fs.closeSync(log);
      await until(() => { remember(); return identity; }, "exact installed Player process identity");
      assert.equal(path.resolve(identity.ExecutablePath).toLowerCase(), path.resolve(exe.path).toLowerCase());
      report.launch = { identity, args, port, webview: env.WEBVIEW2_USER_DATA_FOLDER }; save();
      await until(async () => {
        assert.equal(child.exitCode, null); remember();
        try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; }
        catch { return false; }
      }, "owned installed Player CDP", 45000);
      const sockets = listeners([port]); assert.equal(sockets.length, 1);
      assert(known.has(key([...known.values()].find(p => p.ProcessId === sockets[0].OwningProcess))));
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost/.test(p.url())),
        "installed Runtime document");
      page.setDefaultTimeout(20000); page.on("pageerror", error => { report.errors.push(String(error)); save(); });
      cdp = await page.context().newCDPSession(page);
      await viewport({ width: 1920, height: 1080, dpr: 1, reduced: false }); await ready("title_menu");
      const diagnostics = await browser.newBrowserCDPSession();
      const { gpu } = await diagnostics.send("SystemInfo.getInfo"); await diagnostics.detach();
      report.renderer = { features: gpu.featureStatus, devices: gpu.devices, renderer: gpu.auxAttributes.glRenderer };
      report.image = await checkImage();
      return { noInjectedStore: true, originalBytesAndCoordinatesPreserved: true, actualInstalledPlayer: true };
    }, true);
    await step("actual-game-start-and-menu-entry", async () => {
      await page.getByTestId("start-new-game").click(); await ready("playing");
      await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
      assert.match(await page.locator(".dialog-box").innerText(), /本轮独立 UI 验收/);
      await page.keyboard.press("Escape"); await ready("main_menu");
      return { realStartAndEscape: true, continuedRunMakesSeventhMenuActionVisible: true };
    }, true);
    await step("twelve-display-cells-per-character-menu-hit-and-overlap", async () => {
      for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const cell = { width, height: width * 9 / 16, dpr, reduced };
        const actual = await viewport(cell); await ready("main_menu");
        const evidence = await overlay();
        assert.equal(evidence.controls.length, 7);
        const focus = [];
        for (const control of evidence.controls) {
          const button = page.getByTestId(control.id); await button.focus();
          focus.push({ id: control.id, owned: await button.evaluate(n => n === document.activeElement) });
        }
        const componentButton = page.getByRole("button", { name: "组件打开关于", exact: true });
        await componentButton.focus();
        focus.push({ id: "component-open-about", owned: await componentButton.evaluate(n => n === document.activeElement) });
        const r = evidence.componentRect;
        const bad = evidence.controls.some(c => !c.characters.length || c.disabled || !c.centerHit
          || c.blockedCharacters.length || c.overlapCharacters.length || c.rect.left < 0 || c.rect.top < 0
          || c.rect.right > width + 1 || c.rect.bottom > cell.height + 1);
        const pass = !bad && focus.every(item => item.owned) && evidence.overflow <= 1
          && evidence.componentOverflow.x <= 1 && evidence.componentOverflow.y <= 1
          && r.left >= 0 && r.top >= 0 && r.right <= width + 1 && r.bottom <= cell.height + 1;
        report.screenshots.push(await captureInstalledWebview(page, cdp,
          path.join(out, `menu-${width}-${dpr}-${reduced ? "reduced" : "normal"}.png`), expected)); save();
        await componentButton.click(); await ready("about");
        await page.keyboard.press("Escape"); await ready("main_menu");
        await page.getByTestId("open-settings").click(); await ready("settings");
        await page.keyboard.press("Escape"); await ready("main_menu");
        report.matrix.push({ ...cell, actual, overlay: evidence, focus, componentAction: true, settingsAction: true,
          status: pass ? "PASS" : "FAILED_MENU_OCCLUSION" }); save();
        console.log(`${pass ? "PASS" : "FAILED"} ${width}/${dpr}/${reduced}`);
      }
      assert.equal(report.matrix.length, 12); assert(report.matrix.every(item => item.status === "PASS"), "Original component occludes menu");
      return { combinations: 12, characterHitAndGeometry: true };
    });
    await step("original-component-about-and-native-page-navigation", async () => {
      const navigations = [];
      await viewport({ width: 1920, height: 1080, dpr: 1, reduced: false });
      for (const [control, screen] of [
        ["component", "about"], ["open-settings", "settings"], ["open-save-load", "save_load"],
        ["open-about", "about"], ["open-help", "help"],
      ]) {
        const button = control === "component" ? page.getByRole("button", { name: "组件打开关于", exact: true })
          : page.getByTestId(control);
        await button.click(); await ready(screen); await page.keyboard.press("Escape"); await ready("main_menu");
        navigations.push({ control, screen, returned: true });
      }
      await page.getByTestId("continue-game").click(); await ready("playing");
      assert.match(await page.locator(".dialog-box").innerText(), /本轮独立 UI 验收/);
      return { navigations, actualResume: true, modelRequests: 0 };
    });
    assert.deepEqual(report.errors, []);
    report.status = report.cases.every(item => item.status === "PASS") ? "PASS" : "FAILED";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); }
  finally {
    try {
      remember(); await browser?.close().catch(() => {});
      for (const item of [...known.values()].reverse()) stopOwnedProcess(item, ps);
      await until(() => !rows().some(p => known.has(key(p))) && (!port || !listeners([port]).length), "owned Player cleanup", 15000);
      assert.equal(desc(input).sha256, report.cartridge.sha256);
      verifiedInstalledCandidate(receipt);
      report.cleanup = "PASS"; report.cleanupMethod = "EXACT_OWNED_TERMINATION_NOT_NORMAL_CLOSE";
    } catch (error) { report.cleanup = "FAILED"; report.cleanupError = String(error.stack || error); report.status = "FAILED"; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, matrix: report.matrix.length,
      failedCells: report.matrix.filter(c => c.status !== "PASS").length, cleanup: report.cleanup, out }));
    process.exitCode = report.status === "PASS" ? 0 : 1;
  }
})();
