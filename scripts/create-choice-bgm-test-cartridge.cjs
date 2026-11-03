const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const JSZip = require("../editor/node_modules/jszip");

const root = path.resolve(__dirname, "..");
const outputPath = path.resolve(
  process.argv[2] || path.join(root, "output", "choice-bgm-acceptance", "choice-bgm-acceptance.vncart"),
);

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function svg(width, height, body) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
    "utf8",
  );
}

function wavSine(durationSeconds = 30, sampleRate = 8000) {
  const sampleCount = Math.round(durationSeconds * sampleRate);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const carrier = Math.sin(2 * Math.PI * 220 * time) * 0.19;
    const pulse = Math.sin(2 * Math.PI * 2 * time) > 0.92 ? 0.12 : 0;
    buffer.writeInt16LE(Math.round((carrier + pulse) * 32767), 44 + index * 2);
  }
  return buffer;
}

async function main() {
  const now = new Date().toISOString();
  const zip = new JSZip();
  const entries = [];
  const add = (entryPath, data) => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
    zip.file(entryPath, bytes);
    entries.push({
      path: entryPath,
      size_bytes: bytes.byteLength,
      hash_sha256: sha256(bytes),
    });
    return bytes;
  };

  const background = svg(1280, 720, `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#111938"/>
        <stop offset="0.55" stop-color="#342153"/>
        <stop offset="1" stop-color="#0a5661"/>
      </linearGradient>
      <radialGradient id="r">
        <stop offset="0" stop-color="#f6bad6" stop-opacity=".52"/>
        <stop offset="1" stop-color="#f6bad6" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1280" height="720" fill="url(#g)"/>
    <circle cx="960" cy="150" r="310" fill="url(#r)"/>
    <path d="M0 590 C250 470 400 670 650 540 S1020 430 1280 570 V720 H0Z" fill="#050914" opacity=".74"/>
    <text x="56" y="90" fill="#ffffff" font-size="34" font-family="sans-serif" font-weight="700">BGM / 选项按钮自动化验收</text>
    <text x="58" y="132" fill="#c7d9ff" font-size="18" font-family="sans-serif">切换菜单后音乐应继续；分支按钮应显示不同图片适配样式。</text>
  `);
  const sceneButton = svg(720, 128, `
    <defs><linearGradient id="s" x1="0" x2="1"><stop stop-color="#5d2ca8"/><stop offset="1" stop-color="#c14b9d"/></linearGradient></defs>
    <rect width="720" height="128" rx="28" fill="url(#s)"/>
    <path d="M0 96 L180 50 L360 98 L540 42 L720 88 V128 H0Z" fill="#f7d0ed" opacity=".24"/>
    <rect x="5" y="5" width="710" height="118" rx="24" fill="none" stroke="#ffdff4" stroke-width="6"/>
  `);
  const singleButton = svg(240, 180, `
    <rect width="240" height="180" fill="#0b5772"/>
    <path d="M-20 145 L95 20 L145 70 L260 -35" fill="none" stroke="#75f1e2" stroke-width="30"/>
    <circle cx="195" cy="132" r="42" fill="#ffd16f"/>
    <circle cx="195" cy="132" r="18" fill="#39234f"/>
  `);
  const bgm = wavSine();

  const assets = [
    ["acceptance_background", "background", "assets/backgrounds/acceptance-background.svg", "acceptance-background.svg", "image/svg+xml", background],
    ["acceptance_bgm", "bgm", "assets/bgm/acceptance-loop.wav", "acceptance-loop.wav", "audio/wav", bgm],
    ["button_scene", "ui", "assets/ui/button-scene.svg", "button-scene.svg", "image/svg+xml", sceneButton],
    ["button_single", "ui", "assets/ui/button-single.svg", "button-single.svg", "image/svg+xml", singleButton],
  ].map(([asset_id, asset_type, assetPath, filename, mime_type, data]) => {
    const bytes = add(assetPath, data);
    return {
      asset_id,
      asset_type,
      path: assetPath,
      filename,
      mime_type,
      size_bytes: bytes.byteLength,
      hash_sha256: sha256(bytes),
      preload: true,
      tags: ["acceptance"],
    };
  });

  const uiSkin = {
    ui_layout_version: "1.0.0",
    name: "Choice Button Acceptance Skin",
    target_runtime: "0.1.0",
    tokens: {
      colorBackground: "#050816",
      colorSurface: "#11172a",
      colorSurfaceStrong: "#202a46",
      colorInk: "#f7f8ff",
      colorMuted: "#b8c3dc",
      colorAccent: "#7be4d5",
      colorAccent2: "#f1a7ce",
      colorLine: "#b9c7eb",
      colorPanel: "#0b1020",
      colorPanelText: "#f7f8ff",
      colorControl: "#1d2844",
      colorControlHover: "#2b3b64",
      colorControlActive: "#7be4d5",
      colorControlText: "#f7f8ff",
      colorDialog: "#060a14",
      colorDialogText: "#f7f8ff",
      colorSpeakerPlate: "#24355d",
      colorSpeakerText: "#e4edff",
      colorChoice: "#7be4d5",
      colorChoiceText: "#061512",
      colorQuickMenu: "#11172a",
      colorFocus: "#fff19b",
      radius: 12,
      motionScale: 1,
      fontScale: 1,
    },
    assets: [],
    screens: [
      {
        screen_id: "title",
        components: [
          { component_id: "title_hero", component_type: "main_menu_hero", required: true, rect: { x: 6, y: 24, width: 60, height: 44 } },
          { component_id: "title_continue_button", component_type: "main_menu_continue_button", required: true, rect: { x: 76, y: 25, width: 20, height: 7 } },
          { component_id: "title_start_button", component_type: "main_menu_start_button", required: true, rect: { x: 76, y: 34, width: 20, height: 7 } },
          { component_id: "title_save_load_button", component_type: "main_menu_save_load_button", required: true, rect: { x: 76, y: 43, width: 20, height: 7 } },
          { component_id: "title_library_button", component_type: "main_menu_library_button", required: true, rect: { x: 76, y: 52, width: 20, height: 7 } },
          { component_id: "title_gallery_button", component_type: "main_menu_gallery_button", required: true, rect: { x: 76, y: 61, width: 20, height: 7 } },
          { component_id: "title_settings_button", component_type: "main_menu_settings_button", required: true, rect: { x: 76, y: 70, width: 20, height: 7 } },
          { component_id: "title_about_button", component_type: "main_menu_about_button", required: true, rect: { x: 76, y: 79, width: 20, height: 7 } },
        ],
      },
      {
        screen_id: "player",
        components: [
          { component_id: "stage_background", component_type: "stage_background", rect: { x: 0, y: 0, width: 100, height: 100 }, zIndex: 0 },
          { component_id: "dialog_panel", component_type: "dialog_panel", required: true, rect: { x: 6, y: 76, width: 88, height: 18 }, style: { backgroundColor: "#060a14", borderRadius: 16, padding: 10, backdropBlur: 16 }, zIndex: 30 },
          { component_id: "dialog_text", component_type: "dialog_text", rect: { x: 8, y: 80, width: 84, height: 10 }, style: { color: "#f7f8ff", fontSize: 24 }, zIndex: 35 },
          { component_id: "choice_list", component_type: "choice_list", required: true, rect: { x: 50, y: 43, width: 42, height: 34, anchor: "center" }, style: { gap: 14 }, zIndex: 40 },
          { component_id: "choice_option", component_type: "choice_option", required: true, style: { backgroundColor: "#247b68", color: "#ffffff", borderColor: "#a9fff0", borderWidth: 2, borderRadius: 16, padding: 13, fontSize: 21, fontWeight: 760, shadow: "soft" }, zIndex: 41 },
          { component_id: "quick_menu", component_type: "quick_menu", required: true, rect: { x: 98, y: 2, width: 48, height: 9, anchor: "top_right" }, zIndex: 50 },
        ],
      },
      { screen_id: "game_menu", components: [{ component_id: "game_menu_nav", component_type: "game_menu_nav", required: true, rect: { x: 5, y: 12, width: 90, height: 12 } }] },
      { screen_id: "save_load", components: [{ component_id: "save_grid", component_type: "save_slot_grid", required: true, rect: { x: 4, y: 20, width: 92, height: 74 } }] },
      { screen_id: "preferences", components: [{ component_id: "settings_group", component_type: "settings_group", required: true, rect: { x: 5, y: 18, width: 90, height: 72 } }] },
      { screen_id: "history", components: [{ component_id: "history_list", component_type: "history_list", required: true, rect: { x: 5, y: 18, width: 90, height: 72 } }] },
      { screen_id: "gallery", components: [{ component_id: "gallery_grid", component_type: "gallery_grid", required: true, rect: { x: 5, y: 18, width: 90, height: 72 } }] },
      { screen_id: "about", components: [{ component_id: "about_panel", component_type: "about_panel", required: true, rect: { x: 5, y: 18, width: 90, height: 64 } }] },
    ],
  };

  const script = {
    schema_version: "1.1.0",
    game_id: "choice_bgm_acceptance",
    title: "选项按钮与 BGM 验收",
    entry_scene_id: "scene_start",
    scenes: [
      {
        scene_id: "scene_start",
        title: "自动化验收场景",
        summary: "检查 BGM 跨页面连续播放与按钮样式优先级。",
        chapter: 1,
        tags: ["acceptance"],
        commands: [
          { type: "background", background_id: "acceptance_background", background_fit: "cover" },
          { type: "bgm", bgm_id: "acceptance_bgm", action: "play", volume: 0.72, fade_ms: 0 },
          { type: "narration", text: "自动化步骤：先打开设置、记录、存档和主菜单，再返回正文。背景音乐不应从头重播。" },
          { type: "narration", text: "继续前进即可看到两种不同的按钮图片样式。" },
          {
            type: "choice",
            button_style: {
              backgroundImage: "asset:button_scene",
              backgroundFit: "cover",
              color: "#ffffff",
              borderColor: "#ffd8f2",
              borderWidth: 2,
              borderRadius: 18,
              padding: 14,
              fontSize: 22,
              fontWeight: 760,
              shadow: "strong",
            },
            choices: [
              {
                choice_id: "choice_single",
                text: "单按钮：拉伸图片",
                target_scene_id: "scene_single",
                conditions: [],
                button_style: {
                  backgroundImage: "asset:button_single",
                  backgroundFit: "stretch",
                  color: "#ffffff",
                  borderColor: "#75f1e2",
                  borderWidth: 3,
                  borderRadius: 8,
                },
              },
              {
                choice_id: "choice_scene",
                text: "场景全部：裁切铺满",
                target_scene_id: "scene_scene",
                conditions: [],
              },
            ],
          },
        ],
      },
      {
        scene_id: "scene_single",
        title: "单按钮样式通过",
        summary: "",
        chapter: 1,
        tags: ["acceptance"],
        commands: [{ type: "narration", text: "已选择单按钮样式。验收完成。" }],
        is_ending: true,
        ending_id: "ending_single",
      },
      {
        scene_id: "scene_scene",
        title: "场景样式通过",
        summary: "",
        chapter: 1,
        tags: ["acceptance"],
        commands: [{ type: "narration", text: "已选择当前场景全部按钮样式。验收完成。" }],
        is_ending: true,
        ending_id: "ending_scene",
      },
    ],
  };

  const manifest = {
    manifest_version: "1.0.0",
    cartridge_version: "1.0.0",
    runtime_version: "0.1.0",
    game_id: script.game_id,
    title: script.title,
    author: "AgentVN 自动化验收",
    description: "验证 BGM 跨菜单连续播放、选项按钮背景图和样式作用域。",
    version: "1.0.0",
    language: "zh-CN",
    tags: ["acceptance", "choice-style", "bgm"],
    entry_script: "script.json",
    entry_scene_id: script.entry_scene_id,
    ui_skin: { path: "ui/layout.json", version: "1.0.0", name: uiSkin.name },
    assets,
    created_at: now,
    updated_at: now,
  };

  add("manifest.json", JSON.stringify(manifest, null, 2));
  add("script.json", JSON.stringify(script, null, 2));
  add("gallery.json", JSON.stringify({ gallery_version: "1.0.0", items: [] }, null, 2));
  add("ui/layout.json", JSON.stringify(uiSkin, null, 2));
  zip.file("checksum.json", JSON.stringify({
    checksum_version: "1.0.0",
    algorithm: "sha256",
    generated_at: now,
    files: entries.sort((left, right) => left.path.localeCompare(right.path)),
  }, null, 2));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
