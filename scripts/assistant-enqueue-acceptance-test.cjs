"use strict";
// Exercise the actual installed-QA submission helper, without starting a model.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "installed-assistant-agent-tools-playwright.cjs"), "utf8");
const begin = source.indexOf("async function submit(window, prompt)");
const end = source.indexOf("\nasync function complete(", begin);
assert(begin >= 0 && end > begin);
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ code = 202, returnedId = "qa-task", projectId = "qa-project" } = {}) {
  let accept, predicate, requested = false;
  const submissions = [];
  const accepted = new Promise(resolve => { accept = resolve; });
  const request = {
    method: () => "POST",
    url: () => "http://127.0.0.1:12345/api/assistant/creation/processes",
    postDataJSON: () => ({ id: "qa-task", project_id: "qa-project" }),
  };
  const response = {
    request: () => request,
    url: request.url,
    status: () => code,
    json: async () => ({ id: returnedId, projectId, status: "queued" }),
  };
  const page = { waitForResponse(test) { predicate = test; return accepted.then(() => {
    assert(test(response), "Only the exact submitted request may acknowledge acceptance");
    return response;
  }); } };
  const window = {
    getByLabel: () => ({ fill: async () => {} }),
    getByRole: () => ({ click: async () => {
      assert(!requested, "Submission must never be automatically replayed");
      requested = true;
      submissions.push({ id: "qa-task", projectId: "qa-project" });
    } }),
  };
  const submit = vm.runInNewContext(`(${source.slice(begin, end)})`, {
    assert, page, URL, report: { submissions }, save() {}, sleep: () => tick(),
  });
  return { submit, window, submissions, accept, get predicate() { return predicate; } };
}
(async () => {
  const pending = fixture();
  let settled = false;
  const result = pending.submit(pending.window, "受控验收").finally(() => { settled = true; });
  await tick(); await tick();
  assert.equal(pending.submissions.length, 1);
  assert.equal(settled, false, "Do not query a task while its POST is still awaiting durable acceptance");
  assert(pending.predicate, "Arm the matching response listener before clicking Submit");
  assert.equal(pending.predicate({
    request: () => ({ method: () => "GET" }), url: () => "http://127.0.0.1:12345/api/assistant/creation/processes",
  }), false);
  assert.equal(pending.predicate({
    request: () => ({ method: () => "POST", postDataJSON: () => ({ id: "another-task" }) }),
    url: () => "http://127.0.0.1:12345/api/assistant/creation/processes",
  }), false);
  pending.accept();
  const task = await result;
  assert.equal(task.enqueueAcceptance.status, 202);
  assert.equal(task.enqueueAcceptance.id, task.id);
  for (const options of [{ code: 422 }, { returnedId: "wrong-task" }, { projectId: "wrong-project" }]) {
    const failed = fixture(options);
    const attempt = failed.submit(failed.window, "拒绝错误回执");
    const rejection = assert.rejects(attempt);
    await tick(); failed.accept(); await rejection;
    assert.equal(failed.submissions.length, 1, "Failure must not resubmit the model task");
  }
  console.log(JSON.stringify({ status: "PASS", cases: 6,
    scope: "QA enqueue-acknowledgement timing and ownership; no product/model/network calls" }));
})().catch(error => { console.error(error); process.exitCode = 1; });
