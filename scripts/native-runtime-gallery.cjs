"use strict";
// Current real Player only. Controlled gallery cartridges, native library
// preparation and filesystem fault injection are explicitly NOT Editor exports.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const iteration = process.argv[2] || "01"; assert(/^\d{2}$/.test(iteration));
const returnOnly = process.argv.includes("--return-only");
const rollbackRequired = process.argv.includes("--rollback");
const installedIndex = process.argv.indexOf("--installed-player");
const installed = installedIndex >= 0;
const out = installed ? path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT) : path.join(base, `gallery-${iteration}`);
if (installed) {
  assert.equal(path.dirname(out), path.resolve(base));
  assert.match(path.basename(out), /^installed-gallery-current-\d{2}$/);
  assert(fs.existsSync(out)); assert(!fs.existsSync(path.join(out, "report.json")));
  assert(rollbackRequired && !returnOnly);
} else { assert(!fs.existsSync(out), "Never overwrite previous evidence"); fs.mkdirSync(out, { recursive: true }); }
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const report = { status: "RUNNING", at: new Date().toISOString(),
  scope: installed ? "ACTUAL_NSIS_INSTALLED_PLAYER_CONTROLLED_GALLERY_NOT_EDITOR_EXPORT"
    : "CURRENT_NATIVE_PLAYER_CONTROLLED_GALLERY_NOT_RELEASE_INSTALL_OR_EDITOR_EXPORT",
  installed,
  returnOnly,
  rollbackRequired,
  cases: [], matrix: [], faultMatrix: [], launches: [], screenshots: [], pageErrors: [], console: [], interactions: [],
  productChanges: 0, builds: 0, realModelRequests: 0, installs: 0,
  notRun: [installed ? "New Release installation" : "Release installation", "Fresh Editor GUI gallery export", "Windows setup",
    "Android", "Physical 4K screen", "Normal native window close", "New audio listening"],
  error: null, cleanupError: null };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let session, protectedProfile = false;
async function start(layout) {
  await session.start(layout, false);
  if (installed) await session.page.evaluate(() => {
    window.__qaGalleryInputs = [];
    for (const type of ["click", "keydown"]) document.addEventListener(type, e => {
      const button = e.target?.closest("button,input");
      window.__qaGalleryInputs.push({ type, trusted: e.isTrusted, key: e.key,
        label: button?.getAttribute("aria-label") || button?.getAttribute("data-testid") || button?.textContent.trim() || null });
    }, true);
  });
}
async function stop() {
  if (installed && session?.page) {
    const inputs = await session.page.evaluate(() => window.__qaGalleryInputs);
    report.interactions.push({ pid: session.child.pid, layout: session.layout, installId: session.installId, inputs }); save();
  }
  await session.stop();
}
function ps(args) {
  return execFileSync("powershell.exe", ["-NoProfile", ...args], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 120000,
  });
}
async function test(layout, name, fn) {
  const row = { layout, name, status: "RUNNING" }; report.cases.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
  save(); console.log(`${row.status}: ${layout}/${name}`);
  return row.status === "PASS";
}
async function makeCartridge(original, broken) {
  assert.equal(sha(original.path), original.sha256);
  const zip = await JSZip.loadAsync(fs.readFileSync(original.path));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const script = JSON.parse(await zip.file("script.json").async("string"));
  const art = broken ? Buffer.from("CONTROLLED_INVALID_IMAGE_NOT_PNG")
    : Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#d7ab78"/><circle cx="160" cy="90" r="55" fill="#234758"/></svg>');
  const assetPath = `assets/gallery/本轮画廊.${broken ? "png" : "svg"}`;
  manifest.title = `当前Player画廊验收 ${original.layout}${broken ? " 损坏图像" : ""}`;
  manifest.entry_scene_id = script.entry_scene_id = "qa_gallery";
  script.default_dialog_presentation = "dialog";
  manifest.assets = [{ asset_id: "qa_gallery_art", asset_type: "ui", path: assetPath,
    filename: path.basename(assetPath), display_name: "画廊专有图片",
    mime_type: broken ? "image/png" : "image/svg+xml", size_bytes: art.length, width: 320, height: 180 }];
  script.characters = [];
  script.scenes = [{ scene_id: "qa_gallery", title: "画廊回放目标", summary: "", chapter: 1, tags: [],
    next_scene_id: "qa_forbidden", commands: [
      { type: "narration", text: "GALLERY_OPENING：真实点击解锁与回放。" },
      { type: "gallery_anchor", anchor_id: "qa_gallery_anchor", title: "本轮画廊图",
        asset_id: "qa_gallery_art", description: "独占资源原字节验证" },
      { type: "narration", text: "GALLERY_AFTER：进入画廊前的剧情位置。" },
    ] }, { scene_id: "qa_forbidden", title: "不可跨入的下一场景", summary: "", chapter: 1, tags: [],
      commands: [{ type: "narration", text: "FORBIDDEN_GALLERY_SUCCESSOR" }] }];
  const gallery = { gallery_version: "1.0.0", items: [{
    item_id: "qa_gallery_anchor", anchor_id: "qa_gallery_anchor", scene_id: "qa_gallery",
    command_index: 1, title: "本轮画廊图", description: "独占资源原字节验证", asset_id: "qa_gallery_art",
  }] };
  zip.file("manifest.json", JSON.stringify(manifest));
  zip.file("script.json", JSON.stringify(script)); zip.file("gallery.json", JSON.stringify(gallery));
  zip.file(assetPath, art); zip.remove("checksum.json");
  const files = [];
  for (const f of Object.values(zip.files).filter(f => !f.dir)) {
    const bytes = await f.async("nodebuffer");
    files.push({ path: f.name, size_bytes: bytes.length, hash_sha256: hash(bytes) });
  }
  zip.file("checksum.json", JSON.stringify({ checksum_version: "1.0.0", algorithm: "sha256",
    generated_at: new Date().toISOString(), files: files.sort((a, b) => a.path.localeCompare(b.path)) }));
  const file = path.join(out, `${original.layout}-${broken ? "broken" : "valid"}.vncart`);
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), { flag: "wx" });
  return { ...desc(file), layout: original.layout, controlledDerivative: true, original: desc(original.path),
    art: { path: assetPath, sha256: hash(art), bytes: art.length, deliberatelyInvalidImage: broken },
    scriptSha256: hash(Buffer.from(JSON.stringify(script))), layoutSha256: hash(await zip.file("ui/layout.json").async("nodebuffer")) };
}
async function observe() {
  return session.page.evaluate(() => {
    const n = document.querySelector('[data-testid="game-state-playing"]');
    return { scene: n?.getAttribute("data-current-scene-id") || null,
      index: n ? Number(n.getAttribute("data-current-command-index")) : null,
      text: (document.querySelector(".dialog-text") || document.querySelector(".nvl-page"))?.textContent || null,
      screen: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-presented-screen"),
      playerCount: [...document.querySelectorAll(".story-player")].filter(n => !n.closest("[data-runtime-transition-snapshot]")).length };
  });
}
async function gallery() {
  if (await session.screen() === "playing") {
    await session.page.keyboard.press("Escape"); await session.ready("main_menu");
  }
  await session.page.getByTestId("open-gallery").click(); await session.ready("gallery");
}
async function back(expected) {
  const p = session.page;
  if (!installed) {
    await p.getByTestId(session.layout === "renpy" ? "renpy-menu-return" : "back-to-main-menu").click();
    await p.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
      ?.getAttribute("data-runtime-screen-transition") === "idle");
    return;
  }
  assert(["title_menu", "main_menu"].includes(expected));
  await p.evaluate(() => {
    const row = window.__qaGalleryReturn = { done: false, frames: [] };
    const sample = at => {
      if (row.done) return;
      const n = document.querySelector("[data-runtime-screen-transition]");
      row.frames.push({ at, screen: n?.getAttribute("data-runtime-presented-screen"),
        committed: n?.getAttribute("data-runtime-committed-screen"),
        phase: n?.getAttribute("data-runtime-transition-phase"),
        from: n?.getAttribute("data-runtime-transition-from"), to: n?.getAttribute("data-runtime-transition-to") });
      requestAnimationFrame(sample);
    };
    sample(performance.now());
  });
  const row = { layout: session.layout, expected, status: "RUNNING" };
  report.returnTraces ??= []; report.returnTraces.push(row); save();
  try {
    await p.getByTestId(session.layout === "renpy" ? "renpy-menu-return" : "back-to-main-menu").click();
    row.immediate = await observe();
    // Idle alone can still describe the source page before the requested
    // transition commits. Completion must include the intended destination.
    await session.ready(expected); row.final = await observe(); row.status = "PASS";
  } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally {
    row.frames = await p.evaluate(() => {
      const r = window.__qaGalleryReturn; r.done = true; return r.frames;
    }); save();
  }
}
async function unlock() {
  await session.page.getByTestId("start-new-game").click(); await session.ready("playing");
  await session.command("qa_gallery", 0);
  await session.setAuto(false, true);
  await session.page.locator(".dialog-box").click();
  await session.command("qa_gallery", 2);
  await session.page.waitForFunction(async id => (await window.__TAURI_INTERNALS__.invoke("list_gallery_unlocks",
    { installId: id })).includes("qa_gallery_anchor"), session.installId);
}
async function geometry() {
  return session.page.getByTestId("gallery-screen").evaluate(panel => {
    const controlsRoot = panel.closest("[data-renpy-menu-frame]") || panel;
    const rect = n => n.getBoundingClientRect().toJSON(), r = rect(panel);
    const cards = [...panel.querySelectorAll(".gallery-item")].map(item => {
      const b = item.querySelector("button"), br = rect(b), img = item.querySelector("img");
      return { rect: rect(item), button: br, hit: b.contains(document.elementFromPoint(br.x + br.width / 2, br.y + br.height / 2)),
        disabled: b.disabled, image: img ? { complete: img.complete, width: img.naturalWidth, height: img.naturalHeight } : null };
    });
    return { panel: r, cards, overflow: document.documentElement.scrollWidth - innerWidth,
      focusUnavailable: Boolean(document.activeElement?.closest("[inert],[aria-hidden='true']")),
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      controlsRoot: controlsRoot === panel ? "agentvn-page" : "shared-renpy-frame",
      controls: [...controlsRoot.querySelectorAll("button,input")].filter(b => {
        const r = b.getBoundingClientRect(), s = getComputedStyle(b);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      }).map(b => {
        const r = b.getBoundingClientRect(); let clipped = false;
        for (let p = b.parentElement; p && p !== controlsRoot.parentElement; p = p.parentElement) {
          const css = getComputedStyle(p), pr = p.getBoundingClientRect();
          if (/^(hidden|clip|auto|scroll)$/.test(css.overflowX) && (r.left < pr.left - 1 || r.right > pr.right + 1)) clipped = true;
          if (/^(hidden|clip|auto|scroll)$/.test(css.overflowY) && (r.top < pr.top - 1 || r.bottom > pr.bottom + 1)) clipped = true;
        }
        return { label: b.getAttribute("aria-label") || b.textContent.trim(), rect: r.toJSON(), disabled: b.disabled,
          clipped, inert: Boolean(b.closest("[inert]")),
          hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
      }) };
  });
}
function assertGeometry(g, expected, faulty = false) {
  assert.equal(g.width, expected.width); assert.equal(g.height, expected.height);
  assert(Math.abs(g.dpr - expected.dpr) <= 1e-6); assert.equal(g.reduced, expected.reduced);
  assert.equal(g.cards.length, 1); assert(g.overflow <= 1 && !g.focusUnavailable);
  const c = g.cards[0]; assert(c.hit && !c.disabled);
  assert.equal(c.image?.width, faulty ? 0 : 320); assert.equal(c.image?.height, faulty ? 0 : 180);
  assert(c.rect.x >= -1 && c.rect.y >= -1 && c.rect.right <= g.width + 1 && c.rect.bottom <= g.height + 1);
  assert(g.controls.length > 1);
  for (const b of g.controls) {
    assert(!b.clipped && !b.inert && (b.disabled || b.hit), b.label);
    assert(b.rect.x >= -1 && b.rect.y >= -1 && b.rect.right <= g.width + 1 && b.rect.bottom <= g.height + 1, b.label);
  }
  for (let i = 0; i < g.controls.length; i++) for (let j = i + 1; j < g.controls.length; j++) {
    const a = g.controls[i].rect, b = g.controls[j].rect;
    assert(!(Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1
      && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1), "Gallery controls overlap");
  }
}
async function positive(layout) {
  await start(layout);
  session.page.on("console", m => { if (["warning", "error"].includes(m.type()))
    report.console.push({ layout, type: m.type(), text: m.text() }); });
  if (!returnOnly) await test(layout, "Locked gallery cannot replay and returns to title", async () => {
    await gallery();
    const item = session.page.getByTestId("gallery-item-qa_gallery_anchor");
    assert(await item.locator("button").isDisabled());
    assert.equal(await item.getAttribute("aria-label"), "未解锁画廊条目");
    await session.shot("locked"); await back("title_menu"); await session.ready("title_menu");
    return { unlocks: await session.native("list_gallery_unlocks", { installId: session.installId }), state: await observe() };
  });
  const didUnlock = await test(layout, "Real story progression writes native gallery record and renders exact resource bytes", async () => {
    await unlock();
    const before = await observe(); assert(before.text.includes("GALLERY_AFTER"));
    await gallery();
    const item = session.page.getByTestId("gallery-item-qa_gallery_anchor");
    assert(await item.locator("button").isEnabled());
    await item.locator("img").evaluate(img => img.decode());
    const bytes = await item.locator("img").evaluate(async img => Array.from(new Uint8Array(
      await (await fetch(img.currentSrc)).arrayBuffer())));
    const cartridge = session.cartridges.find(c => c.layout === layout);
    assert.equal(hash(Buffer.from(bytes)), cartridge.art.sha256);
    const record = await session.native("read_gallery_anchor", { installId: session.installId, anchorId: "qa_gallery_anchor" });
    assert.equal(record.anchor_id, "qa_gallery_anchor"); assert.equal(record.scene_id, "qa_gallery");
    const physical = path.join(process.env.APPDATA, "com.agentvn.player/gallery", session.installId, "qa_gallery_anchor.json");
    assert.deepEqual(read(physical), record);
    await session.shot("unlocked");
    return { before, physical: desc(physical), record, assetSha256: hash(Buffer.from(bytes)) };
  });
  if (didUnlock) {
    if (installed) await test(layout, "Manual replay exit restores original story rollback timeline without saving", async () => {
      const before = session.files();
      await session.page.getByTestId("gallery-item-qa_gallery_anchor").locator("button").click();
      await session.ready("playing"); await session.command("qa_gallery", 0);
      await session.page.keyboard.press("Escape"); await session.ready("gallery");
      await back("main_menu"); await session.ready("main_menu");
      await session.page.getByTestId("continue-game").click();
      await session.ready("playing"); await session.command("qa_gallery", 2);
      const restored = await observe(); assert(restored.text.includes("GALLERY_AFTER"));
      await session.page.keyboard.press("PageUp"); await session.command("qa_gallery", 0);
      const previous = await observe(); assert(previous.text.includes("GALLERY_OPENING"));
      await session.page.keyboard.press("PageDown"); await session.command("qa_gallery", 2);
      const forwarded = await observe(); assert(forwarded.text.includes("GALLERY_AFTER"));
      assert.deepEqual(session.files(), before); await session.shot("manual-replay-return");
      await gallery();
      return { restored, previous, forwarded, savesUnchanged: true };
    });
    if (!returnOnly) await test(layout, "Gallery-only display matrix has visible non-overlapping clickable controls", async () => {
      for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        await session.viewport({ width, height: width * 9 / 16, dpr, reduced });
        if (installed) await settleRuntime(session.page);
        const g = await geometry();
        const cell = { layout, width, height: width * 9 / 16, dpr, reduced, status: "RUNNING", geometry: g };
        report.matrix.push(cell); save();
        assert.equal(g.cards.length, 1); assert(g.overflow <= 1 && !g.focusUnavailable);
        for (const c of g.cards) assert(c.hit && !c.disabled && c.image?.width === 320 && c.image.height === 180
          && c.rect.x >= -1 && c.rect.y >= -1 && c.rect.right <= width + 1 && c.rect.bottom <= width * 9 / 16 + 1);
        if (installed) assertGeometry(g, cell);
        cell.status = "PASS"; save();
      }
      await session.shot("gallery-4k-dpr2-reduced");
      await session.viewport({ width: 1920, height: 1080, dpr: 1, reduced: false });
      return { cells: report.matrix.filter(c => c.layout === layout).length, transitionsNotRetested: true };
    });
    await test(layout, "Replay ends at scene boundary and returns without creating saves", async () => {
      const before = session.files();
      await session.page.getByTestId("gallery-item-qa_gallery_anchor").locator("button").click();
      await session.ready("playing"); await session.command("qa_gallery", 0);
      if (layout === "renpy") {
        assert(await session.page.getByTestId("renpy-quick-save-load").isDisabled());
        assert(await session.page.getByTestId("renpy-quick-save").isDisabled());
      } else {
        await session.page.getByTestId("quick-menu-toggle").click();
        assert(await session.page.getByRole("button", { name: "画廊回放中不可存档", exact: true }).isDisabled());
        await session.page.getByTestId("quick-menu-toggle").click();
      }
      await session.page.locator(".dialog-box").click(); await session.command("qa_gallery", 2);
      await session.page.locator(".dialog-box").click(); await session.ready("gallery");
      assert.deepEqual(session.files(), before);
      await back("main_menu");
      const destination = await session.screen();
      const returned = { savesUnchanged: true, destination, afterReturn: await observe() };
      report.replayReturnObservations ??= []; report.replayReturnObservations.push({ layout, ...returned }); save();
      assert.equal(destination, "main_menu", "Replay must preserve the active-story origin rather than silently reset to title");
      const resume = session.page.getByTestId("continue-game");
      assert(await resume.isVisible(), "Original active story must remain resumable after gallery replay");
      await resume.click(); await session.ready("playing"); await session.command("qa_gallery", 2);
      assert((await observe()).text.includes("GALLERY_AFTER"));
      let rollbackRoundTrip;
      if (rollbackRequired) {
        await session.page.keyboard.press("PageUp"); await session.command("qa_gallery", 0);
        const previous = await observe(); assert(previous.text.includes("GALLERY_OPENING"));
        await session.page.keyboard.press("PageDown"); await session.command("qa_gallery", 2);
        const restored = await observe(); assert(restored.text.includes("GALLERY_AFTER"));
        rollbackRoundTrip = { previous, restored };
      }
      return { savesUnchanged: true, destination, final: await observe(), rollbackRoundTrip };
    });
  }
  await stop();
  if (returnOnly) return;
  await test(layout, "Native unlock and image survive real Player process restart", async () => {
    await start(layout); await gallery();
    const button = session.page.getByTestId("gallery-item-qa_gallery_anchor").locator("button");
    assert(await button.isEnabled()); await button.locator("img").evaluate(img => img.decode());
    return { unlocks: await session.native("list_gallery_unlocks", { installId: session.installId }), geometry: await geometry() };
  });
  if (installed) await test(layout, "Title-origin manual and natural replays do not invent an active story", async () => {
    const before = session.files(), outcomes = [];
    for (const exit of ["manual", "natural"]) {
      await session.page.getByTestId("gallery-item-qa_gallery_anchor").locator("button").click();
      await session.ready("playing"); await session.command("qa_gallery", 0);
      if (exit === "manual") await session.page.keyboard.press("Escape");
      else {
        await session.page.locator(".dialog-box").click(); await session.command("qa_gallery", 2);
        await session.page.locator(".dialog-box").click();
      }
      await session.ready("gallery"); await back("title_menu"); await session.ready("title_menu");
      const final = await observe(); assert.equal(final.playerCount, 0);
      assert.equal(final.scene, null); assert.equal(await session.page.getByTestId("continue-game").count(), 0);
      assert.deepEqual(session.files(), before); outcomes.push({ exit, final, savesUnchanged: true });
      await gallery();
    }
    await session.shot("title-replay-return"); return { outcomes };
  });
  await stop();
}
async function broken(layout, cartridges) {
  session.cartridges = cartridges; session.installId = `qa_gallery_broken_${iteration}_${layout}`;
  await start(layout);
  session.page.on("console", m => { if (["warning", "error"].includes(m.type()))
    report.console.push({ layout, injectedBrokenImage: true, type: m.type(), text: m.text() }); });
  await test(layout, "Invalid image payload is diagnosed visibly and gallery remains returnable", async () => {
    await unlock(); await gallery();
    const img = session.page.getByTestId("gallery-item-qa_gallery_anchor").locator("img");
    await img.evaluate(img => new Promise(resolve => {
      if (img.complete) resolve(); else {
        img.addEventListener("load", resolve, { once: true }); img.addEventListener("error", resolve, { once: true });
      }
    }));
    const observed = await geometry(), text = await session.page.getByTestId("gallery-screen").innerText();
    await session.shot("broken-resource");
    const error = session.page.getByTestId("gallery-resource-error");
    await error.waitFor({ state: "visible" });
    await session.page.getByRole("button", { name: "重试加载画廊图片", exact: true }).click();
    await error.waitFor({ state: "visible" });
    const retryDiagnostic = await error.innerText();
    assert.match(retryDiagnostic, /无法加载|失败|损坏/, "Permanently damaged bytes must not produce a false retry success");
    if (installed) for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await session.viewport({ width, height: width * 9 / 16, dpr, reduced }); await settleRuntime(session.page);
      const cell = { layout, width, height: width * 9 / 16, dpr, reduced, status: "RUNNING",
        geometry: await geometry(), diagnostic: await error.innerText() };
      report.faultMatrix.push(cell); save();
      assertGeometry(cell.geometry, cell, true); assert.match(cell.diagnostic, /无法加载|失败|损坏/);
      cell.status = "PASS"; save();
    }
    if (installed) await session.viewport({ width: 1920, height: 1080, dpr: 1, reduced: false });
    await back("main_menu"); await session.ready("main_menu");
    const diagnostic = /(?:失败|无法加载|资源损坏|重试)/.test(text);
    const row = { fault: "Correct checksum, deliberately invalid image bytes; no API/store mocks",
      geometry: observed, text, returned: await session.screen(), visibleDiagnostic: diagnostic,
      retryDiagnostic };
    report.brokenObservations ??= []; report.brokenObservations.push({ layout, ...row }); save();
    assert(diagnostic, "Broken gallery artwork was displayed without a user-visible resource failure diagnostic");
    await session.page.getByTestId("continue-game").click();
    await session.ready("playing"); await session.command("qa_gallery", 2);
    row.originalStoryStillPlayable = (await observe()).text.includes("GALLERY_AFTER");
    assert(row.originalStoryStillPlayable);
    return row;
  });
  await stop();
}
(async () => {
  report.tools = ["scripts/native-runtime-gallery.cjs", "scripts/lib/installed-runtime-session.cjs",
    "scripts/native-dev-preview-profile.ps1"].map(f => {
      const to = path.join(out, path.basename(f)); fs.copyFileSync(path.join(root, f), to, fs.constants.COPYFILE_EXCL);
      return desc(to);
    });
  report.products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
    "editor/src-tauri/binaries/agentvn-player.exe", "GameCli_framework/src-tauri/target/release/agentvn-player.exe"]
    .map(f => desc(path.join(root, f)));
  assert.equal(report.products[0].sha256, report.products[1].sha256);
  assert.equal(report.products[2].sha256, report.products[3].sha256);
  if (installed) {
    report.installation = desc(process.argv[installedIndex + 1]);
    const receipt = read(report.installation.path); assert.equal(receipt.status, "PASS");
    assert.equal(receipt.executable.version, "1.9.14");
    report.executable = desc(path.join(receipt.installRoot, "agentvn-player.exe"));
    assert.equal(report.executable.sha256, "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e");
    assert.equal(receipt.resources.find(f => path.resolve(f.path) === report.executable.path).sha256, report.executable.sha256);
  }
  const fixtureFile = path.join(root, "output/installed-runtime-abilities-20261018-01/fixtures-02.json");
  const exportFile = path.join(root, "output/installed-runtime-abilities-20261018-01/export-03/report.json");
  const oldFixture = read(fixtureFile), oldExport = read(exportFile);
  assert.equal(oldExport.status, "PASS"); assert.equal(sha(oldFixture.input), oldFixture.inputSha256);
  report.sources = [desc(fixtureFile), desc(exportFile)];
  const project = path.join(out, "画廊 隔离小工程.vnproj"); fs.copyFileSync(oldFixture.input, project, fs.constants.COPYFILE_EXCL);
  report.cartridges = []; report.brokenCartridges = [];
  for (const original of oldExport.cartridges) {
    report.cartridges.push(await makeCartridge(original, false));
    report.brokenCartridges.push(await makeCartridge(original, true));
  }
  process.env.AGENTVN_TEST_PROJECT = project; process.env.AGENTVN_WORKSPACE_OUTPUT = out;
  report.isolation = { AGENTVN_TEST_PROJECT: project, AGENTVN_WORKSPACE_OUTPUT: out,
    controlledProjectMarker: "Historical isolated project copied for harness ownership; gallery script is a controlled ZIP derivative" };
  save();
  protectedProfile = true;
  report.profilePreparation = ps(["-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/native-dev-preview-profile.ps1"),
    "-Action", "Prepare", "-RunDirectory", out, "-Storage", "NativeRoaming"]);
  const journal = read(path.join(out, "profile-protection.json"));
  const prep = { status: "PASS", sessionRoot: out, defaultStorage: "PHYSICAL_DEFAULT_PATH",
    profiles: journal.records.filter(r => r.existed), executable: installed ? report.executable : report.products[2],
    webview: path.join(out, "webview"), temporary: path.join(out, "temporary") };
  fs.mkdirSync(prep.temporary);
  const fixture = { ...oldFixture, input: project, inputSha256: sha(project) };
  for (const layout of ["agentvn", "renpy"]) {
    session = new InstalledRuntimeSession({ prep, fixture, cartridges: report.cartridges, out, report, save,
      installId: `qa_gallery_valid_${iteration}_${layout}`, currentNative: true });
    await positive(layout);
    if (!returnOnly) await broken(layout, report.brokenCartridges);
  }
  report.status = report.cases.length === (returnOnly ? 4 : installed ? 16 : 12) && report.cases.every(c => c.status === "PASS")
    && report.matrix.length === (returnOnly ? 0 : 24)
    && report.faultMatrix.length === (installed ? 24 : 0) && report.faultMatrix.every(c => c.status === "PASS")
    && report.matrix.every(c => c.status === "PASS") && !report.pageErrors.length ? "PASS" : "FAILED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
.finally(async () => {
  try {
    if (session?.child) await stop();
    if (protectedProfile && fs.existsSync(path.join(out, "profile-protection.json"))) {
      if (installed) {
        const { rows } = require("./lib/current-native-editor-session.cjs");
        const end = Date.now() + 20000; let live;
        do {
          live = rows().filter(p => p.Name === "agentvn-player.exe" ||
            p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out));
          if (!live.length) break;
          await new Promise(resolve => setTimeout(resolve, 250));
        } while (Date.now() < end);
        assert.deepEqual(live, [], "Refuse restore while Player/owned WebView remains alive");
      }
      report.profileRestorationOutput = ps(["-ExecutionPolicy", "Bypass", "-File",
        path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", "Restore", "-RunDirectory", out]);
      report.profileRestoration = desc(path.join(out, "profile-restoration.json"));
      assert.equal(read(report.profileRestoration.path).status, "PASS");
    }
    for (const p of report.products || []) assert.equal(sha(p.path), p.sha256);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.map(c => ({ layout: c.layout,
    name: c.name, status: c.status, error: c.error })), error: report.error, cleanupError: report.cleanupError }, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
});
