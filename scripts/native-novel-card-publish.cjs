"use strict";
// Real native Dev public UI; no model provider, frontend state writes or product mocks.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { nativeSession, until } = require("./lib/current-native-editor-session.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const A = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), label = "Native-Novel-Card-Publish-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/native-novel-card-publish-20261020-01");
const load = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(root, f), sha256: sha(path.resolve(root, f)),
  modifiedAt: fs.statSync(path.resolve(root, f)).mtime.toISOString() });
const sources = ["editor/src/components/novel-import/NovelTaskCard.tsx",
  "editor/src/components/novel-import/novel-task-floating.css", "editor/src/components/novel-import/novelTaskMotion.ts",
  "editor/src/cartridge/ExportCartridgePanel.tsx", "editor/src/novel-import/novelCardPosition.ts",
  "scripts/lib/current-native-editor-session.cjs"];
const products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
  "editor/src-tauri/binaries/agentvn-player.exe"];
function prepare() {
  for (const dir of [qa, checkpoint, summary]) { assert(!fs.existsSync(dir)); fs.mkdirSync(dir, { recursive: true }); }
  const priorPath = "F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-01/novel-consume-03/report.json", prior = load(priorPath);
  assert.equal(prior.status, "CURRENT_NATIVE_NOVEL_EXPORT_PLAYER_PASS_WITH_TASK_CARD_OVERLAP");
  const inputs = prior.projects.map(p => {
    const old = prior.inputs.find(i => i.kind === p.kind), input = path.join(checkpoint, `${p.kind}.vnproj`);
    assert.equal(sha(p.connectedBundle.path), p.connectedBundle.sha256);
    fs.copyFileSync(p.connectedBundle.path, input, fs.constants.COPYFILE_EXCL);
    return { kind: p.kind, id: p.id, title: old.title, input: desc(input), original: p.connectedBundle };
  });
  const snapshots = [];
  for (const f of [...sources, __filename, "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
    const original = path.resolve(root, f), target = path.join(checkpoint, path.relative(root, original));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(original, target, fs.constants.COPYFILE_EXCL); snapshots.push(desc(target));
  }
  fs.writeFileSync(path.join(summary, "preparation.json"), JSON.stringify({
    at: new Date().toISOString(), prior: desc(priorPath), inputs, snapshots, products: products.map(desc),
  }, null, 2), { flag: "wx" });
  console.log(`PREPARED ${checkpoint}`);
}
async function run(iteration) {
  assert(/^\d{2}$/.test(iteration));
  const out = path.join(qa, `session-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const prep = load(path.join(summary, "preparation.json"));
  const r = { status: "RUNNING", at: new Date().toISOString(), products: products.map(desc), sources: sources.map(desc),
    inputs: prep.inputs, cases: [], matrix: [], launches: [], cleanups: [], screenshots: [], errors: [], requests: [],
    modelRequests: 0, realModelRequests: 0, scope: "CURRENT_NATIVE_DEV_CARD_PUBLISH_NOT_RELEASE_OR_PHYSICAL_INPUT",
    boundaries: ["Public import setup, not native picker", "Native source Python/Vite, not packaged Release",
      "Explicit DB/WebView/TEMP isolation", "CDP input/viewport simulation, not physical 4K/input",
      "Exact-owned forced cleanup, not normal close", "No novel generation/model calls"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const session = nativeSession({ out, input: prep.inputs[0].input.path, report: r, save });
  let page;
  const cardSelector = '[data-testid="novel-task-mini-entry"]';
  const card = () => page.getByTestId("novel-task-mini-entry");
  const dock = () => page.locator(".toolbar-popover.cartridge:not([inert]) .package-build-dock");
  async function settle() {
    await A.settleEditor(page);
    await page.evaluate(() => { window.__cardPublishSettled = { value: "", count: 0 }; });
    await page.waitForFunction(sel => {
      const n = document.querySelector(sel);
      const dock = document.querySelector(".toolbar-popover.cartridge:not([inert]) .package-build-dock");
      const owners = [n, dock, dock?.closest(".toolbar-popover")].filter(Boolean);
      const value = JSON.stringify(owners.map(owner => owner.getBoundingClientRect().toJSON()));
      const settled = window.__cardPublishSettled;
      settled.count = settled.value === value ? settled.count + 1 : 0; settled.value = value;
      return n?.getAttribute("data-ready") === "true"
        && n.getAttribute("data-position-persistence") === "saved"
        && owners.every(owner => owner.getAnimations().every(a =>
          a.effect?.getComputedTiming().iterations === Infinity || (a.playState !== "running" && !a.pending)))
        && settled.count >= 3;
    }, cardSelector);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function geometry() {
    return page.evaluate(sel => {
      const card = document.querySelector(sel), dock = document.querySelector(".toolbar-popover.cartridge:not([inert]) .package-build-dock");
      const target = document.querySelector('[data-help-key="package.export"]');
      const c = card.getBoundingClientRect(), d = dock?.getBoundingClientRect(), b = target?.getBoundingClientRect();
      const h = b && document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { card: c.toJSON(), dock: d?.toJSON(), button: b?.toJSON(),
        overlap: !!d && c.left < d.right && c.right > d.left && c.top < d.bottom && c.bottom > d.top,
        hit: !!target && (h === target || target.contains(h)),
        hitClass: h?.className, overflow: document.documentElement.scrollWidth - innerWidth,
        position: localStorage.getItem(`agentvn.novelTask.position.${encodeURIComponent(card.dataset.projectId)}`),
        actual: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
          reduced: matchMedia("(prefers-reduced-motion: reduce)").matches } };
    }, cardSelector);
  }
  function safe(g) {
    assert(g.dock && g.button, "Live publish controls missing");
    assert(!g.overlap && g.card.bottom <= g.dock.top - 11, "Task card overlaps live publish dock");
    assert(g.hit && g.overflow <= 1, "Publish export must be truly hit-testable without moving the task card");
    assert(g.card.x >= 12 && g.card.y >= 12 && g.card.right <= g.actual.width - 11
      && g.card.bottom <= g.actual.height - 11, "Task card outside viewport");
  }
  async function step(name, fn) {
    const c = { name, status: "RUNNING" }; r.cases.push(c); save(); console.log(`START ${name}`);
    try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
    finally { save(); }
  }
  async function open(item) {
    await page.reload(); await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: item.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settle();
    assert.equal(await card().getAttribute("data-project-id"), item.id);
  }
  async function publish(keyboard = false) {
    const entry = page.locator('[data-workspace-surface="publish"]:visible');
    if (keyboard) { await entry.focus(); await page.keyboard.press("Enter"); } else await entry.click();
    await A.settleEditor(page);
    // Reopened cartridge workspaces retain their public mode and correctly do
    // not rerun an irrelevant Windows environment check or open another modal.
    await page.waitForFunction(() => {
      const panel = document.querySelector(".toolbar-popover.cartridge:not([inert])");
      return panel?.querySelector(".package-workbench-title")?.textContent?.includes(".vncart")
        || panel?.querySelector(".package-primary-action")?.getAttribute("data-environment-status") === "passed"
        || Array.from(document.querySelectorAll('[role="dialog"]')).some(n => n.textContent?.includes("环境检测已完成"));
    }, null, { timeout: 60000 });
    await A.dismissEnvironmentCompletion(page); await settle();
  }
  async function closePublish(keyboard = false) {
    const close = page.locator(".toolbar-popover.cartridge:not([inert]) .package-panel-close");
    if (keyboard) { await close.focus(); await page.keyboard.press("Enter"); } else await close.click();
    await page.locator(".toolbar-popover.cartridge:not(.toolbar-popover-morph-ghost)")
      .waitFor({ state: "detached" }); await settle();
  }
  async function drag(dx, dy) {
    const grip = await card().getByRole("button", { name: "拖动小说任务卡片", exact: true }).boundingBox(); assert(grip);
    await page.mouse.move(grip.x + 32, grip.y + 14); await page.mouse.down();
    await page.mouse.move(grip.x + 32 + dx, grip.y + 14 + dy, { steps: 12 }); await page.mouse.up(); await settle();
    assert.equal(await page.getByTestId("novel-task-workbench").count(), 0, "Drag must not open panel");
  }
  async function armFrames() {
    await page.evaluate(sel => {
      const state = window.__cardPublishFrames = { frames: [], active: true };
      const frame = time => {
        if (!state.active) return;
        const card = document.querySelector(sel), dock = document.querySelector(".toolbar-popover.cartridge:not([inert]) .package-build-dock");
        state.frames.push({ time, card: card?.getBoundingClientRect().toJSON(), dock: dock?.getBoundingClientRect().toJSON(),
          animations: card?.getAnimations().map(a => ({ time: a.currentTime, state: a.playState,
            duration: a.effect?.getTiming().duration })) ?? [] });
        requestAnimationFrame(frame);
      }; requestAnimationFrame(frame);
    }, cardSelector);
  }
  async function endFrames() {
    return page.evaluate(() => { window.__cardPublishFrames.active = false; return window.__cardPublishFrames.frames; });
  }
  try {
    for (const f of prep.inputs.flatMap(i => [i.input, i.original])) assert.equal(sha(f.path), f.sha256);
    page = await session.start();
    page.on("request", req => {
      if (req.method() === "POST" && /\/api\/(novel|assistant)/.test(req.url())) {
        r.requests.push({ path: new URL(req.url()).pathname }); r.modelRequests++; save();
      }
    });
    for (const item of prep.inputs) {
      const res = await fetch(`http://127.0.0.1:${session.current.ports[0]}/api/project/projects/import`, {
        method: "POST", headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": `${item.kind}.vnproj` },
        body: fs.readFileSync(item.input.path), signal: AbortSignal.timeout(30000) });
      assert(res.ok && (await res.json()).ok);
    }
    await open(prep.inputs[0]);
    if (process.argv.includes("--position-probe")) {
      await publish(); await closePublish();
      await drag(-130, -55);
      r.status = "POSITION_PROBE_NO_ERROR";
      return;
    }
    await step("default-completed-card-does-not-block-real-publish", async () => {
      await publish(); const g = await geometry(); r.baseline = g; save(); await session.shot("publish-baseline"); safe(g);
      await page.locator('[data-help-key="package.mode"]').click();
      await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
      const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
      if (await warnings.isVisible()) await warnings.click();
      const check = page.locator('[data-help-key="package.confirmWarnings"]'); if (await check.isVisible()) await check.check();
      await settle(); safe(await geometry());
      const destination = path.join(out, "cartridge"); fs.mkdirSync(destination);
      await session.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: destination, eventsEnabled: true });
      const [download] = await Promise.all([page.waitForEvent("download"), page.locator('[data-help-key="package.export"]').click()]);
      const filename = download.suggestedFilename(); assert.equal(filename, path.basename(filename));
      const file = path.join(destination, filename);
      await until(() => fs.existsSync(file) && !fs.existsSync(`${file}.crdownload`), "actual cartridge download");
      assert.equal(await download.failure(), null);
      const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
      const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      const script = JSON.parse(await zip.file(manifest.entry_script).async("string"));
      assert.equal(manifest.game_id, prep.inputs[0].id); assert.equal(script.scenes.length, 2);
      assert(script.scenes.some(s => s.scene_id === "qa_default_scene"));
      r.cartridge = desc(file); await session.shot("export-without-card-workaround");
      return { geometry: g, cartridge: r.cartridge };
    });
    await step("publish-live-bounds-full-desktop-matrix-and-dock-toggle", async () => {
      for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const view = { width, height, dpr, reduced }, row = { ...view, status: "RUNNING" }; r.matrix.push(row); save();
        await session.metrics(view); await settle(); row.expanded = await geometry(); safe(row.expanded);
        const toggle = page.getByRole("button", { name: /^(收起|展开)$/ }).filter({ visible: true });
        const before = row.expanded.dock.height;
        await toggle.click(); await settle(); row.toggled = await geometry(); safe(row.toggled);
        assert(Math.abs(row.toggled.dock.height - before) > 10, "Dock did not actually resize");
        await toggle.click(); await settle(); row.restored = await geometry(); safe(row.restored);
        assert.equal(row.restored.position, row.expanded.position, "Automatic avoidance must not persist new position");
        if (dpr === 2 && !reduced) await session.shot(`${width}-dpr2-publish-safe`);
        row.status = "PASS"; save();
      }
      assert.equal(r.matrix.length, 12); return { matrix: r.matrix.length };
    });
    await session.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false }); await settle(); await closePublish();
    await step("custom-position-roundtrip-reload-and-project-isolation", async () => {
      await drag(-130, -55); const preferred = await geometry(); r.preferred = preferred; assert(preferred.position);
      await armFrames(); await publish(); const frames = await endFrames(), avoided = await geometry(); safe(avoided);
      assert.equal(avoided.position, preferred.position);
      assert(frames.some(f => f.animations.some(a => a.state === "running")), "Automatic avoidance must have a real transition");
      r.enterFrames = frames;
      await armFrames(); await closePublish(); r.leaveFrames = await endFrames();
      const restored = await geometry(); assert.equal(restored.position, preferred.position);
      assert(Math.abs(restored.card.x - preferred.card.x) < 1 && Math.abs(restored.card.y - preferred.card.y) < 1);
      await open(prep.inputs[1]); const other = await geometry(); assert.equal(other.position, null);
      await publish(); const otherPublish = await geometry(); safe(otherPublish); await closePublish();
      await open(prep.inputs[0]); const reloaded = await geometry();
      assert.equal(reloaded.position, preferred.position);
      assert(Math.abs(reloaded.card.x - preferred.card.x) < 1 && Math.abs(reloaded.card.y - preferred.card.y) < 1);
      await publish(); safe(await geometry());
      await card().getByRole("button", { name: "恢复任务卡片默认位置", exact: true }).click(); await settle();
      const reset = await geometry(); safe(reset); assert.equal(reset.position, null); await closePublish();
      r.positionRoundtrip = { preferred, avoided, restored, other, otherPublish, reloaded, reset };
      return { automaticWrite: false, restoredAfterReload: true, otherProjectUnchanged: true };
    });
    await step("reduced-keyboard-reflow-captured-drag-and-rapid-reverse", async () => {
      await session.metrics({ width: 1920, height: 1080, dpr: 1, reduced: true }); await settle();
      await armFrames(); await publish(true); r.reducedEnterFrames = await endFrames(); safe(await geometry());
      assert(r.reducedEnterFrames.some(f => f.animations.some(a => a.state === "running" && a.duration === 80)),
        "Reduced motion still requires a continuous, bounded handoff");
      const grip = await card().getByRole("button", { name: "拖动小说任务卡片", exact: true }).boundingBox(); assert(grip);
      await page.mouse.move(grip.x + 32, grip.y + 14); await page.mouse.down();
      await page.mouse.move(grip.x - 68, grip.y - 56, { steps: 8 });
      const held = await geometry();
      const toggle = page.locator(".toolbar-popover.cartridge:not([inert]) .package-console-toggle");
      await toggle.focus(); await page.keyboard.press("Enter"); await settle();
      const resizedWhileHeld = await geometry();
      assert(Math.abs(held.card.x - resizedWhileHeld.card.x) < 1
        && Math.abs(held.card.y - resizedWhileHeld.card.y) < 1, "Live bounds update stole pointer-owned placement");
      await page.mouse.up(); await settle();
      assert.equal(await page.getByTestId("novel-task-workbench").count(), 0);
      await armFrames(); await toggle.focus(); await page.keyboard.press("Enter");
      await page.evaluate(() => new Promise(requestAnimationFrame)); await page.keyboard.press("Enter"); await settle();
      r.reverseFrames = await endFrames(); r.reverseFinal = await geometry(); safe(r.reverseFinal);
      assert.equal(await card().count(), 1);
      await card().getByRole("button", { name: "恢复任务卡片默认位置", exact: true }).click(); await settle();
      safe(await geometry()); await closePublish(true);
      r.pointerOwnership = { held, resizedWhileHeld }; return { reducedContinuous: true, pointerOwned: true, reverseSafe: true };
    });
    assert.equal(r.cases.length, 4); assert(r.cases.every(c => c.status === "PASS"));
    assert.equal(r.modelRequests, 0); assert.deepEqual(r.errors, []);
    r.status = "CURRENT_NATIVE_NOVEL_CARD_PUBLISH_PASS";
  } catch (e) {
    r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      r.failureDOM = await page.locator("body").innerText().catch(String);
      await session.shot("failure").catch(e => { r.failureShotError = String(e); });
    }
  } finally {
    try { await session.stop("finally exact-owned cleanup, not normal close"); }
    catch (e) { r.cleanupError = String(e); r.status = "FAILED"; process.exitCode = 1; }
    try { for (const f of [...r.sources, ...r.products, ...prep.inputs.flatMap(i => [i.input, i.original])])
      assert.equal(sha(f.path), f.sha256, "Runtime modified source/input/product"); }
    catch (e) { r.immutabilityError = String(e); r.status = "FAILED"; process.exitCode = 1; }
    r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, out, error: r.error }));
  }
}
module.exports = { qa, summary, sources, products, desc };
if (require.main === module) (async () => {
  if (process.argv[2] === "prepare") prepare(); else await run(process.argv[2]);
})().catch(e => { console.error(e); process.exitCode = 1; });
