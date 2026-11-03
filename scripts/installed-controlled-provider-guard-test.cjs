"use strict";
// QA boundary only: never grant arbitrary paid-model access to an installed run.
const assert = require("node:assert/strict");
const { controlledCreationGuard } = require("./lib/installed-controlled-provider-guard.cjs");
const endpoint = "http://127.0.0.1:45678/v1", backend = "http://127.0.0.1:45679";
const options = { endpoint, projectIds: ["qa-project-a", "qa-project-b"] };
const payload = () => ({ id: "qa-task-1", project_id: "qa-project-a", request: {
  provider_selection: { base_url: endpoint, connection_id: "qa-review", model_id: "controlled-model",
    api_key: "test-only-secret" },
} });
const submit = body => ({ method: "POST", url: backend + "/api/assistant/creation/processes", body });
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
check("default policy denies all model submissions", () => {
  const g = controlledCreationGuard();
  assert(!g.allows(submit(payload()), backend));
});
check("explicit exact loopback provider permits controlled task only", () => {
  const g = controlledCreationGuard(options);
  assert(g.allows(submit(payload()), backend));
  assert(g.allows({ method: "POST", url: backend + "/api/assistant/creation/processes/qa-task-1/local-result",
    body: { project_id: "qa-project-a", result: { ok: true } } }, backend));
  assert(g.allows({ method: "POST", url: backend + "/api/assistant/creation/processes/qa-task-1/cancel", body: {} }, backend));
});
const mutations = [
  p => { p.project_id = "user-project"; }, p => { p.id = "../escape"; }, p => { delete p.id; },
  p => { delete p.request; }, p => { delete p.request.provider_selection; },
  p => { p.request.provider_selection.base_url = "https://api.deepseek.com/v1"; },
  p => { p.request.provider_selection.base_url = endpoint + "/"; },
  p => { p.request.provider_selection.connection_id = "user-secret-connection"; },
  p => { p.request.provider_selection.api_key = "real-secret"; },
  p => { p.request.provider_selection.model_id = "deepseek-chat"; },
];
for (const [i, mutate] of mutations.entries()) check(`rejects modified submission ${i + 1}`, () => {
  const g = controlledCreationGuard(options), p = payload(); mutate(p);
  assert(!g.allows(submit(p), backend));
});
for (const suffix of ["/api/assistant/chat", "/api/novel/process", "/api/assistant/creation/processes/unknown/cancel",
  "/api/assistant/creation/processes/qa-task-1/retry", "/api/assistant/creation/processes?x=1"])
  check(`rejects unapproved path ${suffix}`, () => {
    const g = controlledCreationGuard(options);
    assert(!g.allows({ method: "POST", url: backend + suffix, body: payload() }, backend));
  });
check("does not whitelist wrong-project receipt or task reuse", () => {
  const g = controlledCreationGuard(options); assert(g.allows(submit(payload()), backend));
  assert(!g.allows({ method: "POST", url: backend + "/api/assistant/creation/processes/qa-task-1/local-result",
    body: { project_id: "qa-project-b" } }, backend));
  const second = payload(); second.project_id = "qa-project-b"; assert(!g.allows(submit(second), backend));
});
check("rejects different backend origin", () => {
  const g = controlledCreationGuard(options), request = submit(payload());
  request.url = request.url.replace("45679", "45680"); assert(!g.allows(request, backend));
});
for (const invalid of ["https://127.0.0.1:45678/v1", "http://localhost:45678/v1", "http://127.0.0.1:80/v1",
  "http://user:secret@127.0.0.1:45678/v1", endpoint + "?redirect=1", "http://192.168.1.1:45678/v1"])
  check(`rejects unsafe endpoint ${invalid}`, () => {
    assert.throws(() => controlledCreationGuard({ ...options, endpoint: invalid }));
  });
console.log(`PASS ${count} controlled-provider boundary cases; zero HTTP/model requests`);
