"use strict";
// Test-only opt-in. Actual paid providers and unspecified inquiry prompts stay denied.
const assert = require("node:assert/strict");
const { controlledCreationGuard } = require("./lib/installed-controlled-provider-guard.cjs");
const endpoint = "http://127.0.0.1:45678/v1", backend = "http://127.0.0.1:45679";
const question = "HISTORY_A 说明会话如何保存";
const options = { endpoint, projectIds: ["qa-project-a", "qa-project-b"], inquiryQuestions: [question] };
const payload = () => ({ question, context_chunks: [], messages: [], editor_context: "Isolated QA fixture",
  provider_selection: { base_url: endpoint, connection_id: "qa-review", model_id: "controlled-model",
    api_key: "test-only-secret" } });
const request = body => ({ method: "POST", url: backend + "/api/assistant/chat_stream", body });
let count = 0;
const test = (name, fn) => { fn(); count++; console.log(`PASS ${name}`); };
test("inquiry stays denied without explicit question opt-in", () => {
  assert(!controlledCreationGuard().allows(request(payload()), backend));
  assert(!controlledCreationGuard({ endpoint, projectIds: options.projectIds }).allows(request(payload()), backend));
});
test("exact synthetic provider and question allow one inquiry, not a paid retry", () => {
  const g = controlledCreationGuard(options);
  assert(g.allows(request(payload()), backend));
  assert(!g.allows(request(payload()), backend));
});
for (const [name, mutate] of [
  ["wrong question", p => { p.question += " 再次请求"; }],
  ["missing question", p => { delete p.question; }],
  ["missing provider", p => { delete p.provider_selection; }],
  ["real provider", p => { p.provider_selection.base_url = "https://api.deepseek.com/v1"; }],
  ["other loopback", p => { p.provider_selection.base_url = "http://127.0.0.1:45677/v1"; }],
  ["different model", p => { p.provider_selection.model_id = "deepseek-chat"; }],
  ["real credential", p => { p.provider_selection.api_key = "real-user-secret"; }],
  ["other connection", p => { p.provider_selection.connection_id = "user-connection"; }],
]) test(`reject ${name}`, () => {
  const p = payload(); mutate(p); assert(!controlledCreationGuard(options).allows(request(p), backend));
});
for (const suffix of ["/api/assistant/chat", "/api/assistant/chat_stream?retry=1",
  "/api/assistant/creation/component", "/api/novel/processing/execute/jobs"])
  test(`deny unapproved route ${suffix}`, () => {
    const r = request(payload()); r.url = backend + suffix;
    assert(!controlledCreationGuard(options).allows(r, backend));
  });
test("wrong backend and non-POST cannot consume inquiry allowance", () => {
  const g = controlledCreationGuard(options), r = request(payload());
  assert(!g.allows({ ...r, url: r.url.replace("45679", "45680") }, backend));
  assert(!g.allows({ ...r, method: "PUT" }, backend));
  assert(g.allows(r, backend));
});
for (const inquiryQuestions of ["HISTORY_A", [], ["arbitrary user prompt"], [question, question], [1]])
  test(`reject invalid inquiry allowlist ${JSON.stringify(inquiryQuestions)}`, () => {
    assert.throws(() => controlledCreationGuard({ ...options, inquiryQuestions }));
  });
console.log(`PASS ${count} inquiry boundary cases; zero HTTP/model calls`);
