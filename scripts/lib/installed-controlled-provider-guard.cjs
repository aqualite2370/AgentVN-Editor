"use strict";
const assert = require("node:assert/strict");
// Test-only allowlist, default deny. Never use this to permit arbitrary providers.
function controlledCreationGuard(options) {
  const tasks = new Map();
  const usedInquiries = new Set();
  if (options) {
    const u = new URL(options.endpoint);
    assert.equal(u.protocol, "http:"); assert.equal(u.hostname, "127.0.0.1");
    assert(+u.port > 1024 && +u.port <= 65535); assert.equal(u.pathname, "/v1");
    assert(!u.username && !u.password && !u.search && !u.hash);
    assert.equal(u.href, options.endpoint);
    assert(Array.isArray(options.projectIds) && options.projectIds.length > 0);
    assert(options.projectIds.every(p => typeof p === "string" && p.startsWith("qa-")));
    if (options.inquiryQuestions !== undefined) {
      assert(Array.isArray(options.inquiryQuestions) && options.inquiryQuestions.length > 0);
      assert(options.inquiryQuestions.every(q => typeof q === "string" && /^HISTORY_[A-Z] .{1,160}$/.test(q)));
      assert.equal(new Set(options.inquiryQuestions).size, options.inquiryQuestions.length);
    }
  }
  const controlledSelection = selection => Boolean(selection &&
    selection.base_url === options.endpoint && selection.connection_id === "qa-review" &&
    selection.model_id === "controlled-model" && selection.api_key === "test-only-secret");
  return {
    allows({ method, url, body }, backendOrigin) {
      if (!options || method !== "POST") return false;
      const u = new URL(url);
      if (u.origin !== backendOrigin || u.search || u.hash) return false;
      if (u.pathname === "/api/assistant/chat_stream") {
        if (!options.inquiryQuestions?.includes(body?.question) || usedInquiries.has(body.question) ||
          !controlledSelection(body.provider_selection)) return false;
        usedInquiries.add(body.question); return true;
      }
      if (u.pathname === "/api/assistant/creation/processes") {
        const selection = body?.request?.provider_selection;
        if (!options.projectIds.includes(body?.project_id) ||
          !/^[a-zA-Z0-9_-]{1,160}$/.test(body.id || "") ||
          !controlledSelection(selection)) return false;
        if (tasks.has(body.id) && tasks.get(body.id) !== body.project_id) return false;
        tasks.set(body.id, body.project_id); return true;
      }
      const match = u.pathname.match(/^\/api\/assistant\/creation\/processes\/([a-zA-Z0-9_-]+)\/(local-result|cancel)$/);
      if (!match || !tasks.has(match[1])) return false;
      return match[2] === "cancel" || body?.project_id === tasks.get(match[1]);
    },
  };
}
module.exports = { controlledCreationGuard };
