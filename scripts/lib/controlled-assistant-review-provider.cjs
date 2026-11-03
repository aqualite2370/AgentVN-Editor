"use strict";
const http = require("node:http"), assert = require("node:assert/strict");
// External model boundary ONLY. The installed application owns every tool,
// local validation/Runtime receipt, project write and queue transition.
async function controlledAssistantReviewProvider() {
  const requests = [], sockets = new Set(), errors = [];
  const proposal = marker => ({ components: (marker === "CONFLICT_A" ? ["冲突候选"] : ["审核关于卡", "审核帮助卡", "排除候选"]).map((name, i) => ({
    name, screen_id: marker === "CONFLICT_A" ? "game_menu" : "title",
    description: "受控多工具链候选；必须经用户审核才写入工程",
    html: `<div class="root"><img class="icon" data-asset="project-asset-1" aria-label="${name}徽章"/><span class="title" data-bind="project.title">标题</span><button class="button" type="button" aria-label="${name}操作" data-action="${i === 1 ? "open_help" : "open_about"}">${i === 1 ? "帮助" : "关于"}</button></div>`,
    css: ".root { display: flex; flex-direction: column; gap: 2px; padding: 4px; }.icon { width: 24px; height: 16px; object-fit: contain; }.title { color: #ffffff; font-size: 12px; line-height: 14px; }.button { color: #ffffff; background-color: #223344; font-size: 12px; line-height: 14px; padding: 4px; border-radius: 4px; }"
  })), edits: [] });
  const names = ["read_assistant_context", "build_assistant_draft", "validate_assistant_draft", "preview_assistant_draft", "read_assistant_draft", "submit_assistant_component_draft"];
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") { res.writeHead(404).end(); return; }
    try {
      const chunks = []; for await (const c of req) chunks.push(c);
      const p = JSON.parse(Buffer.concat(chunks).toString("utf8")), serialized = JSON.stringify(p);
      const marker = serialized.includes("CONFLICT_A") ? "CONFLICT_A" : "REVIEW_A";
      const toolMessages = p.messages.filter(m => m.role === "tool"), step = toolMessages.length;
      assert(step < names.length, "Unexpected extra model round; do not replay completion");
      for (const forbidden of ["private-project", "PRIVATE_UNSELECTED", "private-generation", "C:\\\\private", "data:image", "test-only-secret"])
        assert(!serialized.includes(forbidden), `Forbidden private material reached external model: ${forbidden}`);
      assert(p.tools?.some(t => t.function.name === names[step]), "Requested tool not disclosed by product capability list");
      const receipts = toolMessages.map(m => ({ toolCallId: m.tool_call_id, result: JSON.parse(m.content) }));
      requests.push({ marker, step, tool: names[step], tools: p.tools.map(t => t.function.name), receipts,
        at: new Date().toISOString(), privateMaterialAbsent: true });
      const args = ["build_assistant_draft", "submit_assistant_component_draft"].includes(names[step]) ? proposal(marker) : {};
      const message = { role: "assistant", content: null, tool_calls: [{ id: `controlled-${marker}-${step}`, type: "function",
        function: { name: names[step], arguments: JSON.stringify(args) } }] };
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({
        id: `controlled-${marker}-${step}`, object: "chat.completion", created: 1, model: "controlled-model",
        choices: [{ index: 0, finish_reason: "tool_calls", message }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }));
    } catch (e) { errors.push(String(e.stack || e)); if (!res.headersSent) res.writeHead(500); res.end(JSON.stringify({ error: { message: String(e), type: "controlled_test_error" } })); }
  });
  server.on("connection", s => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { url: `http://127.0.0.1:${server.address().port}/v1`, requests, errors, names,
    async stop() { for (const s of sockets) s.destroy(); await new Promise(r => server.close(r)); return { stopped: true, requests: requests.length }; } };
}
module.exports = { controlledAssistantReviewProvider };
