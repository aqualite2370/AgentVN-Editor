"use strict";
// Acceptance inputs only: no application source or previous evidence is changed.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");
const run = "D:/AgentVN/output/installed-video-20261018-01";
const work = "F:/AgentVN-QA-InstalledVideo-20261018-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const report = { status: "RUNNING", at: new Date().toISOString(), realModelRequests: 0, videos: [], error: null };
let browser;
(async () => {
  assert(fs.existsSync(work) && !fs.existsSync(path.join(run, "fixtures.json")));
  browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [version, color] of [["old", "#663344"], ["new", "#448866"]]) {
    const generated = await page.evaluate(async ({ color }) => {
      const canvas = document.createElement("canvas"); canvas.width = 480; canvas.height = 270;
      const ctx = canvas.getContext("2d"), stream = canvas.captureStream(24), chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
      const done = new Promise((resolve, reject) => {
        recorder.onerror = e => reject(new Error(String(e.error)));
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())));
      });
      let drawnFrames = 0; recorder.start();
      const started = performance.now();
      while (performance.now() - started < 1800) {
        ctx.fillStyle = color; ctx.fillRect(0, 0, 480, 270);
        ctx.fillStyle = "#ffffff"; ctx.fillRect((drawnFrames * 13) % 420, 100, 60, 60);
        ctx.fillStyle = "#000000"; ctx.font = "28px sans-serif"; ctx.fillText(`FRAME ${drawnFrames}`, 10, 45);
        drawnFrames++;
        // Input generation clock, not a fixed acceptance/readiness wait.
        await new Promise(resolve => setTimeout(resolve, 1000 / 24));
      }
      recorder.stop(); const bytes = await done; stream.getTracks().forEach(t => t.stop());
      const video = document.createElement("video"); video.muted = true; document.body.append(video);
      video.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "video/webm" }));
      let frames = 0, lastTime = 0; const times = [];
      const observe = () => video.requestVideoFrameCallback((_, m) => {
        frames++; lastTime = m.mediaTime; if (times.length < 100) times.push(m.mediaTime); observe();
      });
      observe();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Fixture decode timeout")), 10000);
        video.onerror = () => { clearTimeout(timer); reject(new Error(`Fixture decode error ${video.error?.code}`)); };
        video.onended = () => { clearTimeout(timer); resolve(); };
        video.play().catch(reject);
      });
      const decoded = { width: video.videoWidth, height: video.videoHeight, duration: video.duration,
        currentTime: video.currentTime, frames, lastTime, times, ended: video.ended, drawnFrames };
      URL.revokeObjectURL(video.src); video.remove(); return { bytes, decoded };
    }, { color });
    assert(generated.decoded.frames >= 15 && generated.decoded.lastTime > 1
      && generated.decoded.duration > 1 && generated.decoded.ended, "Genuine multiframe decode required");
    const file = path.join(work, `视频-${version}-多帧.webm`), bytes = Buffer.from(generated.bytes);
    fs.writeFileSync(file, bytes, { flag: "wx" });
    report.videos.push({ version, path: file, sha256: sha(bytes), bytes: bytes.length, decoded: generated.decoded });
  }
  assert.notEqual(report.videos[0].sha256, report.videos[1].sha256);
  const prior = read("D:/AgentVN/output/installed-assets-20261018-01/save-01/report.json").package;
  assert.equal(sha(fs.readFileSync(prior.retained)), prior.sha256);
  const zip = await JSZip.loadAsync(fs.readFileSync(prior.retained));
  const project = JSON.parse(await zip.file("project.json").async("string"));
  project.project_id = "installed-video-isolated-20261018-01";
  project.title = "安装版多帧视频替换验收_20261018";
  const scene = project.nodes.find(n => n.data?.scene).data.scene;
  scene.commands = [
    { type: "background", background_id: "qa_background", background_fit: "contain" },
    { type: "narration", text: "QA_MULTIFRAME_BEFORE_VIDEO" },
    { type: "video", video_id: "qa_video", video_fit: "contain", fade_in_ms: 0, fade_out_ms: 0 },
    { type: "narration", text: "QA_MULTIFRAME_AFTER_VIDEO" },
  ];
  for (const asset of project.asset_manifest) {
    const bytes = asset.asset_id === "qa_video" ? fs.readFileSync(report.videos[0].path)
      : await zip.file(asset.metadata.project_path).async("nodebuffer");
    asset.metadata.data_url = `data:${asset.metadata.mime_type};base64,${bytes.toString("base64")}`;
    if (asset.asset_id === "qa_video") {
      asset.metadata.filename = path.basename(report.videos[0].path);
      asset.metadata.width = 480; asset.metadata.height = 270;
      asset.metadata.duration_ms = report.videos[0].decoded.duration * 1000;
    }
  }
  report.input = path.join(work, "安装版多帧视频替换.vnproj");
  fs.writeFileSync(report.input, JSON.stringify(project), { flag: "wx" });
  report.inputSha256 = sha(fs.readFileSync(report.input)); report.projectId = project.project_id; report.title = project.title;
  report.preparationScope = "CONTROLLED_LOCAL_FIXTURE_FROM_PREVIOUS_SAVED_PACKAGE; explicit video commands, NOT GUI authoring or native import";
  report.priorPackage = prior; report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(run, "fixtures.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, videos: report.videos.map(v => ({ ...v, decoded: { ...v.decoded, times: undefined } })), error: report.error }, null, 2));
});
