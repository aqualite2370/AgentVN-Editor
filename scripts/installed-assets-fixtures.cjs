"use strict";
// Local-only generated inputs, never model requests or product mutation.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const work = "F:/AgentVN-QA-InstalledAssets-20261018-01";
const out = "D:/AgentVN/output/installed-assets-20261018-01";
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const types = ["background", "sprite", "portrait", "bgm", "sfx", "voice", "video", "animation", "ui", "font", "other"];
function wav(seconds, frequency) {
  const n = Math.floor(seconds * 8000), bytes = Buffer.alloc(44 + n * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) bytes.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * frequency / 8000) * 4000), 44 + i * 2);
  return bytes;
}
async function video(browser, width, height, color) {
  const page = await browser.newPage();
  try {
    return Buffer.from(await page.evaluate(async ({ width, height, color }) => {
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d"), stream = canvas.captureStream(10);
      const chunks = [], recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
      const done = new Promise(resolve => { recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))); });
      recorder.start(); ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
      // Fixture generation timing only, not an acceptance wait or readiness check.
      await new Promise(resolve => setTimeout(resolve, 650)); recorder.stop();
      const bytes = await done; stream.getTracks().forEach(t => t.stop()); return bytes;
    }, { width, height, color }));
  } finally { await page.close(); }
}
(async () => {
  assert(fs.existsSync(work) && fs.existsSync(out), "Run protected session Prepare first");
  assert(!fs.existsSync(path.join(out, "fixtures.json")), "Fresh fixture evidence required");
  const inputDir = path.join(work, "inputs"); fs.mkdirSync(inputDir);
  const browser = await chromium.launch();
  const videos = {};
  try { videos.old = await video(browser, 320, 180, "#663344"); videos.new = await video(browser, 480, 270, "#448866"); }
  finally { await browser.close(); }
  const project = fixture("installed-assets-isolated-20261018-01");
  project.title = "安装版全类型素材替换验收_20261018";
  project.schema_version = "1.1.0";
  project.nodes[1].data.scene.commands = [
    { type: "background", background_id: "qa_background", background_fit: "cover" },
    { type: "narration", text: "全类型素材替换独立工程：升级后背景应为绿色。" },
  ];
  project.editor_settings.assetLibrary = { folders: [{ folder_id: "qa_folder", name: "原文件夹",
    parent_folder_id: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
    assetLocations: {} };
  const evidence = { status: "PASS", at: new Date().toISOString(), types: [], projectId: project.project_id,
    realModelRequests: 0, fixtureScope: "Synthetic local media and installed Windows Arial fonts; no public redistribution" };
  for (const type of types) {
    const image = ["background", "sprite", "portrait", "ui", "other"].includes(type);
    const audio = ["bgm", "sfx", "voice"].includes(type);
    const extension = image ? "svg" : audio ? "wav" : type === "video" ? "webm" : type === "font" ? "ttf" : "json";
    const mime = image ? "image/svg+xml" : audio ? "audio/wav" : type === "video" ? "video/webm"
      : type === "font" ? "font/ttf" : "application/json";
    const row = { type, id: `qa_${type}`, mime, files: {} };
    for (const version of ["old", "new"]) {
      const isNew = version === "new";
      const bytes = image ? Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${isNew ? 900 : 600}" height="${isNew ? 600 : 400}"><rect width="100%" height="100%" fill="${isNew ? "#448866" : "#663344"}"/><text x="20" y="80" fill="white" font-size="30">${type}-${version}</text></svg>`)
        : audio ? wav(isNew ? .8 : .4, isNew ? 660 : 330)
        : type === "video" ? videos[version]
        : type === "font" ? fs.readFileSync(`C:/Windows/Fonts/${isNew ? "arialbd" : "arial"}.ttf`)
        : Buffer.from(JSON.stringify({ version: isNew ? 2 : 1, frames: [], marker: `qa-${version}` }));
      const file = path.join(inputDir, `${type}-${isNew ? "升级" : "原始"}.${extension}`);
      fs.writeFileSync(file, bytes, { flag: "wx" });
      row.files[version] = { path: file, sha256: sha(bytes), bytes: bytes.length };
      if (!isNew) project.asset_manifest.push({ asset_id: row.id, asset_type: type, metadata: {
        display_name: `${type}保留名称`, filename: path.basename(file), mime_type: mime, size_bytes: bytes.length,
        data_url: `data:${mime};base64,${bytes.toString("base64")}`, source: "generated",
        project_path: `assets/${type}/${path.basename(file)}`, width: image ? 600 : undefined,
        height: image ? 400 : undefined, duration_ms: audio ? 400 : undefined,
        hash_sha256: sha(bytes), license_note: "旧授权待核对", provider_id: "qa-old-provider",
        model: "qa-old-model", prompt: "qa-old-prompt", generation: { qa: "old" },
        tags: ["qa-identity"], created_at: "2026-10-01T00:00:00Z" } });
    }
    project.editor_settings.assetLibrary.assetLocations[row.id] = { primaryFolderId: "qa_folder", linkedFolderIds: [] };
    evidence.types.push(row);
  }
  evidence.input = path.join(work, "安装版全类型素材替换.vnproj");
  fs.writeFileSync(evidence.input, JSON.stringify(project), { flag: "wx" });
  evidence.inputSha256 = sha(fs.readFileSync(evidence.input));
  fs.writeFileSync(path.join(out, "fixtures.json"), JSON.stringify(evidence, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: evidence.status, count: evidence.types.length, input: evidence.input }));
})().catch(error => { console.error(error); process.exitCode = 1; });
