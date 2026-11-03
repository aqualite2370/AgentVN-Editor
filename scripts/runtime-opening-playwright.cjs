"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { spawnSync } = require("node:child_process");
const { installedOpeningPreview } = require("./lib/installed-opening-preview-session.cjs");
const { startPresentedFrames } = require("./lib/opening-presented-frames.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
const installationFile = process.argv.find(a => a.startsWith("--installed="))?.slice("--installed=".length);
const nativeBuildFile = process.argv.find(a => a.startsWith("--native-build="))?.slice("--native-build=".length);
const nativeMode = Boolean(installationFile || nativeBuildFile);
assert(!(installationFile && nativeBuildFile), "Choose actual installation or verified new native build");
const diagnostic4k = process.argv.includes("--diagnostic-4k");
const noOpeningShot = process.argv.includes("--no-opening-shot");
const compositor = process.argv.includes("--compositor");
const d3d11 = process.argv.includes("--d3d11");
assert(!compositor || diagnostic4k, "Presented-frame probe is initially a scoped diagnostic, not acceptance");
assert(!d3d11 || !nativeMode, "Source browser flags cannot configure a native WebView");
assert(!noOpeningShot || diagnostic4k, "Screenshot control is diagnostic only, never full acceptance");
if (installationFile) assert.equal(path.resolve(installationFile),
  path.resolve("F:/AgentVN/QA/Editor-Repair-Release-20261024-01/installation.json"));
assert(/^(red|green|matrix)-\d{2}$/.test(attempt || ""), "Explicit fresh attempt");
if (nativeBuildFile) assert.equal(path.resolve(nativeBuildFile),
  path.resolve("F:/AgentVN/QA/Runtime-Opening-Time-20261024-01/build-02/report.json"));
const out = nativeBuildFile
  ? path.join("F:/AgentVN/QA/Native-Runtime-State-20261020-01", `opening-native-time02-${attempt.slice(-2)}`)
  : installationFile
  ? path.join("F:/AgentVN/QA/Native-Runtime-State-20261020-01", `opening-installed-1923-${attempt.slice(-2)}`)
  : path.join("F:/AgentVN/QA/Runtime-Opening-20261023-01", attempt);
assert(!fs.existsSync(out), "Never overwrite evidence");
fs.mkdirSync(out, { recursive: true });
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: nativeBuildFile ? "CURRENT_DEV_BUNDLED_NATIVE_PREVIEW_NOT_INSTALLATION_EDITOR_EXPORT_STANDALONE_OR_ANDROID"
    : installationFile ? "INSTALLED_1_9_23_BUNDLED_NATIVE_PREVIEW_NOT_EDITOR_EXPORT_STANDALONE_OR_ANDROID"
    : "SOURCE_RUNTIME_BROWSER_NOT_INSTALLED_OR_ANDROID", cases: [], modelRequests: 0, screenshots: [],
  ...(nativeMode ? { installationFile, nativeBuildFile, boundaries: [
    nativeBuildFile ? "Verified newly built native Player with synthetic complete-cartridge preview messages"
      : "Actual installed bundled Player with synthetic complete-cartridge preview messages",
    "Controlled fixtures, not a fresh authoring/export or native file picker workflow",
    "Real WebView simulated viewport, not physical 4K; attributed teardown, not normal close",
    "Synthetic media playback only, not listening acceptance",
  ] } : {}) };
report.sources = [
  "GameCli_framework/src/app/App.tsx", "GameCli_framework/src/app/App.css",
  "GameCli_framework/src/components/common/BootAnimation.tsx",
  "GameCli_framework/src/components/common/OpeningScreen.tsx",
  "GameCli_framework/src/styles/shell.css", "GameCli_framework/src/app/RuntimeScreenNavigator.tsx",
].filter(f => fs.existsSync(path.join(root, f))).map(file => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) }));
fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
const compiled = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles"; export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(compiled, compiled.exports);
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let server, browser, profilePrepared = false;
function profile(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action,
    "-RunDirectory", out, "-CodexCacheView"],
  { encoding: "utf8", windowsHide: true, timeout: 45000 });
  fs.writeFileSync(path.join(out, `profile-${action}.log`), result.stdout + result.stderr, { flag: "wx" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
async function fixture(kind, layout, video) {
  const file = path.join(out, `${kind}-${layout}.vncart`);
  if (fs.existsSync(file)) return fs.readFileSync(file).toString("base64");
  const id = `qa-opening-${kind}-${layout}`, now = new Date().toISOString();
  const assets = kind === "default" ? [] : kind === "image_sequence"
    ? [1, 2].map(i => ({ id: `frame_${i}`, type: "ui", mime: "image/svg+xml",
      bytes: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="${i === 1 ? "#173b5c" : "#682a46"}"/><text x="120" y="450" font-size="80" fill="white">FRAME ${i}</text></svg>`) }))
    : [{ id: "opening", type: "video", mime: "video/webm", bytes: kind === "broken" ? Buffer.from("invalid video") : video }];
  const manifest = { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.25.0",
    game_id: id, title: "独立全屏开场隔离工程", author: "QA", version: "0.1.0", language: "zh-CN",
    entry_script: "script.json", entry_scene_id: "main", created_at: now, updated_at: now,
    ui_skin: { path: "ui/layout.json", version: "1.0.0", name: "QA" },
    assets: assets.map(a => ({ asset_id: a.id, asset_type: a.type, path: `assets/${a.id}`,
      filename: a.id + (a.mime.includes("svg") ? ".svg" : ".webm"), mime_type: a.mime,
      size_bytes: a.bytes.length, hash_sha256: sha(a.bytes) })) };
  const script = { schema_version: "1.10.0", game_id: id, title: manifest.title, entry_scene_id: "main",
    loading_animation: kind === "image_sequence" ? { kind, image_asset_ids: ["frame_1", "frame_2"], frame_duration_ms: 700 }
      : kind === "default" ? { kind } : { kind: "video", video_asset_id: "opening" },
    scenes: [{ scene_id: "main", title: "隔离", chapter: 1, tags: [],
      commands: [{ type: "narration", text: "全屏开场不会替换剧情转场。" }] }] };
  const entries = new Map([["manifest.json", Buffer.from(JSON.stringify(manifest))],
    ["script.json", Buffer.from(JSON.stringify(script))],
    ["ui/layout.json", Buffer.from(JSON.stringify(layout === "renpy"
      ? compiled.exports.createRenpyUILayout() : compiled.exports.getDefaultUISkinLayout()))],
    ...assets.map(a => [`assets/${a.id}`, a.bytes])]);
  const zip = new JSZip();
  for (const [file, bytes] of entries) zip.file(file, bytes);
  zip.file("checksum.json", JSON.stringify({ checksum_version: "1.0.0", algorithm: "sha256", generated_at: now,
    files: [...entries].map(([file, bytes]) => ({ path: file, size_bytes: bytes.length, hash_sha256: sha(bytes) })) }));
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(file, bytes, { flag: "wx" });
  (report.fixtures ??= []).push({ path: file, sha256: sha(bytes), kind, layout });
  return bytes.toString("base64");
}
async function record(page) {
  await page.evaluate(() => {
    window.__openingFrames = []; window.__openingCapture = true; window.__openingEvents = [];
    window.__openingMediaEvents = [];
    document.addEventListener("ended", e => {
      if (e.target instanceof HTMLVideoElement) window.__openingEvents.push({ event: "ended", at: performance.now(), time: e.target.currentTime });
    }, true);
    for (const type of ["loadedmetadata", "loadeddata", "canplay", "playing"]) document.addEventListener(type, e => {
      if (e.target instanceof HTMLVideoElement) window.__openingMediaEvents.push({
        event: type, at: performance.now(), time: e.target.currentTime, ready: e.target.readyState,
      });
    }, true);
    window.__openingVideoFrames = [];
    const seen = new WeakSet();
    window.__openingMediaObserver = new MutationObserver(() => {
      for (const video of document.querySelectorAll(".custom-loading-animation video")) {
        if (seen.has(video)) continue; seen.add(video);
        const videoFrame = (now, metadata) => {
          window.__openingVideoFrames.push({ at: now, ...metadata });
          if (window.__openingCapture && video.isConnected) video.requestVideoFrameCallback(videoFrame);
        };
        video.requestVideoFrameCallback(videoFrame);
      }
    });
    window.__openingMediaObserver.observe(document.body, { childList: true, subtree: true });
    const tick = () => {
      if (!window.__openingCapture) return;
      const opening = document.querySelector('[data-testid="runtime-opening-screen"]');
      const media = document.querySelector(".custom-loading-animation video,.custom-loading-animation img");
      const r = media?.getBoundingClientRect();
      const clocks = element => element?.getAnimations().map(animation => ({
        currentTime: animation.currentTime, startTime: animation.startTime,
        playState: animation.playState, pending: animation.pending,
        timing: animation.effect?.getTiming(), computed: animation.effect?.getComputedTiming(),
      }));
      window.__openingFrames.push({ at: performance.now(), opening: !!opening,
        opacity: opening ? Number(getComputedStyle(opening).opacity) : null,
        mediaOpacity: media ? Number(getComputedStyle(media.closest(".runtime-opening-media") ?? media.parentElement).opacity) : null,
        time: media instanceof HTMLVideoElement ? media.currentTime : null,
        ready: media instanceof HTMLVideoElement ? media.readyState : null,
        mediaAnimations: clocks(media?.closest(".runtime-opening-media")),
        stageAnimations: clocks(opening),
        width: r?.width, height: r?.height,
        loader: !!document.querySelector(".boot-card .project-entry-loader"),
        cardMedia: !!media?.closest(".boot-card"),
        transform: opening ? getComputedStyle(opening).transform : null,
        blackout: !!document.querySelector('[data-testid="game-launch-blackout"]') });
      requestAnimationFrame(tick);
    }; requestAnimationFrame(tick);
  });
}
async function runCase(params, kind, layout, video) {
  const row = { ...params, kind, layout, status: "RUNNING" }; report.cases.push(row); save();
  const cartridgeBase64 = await fixture(kind, layout, video);
  const native = nativeMode ? await installedOpeningPreview({
    installationFile, nativeBuildFile, out, report, save, viewport: params, index: report.cases.length,
    input: path.join(out, `${kind}-${layout}.vncart`),
  }) : undefined;
  const context = native || await browser.newContext({ viewport: { width: params.width, height: params.height },
    deviceScaleFactor: params.dpr, reducedMotion: params.reduced ? "reduce" : "no-preference" });
  const page = native ? native.page : await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on("pageerror", e => errors.push(String(e)));
  let presented;
  try {
    if (!native) await page.goto(`${server.url}/?mode=preview`);
    await page.locator(".boot-card .project-entry-loader").waitFor();
    await record(page);
    if (compositor) presented = await startPresentedFrames(page, path.join(out, `presented-${report.cases.length}`));
    await page.evaluate(cartridgeBase64 => window.postMessage({
      type: "agentvn.runtime.preview", cartridgeBase64, fileName: "opening.vncart", previewNonce: "opening-fixture",
    }, "*"), cartridgeBase64);
    if (kind === "broken") {
      await page.getByRole("alert").waitFor();
      assert.match(await page.getByRole("alert").innerText(), /开屏视频.*播放/);
      assert(await page.getByRole("button", { name: "重试", exact: true }).isVisible());
      row.errorVisible = true;
    } else if (kind !== "default") {
      const media = page.locator(".custom-loading-animation video,.custom-loading-animation img");
      await media.waitFor();
      row.geometry = await media.evaluate(el => {
        const r = el.getBoundingClientRect(), parent = el.parentElement, css = getComputedStyle(parent);
        const stage = el.closest('[data-testid="runtime-opening-screen"]');
        return { media: r.toJSON(), stage: stage?.getBoundingClientRect().toJSON(),
          inCard: !!el.closest(".boot-card"), fit: getComputedStyle(el).objectFit,
          radius: css.borderRadius, border: css.borderWidth, shadow: css.boxShadow,
          overflow: document.documentElement.scrollWidth - innerWidth,
          width: innerWidth, height: innerHeight, dpr: devicePixelRatio };
      });
      assert(!row.geometry.inCard && row.geometry.stage, "Opening must own a separate full-screen stage, never replace the loader card");
      const g = row.geometry;
      assert(Math.abs(g.stage.x) < 1 && Math.abs(g.stage.y) < 1 &&
        Math.abs(g.stage.width - params.width) < 1 && Math.abs(g.stage.height - params.height) < 1, "Stage covers actual viewport");
      assert(g.media.width >= params.width - 1 && g.media.height >= params.height - 1, "Media uses the full stage");
      assert(g.fit === "contain" && g.radius === "0px" && g.border === "0px" && g.shadow === "none" && g.overflow <= 1);
      assert.equal(g.dpr, params.dpr);
      await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
      assert.equal(await page.getByTestId("game-state-playing").count(), 0, "Opening keys cannot activate background start");
      row.input = await page.evaluate(() => {
        const stage = document.querySelector('[data-testid="runtime-opening-screen"]');
        const title = document.querySelector('[data-testid="start-new-game"]');
        const r = title?.getBoundingClientRect();
        return { focused: document.activeElement === stage,
          backgroundInert: document.querySelector(".runtime-boot-content")?.inert,
          titleBlocked: !r || !title.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
      });
      assert(row.input.focused && row.input.backgroundInert && row.input.titleBlocked, "Opening owns both focus and pointer input");
      if (kind === "video") {
        await page.waitForFunction(() => document.querySelector("video")?.currentTime > .15);
        row.playing = await media.evaluate(v => ({ time: v.currentTime, paused: v.paused, duration: v.duration, ready: v.readyState }));
        assert(!row.playing.paused && row.playing.duration > 2);
      }
      if (params.interrupt) {
        await media.evaluate(v => { window.__abandonedOpeningVideo = v; });
        const replacement = await fixture("default", layout, video);
        await page.evaluate(cartridgeBase64 => window.postMessage({
          type: "agentvn.runtime.preview", cartridgeBase64, previewNonce: "replacement",
        }, "*"), replacement);
      }
      const shot = path.join(out, `${params.width}-${params.dpr}-${params.reduced}-${layout}-${kind}${params.interrupt ? "-interrupted" : ""}.png`);
      row.screenshotControl = { skipped: noOpeningShot, before: await page.evaluate(() => performance.now()) };
      if (!noOpeningShot) {
        if (native) report.screenshots.push(await native.shot(shot));
        else await page.screenshot({ path: shot });
        const bytes = fs.readFileSync(shot);
        assert.equal(bytes.readUInt32BE(16), params.width * params.dpr);
        assert.equal(bytes.readUInt32BE(20), params.height * params.dpr);
        if (!native) report.screenshots.push({ path: shot, sha256: sha(bytes), viewport: g });
      }
      row.screenshotControl.after = await page.evaluate(() => performance.now());
      await page.locator('[data-testid="runtime-opening-screen"]').waitFor({ state: "detached" });
      row.frames = await page.evaluate(() => window.__openingFrames);
      assert(row.frames.filter(f => f.opening && f.mediaOpacity > .02 && f.mediaOpacity < .98).length >= 2,
        "Media entrance retains intermediate frames, including an interrupted opening and reduced motion");
      if (!params.interrupt) assert(row.frames.filter(f => f.opening && f.opacity > .02 && f.opacity < .98).length >= 2,
        "Completed opening fades out the full stage before handing input to the title");
      assert(row.frames.filter(f => f.opening).every(f => f.transform === "none" && !f.cardMedia), "No loader scaling/crop inherited");
      if (kind === "video") {
        row.events = await page.evaluate(() => window.__openingEvents);
        if (params.interrupt) {
          assert.equal(row.events.length, 0, "Abandoned opening must not finish the new boot");
          assert(await page.evaluate(() => window.__abandonedOpeningVideo.paused &&
            !window.__abandonedOpeningVideo.hasAttribute("src")), "Unmount releases old playback and source");
        } else {
          assert.equal(row.events.filter(e => e.event === "ended").length, 1);
          assert(row.frames.some(f => f.time > 1 && f.opening), "Do not hide before real video completion");
          const ended = row.events.find(e => e.event === "ended");
          const playingFrames = row.frames.filter(f => f.opening && f.at < ended.at);
          assert(playingFrames.length > 2 && playingFrames.every(f => f.opacity >= .999),
            "Opening backdrop must stay opaque until playback ends; title cannot bleed through the entrance");
          assert(playingFrames.filter(f => f.mediaOpacity > .02 && f.mediaOpacity < .98).length >= 2,
            "Media fades into an opaque full-screen backdrop, including reduced motion");
        }
      }
    }
    if (kind !== "broken") {
      await page.locator(".boot-overlay").waitFor({ state: "detached" });
      await page.getByTestId("start-new-game").click();
      await page.getByTestId("game-launch-blackout").waitFor();
      await page.getByTestId("game-state-playing").waitFor();
      await page.getByTestId("game-launch-blackout").waitFor({ state: "detached" });
      row.storyBlackoutPreserved = true;
      assert.equal(await page.locator(".custom-loading-animation").count(), 0);
    }
    assert.deepEqual(errors, []); row.status = "PASS";
  } catch (e) {
    row.status = "FAILED"; row.error = String(e.stack || e);
    await page.screenshot({ path: path.join(out, `failure-${report.cases.length}.png`) }).catch(() => {});
  } finally {
    await page.evaluate(() => { window.__openingCapture = false; window.__openingMediaObserver?.disconnect(); }).catch(() => {});
    row.events ??= await page.evaluate(() => window.__openingEvents).catch(() => []);
    row.mediaEvents = await page.evaluate(() => window.__openingMediaEvents).catch(() => []);
    row.videoFrames = await page.evaluate(() => window.__openingVideoFrames).catch(() => []);
    if (presented) {
      try { row.presented = await presented.stop(); }
      catch (error) { row.status = "FAILED"; row.captureError = String(error.stack || error); }
    }
    await context.close(); row.contextClosed = true; row.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ ...params, kind, layout, status: row.status, error: row.error }));
  }
}
(async () => {
  let video;
  if (nativeMode) {
    const source = "F:/AgentVN/QA/Runtime-Opening-20261023-01/matrix-03";
    const original = JSON.parse(fs.readFileSync(path.join(source, "report.json"), "utf8"));
    video = fs.readFileSync(path.join(source, "opening-probe.webm"));
    assert.equal(sha(video), original.video.sha256);
    report.video = { bytes: video.length, sha256: sha(video), synthetic: true,
      listeningAcceptance: false, source: path.join(source, "opening-probe.webm") };
    report.tools = [__filename, path.join(__dirname, "lib/installed-opening-preview-session.cjs"),
      path.join(__dirname, "lib/opening-native-build-evidence.cjs"),
      path.join(__dirname, "native-dev-preview-profile.ps1")].map(file => ({
      path: file, sha256: sha(fs.readFileSync(file)),
    }));
    fs.writeFileSync(path.join(out, "opening-probe.webm"), video, { flag: "wx" });
    profilePrepared = true; profile("Prepare");
  } else {
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
    configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(out, "server.log") });
  report.owner = { pid: server.pid, runId: server.runId, url: server.url };
  browser = await chromium.launch(d3d11 ? { args: ["--use-angle=d3d11", "--enable-gpu"] } : {});
  const browserDiagnostic = await browser.newBrowserCDPSession();
  const { gpu } = await browserDiagnostic.send("SystemInfo.getInfo");
  report.renderer = { requested: d3d11 ? "D3D11_HARDWARE" : "BROWSER_DEFAULT",
    browserVersion: browser.version(), devices: gpu.devices, features: gpu.featureStatus,
    implementation: gpu.auxAttributes.glImplementationParts, renderer: gpu.auxAttributes.glRenderer };
  await browserDiagnostic.detach(); save();
  if (d3d11) {
    assert.equal(report.renderer.features.gpu_compositing, "enabled");
    assert(/Direct3D11/.test(report.renderer.renderer) && !/SwiftShader|Basic Render/i.test(report.renderer.renderer));
  }
  const generator = await browser.newPage();
  await generator.goto(server.url);
  const media = await generator.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
    const stream = canvas.captureStream(20), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    const ended = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.ondataavailable = e => chunks.push(e.data);
    const ctx = canvas.getContext("2d"), started = performance.now();
    function draw() { const t = performance.now() - started; ctx.fillStyle = t % 500 < 250 ? "#245779" : "#634875";
      ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = "#fff"; ctx.font = "42px sans-serif";
      ctx.fillText("FULL SCREEN " + Math.round(t), 50, 180);
      if (t < 3000) requestAnimationFrame(draw); else recorder.stop(); }
    recorder.start(); draw(); await ended; stream.getTracks().forEach(t => t.stop());
    return [...new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer())];
  });
  video = Buffer.from(media); fs.writeFileSync(path.join(out, "opening-probe.webm"), video, { flag: "wx" });
  report.video = { bytes: video.length, sha256: sha(video), synthetic: true, listeningAcceptance: false };
  await generator.close();
  }
  const full = process.argv.includes("--matrix"), interruptOnly = process.argv.includes("--interrupt-only");
  assert(!diagnostic4k || !full && !interruptOnly, "Focused diagnostic must not masquerade as full coverage");
  assert(!(full && interruptOnly), "Choose a full matrix or a scoped interruption follow-up");
  report.mode = diagnostic4k ? "4K_REDUCED_SCREENSHOT_DIAGNOSTIC_NOT_ACCEPTANCE"
    : interruptOnly ? "INTERRUPTION_FOLLOWUP" : full ? "FULL_MATRIX" : "SMOKE";
  const matrix = diagnostic4k ? [{ width: 3840, height: 2160, dpr: 1, reduced: true }]
    : full ? [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
    [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))))
    : [{ width: 1920, height: 1080, dpr: 1, reduced: false }];
  const execute = async () => {
    if (!interruptOnly) for (const params of matrix) for (const layout of full ? ["agentvn", "renpy"] : ["agentvn"])
      await runCase(params, "video", layout, video);
    if (full) for (const reduced of [false, true]) for (const kind of ["image_sequence", "default", "broken"])
      await runCase({ width: 1920, height: 1080, dpr: 1, reduced }, kind, "renpy", video);
    if (full || interruptOnly) for (const reduced of [false, true])
      await runCase({ width: 1920, height: 1080, dpr: 1, reduced, interrupt: true }, "video", "agentvn", video);
  };
  if (nativeMode) await execute(); else await server.run(execute);
  assert.equal(report.cases.length, interruptOnly ? 2 : full ? 32 : 1);
  assert(report.cases.every(c => c.status === "PASS"), "Every required flow must pass");
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    await browser?.close(); report.browserClosed = true;
    await server?.stop(); report.serverStopped = true;
    if (profilePrepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profile("Restore");
      const file = path.join(out, "profile-restoration.json");
      assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).status, "PASS");
      report.profileRestoration = { path: file, sha256: sha(fs.readFileSync(file)) };
    }
    if (nativeMode) assert(report.launches?.length === report.cases.length &&
      report.launches.every(l => l.cleanup?.status === "PASS" && !l.cleanupError));
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, error: report.error }));
});
