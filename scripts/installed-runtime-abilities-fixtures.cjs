"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const run = "D:/AgentVN/output/installed-runtime-abilities-20261018-01";
const work = "F:/AgentVN-QA-InstalledRuntimeAbilities-20261018-01";
const revision = process.argv[2] || "02";
assert(/^\d{2}$/.test(revision));
const prep = JSON.parse(fs.readFileSync(path.join(run, "preparation.json")));
assert.equal(prep.status, "PASS"); assert(prep.profiles.every(p => fs.existsSync(p.held)));
assert(!fs.existsSync(path.join(run, `fixtures-${revision}.json`)));
const mod = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "ts",
  contents: 'export {useProjectStore} from "./editor/src/store/projectStore";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(mod, mod.exports);
const p = fixture("installed-runtime-abilities-20261018-01");
p.schema_version = "1.1.0"; p.title = "安装版剧情与存档能力验收20261018";
p.editor_settings = { ...structuredClone(mod.exports.useProjectStore.getState().settings),
  defaultDialogPresentation: "nvl", characterDialogPresentations: { alice: "bubble", nvl_person: "nvl" },
  characterDisplayNames: { alice: "小岚", nvl_person: "叙述者", hero: "主角" } };
p.nodes[0].data.loadingAnimation = { kind: "default" }; p.nodes[0].data.openingAudio = [];
const mid = "MID_ADAPT：对白应优先自动缩小，在安全字号下完整显示并保留所有中文标点。".repeat(45);
const extreme = "EXTREME_PAGE：超长内容达到可读字号下限后必须分页，不得裁切、跳字或重复对白。".repeat(300);
const bubbleLong = "BUBBLE_LONG：气泡长文本应避开安全边缘和快捷栏，达到字号下限后分页。".repeat(90);
const commands = [
  { type: "dialog", character_id: "alice", text: "ORDINARY_SHORT：节点显式普通对白优先于角色气泡默认。", presentation_mode: "dialog" },
  { type: "dialog", character_id: "hero", text: mid, presentation_mode: "dialog" },
  { type: "dialog", character_id: "hero", text: extreme, presentation_mode: "dialog" },
  { type: "dialog", character_id: "nvl_person", text: "NVL_ONE：角色继承NVL第一句。" },
  { type: "narration", text: "NVL_TWO：旁白仅继承工程默认第二句。" },
  { type: "dialog", character_id: "alice", text: "NVL_THREE：节点NVL覆盖角色气泡第三句。", presentation_mode: "nvl" },
  { type: "narration", text: "NVL_CLEAR：显式清页后仅显示新段。", clear_nvl_page_before: true },
  { type: "choice", choices: [{ choice_id: "bubble-branch", text: "进入气泡验收", target_scene_id: "bubble", conditions: [] }] },
];
p.nodes[1].data.scene.scene_id = "ordinary_nvl"; p.nodes[1].data.scene.title = "普通对白与NVL";
p.nodes[1].data.scene.commands = commands;
const spriteBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="260" height="520"><rect x="70" y="20" width="120" height="140" rx="50" fill="#f5d5bd"/><rect x="35" y="160" width="190" height="340" rx="30" fill="#527baa"/></svg>');
p.asset_manifest.push({ asset_id: "qa_actor", asset_type: "sprite", metadata: { filename: "本轮测试立绘.svg",
  display_name: "本轮测试立绘", mime_type: "image/svg+xml", width: 260, height: 520,
  data_url: `data:image/svg+xml;base64,${spriteBytes.toString("base64")}` } });
const bubbleCommands = [
  { type: "sprite", character_id: "alice", sprite_id: "qa_actor", position: "left", visible: true },
  { type: "dialog", character_id: "alice", text: "BUBBLE_VISIBLE：角色默认气泡跟随左侧可见立绘。" },
  { type: "sprite", character_id: "alice", sprite_id: "qa_actor", position: "right", scale: 1.1, visible: true },
  { type: "camera", motion: { schema_version: 1, kind: "reframe",
    to: { center_x: .5, center_y: .5, zoom: 1.12 }, duration_ms: 240, easing: "linear" }, blocking: false },
  { type: "dialog", character_id: "alice", text: "BUBBLE_MOVED：镜头及立绘变换后角色偏移锚点仍有效。",
    bubble_position: { mode: "character", offset_x: 3, offset_y: -2 } },
  { type: "sprite", character_id: "alice", sprite_id: "qa_actor", visible: false },
  { type: "dialog", character_id: "alice", text: "BUBBLE_ABSENT：人物离场后气泡使用安全回退位置。" },
  { type: "dialog", character_id: "alice", text: "BUBBLE_FIXED：固定锚点在边缘时仍不可裁切。",
    bubble_position: { mode: "fixed", x: 97, y: 97 } },
  { type: "dialog", character_id: "alice", text: bubbleLong, bubble_position: { mode: "fixed", x: 96, y: 96 } },
  { type: "choice", choices: [{ choice_id: "save-branch", text: "进入存档验收", target_scene_id: "saves", conditions: [] }] },
];
const common = structuredClone(p.nodes[1].data);
for (const [index, sceneId, title, list] of [
  [2, "bubble", "角色气泡", bubbleCommands],
  [3, "saves", "手动自动快存", Array.from({ length: 18 }, (_, i) => ({
    type: "dialog", character_id: "hero", text: `SAVE_LINE_${String(i + 1).padStart(2, "0")}：真实UI存档、读取及回退验证。`,
    presentation_mode: "dialog" }))],
]) {
  p.nodes.push({ id: sceneId, type: "sceneNode", position: { x: index * 320, y: 180 },
    data: { ...structuredClone(common), label: title, scene: { ...structuredClone(common.scene),
      scene_id: sceneId, title, commands: list } } });
}
for (const node of p.nodes) for (const command of node.data.scene?.commands || [])
  if (command.type === "sprite") assert.equal(typeof command.sprite_id, "string", "Even hidden sprite commands require sprite_id");
const input = path.join(work, `剧情能力隔离工程-${revision}.vnproj`);
fs.writeFileSync(input, JSON.stringify(p), { flag: "wx" });
const report = { status: "PASS", at: new Date().toISOString(), input, inputSha256: sha256(fs.readFileSync(input)),
  projectId: p.project_id, title: p.title, realModelRequests: 0,
  lengths: { mid: mid.length, extreme: extreme.length, bubbleLong: bubbleLong.length },
  text: { mid, extreme, bubbleLong }, spriteSha256: sha256(spriteBytes),
  controlledProjectFixture: true, nativeProjectPickerClaim: false, revision,
  priorInvalidFixture: path.join(run, "fixtures.json"),
  correction: "The previous synthetic hide-sprite command omitted the required sprite_id; prior input and failed run are retained.",
  expectedPresentation: ["dialog", "dialog", "dialog", "nvl", "nvl", "nvl", "nvl"] };
fs.writeFileSync(path.join(run, `fixtures-${revision}.json`), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, input, lengths: report.lengths }));
