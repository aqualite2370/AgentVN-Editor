"use strict";
// Only the external model transport is controlled. AgentVN APIs are untouched.
const http = require("node:http");
const assert = require("node:assert/strict");
async function controlledNovelProvider() {
  const requests = [], sockets = new Set(), gates = new Map();
  let stopped = false;
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404).end(); return;
    }
    let entry;
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const prompt = String(payload.messages?.findLast(m => m.role === "user")?.content || "");
      const match = prompt.match(/Subagent input JSON follows\.[\s\S]*?\n(\{[\s\S]*\})\n\nReturn/);
      assert(match, "Unexpected model task: refuse to invent an unhandled schema");
      const input = JSON.parse(match[1]);
      assert.equal(input.promptVersion, "novel-process-v3");
      assert.equal(payload.response_format?.type, "json_object");
      assert.equal(payload.stream, true);
      entry = { index: requests.length, at: new Date().toISOString(), input, stream: true,
        requestedModel: payload.model, responseFormat: payload.response_format, released: false };
      requests.push(entry);
      await new Promise(resolve => gates.set(entry.index, resolve));
      entry.released = true;
      if (stopped || res.destroyed) { entry.disconnected = true; return; }
      const text = `受控章节正文_${input.chapterIndex}_${input.chunkIndex}：雨后，窗外的树叶轻轻摇动。`;
      const result = { status: "completed", resultText: text, summary: "雨后窗边的场景",
        fragment: { summary: "雨后窗边的场景", tags: ["controlled-native-qa"],
          commands: [{ type: "narration", text }], continuityNotes: [], warnings: [] },
        scenes: [], continuityNotes: [], warnings: [] };
      entry.output = result;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const json = JSON.stringify(result);
      for (let i = 0; i < json.length; i += 90) {
        res.write(`data: ${JSON.stringify({ id: `controlled-novel-${entry.index}`,
          object: "chat.completion.chunk", created: 1, model: "controlled-novel",
          choices: [{ index: 0, delta: { content: json.slice(i, i + 90) }, finish_reason: null }] })}\n\n`);
      }
      res.end(`data: ${JSON.stringify({ id: `controlled-novel-${entry.index}`,
        object: "chat.completion.chunk", created: 1, model: "controlled-novel",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
      entry.finishedAt = new Date().toISOString();
    } catch (e) {
      if (entry) entry.error = String(e);
      else requests.push({ error: String(e), at: new Date().toISOString() });
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(e), type: "controlled_test_error" } }));
    }
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`, requests,
    release(index) { assert(gates.has(index), `Request ${index} is not held`); gates.get(index)(); gates.delete(index); },
    async stop() {
      stopped = true;
      for (const resolve of gates.values()) resolve();
      gates.clear();
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
      return { stopped, requests: requests.length, held: gates.size };
    },
  };
}
module.exports = { controlledNovelProvider };
