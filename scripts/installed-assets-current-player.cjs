"use strict";
// QA only. Exact current Editor export; real installed Player; observational probes.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const candidate = require("./lib/installed-assets-candidate.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { validate: validateEditor, matrix } = require("./lib/installed-assets-evidence.cjs");
const { validate } = require("./lib/installed-assets-player-evidence.cjs");
const videoEvidence = require("./lib/installed-video-current-evidence.cjs");
const root = path.resolve(__dirname, ".."), qa = candidate.qaRoot;
const videoMode = process.argv[2] === "--video";
const sourceAttempt = process.argv[videoMode ? 3 : 2] || "02", attempt = process.argv[videoMode ? 4 : 3] || "01";
for (const a of [sourceAttempt, attempt]) assert.match(a, /^\d{2}$/);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size, generatedAt: fs.statSync(f).mtime.toISOString() });
const sourceFile = path.join(qa, `editor-${sourceAttempt}/report.json`), source = read(sourceFile);
(videoMode ? videoEvidence.validateEditor : r => validateEditor(r, candidate.editor))(source);
if (!videoMode) assert.equal(path.resolve(source.installation.path), path.resolve(candidate.installationFile));
const installation = read(source.installation.path), exe = path.join(installation.installRoot, "agentvn-player.exe");
assert.equal(sha(source.installation.path), source.installation.sha256);
assert.equal(sha(exe), candidate.player.sha256);
assert(installation.resources.some(f => path.resolve(f.path) === path.resolve(exe) && f.sha256 === candidate.player.sha256));
const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-assets-${videoMode ? "video-" : ""}current-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "CURRENT_INSTALLED_PLAYER_EXACT_NEW_EDITOR_ASSET_EXPORT", source: desc(sourceFile), sourceStatus: source.status,
  executable: desc(exe), installation: source.installation, cartridge: source.cartridge,
  cases: [], screenshots: [], launches: [], errors: [], mediaErrors: [], snapshots: [], productChanges: 0, modelRequests: 0, builds: 0,
  limitations: ["Actual WebView viewport emulation, not physical 4K", "Preview mode, not standalone/setup/Android",
    "Attributed termination, not normal native close", "Technical audio decoding, not new listening confirmation",
    "Single-frame 0.001s video fixture, not long video timeline", "Animation JSON dedicated consumption undefined",
    "Native file picker not exercised", "No full motion or aesthetic verdict"] };
if (candidate.current) {
  report.candidateEditorVersion = source.version;
  report.actualPlayerVersion = JSON.parse(ps(
    `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo | Select-Object FileVersion,ProductVersion | ConvertTo-Json -Compress`));
  report.limitations = report.limitations.filter(s => !s.includes("Single-frame"));
  report.limitations.push("One ~1.77s multiframe fixture, not exhaustive video codec or duration coverage");
}
if (videoMode) {
  report.scope = "CURRENT_INSTALLED_PLAYER_MULTIFRAME_VIDEO_SUPPLEMENT";
  report.limitations = report.limitations.filter(s => !s.includes("Single-frame"));
  report.limitations.push("Single ~1.77s multiframe local video, not exhaustive codec/duration coverage");
}
const resumeAttempt = videoMode ? undefined : process.argv[4];
let inheritedCount = 0;
if (resumeAttempt) {
  assert.match(resumeAttempt, /^\d{2}$/);
  const file = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-assets-current-${resumeAttempt}/report.json`, prior = read(file);
  assert.equal(prior.profileRestored, true); assert.equal(prior.protectedUnchanged, true);
  assert.equal(prior.launches[0].cleanup.status, "PASS"); assert.equal(prior.executable.sha256, report.executable.sha256);
  assert.equal(prior.cartridge.sha256, source.cartridge.sha256);
  for (const c of prior.cases) {
    if (c.consumed.length !== 10 || !["PASS", "FAILED"].includes(c.status)) break;
    assert(c.consumed.every(a => a.decoded && a.sha256 === a.expectedSha256));
    const audio = c.consumed.filter(a => ["bgm", "voice", "sfx"].includes(a.type));
    assert.equal(audio.length, 3); assert(audio.every(a => a.played && a.pipelinePlaying && !a.error));
    report.cases.push(c); inheritedCount++;
  }
  assert(inheritedCount > 0 && inheritedCount < 12);
  report.screenshots.push(...prior.screenshots);
  report.inherited = { source: desc(file), cases: inheritedCount, scope: "Exact prior complete media cases; original failure retained; not one uninterrupted run" };
}
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let player, browser, page, cdp, protectedProfile = false, launch, currentCase;
const known = new Map(), identity = p => `${p.ProcessId}:${p.Created}`;
const git = () => {
  const p = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(p.status, 0);
  const indexPath = spawnSync("git", ["rev-parse", "--git-path", "index"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(indexPath.status, 0);
  const resolvedIndex = path.resolve(root, indexPath.stdout.trim());
  return { head: p.stdout.trim(), indexPath: resolvedIndex, index: sha(resolvedIndex) };
};
function remember() {
  if (player) for (const p of ownedProcessTree(rows(), player.pid, launch.created)) {
    if (p.ProcessId === player.pid) launch.created = p.Created;
    known.set(identity(p), p);
  }
  report.knownProcesses = [...known.values()]; save();
}
function profile(action) {
  const p = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, `profile-${action}.log`), p.stdout + p.stderr, { flag: "wx" });
  assert.equal(p.status, 0, p.stdout + p.stderr);
}
async function ready(screen) {
  await page.waitForFunction(s => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-presented-screen") === s
      && n?.getAttribute("data-runtime-screen-transition") === "idle"
      && !document.querySelector('[data-testid="game-launch-blackout"]');
  }, screen); await settleRuntime(page);
}
async function consumed(type, result) {
  const expected = source.cartridge.assets.find(a => a.type === type); assert(expected);
  assert.equal(result.sha256, expected.sha256, `Player bytes: ${type}`);
  const row = { type, ...result, expectedSha256: expected.sha256 };
  currentCase.consumed.push(row); save(); return row;
}
async function image(locator, background = false) {
  return locator.evaluate(async (n, background) => {
    const style = getComputedStyle(n), rect = n.getBoundingClientRect().toJSON();
    const url = background ? style.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1] : n.currentSrc || n.src;
    if (!url) throw Error("Missing rendered resource");
    const img = background ? new Image() : n; if (background) img.src = url; await img.decode();
    const bytes = await (await fetch(url)).arrayBuffer(), digest = await crypto.subtle.digest("SHA-256", bytes);
    return { src: url, sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join(""),
      width: img.naturalWidth, height: img.naturalHeight, rect, decoded: img.naturalWidth > 0 && rect.width > 0
        && rect.height > 0 && style.visibility === "visible" && Number(style.opacity) > .99 };
  }, background);
}
async function audioObjects(stage) {
  const proto = await cdp.send("Runtime.evaluate", { expression: "HTMLAudioElement.prototype", objectGroup: "asset-audio" });
  const objects = await cdp.send("Runtime.queryObjects", { prototypeObjectId: proto.result.objectId, objectGroup: "asset-audio" });
  const response = await cdp.send("Runtime.callFunctionOn", { objectId: objects.objects.objectId, returnByValue: true,
    awaitPromise: true, functionDeclaration: `async function() {
      return Promise.all(this.filter(a=>a.currentSrc||a.src).map(async a=>{
        const src=a.currentSrc||a.src, b=await(await fetch(src)).arrayBuffer(), h=await crypto.subtle.digest("SHA-256",b);
        return {src,sha256:[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join(""),
          duration:a.duration,currentTime:a.currentTime,paused:a.paused,ended:a.ended,error:a.error?.code??null,readyState:a.readyState};
      }));
    }` });
  assert(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
  const values = response.result.value; assert(Array.isArray(values));
  currentCase.audioObjects.push({ stage, values }); save(); return values;
}
async function advance(marker) {
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
  await page.locator(".dialog-box:visible").click();
  if (marker) await page.locator(`.dialog-box[aria-label*="${marker}"]`).waitFor();
}
(async () => {
  report.gitBefore = git(); report.protectedFiles = source.protectedFiles;
  for (const f of report.protectedFiles) assert.equal(sha(f.path), f.sha256);
  assert.equal(sha(source.cartridge.path), source.cartridge.sha256);
  const checkpoint = `F:/AgentVN/Checkpoints/Installed-Assets-20261021-01/${videoMode ? "video-" : ""}player-${attempt}`;
  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint);
  for (const relative of ["scripts/installed-assets-current-player.cjs", "scripts/lib/installed-assets-player-evidence.cjs",
    "scripts/installed-assets-player-evidence-test.cjs", "scripts/lib/installed-video-current-evidence.cjs",
    "plans/ACTIVE_TASKS.md"]) {
    const f = path.join(root, relative), copy = path.join(checkpoint, path.basename(relative));
    fs.copyFileSync(f, copy, fs.constants.COPYFILE_EXCL); report.snapshots.push({ source: desc(f), copy: desc(copy) });
  }
  assert(!rows().some(p => p.Name === "agentvn-player.exe"));
  protectedProfile = true; profile("Prepare");
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => {
    const n = s.address().port; s.close(() => resolve(n));
  }); });
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    AGENTVN_TEST_PROJECT: source.portable.path, AGENTVN_WORKSPACE_OUTPUT: out });
  player = spawn(exe, ["--mode", "preview", "--cartridge", source.cartridge.path],
    { cwd: installation.installRoot, env, windowsHide: true, stdio: "ignore" });
  launch = { pid: player.pid, port, executable: desc(exe), environment: {
    AGENTVN_TEST_PROJECT: source.portable.path, AGENTVN_WORKSPACE_OUTPUT: out,
    WEBVIEW2_USER_DATA_FOLDER: env.WEBVIEW2_USER_DATA_FOLDER } };
  report.launches.push(launch); remember();
  await until(async () => {
    assert.equal(player.exitCode, null); remember();
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; }
    catch { return false; }
  }, "owned installed asset Player", 60000);
  const tree = ownedProcessTree(rows(), player.pid, launch.created);
  assert(listeners([port]).length > 0 && listeners([port]).every(l => tree.some(p => p.ProcessId === l.OwningProcess)));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())), "Player page");
  page.setDefaultTimeout(30000); page.on("pageerror", e => { report.errors.push(String(e)); save(); });
  await page.addInitScript(({ videoMode }) => {
    window.__AGENTVN_RUNTIME_DIAGNOSTICS_ENABLED__ = true;
    window.__qaAssetsVideos = []; window.__qaAssetsInputs = []; window.__qaAssetsVideoFrames = [];
    const seen = new WeakSet();
    document.addEventListener("pointerdown", e => window.__qaAssetsInputs.push({ trusted: e.isTrusted,
      testId: e.target.closest("[data-testid]")?.getAttribute("data-testid"), at: performance.now() }), true);
    for (const event of ["loadedmetadata", "playing", "timeupdate", "ended", "error"])
      document.addEventListener(event, e => {
        if (!(e.target instanceof HTMLVideoElement)) return;
        const v = e.target, src = v.currentSrc || v.src;
        const row = { event, src, time: v.currentTime, duration: v.duration, width: v.videoWidth,
          height: v.videoHeight, error: v.error?.code ?? null }; window.__qaAssetsVideos.push(row);
        if (videoMode && !seen.has(v)) {
          seen.add(v);
          const canvas = document.createElement("canvas"); canvas.width = 48; canvas.height = 27;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          const next = () => v.requestVideoFrameCallback((_, meta) => {
            ctx.drawImage(v, 0, 0, 48, 27);
            let signature = 2166136261;
            for (const b of ctx.getImageData(0, 0, 48, 27).data) signature = Math.imul(signature ^ b, 16777619);
            window.__qaAssetsVideoFrames.push({ time: meta.mediaTime, presentedFrames: meta.presentedFrames,
              width: meta.width, height: meta.height, pixelSignature: signature >>> 0 }); next();
          }); next();
        }
        if (event === "loadedmetadata") row.probe = fetch(src).then(r => r.arrayBuffer()).then(async b => {
          row.sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map(x => x.toString(16).padStart(2, "0")).join("");
        }).catch(e => { row.probeError = String(e); });
      }, true);
  }, { videoMode: videoMode || candidate.current });
  cdp = await page.context().newCDPSession(page); await cdp.send("Media.enable");
  cdp.on("Media.playerEventsAdded", e => { if (currentCase) currentCase.mediaEvents.push(e); });
  cdp.on("Media.playerErrorsRaised", e => { report.mediaErrors.push(e); save(); });
  for (const m of matrix().slice(inheritedCount)) {
    currentCase = { ...m, status: "RUNNING", consumed: [], audioObjects: [], mediaEvents: [] }; report.cases.push(currentCase); save();
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: m.width, height: m.height, deviceScaleFactor: m.dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: m.reduced ? "reduce" : "no-preference" }); await page.reload();
    currentCase.viewport = await readInstalledViewport(page, m);
    await page.getByTestId("start-new-game").waitFor(); await ready("title_menu");
    const start = page.getByTestId("start-new-game");
    currentCase.input = await start.evaluate(n => {
      const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { rect: r.toJSON(), hit: hit === n || n.contains(hit), overflow: document.documentElement.scrollWidth - innerWidth };
    });
    await start.click(); await page.locator('.dialog-box[aria-label*="QA_REPLACED_MEDIA_DIALOG"]').waitFor();
    // Retain genuine detached objects before the 0.8s voice ends and clears its
    // React ref. Waiting for decorative reveal first races actual object GC.
    if (!videoMode) await audioObjects("dialog-before-transition-idle");
    await ready("playing");
    const firstAudio = videoMode ? [] : await audioObjects("dialog-after-transition-idle");
    currentCase.input.trusted = await page.evaluate(() => window.__qaAssetsInputs.some(e => e.trusted && e.testId === "start-new-game"));
    if (videoMode) {
      await advance("QA_REPLACED_MEDIA_SFX_HOLD"); await advance();
      for (const alt of ["QA_REPLACED_UI", "QA_REPLACED_OTHER"]) {
        const overlay = page.getByTestId("focused-image-overlay").filter({ has: page.getByAltText(alt, { exact: true }) });
        await overlay.waitFor(); await settleRuntime(page); await overlay.press("Enter"); await overlay.waitFor({ state: "hidden" });
      }
      await page.waitForFunction(() => window.__qaAssetsVideoFrames.some(f => f.time >= .4));
      if (m.width === 1920 && m.dpr === 1 && !m.reduced)
        report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, "moving-video-1920-1-false.png"), m));
      await page.locator('.dialog-box[aria-label*="QA_REPLACED_MEDIA_FINISHED"]').waitFor();
      currentCase.video = await page.evaluate(async () => {
        await Promise.all(window.__qaAssetsVideos.map(v => v.probe));
        return window.__qaAssetsVideos.map(({ probe, ...v }) => v);
      });
      currentCase.videoFrames = await page.evaluate(() => window.__qaAssetsVideoFrames);
      const events = currentCase.video, metadata = events.find(v => v.event === "loadedmetadata"); assert(metadata);
      await consumed("video", { sha256: metadata.sha256, decoded: metadata.width === 480 && metadata.height === 270,
        duration: metadata.duration, playing: events.some(v => v.event === "playing"),
        ended: events.some(v => v.event === "ended"), timeAdvanced: events.some(v => v.event === "timeupdate" && v.time > 1),
        error: events.some(v => v.event === "error" || v.probeError) });
      if (m.width === 3840 && m.dpr === 2 && m.reduced) {
        await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
        report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, "after-video-3840-2-true.png"), m));
      }
      const a = currentCase.consumed[0], frames = currentCase.videoFrames;
      currentCase.status = a.decoded && a.playing && a.ended && a.timeAdvanced && !a.error && a.duration > 1
        && frames.length >= 15 && frames.some(f => f.time > 1)
        && new Set(frames.map(f => f.pixelSignature)).size >= 10 ? "PASS" : "FAILED";
      save(); console.log(`${currentCase.status} multiframe ${m.width}/${m.dpr}/${m.reduced}: ${frames.length} frames`);
      continue;
    }
    await consumed("background", await image(page.locator(".background-transition-frame.is-current"), true));
    await consumed("sprite", await image(page.locator('[data-sprite-id="qa_sprite"] img.sprite-visual').last()));
    await consumed("portrait", await image(page.locator('img.dialog-portrait[data-portrait-ready="true"]')));
    const font = await page.evaluate(async () => {
      await document.fonts.ready;
      const family = "AgentVNFont_qa_font", face = [...document.fonts].find(f => f.family.includes(family));
      const text = document.querySelector(".dialog-text"), actualFamily = text && getComputedStyle(text).fontFamily;
      const rule = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } })
        .find(r => r.cssText.includes("@font-face") && r.cssText.includes(family));
      const url = rule?.cssText.match(/url\(["']?(.*?)["']?\)/)?.[1]; if (!url) throw Error("Missing used font URL");
      const bytes = await (await fetch(url)).arrayBuffer(), digest = await crypto.subtle.digest("SHA-256", bytes);
      return { decoded: face?.status === "loaded" && actualFamily?.includes(family), actualFamily,
        sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("") };
    });
    await consumed("font", font);
    if (m.width === 1920 && m.dpr === 1 && !m.reduced || m.width === 3840 && m.dpr === 2 && m.reduced)
      report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `dialog-${m.width}-${m.dpr}-${m.reduced}.png`), m));
    await advance("QA_REPLACED_MEDIA_SFX_HOLD"); const laterAudio = await audioObjects("sfx");
    await advance();
    for (const [type, alt] of [["ui", "QA_REPLACED_UI"], ["other", "QA_REPLACED_OTHER"]]) {
      const overlay = page.getByTestId("focused-image-overlay").filter({ has: page.getByAltText(alt, { exact: true }) });
      await overlay.waitFor(); await settleRuntime(page);
      await consumed(type, await image(overlay.getByTestId("focused-image")));
      await overlay.press("Enter"); await overlay.waitFor({ state: "hidden" });
    }
    await page.locator('.dialog-box[aria-label*="QA_REPLACED_MEDIA_FINISHED"]').waitFor();
    const video = await page.evaluate(async () => {
      await Promise.all(window.__qaAssetsVideos.map(v => v.probe));
      return window.__qaAssetsVideos.map(({ probe, ...v }) => v);
    });
    currentCase.video = video;
    if (candidate.current) currentCase.videoFrames = await page.evaluate(() => window.__qaAssetsVideoFrames);
    const metadata = video.find(v => v.event === "loadedmetadata"); assert(metadata);
    await consumed("video", { sha256: metadata.sha256, decoded: metadata.width === 480 && metadata.height === 270,
      duration: metadata.duration, playing: video.some(v => v.event === "playing"),
      ended: video.some(v => v.event === "ended"), timeAdvanced: video.some(v => v.event === "timeupdate" && v.time > (candidate.current ? 1 : 0)),
      error: video.some(v => v.event === "error" || v.probeError) });
    currentCase.diagnostics = await page.evaluate(() => window.__AGENTVN_RUNTIME_DIAGNOSTICS__);
    const bgm = currentCase.diagnostics.audio.find(e => e.payload.kind === "bgm" && e.payload.assetId === "qa_bgm"
      && e.payload.phase === "play-request")?.payload.source; assert(bgm);
    const voice = [...new Set(firstAudio.filter(a => a.src !== bgm).map(a => a.src))]; assert.equal(voice.length, 1);
    const sfx = [...new Set(laterAudio.filter(a => !firstAudio.some(f => f.src === a.src)).map(a => a.src))]; assert.equal(sfx.length, 1);
    for (const [type, src] of [["bgm", bgm], ["voice", voice[0]], ["sfx", sfx[0]]]) {
      const obj = [...firstAudio, ...laterAudio].find(a => a.src === src && a.readyState >= 2); assert(obj);
      // CDP groups correlate load/play/decoder events by the real media player ID.
      const players = new Map();
      for (const group of currentCase.mediaEvents) {
        const list = players.get(group.playerId) || [];
        list.push(...group.events.map(e => { try { return JSON.parse(e.value); } catch { return {}; } })); players.set(group.playerId, list);
      }
      const matching = [...players.values()].filter(es => es.some(e => e.event === "kLoad" && e.url === src));
      await consumed(type, { ...obj, decoded: obj.readyState >= 2 && obj.duration > 0,
        played: matching.some(es => es.some(e => e.event === "kPlay")),
        pipelinePlaying: matching.some(es => es.some(e => e.pipeline_state === "kPlaying")) });
    }
    await cdp.send("Runtime.releaseObjectGroup", { objectGroup: "asset-audio" });
    currentCase.status = currentCase.consumed.every(a => a.decoded
      && (!["bgm", "voice", "sfx"].includes(a.type) || a.played && a.pipelinePlaying && !a.error)
      && (a.type !== "video" || a.playing && a.ended && a.timeAdvanced && !a.error)) ? "PASS" : "FAILED";
    if (candidate.current && !(currentCase.videoFrames.length >= 15
      && currentCase.videoFrames.some(f => f.time > 1) && new Set(currentCase.videoFrames.map(f => f.pixelSignature)).size >= 10))
      currentCase.status = "FAILED";
    save(); console.log(`${currentCase.status} ${m.width}/${m.dpr}/${m.reduced}: ten replaced media; videoTime=${currentCase.video.map(v => v.time).join(",")}`);
  }
  report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (currentCase?.status === "RUNNING") currentCase.status = "FAILED";
  if (page && !page.isClosed()) report.failureDOM = await page.locator("body").innerText().catch(String);
}).finally(async () => {
  try {
    if (player) {
      remember(); await browser?.close().catch(() => {});
      for (const p of [...known.values()].reverse()) if (rows().some(r => identity(r) === identity(p)))
        stopOwnedProcess(p, ps);
      await until(() => !rows().some(p => known.has(identity(p))) && listeners([launch.port]).length === 0,
        "installed asset Player cleanup", 15000);
      launch.cleanup = { status: "PASS", normalCloseClaimed: false };
    }
    if (protectedProfile && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profile("Restore"); report.profileRestoration = desc(path.join(out, "profile-restoration.json"));
      report.profileRestored = read(report.profileRestoration.path).status === "PASS"; assert(report.profileRestored);
    }
    for (const f of report.protectedFiles || []) assert.equal(sha(f.path), f.sha256, f.path);
    assert.equal(sha(source.cartridge.path), source.cartridge.sha256); report.protectedUnchanged = true;
    report.gitAfter = git(); report.finishedAt = new Date().toISOString();
    if (report.status === "PASS") {
      try { report.validation = (videoMode ? videoEvidence.validatePlayer : r => validate(r, candidate.player))(report); }
      catch (e) { report.status = "FAILED"; report.validationError = String(e.stack || e); process.exitCode = 1; }
    }
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
