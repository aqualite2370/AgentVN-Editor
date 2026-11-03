"use strict";

// Contract regression for QA observers of the real creation-process endpoint.
// This is deliberately transport-only: it uses a local fake endpoint and never
// reads credentials, launches the product, or calls a model.
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const { waitForAcceptedCreationSubmission } =
  require("./lib/assistant-creation-submission-gate.cjs");

async function startFakeServer() {
  const state = {
    postReturned: false,
    getBeforePostReturned: 0,
    process: null,
    events: [],
  };
  const server = http.createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/assistant/creation/processes") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      state.events.push("post-request");
      state.process = { id: payload.id, status: "queued" };
      await new Promise(resolve => setTimeout(resolve, 50));
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify(state.process), () => {
        state.postReturned = true;
        state.events.push("post-response");
      });
      return;
    }
    const match = request.method === "GET"
      && request.url.match(/^\/api\/assistant\/creation\/processes\/([^/]+)$/);
    if (match) {
      if (!state.postReturned) {
        state.getBeforePostReturned += 1;
        state.events.push("get-before-post-response");
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ detail: "not committed to observer yet" }));
        return;
      }
      state.events.push("get-after-post-response");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(state.process));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, state, url: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  const fake = await startFakeServer();
  try {
    const page = new EventEmitter();
    page.waitForResponse = (predicate, { timeout } = {}) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        page.off("response", onResponse);
        reject(new Error(`Timed out waiting for response after ${timeout}ms`));
      }, timeout);
      function onResponse(response) {
        if (!predicate(response)) return;
        clearTimeout(timer);
        page.off("response", onResponse);
        resolve(response);
      }
      page.on("response", onResponse);
    });
    const id = "post-response-gate";
    let postStatus;
    const accepted = await waitForAcceptedCreationSubmission(page, async () => {
      const requestPromise = fetch(`${fake.url}/api/assistant/creation/processes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, project_id: "qa-gate", project_title: "QA", conversation_id: "qa", request: {} }),
      });
      fake.state.events.push("request-observed");
      const response = await requestPromise;
      postStatus = response.status;
      const body = await response.json();
      page.emit("response", {
        url: () => `${fake.url}/api/assistant/creation/processes`,
        request: () => ({ method: () => "POST" }),
        status: () => response.status,
        json: async () => body,
      });
    });
    assert.equal(accepted.id, id);
    assert.equal(postStatus, 202);
    const current = await fetch(`${fake.url}/api/assistant/creation/processes/${accepted.id}`);
    assert.equal(current.status, 200);
    const result = await current.json();
    assert.deepEqual(result, { id: "post-response-gate", status: "queued" });
    assert.equal(fake.state.getBeforePostReturned, 0);
    assert.deepEqual(fake.state.events, [
      "request-observed",
      "post-request",
      "post-response",
      "get-after-post-response",
    ]);
    console.log(JSON.stringify({
      status: "PASS",
      contract: "POST_202_BEFORE_GET",
      postResponseGetCount: fake.state.events.filter(event => event === "get-after-post-response").length,
      getBeforePostResponse: fake.state.getBeforePostReturned,
      modelRequests: 0,
    }, null, 2));
  } finally {
    await new Promise(resolve => fake.server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
