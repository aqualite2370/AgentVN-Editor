"use strict";
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const projectId = "qa-narrative-boundaries-1922-20261023";
const voiceId = "qa_narrative_voice";
const branches = ["voice_dialog", "voice_nvl", "voice_nvl_4k", "voice_bubble", "capacity"];
const sentence = "月光映照石阶，远处传来清晰脚步声；每页文字须完整保留，恢复时不能重复播放语音。";
function makeNarrativeFixture(source, { mixedCapacity = false } = {}) {
  const project = structuredClone(source), template = project.nodes.find(n => n.data?.scene);
  assert(template);
  const wav = Buffer.alloc(44 + 32000 * 2), rate = 16000;
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 32000; i++) wav.writeInt16LE(Math.round(1200 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
  const longTexts = {};
  for (const [name, count] of [["voice_dialog", 240], ["voice_nvl", 340],
    ["voice_nvl_4k", 1200], ["voice_bubble", 120]]) {
    longTexts[name] = Array.from({ length: count }, (_, i) =>
      `${name}第${String(i + 1).padStart(4, "0")}段：${sentence}`).join("");
  }
  const capacityTexts = Array.from({ length: 24 }, (_, i) =>
    Array.from({ length: mixedCapacity && i < 8 ? 5 : 32 }, (_, j) =>
      `CAP_${String(i + 1).padStart(2, "0")}_${j + 1}：${sentence}`).join(""));
  function scene(name, commands) {
    const n = structuredClone(template);
    n.id = name; n.position = { x: 400, y: 100 + branches.indexOf(name) * 180 };
    n.data.scene = { scene_id: name, title: name, summary: "", chapter: 1, tags: [], commands };
    n.data.label = name; return n;
  }
  project.project_id = projectId; project.title = "当前安装版NVL容量与语音去重隔离验收";
  project.editor_settings.defaultDialogPresentation = "dialog";
  project.asset_manifest.push({ asset_id: voiceId, asset_type: "voice", metadata: {
    filename: "合成语音触发探针.wav", display_name: "合成语音触发探针（非听辨）",
    mime_type: "audio/wav", duration_ms: 2000, size_bytes: wav.length,
    data_url: `data:audio/wav;base64,${wav.toString("base64")}`,
  } });
  const entry = scene("narrative_entry", [
    { type: "narration", text: "NARRATIVE_ENTRY：请选择独立验收范围。", presentation_mode: "dialog" },
    { type: "choice", choices: branches.map(name => ({
      choice_id: `to_${name}`, text: name, target_scene_id: name, conditions: [],
    })) },
  ]);
  const voiceScenes = branches.slice(0, 4).map(name => {
    const mode = name === "voice_dialog" ? "dialog" : name === "voice_bubble" ? "bubble" : "nvl";
    return scene(name, [
      { type: "dialog", character_id: "hero", text: longTexts[name], voice: voiceId, presentation_mode: mode },
      { type: "dialog", character_id: "hero", text: `${name}_NEXT：新一句应当正常播放一次。`,
        voice: voiceId, presentation_mode: mode },
    ]);
  });
  const capacity = scene("capacity", [
    ...capacityTexts.map(text => ({ type: "narration", text, presentation_mode: "nvl" })),
    { type: "choice", choices: [{ choice_id: "leave_nvl", text: "离开NVL容量页",
      target_scene_id: "capacity_end", conditions: [] }] },
  ]);
  const end = scene("capacity_end", [{ type: "narration", text: "CAPACITY_END：离开NVL后应清空累积页。",
    presentation_mode: "dialog" }]);
  project.nodes = [structuredClone(source.nodes.find(n => n.type === "startNode")), entry, ...voiceScenes, capacity, end];
  assert(project.nodes[0]); project.edges = [{ id: "narrative_entry_edge",
    source: project.nodes[0].id, target: entry.id, sourceHandle: "default" }];
  const metadata = { projectId, title: project.title, branches, longTexts, capacityTexts,
    voice: { assetId: voiceId, sha256: hash(wav), bytes: wav.length, seconds: 2,
      synthetic: true, listeningAcceptanceClaim: false } };
  if (mixedCapacity) metadata.capacityVariant = "mixed-history-v2";
  validateNarrativeFixture(project, metadata, wav);
  return { project, metadata, wav };
}
function validateNarrativeFixture(project, m, wav) {
  assert.equal(project.project_id, projectId); assert.equal(m.projectId, projectId);
  assert.equal(project.title, m.title); assert.deepEqual(m.branches, branches);
  assert.equal(m.voice.assetId, voiceId); assert.equal(m.voice.synthetic, true);
  assert.equal(m.voice.listeningAcceptanceClaim, false);
  assert.equal(wav.subarray(0, 4).toString(), "RIFF"); assert.equal(hash(wav), m.voice.sha256);
  assert.equal(wav.length, m.voice.bytes);
  const asset = project.asset_manifest.find(a => a.asset_id === voiceId);
  assert.equal(asset.asset_type, "voice");
  assert.match(asset.metadata.data_url, /^data:audio\/wav;base64,/);
  assert.equal(hash(Buffer.from(asset.metadata.data_url.split(",")[1], "base64")), m.voice.sha256);
  const scenes = project.nodes.filter(n => n.data?.scene).map(n => n.data.scene);
  assert.equal(scenes.length, 7);
  const entry = scenes.find(s => s.scene_id === "narrative_entry");
  assert.deepEqual(entry.commands[1].choices.map(c => c.target_scene_id), branches);
  for (const name of branches.slice(0, 4)) {
    const s = scenes.find(s => s.scene_id === name);
    assert.equal(s.commands.length, 2); assert.equal(s.commands[0].text, m.longTexts[name]);
    const mode = name === "voice_dialog" ? "dialog" : name === "voice_bubble" ? "bubble" : "nvl";
    for (const c of s.commands) { assert.equal(c.voice, voiceId); assert.equal(c.presentation_mode, mode); }
  }
  assert(m.longTexts.voice_nvl_4k.length > m.longTexts.voice_nvl.length * 3);
  const capacity = scenes.find(s => s.scene_id === "capacity");
  assert.equal(capacity.commands.length, 25); assert.equal(m.capacityTexts.length, 24);
  assert.equal(new Set(m.capacityTexts).size, 24);
  capacity.commands.slice(0, 24).forEach((c, i) => {
    assert.equal(c.presentation_mode, "nvl"); assert.equal(c.text, m.capacityTexts[i]);
    if (m.capacityVariant === "mixed-history-v2" && i < 8) assert(c.text.length > 200 && c.text.length < 500);
    else assert(c.text.length > 1000);
  });
  assert(m.capacityVariant === undefined || m.capacityVariant === "mixed-history-v2");
  assert.equal(capacity.commands[24].type, "choice");
  assert.equal(capacity.commands[24].choices[0].target_scene_id, "capacity_end");
}
module.exports = { makeNarrativeFixture, validateNarrativeFixture };
