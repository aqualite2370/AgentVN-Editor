const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-startup-index-"));

function write(relativePath, content) {
  const target = path.join(fixture, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function fileEntry(relativePath) {
  const bytes = fs.readFileSync(path.join(fixture, ...relativePath.split("/")));
  return {
    path: relativePath,
    size_bytes: bytes.length,
    hash_sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

try {
  write("assets/title.png", Buffer.from("title"));
  write("assets/entry.png", Buffer.from("entry"));
  write("assets/next.png", Buffer.from("next"));
  write("assets/font.ttf", Buffer.from("font"));
  write("ui/layout.json", JSON.stringify({
    assets: [],
    screens: [
      {
        screen_id: "title",
        components: [{ style: { backgroundImage: "assets/title.png", fontAssetId: "font" } }],
      },
      {
        screen_id: "player",
        components: [{ style: { fontAssetId: "font" } }],
      },
    ],
  }));
  write("manifest.json", JSON.stringify({
    game_id: "fixture",
    title: "Fixture",
    author: "AgentVN",
    version: "1.0.0",
    language: "zh-CN",
    description: "",
    cover: "title",
    shell: { background: "title" },
    ui_skin: { path: "ui/layout.json" },
    assets: [
      { asset_id: "title", asset_type: "background", path: "assets/title.png", mime_type: "image/png", preload: true },
      { asset_id: "entry", asset_type: "background", path: "assets/entry.png", mime_type: "image/png", preload: false },
      { asset_id: "next", asset_type: "background", path: "assets/next.png", mime_type: "image/png", preload: false },
      { asset_id: "font", asset_type: "font", path: "assets/font.ttf", mime_type: "font/ttf", preload: true },
    ],
  }));
  write("script.json", JSON.stringify({
    game_id: "fixture",
    title: "Fixture",
    entry_scene_id: "entry-scene",
    scenes: [
      {
        scene_id: "entry-scene",
        commands: [{ type: "background", background_id: "entry" }],
        next_scene_id: "next-scene",
      },
      {
        scene_id: "next-scene",
        commands: [{ type: "background", background_id: "next" }],
      },
    ],
  }));
  write("gallery.json", JSON.stringify({ gallery_version: "1.0.0", items: [] }));
  const checksumFiles = [
    "assets/title.png",
    "assets/entry.png",
    "assets/next.png",
    "assets/font.ttf",
    "manifest.json",
    "script.json",
    "gallery.json",
    "ui/layout.json",
  ].map(fileEntry);
  write("checksum.json", JSON.stringify({
    checksum_version: "1.0.0",
    algorithm: "sha256",
    files: checksumFiles,
  }));

  const result = spawnSync(process.execPath, [
    path.join(root, "scripts", "build-release-runtime-assets.cjs"),
    fixture,
    "--profile",
    "off",
  ], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const index = JSON.parse(fs.readFileSync(path.join(fixture, "startup-index.json"), "utf8"));
  assert.equal(index.schemaVersion, "1.0");
  assert.match(index.contentId, /^[a-f0-9]{64}$/);
  assert.deepEqual(new Set(index.titleAssets), new Set(["title", "font"]));
  assert.deepEqual(new Set(index.entrySceneAssets), new Set(["entry", "font"]));
  assert.deepEqual(index.nextScenes["entry-scene"], ["next-scene"]);
  assert.deepEqual(index.sceneAssets["next-scene"].sort(), ["font", "next"]);
  assert.deepEqual(new Set(index.legacyPreloadHints), new Set(["title", "font"]));
  assert.equal(Object.keys(index.files).length, 4);
  console.log(JSON.stringify({ ok: true, contentId: index.contentId }));
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
