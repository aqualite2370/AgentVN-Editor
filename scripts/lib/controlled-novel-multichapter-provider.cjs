"use strict";
// Model-HTTP boundary only. All chapter IDs/spans follow actual product prompts.
const http = require("node:http"), assert = require("node:assert/strict");
const { answer: singleAnswer, jsonAfter } = require("./controlled-novel-default-provider.cjs");
const text = "第一章 雨后岔路\n雨停了，窗外的树叶轻轻摇动。\n远处的灯光逐渐明亮，屋内的时钟缓缓走动。门前有两条路，可以等候，也可以先去探看。\n第二章 灯下重逢\n沿着主路抵达灯下，桌面放着一封信。读完信后，把它妥善收好，继续原来的旅程。";
const split = text.indexOf("第二章");
const chapters = [
  { chapter_id: "qa_multi_chapter_1", index: 0, title: "雨后岔路", start_offset: 0, end_offset: split,
    summary: "雨停后，在门前选择等候或探看，主线继续沿原路前行。", confidence: 1 },
  { chapter_id: "qa_multi_chapter_2", index: 1, title: "灯下重逢", start_offset: split, end_offset: text.length,
    summary: "沿主路抵达灯下，读信后继续旅程。", confidence: 1 },
];
function branch(candidate) {
  if (candidate.chapter_id !== chapters[0].chapter_id) return [];
  return [{ suggestion_id: "qa_multi_optional_detour", source_scene_id: candidate.scene_candidate_id,
    source_scene_display_name: candidate.title, choice_display_name: "先去探看",
    choice_text: "先去探看门前的另一条路", branch_summary: "沿另一条路短暂探看后，由作者继续创作。",
    confidence: 0.95, enabled_by_default: false }];
}
function answer(payload) {
  const system = payload.messages.find(m => m.role === "system")?.content || "";
  const user = payload.messages.findLast(m => m.role === "user")?.content || "";
  assert.equal(payload.stream, true);
  if (system.includes("章节候选、人物和地点索引")) return { stage: "scan-entities",
    result: { chapter_candidates: chapters, characters: [], locations: ["窗边", "灯下"], warnings: [] } };
  if (system.includes("整理成章节结构")) {
    const input = jsonAfter(user, "分块分析数据:"); assert.equal(input.total_chars, text.length);
    return { stage: "outline-structure", result: { chapters, timeline: ["雨后", "灯下"],
      branch_or_foreshadowing: ["第一章门前的等候或探看"], conflict_points: [], warnings: [] } };
  }
  if (system.includes("合成为小说主线总览")) {
    const input = jsonAfter(user, "分块分析数据:");
    return { stage: "outline-mainline", result: { document_id: input.document_id, title: input.title,
      summary: chapters.map(c => c.summary).join(""), main_plot: "雨后沿主路来到灯下读信，门前可选探看。",
      needs_review: false, coverage_confidence: 1, warnings: [] } };
  }
  if (system.includes("SceneCandidate objects")) {
    const chapter = jsonAfter(user, "章节:"), original = chapters.find(c => c.chapter_id === chapter.chapter_id);
    assert(original); assert.equal(chapter.start_offset, original.start_offset); assert.equal(chapter.end_offset, original.end_offset);
    const excerpt = user.slice(user.indexOf("章节原文:") + "章节原文:".length).trim();
    assert.equal(excerpt, text.slice(chapter.start_offset, chapter.end_offset).trim());
    return { stage: "scene-plan", chapterId: chapter.chapter_id, result: { chapter_id: chapter.chapter_id,
      scenes: [{ scene_candidate_id: "qa_multi_candidate_" + (chapter.index + 1), chapter_id: chapter.chapter_id,
        title: chapter.title, display_name: "第" + (chapter.index + 1) + "场", index: chapter.index,
        start_offset: chapter.start_offset, end_offset: chapter.end_offset,
        source_span: { start_offset: chapter.start_offset, end_offset: chapter.end_offset },
        source_excerpt: excerpt, summary: original.summary, commands: [{ type: "narration", text: excerpt }],
        location_hint: chapter.index ? "灯下" : "窗边", characters: [], confidence: 1 }],
      warnings: [], needs_review: false } };
  }
  if (system.includes("branch suggestions for a planned imported")) {
    const plan = jsonAfter(user, "Scene plan:"); assert.equal(plan.scenes.length, 1);
    return { stage: "planning-branches", chapterId: plan.chapter_id,
      result: { branch_suggestions: branch(plan.scenes[0]), warnings: [] } };
  }
  if (system.includes("into one playable AgentVN SceneBeat")) {
    const candidate = jsonAfter(user, "Scene candidate:"), chapter = chapters.find(c => c.chapter_id === candidate.chapter_id);
    assert(chapter);
    return { stage: "scene-beat", chapterId: chapter.chapter_id, result: {
      scene_id: "qa_multi_scene_" + (chapter.index + 1), title: candidate.title, chapter: chapter.index,
      summary: chapter.summary, tags: ["controlled-multichapter"],
      commands: [{ type: "narration", text: candidate.source_excerpt }] } };
  }
  if (system.includes("branch suggestions for an imported visual-novel scene")) {
    const candidate = jsonAfter(user, "Scene candidate:");
    return { stage: "adaptation-branches", chapterId: candidate.chapter_id,
      result: { branch_suggestions: branch(candidate), warnings: [] } };
  }
  const result = singleAnswer(payload);
  if (result.stage === "scan-summary") result.result.summary = chapters.map(c => c.summary).join("");
  if (result.stage === "scan-timeline") result.result.timeline = ["雨后", "灯下"];
  if (result.stage === "outline-index") result.result.locations = ["窗边", "灯下"];
  return result;
}
async function controlledMultichapterProvider() {
  const requests = [], sockets = new Set();
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") return res.writeHead(404).end();
    const entry = { index: requests.length, at: new Date().toISOString() }; requests.push(entry);
    try {
      assert(requests.length <= 20, "Unexpected repair/retry exceeds declared 20 local requests");
      const parts = []; for await (const part of req) parts.push(part);
      const payload = JSON.parse(Buffer.concat(parts).toString("utf8"));
      entry.payload = payload;
      assert(!JSON.stringify(payload).includes("test-only-secret"));
      const result = answer(payload); Object.assign(entry, result);
      const value = typeof result.result === "string" ? result.result : JSON.stringify(result.result);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      for (let i = 0; i < value.length; i += 90) res.write("data: " + JSON.stringify({
        id: "qa-multi-" + entry.index, object: "chat.completion.chunk", created: 1, model: "qa-default",
        choices: [{ index: 0, delta: { content: value.slice(i, i + 90) }, finish_reason: null }],
      }) + "\n\n");
      res.end("data: " + JSON.stringify({ id: "qa-multi-" + entry.index, object: "chat.completion.chunk",
        created: 1, model: "qa-default", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + "\n\ndata: [DONE]\n\n");
      entry.finishedAt = new Date().toISOString();
    } catch (error) {
      entry.error = String(error.stack || error);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(error), type: "controlled_test_error" } }));
    }
  });
  server.on("connection", s => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { url: `http://127.0.0.1:${server.address().port}/v1`, requests,
    async stop() { for (const socket of sockets) socket.destroy(); await new Promise(r => server.close(r));
      return { stopped: true, requests: requests.length }; } };
}
module.exports = { text, chapters, answer, controlledMultichapterProvider };
