"use strict";

// Creates an isolated authored project, not an installed-editor export. The
// subsequent acceptance must import this .vnproj and export through the real UI.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const JSZip = require("../editor/node_modules/jszip");
const sharp = require("../GameCli_framework/node_modules/sharp");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");

const root = path.resolve(__dirname, "..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const output = path.resolve(process.argv[2] || "");
assert(process.argv[2], "Pass a fresh isolated output directory");
assert(process.argv.slice(3).every(arg => arg === "--agentvn-default"), "Unknown fixture option");
const agentvnDefault = process.argv.includes("--agentvn-default");
const relative = path.relative(path.join(root, "output"), output);
assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative),
  "Acceptance input must be inside output");
assert(!fs.existsSync(output), "Never overwrite an existing acceptance directory");

const mod = { exports: {} };
new Function("module", "exports", "require", buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export { switchRuntimeUILayoutType } from "./shared/cartridge/uiLayoutProfiles";
    export { exportScript } from "./editor/src/utils/exportScript";
    export { readProjectJsonFromBundle } from "./editor/src/utils/projectBundle";
    export { validateRuntimeScript, validateAssetReferences } from "./shared/cartridge/validators";
    export { minimumRuntimeVersionForScript } from "./shared/cartridge/runtimeCapabilities";
  ` },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(mod, mod.exports, require);

function tone() {
  const rate = 22050, frames = rate * 3;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) {
    const envelope = Math.min(1, frame / (rate * .02), (frames - frame - 1) / (rate * .02));
    bytes.writeInt16LE(Math.round(Math.sin(frame * 2 * Math.PI * 440 / rate) * 4000 * envelope),
      44 + frame * 2);
  }
  return bytes;
}

async function main() {
  const id = `installed_resource_flow_story_${randomUUID().replaceAll("-", "")}`;
  const project = fixture(id);
  project.title = `${agentvnDefault ? "默认标题隔离验收" : "完整剧情隔离验收"} ${id.slice(-8)}`;
  // Absence is intentional: exercise the old-project/default-layout path,
  // rather than adding a hand-authored layout that could mask the title bug.
  project.editor_settings = agentvnDefault ? {} : mod.exports.switchRuntimeUILayoutType({}, "renpy");
  project.editor_settings.characterDisplayNames = { alice: "小岚" };
  const common = project.nodes.find(node => node.id === "scene").data;
  let sceneIndex = 0;
  const scene = (id, title, commands, ending = false) => ({
    id, type: "sceneNode", position: { x: 320 + sceneIndex++ * 500, y: 180 },
    data: { ...structuredClone(common), label: title,
      scene: { scene_id: id, title, summary: "本轮隔离验收，不含用户工程内容",
        chapter: 1, tags: ["isolated-acceptance"], commands,
        ...(ending ? { is_ending: true, ending_id: id, ending_title: title } : {}) } },
  });
  const longText = "长对白验收：自动缩小到可读下限后分页，逐页点击保留全部字符，菜单往返与存读档保持位置。".repeat(160);
  const nvlText = "NVL 超长单句验收：清页、分页、快存、快读和回滚之后不重播或丢失文字。".repeat(160);
  const bubbleText = "气泡超长验收：角色移动与边缘安全区不裁切文字，达到字号下限后按页推进。".repeat(70);
  project.nodes = [
    project.nodes[0],
    scene("main", "普通对白与分支", [
      { type: "background", background_id: "story_background", transition: "fade" },
      { type: "bgm", action: "play", bgm_id: "story_tone", volume: .25, fade_ms: 0 },
      { type: "sprite", character_id: "alice", sprite_id: "story_sprite", position: "center", visible: true, scale: .72 },
      { type: "dialog", character_id: "alice", text: "第一句：确认背景、立绘、普通对白与八项快捷栏。", presentation_mode: "dialog" },
      { type: "dialog", character_id: "alice", text: longText, presentation_mode: "dialog" },
      { type: "dialog", character_id: "alice", text: "第二句：分页结束后有效回退、快存快读和手动存读档。", presentation_mode: "dialog" },
      { type: "choice", choices: [
        { choice_id: "read_nvl", text: "验证 NVL 累积阅读", target_scene_id: "nvl", conditions: [] },
        { choice_id: "read_bubble", text: "验证气泡跟随", target_scene_id: "bubble", conditions: [] },
      ] },
    ]),
    scene("nvl", "NVL 累积与清页", [
      { type: "background", background_id: "story_background", transition: "fade" },
      { type: "sprite", character_id: "alice", sprite_id: "story_sprite", position: "center", visible: true, scale: .72 },
      { type: "dialog", character_id: "alice", text: "NVL 第一行保留。", presentation_mode: "nvl" },
      { type: "narration", text: "NVL 第二行累积，打开菜单不清空。", presentation_mode: "nvl" },
      { type: "dialog", character_id: "alice", text: nvlText, presentation_mode: "nvl", clear_nvl_page_before: true },
      { type: "choice", choices: [
        { choice_id: "continue_bubble", text: "继续验证气泡", target_scene_id: "bubble", conditions: [] },
      ] },
    ]),
    scene("bubble", "气泡跟随、离场与长文", [
      { type: "background", background_id: "story_background", transition: "fade" },
      { type: "sprite", character_id: "alice", sprite_id: "story_sprite", position: "center", visible: true, scale: .72 },
      { type: "dialog", character_id: "alice", text: "气泡跟随中央角色。", presentation_mode: "bubble" },
      { type: "camera", motion: { schema_version: 1, kind: "reframe",
        to: { center_x: .5, center_y: .5, zoom: 1.1 }, duration_ms: 240, easing: "linear" }, blocking: false },
      { type: "sprite", character_id: "alice", sprite_id: "story_sprite", position: "right", visible: true, scale: .8 },
      { type: "dialog", character_id: "alice", text: "气泡随角色与镜头移动。", presentation_mode: "bubble",
        bubble_position: { mode: "character", offset_x: 2, offset_y: -2 } },
      { type: "sprite", character_id: "alice", sprite_id: "story_sprite", position: "right", visible: false },
      { type: "dialog", character_id: "alice", text: "角色离场时使用安全回退锚点。", presentation_mode: "bubble" },
      { type: "dialog", character_id: "alice", text: bubbleText, presentation_mode: "bubble",
        bubble_position: { mode: "fixed", x: 94, y: 94 } },
      { type: "jump", target_scene_id: "finish" },
    ]),
    scene("finish", "验收结束", [
      { type: "background", background_id: "story_background", transition: "fade" },
      { type: "dialog", character_id: "alice", text: "验收结束：返回普通对白，玩家仍可保存和打开菜单。", presentation_mode: "dialog" },
    ], true),
  ];
  project.edges = [{ id: "entry", source: "start", target: "main", sourceHandle: "default" }];
  const background = await sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#15283b"/><path d="M0 660L480 180 980 650 1450 260 1920 700V1080H0Z" fill="#31566a"/><circle cx="1500" cy="180" r="70" fill="#dfc397"/></svg>'))
    .png().toBuffer();
  const sprite = await sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="900"><circle cx="240" cy="165" r="100" fill="#e4bfa6"/><path d="M145 130Q240 -20 335 130L340 210 310 160 150 160 140 210Z" fill="#25324a"/><path d="M140 295Q240 240 340 295L410 850H70Z" fill="#71a6b5"/></svg>'))
    .png().toBuffer();
  const assets = [
    { id: "story_background", type: "background", filename: "隔离背景.png", mime: "image/png", bytes: background, width: 1920, height: 1080 },
    { id: "story_sprite", type: "sprite", filename: "隔离立绘.png", mime: "image/png", bytes: sprite, width: 480, height: 900 },
    { id: "story_tone", type: "bgm", filename: "合成测试音.wav", mime: "audio/wav", bytes: tone() },
  ];
  const zip = new JSZip();
  project.asset_manifest = assets.map(asset => {
    const file = `assets/${asset.type}/${asset.filename}`;
    zip.file(file, asset.bytes);
    return { asset_id: asset.id, asset_type: asset.type,
      metadata: { filename: asset.filename, display_name: asset.id, mime_type: asset.mime,
        path: file, project_path: file, size_bytes: asset.bytes.length, hash_sha256: hash(asset.bytes),
        width: asset.width, height: asset.height, source: "isolated-generated-fixture" } };
  });
  const projectText = JSON.stringify(project, null, 2);
  zip.file("project.json", projectText);
  zip.file("format.json", JSON.stringify({ format: "agentvn-vnproj-zip", version: 1,
    projectHashSha256: hash(Buffer.from(projectText)), assetCount: assets.length,
    totalAssetBytes: assets.reduce((sum, asset) => sum + asset.bytes.length, 0) }));
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const reopened = await mod.exports.readProjectJsonFromBundle(new File([bytes], "完整剧情.vnproj"));
  assert.equal(reopened.project_id, id);
  for (const asset of reopened.asset_manifest) {
    assert.equal(hash(Buffer.from(asset.metadata.data_url.split(",")[1], "base64")), asset.metadata.hash_sha256);
  }
  const script = { ...mod.exports.exportScript(reopened.nodes, reopened.edges), game_id: id, title: project.title };
  assert.equal(script.scenes.length, 4, "All explicitly targeted branches must survive real graph export");
  assert.equal(new Set(project.nodes.filter(node => node.type === "sceneNode")
    .map(node => `${node.position.x},${node.position.y}`)).size, 4, "Authored scene cards require distinct positions");
  for (const current of script.scenes) assert(current.commands.some(command => command.type === "background"
    && command.background_id === "story_background"), `${current.scene_id}: explicit scene background required`);
  const bubbleScene = script.scenes.find(current => current.scene_id === "bubble");
  const firstBubble = bubbleScene.commands.findIndex(command => command.type === "dialog");
  assert(bubbleScene.commands.slice(0, firstBubble).some(command => command.type === "sprite"
    && command.character_id === "alice" && command.visible !== false),
  "Bubble entry must show its own character; scene-local sprites do not carry across a jump");
  const validation = mod.exports.validateRuntimeScript(script);
  assert(validation.ok, JSON.stringify(validation.errors));
  const references = mod.exports.validateAssetReferences(script, {
    assets: project.asset_manifest.map(asset => ({ asset_id: asset.asset_id, asset_type: asset.asset_type,
      mime_type: asset.metadata.mime_type, path: asset.metadata.project_path })),
  });
  assert(references.ok, JSON.stringify(references.errors));
  fs.mkdirSync(output);
  const file = path.join(output, "完整剧情 隔离工程.vnproj");
  fs.writeFileSync(file, bytes, { flag: "wx" });
  fs.writeFileSync(path.join(output, "fixture-report.json"), JSON.stringify({
    status: "FIXTURE_VALIDATED", scope: "authored-isolated-project-not-installed-export-or-runtime-pass",
    generatedAt: new Date().toISOString(), input: file, sha256: hash(bytes), bytes: bytes.length,
    projectId: id, title: project.title, layoutType: agentvnDefault ? "agentvn" : "renpy",
    ...(agentvnDefault ? { layoutSource: "absent-project-default",
      titleCoverage: "AgentVN default, no authored theme or title color" } : {}),
    scenes: script.scenes.map(scene => scene.scene_id),
    minimumRuntime: mod.exports.minimumRuntimeVersionForScript(script),
    coveragePlanned: ["background", "sprite", "long-dialogue", "branch", "nvl", "bubble", "save-load", "rollback", "rotation"],
    audio: { source: "generated 440 Hz fixture tone; not a new listening confirmation",
      priorUserConfirmationPreserved: true },
    assets: project.asset_manifest,
  }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: "FIXTURE_VALIDATED", file, title: project.title, projectId: id }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
