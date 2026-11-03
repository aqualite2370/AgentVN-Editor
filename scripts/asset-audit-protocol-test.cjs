"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const ts = require("../editor/node_modules/typescript");
const original = require.extensions[".ts"];
require.extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, f);
const { buildPendingVisualAssetsForScene: audit } = require("../editor/src/utils/assetAudit.ts");
const { collectEditorAssetReferences } = require("../editor/src/utils/editorAssetReferences.ts");
const { collectAssetReferencesFromCommand } = require("../shared/cartridge/assetScanner.ts");
const attempt = process.argv[2] || "red-01";
assert.match(attempt, /^(?:red|green)-\d{2}$/);
const out = `F:/AgentVN/QA/Asset-Audit-20261021-01/${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const cases = [];
function check(name, action) { try { action(); cases.push({ name, status: "PASS" }); }
  catch (e) { cases.push({ name, status: "FAILED", error: String(e.stack) }); } }
const scene = commands => ({ scene_id: "audit", title: "雨夜车站", summary: "", chapter: 1, tags: [], commands });
const run = (commands, assets = [], extra = {}) => audit(scene(commands), {
  nodeId: "n", nodeLabel: "场景卡片", projectAssets: assets, includeOptional: true, ...extra });
const required = items => items.filter(i => !i.optional);
const asset = (id, type, metadata = {}) => ({ asset_id: id, asset_type: type, metadata: { data_url: "data:image/png;base64,AQ==", ...metadata } });
check("Offstage dialog and inherited background are optional, never fabricated mandatory references", () => {
  assert.equal(required(run([{ type: "dialog", character_id: "alice", text: "你好" }])).length, 0);
});
check("Hidden sprite and stop BGM require no file", () => {
  assert.equal(required(run([{ type: "sprite", character_id: "alice", sprite_id: "", visible: false },
    { type: "bgm", action: "stop", bgm_id: "unused" }])).length, 0);
});
check("Every explicit modern resource field is checked at its true command/field", () => {
  const commands = [{ type: "show_image", image_id: "cg_missing" }, { type: "video", video_id: "movie_missing" },
    { type: "dialog", character_id: "alice", text: "你好", voice: "voice_missing", font_asset_id: "font_missing",
      portrait: "portrait_missing", dialog_style: { background_asset_id: "box_missing" } },
    { type: "bgm", action: "play", bgm_id: "music_missing" }, { type: "sfx", sfx_id: "sfx_missing" },
    { type: "gallery_anchor", asset_id: "gallery_missing", anchor_id: "a", title: "画廊" }];
  const items = required(run(commands));
  for (const id of ["cg_missing","movie_missing","voice_missing","font_missing","portrait_missing",
    "box_missing","music_missing","sfx_missing","gallery_missing"]) {
    const item = items.find(i => i.asset_id === id);
    assert(item, `Missing audit coverage: ${id}`); assert(item.field); assert(item.command_index >= 0);
    assert(item.reason.includes(id), `Reason must identify ${id}`);
  }
});
check("Visible/play/required empty fields are required even if the ID is absent", () => {
  const items = required(run([{ type:"video",video_id:"" },{ type:"show_image",image_id:"" },
    { type:"sprite",character_id:"alice",sprite_id:"",visible:true },{ type:"bgm",action:"play",bgm_id:"" }]));
  for (const field of ["video_id","image_id","sprite_id","bgm_id"]) assert(items.some(i => i.field === field), field);
});
check("Wrong type, placeholder and metadata-only registration explain different failures", () => {
  for (const [metadata, type, expected] of [[{}, "voice", /类型/], [{ placeholder:true }, "background", /占位/],
    [{ data_url:undefined, filename:"rain.png" }, "background", /文件来源/]]) {
    const item = required(run([{ type:"background",background_id:"rain" }], [asset("rain",type,metadata)]))[0];
    assert(item); assert.match(item.reason, expected);
  }
});
check("Valid semantic sprite/portrait and shared BGM/SFX types are accepted", () => {
  assert.equal(required(run([{type:"dialog",character_id:"alice",text:"好",portrait:"a"},
    {type:"bgm",action:"play",bgm_id:"music"}], [asset("a","sprite"),asset("music","sfx")])).length,0);
});
check("Show image and gallery accept every authorable image type while rejecting audio", () => {
  for(const type of ["background","sprite","portrait","ui"]) {
    const commands=[{type:"show_image",image_id:"image"},{type:"gallery_anchor",asset_id:"image",anchor_id:"a",title:"图"}];
    assert.equal(required(run(commands,[asset("image",type)])).length,0,type);
  }
  assert.equal(required(run([{type:"show_image",image_id:"sound"},
    {type:"gallery_anchor",asset_id:"sound",anchor_id:"a",title:"图"}],
    [asset("sound","sfx",{mime_type:"audio/wav"})])).length,2);
  assert.equal(required(run([{type:"dialog",character_id:"a",text:"图",
    dialog_style:{background_asset_id:"image"}}],[asset("image","background")])).length,1,
    "Do not widen unrelated UI-only fields");
});
check("Unused generated suggestions are optional and do not inflate missing dependencies", () => {
  const items = run([{type:"narration",text:"雨"}], [], { assetSuggestions:[
    { asset_type:"portrait",description:"建议头像",suggested_asset_id:"suggested",source_scene_id:"audit" }] });
  assert(items.find(i => i.asset_id === "suggested")?.optional); assert.equal(required(items).length,0);
});
check("Every optional suggestion has an actionable command/field and preserves character identity", () => {
  const items = run([{type:"dialog",character_id:"alice",text:"你好"}], [], { assetSuggestions:[
    { asset_type:"background",description:"建议背景",suggested_asset_id:"bg_suggest",source_scene_id:"audit" },
    { asset_type:"sprite",description:"建议立绘",suggested_asset_id:"sprite_suggest",source_scene_id:"audit" },
    { asset_type:"portrait",description:"建议头像",suggested_asset_id:"portrait_suggest",source_scene_id:"audit" },
  ] });
  const fields = {background:"background_id",sprite:"sprite_id",portrait:"portrait",bgm:"bgm_id",sfx:"sfx_id",voice:"voice"};
  for (const item of items.filter(i=>i.optional)) {
    assert(item.command_type, `No command target: ${item.label}`);
    if(item.kind !== "performance")assert.equal(item.field,fields[item.asset_type],item.label);
  }
  assert.equal(items.find(i=>i.kind==="sprite" && i.character_id==="alice").command_type,"sprite");
});
check("Editor/export/runtime scanners agree on stop/hide/gallery dependencies", () => {
  const commands = [{type:"sprite",character_id:"a",visible:false,sprite_id:"hidden"},
    {type:"bgm",action:"stop",bgm_id:"stopped"},{type:"gallery_anchor",asset_id:"gallery",anchor_id:"a",title:"图"}];
  const refs = collectEditorAssetReferences([{id:"n",data:{nodeKind:"scene",label:"场景",scene:scene(commands)}}]);
  assert.deepEqual(refs.map(r=>r.asset_id),["gallery"]);
  assert.deepEqual(commands.flatMap(c=>collectAssetReferencesFromCommand(c)).map(r=>r.asset_id),["gallery"]);
});
check("No silent truncation or false resolved state for multiple same-kind missing fields", () => {
  const commands = Array.from({length:11}, (_,i)=>({type:"background",background_id:`missing_${i}`}));
  const items = required(run(commands)); assert.equal(items.length,11);
  assert.equal(new Set(items.map(i=>i.id)).size,11);
});
require.extensions[".ts"] = original;
const report = { status: cases.some(c=>c.status==="FAILED")?"FAILED":"PASS", scope:"SOURCE_PROTOCOL_NOT_FILE_BYTES_OR_INSTALLED",
  at:new Date().toISOString(), modelRequests:0, cases };
fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2)); if(report.status!=="PASS")process.exitCode=1;
