"use strict";
// Fault injection ONLY at the external model boundary; never mock AgentVN jobs.
const http = require("node:http"), assert = require("node:assert/strict");
async function controlledNovelFailureProvider() {
  const requests = [], held = new Map(), sockets = new Set();
  let stopped = false;
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") { res.writeHead(404).end(); return; }
    let entry;
    try {
      const buffers = [];
      for await (const chunk of req) buffers.push(chunk);
      const payload = JSON.parse(Buffer.concat(buffers).toString("utf8"));
      const prompt = String(payload.messages?.findLast(m => m.role === "user")?.content || "");
      const match = prompt.match(/Subagent input JSON follows\.[\s\S]*?\n(\{[\s\S]*\})\n\nReturn/);
      assert(match, "Unhandled schema; do not fake a successful model task");
      const input = JSON.parse(match[1]);
      assert.equal(input.promptVersion, "novel-process-v3"); assert.equal(payload.stream, true);
      assert.equal(payload.response_format?.type, "json_object");
      entry = { index: requests.length, at: new Date().toISOString(), input, stream: true,
        requestedModel: payload.model, released: false };
      requests.push(entry);
      const outcome = await new Promise(resolve => held.set(entry.index, resolve));
      entry.released = true; entry.outcome = outcome;
      if (stopped || res.destroyed) { entry.disconnected = true; return; }
      const text = `异常闭环正文_${input.chapterIndex}_${input.chunkIndex}：窗边留下了雨水，远处的灯光逐渐明亮。`;
      const output = outcome === "failed"
        ? { status: "failed", errorMessage: `CONTROLLED_CHAPTER_FAILURE_${entry.index}`, warnings: [] }
        : { status: "completed", resultText: text, summary: `第${input.chapterIndex + 1}章的受控场景`,
          fragment: { summary: `第${input.chapterIndex + 1}章的受控场景`, tags: ["native-novel-fault-qa"],
            commands: [{ type: "narration", text }], continuityNotes: [], warnings: [] }, warnings: [] };
      entry.output = output;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const textOutput = JSON.stringify(output);
      for (let i = 0; i < textOutput.length; i += 80) {
        res.write(`data: ${JSON.stringify({ id: `fault-novel-${entry.index}`, object: "chat.completion.chunk",
          created: 1, model: "controlled-novel-fault", choices: [{ index: 0,
            delta: { content: textOutput.slice(i, i + 80) }, finish_reason: null }] })}\n\n`);
      }
      res.end(`data: ${JSON.stringify({ id: `fault-novel-${entry.index}`, object: "chat.completion.chunk", created: 1,
        model: "controlled-novel-fault", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
      entry.finishedAt = new Date().toISOString();
    } catch (e) {
      if (entry) entry.error = String(e); else requests.push({ error: String(e) });
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(e), type: "controlled_test_error" } }));
    }
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`, requests,
    release(index, outcome = "completed") {
      assert(["completed", "failed"].includes(outcome)); assert(held.has(index), `Request ${index} is not held`);
      held.get(index)(outcome); held.delete(index);
    },
    async stop() {
      stopped = true; for (const resolve of held.values()) resolve("cleanup");
      held.clear(); for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
      return { stopped, requests: requests.length, held: held.size };
    },
  };
}
module.exports = { controlledNovelFailureProvider };
