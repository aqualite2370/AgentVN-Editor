"use strict";
// QA transport only. Never intercept AgentVN APIs or execute model-supplied code.
const http = require("node:http");
const assert = require("node:assert/strict");

function jsonAfter(text, marker) {
  const markerAt = text.indexOf(marker);
  assert(markerAt >= 0, `Missing controlled prompt marker: ${marker}`);
  const start = text.indexOf("{", markerAt + marker.length);
  assert(start >= 0);
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw Error(`Unclosed controlled input at ${marker}`);
}

function answer(payload) {
  const system = payload.messages.find(m => m.role === "system")?.content ?? "";
  const user = payload.messages.findLast(m => m.role === "user")?.content ?? "";
  const summary = "雨停后，窗边的树叶轻轻摇动，远处的灯光逐渐明亮。";
  const chapter = (start, end) => ({ chapter_id: "qa_default_chapter", title: "雨后窗边",
    index: 0, start_offset: start, end_offset: end, summary, confidence: 1 });
  assert.equal(payload.stream, true, "Unexpected nonstream repair/retry must be investigated");
  if (system.includes("公开决策过程播报器")) {
    assert(!payload.response_format);
    return { stage: "public-notes", result: "受控测试：保留雨后窗边的旁白，不引入新人物或资产；接下来生成结构化场景。" };
  }
  assert.equal(payload.response_format?.type, "json_object");
  assert(!payload.tools, "JSON controlled boundary must not hide tool calls");
  if (system.includes("压缩成稳定的导入摘要")) {
    const chunk = user.match(/文本块 id:\s*(\S+)/), index = user.match(/文本块序号:\s*(\d+)/);
    assert(chunk && index);
    return { stage: "scan-summary", result: { chunk_id: chunk[1], index: Number(index[1]), summary, confidence: 1, warnings: [] } };
  }
  if (system.includes("章节候选、人物和地点索引")) {
    const range = user.match(/原文 offset:\s*(\d+)-(\d+)/); assert(range);
    return { stage: "scan-entities", result: { chapter_candidates: [chapter(Number(range[1]), Number(range[2]))],
      characters: [], locations: ["窗边"], warnings: [] } };
  }
  if (system.includes("提取时间线、伏笔")) return { stage: "scan-timeline",
    result: { timeline: ["雨后"], foreshadowing: [], warnings: [] } };
  if (system.includes("合成为小说主线总览")) {
    const input = jsonAfter(user, "分块分析数据:");
    return { stage: "outline-mainline", result: { document_id: input.document_id, title: input.title,
      summary, main_plot: summary, needs_review: false, coverage_confidence: 1, warnings: [] } };
  }
  if (system.includes("整理成章节结构")) {
    const input = jsonAfter(user, "分块分析数据:");
    return { stage: "outline-structure", result: { chapters: [chapter(0, input.total_chars)],
      timeline: ["雨后"], branch_or_foreshadowing: [], conflict_points: [], warnings: [] } };
  }
  if (system.includes("合并人物和地点索引")) return { stage: "outline-index",
    result: { characters: [], locations: ["窗边"], warnings: [] } };
  if (system.includes("SceneCandidate objects")) {
    const input = jsonAfter(user, "章节:");
    const text = user.slice(user.indexOf("章节原文:") + "章节原文:".length).trim();
    assert(input.start_offset < input.end_offset && text.length > 0);
    return { stage: "scene-plan", result: { chapter_id: input.chapter_id, scenes: [{
      scene_candidate_id: "qa_default_candidate", chapter_id: input.chapter_id, title: "雨后窗边", display_name: "第一场",
      index: 0, start_offset: input.start_offset, end_offset: input.end_offset,
      source_span: { start_offset: input.start_offset, end_offset: input.end_offset },
      source_excerpt: text, summary, commands: [{ type: "narration", text }],
      location_hint: "窗边", time_hint: "雨后", characters: [], confidence: 1,
    }], warnings: [], needs_review: false } };
  }
  if (system.includes("一个章节场景计划")) return { stage: "planning-conflicts", result: { conflict_points: [], warnings: [] } };
  if (system.includes("into one playable AgentVN SceneBeat")) {
    const input = jsonAfter(user, "Scene candidate:");
    return { stage: "scene-beat", result: { scene_id: "qa_default_scene", title: input.title, chapter: 0,
      summary, tags: ["controlled-default"], commands: [{ type: "narration", text: input.source_excerpt }] } };
  }
  if (system.includes("Analyze one adapted visual-novel scene")) return { stage: "adaptation-conflicts",
    result: { conflict_points: [], warnings: [] } };
  if (system.includes("branch suggestions for a planned imported")) return { stage: "planning-branches",
    result: { branch_suggestions: [], warnings: ["原文只有连续环境描写，不存在高置信度可选分支。"] } };
  if (system.includes("branch suggestions for an imported visual-novel scene")) return { stage: "adaptation-branches",
    result: { branch_suggestions: [], warnings: ["原文只有连续环境描写，不存在高置信度可选分支。"] } };
  throw Error(`Unhandled default-workflow model request: ${system.slice(0, 160)}`);
}

async function controlledDefaultNovelProvider() {
  const requests = [], sockets = new Set();
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") { res.writeHead(404).end(); return; }
    const entry = { at: new Date().toISOString(), index: requests.length }; requests.push(entry);
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      entry.payload = payload;
      const { stage, result } = answer(payload);
      Object.assign(entry, { stage, payload, result });
      const text = typeof result === "string" ? result : JSON.stringify(result);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      for (let i = 0; i < text.length; i += 90) res.write(`data: ${JSON.stringify({
        id: `qa-default-${entry.index}`, object: "chat.completion.chunk", created: 1, model: "qa-default",
        choices: [{ index: 0, delta: { content: text.slice(i, i + 90) }, finish_reason: null }],
      })}\n\n`);
      res.end(`data: ${JSON.stringify({ id: `qa-default-${entry.index}`, object: "chat.completion.chunk",
        created: 1, model: "qa-default", choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}\n\ndata: [DONE]\n\n`);
      entry.finishedAt = new Date().toISOString();
    } catch (e) {
      entry.error = String(e.stack || e);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(e), type: "controlled_test_error" } }));
    }
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { url: `http://127.0.0.1:${server.address().port}/v1`, requests,
    async stop() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
      return { stopped: true, requests: requests.length };
    } };
}
module.exports = { controlledDefaultNovelProvider, answer, jsonAfter };
