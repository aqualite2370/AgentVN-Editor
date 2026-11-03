"use strict";
const assert = require("node:assert/strict"), path = require("node:path"), { test } = require("node:test");
const { buildSync } = require("../editor/node_modules/esbuild");
const compiled = buildSync({ stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "ts", contents:
  'export {assistantCreationDefaultRect} from "./editor/src/assistant/creationPlacement"; export {recoverAssistantCreationConversation} from "./editor/src/assistant/creationRecovery";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text;
const m = { exports: {} }; new Function("module", "exports", compiled)(m, m.exports);
const { assistantCreationDefaultRect: rect, recoverAssistantCreationConversation: recover } = m.exports;
test("sparse candidate cards have room for actual image/title/button content in a 720px reference canvas", () => {
  for (const total of [1, 2, 4]) for (let index = 0; index < total; index++) {
    assert(rect(index, total).height * 720 / 100 >= 130,
      "The real failed card has 122px scroll content plus bottom padding; never restore a 100.8px slot");
  }
});
test("all bounded batches are in the canvas and non-overlapping, with independent returned rectangles", () => {
  for (let total = 1; total <= 16; total++) {
    const slots = Array.from({ length: total }, (_, i) => rect(i, total));
    for (const [i, a] of slots.entries()) {
      assert(a.x >= 0 && a.y >= 0 && a.width > 0 && a.height > 0);
      assert(a.x + a.width <= 100 && a.y + a.height <= 100);
      for (const b of slots.slice(i + 1))
        assert(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
    slots[0].height = 0; assert(rect(0, total).height > 0);
  }
  for (const [index, total] of [[-1, 2], [2, 2], [0, 0], [0, 17], [0.5, 2], [0, NaN]])
    assert.throws(() => rect(index, total));
});
test("title-page candidates reserve the Ren'Py navigation rail", () => {
  for (const total of [1, 2, 4, 8, 16]) {
    const slots = Array.from({ length: total }, (_, i) => rect(i, total, "title"));
    for (const [i, a] of slots.entries()) {
      assert(a.x >= 60, "Title candidates must stay to the right of the default Ren'Py navigation rail");
      assert(a.x + a.width <= 100 && a.y >= 0 && a.y + a.height <= 100);
      for (const b of slots.slice(i + 1)) {
        assert(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
      }
    }
  }
});
test("terminal conversation recovery uses the same placement without changing previous persisted review coordinates", () => {
  const baseline = { projectId: "p", layoutType: "renpy", screens: { title: "snapshot" } };
  const conversation = { id: "c", projectId: "p", mode: "creation", title: "创建", createdAt: "now", updatedAt: "now",
    messages: [], citations: [], creationPendingProcess: {
      version: 1, id: "task", baseline, authorizedAssets: [], targets: [],
    }, creationReviewItems: [{ id: "existing", rect: { x: 45, y: 12, width: 30, height: 30 } }] };
  const original = structuredClone(conversation);
  const recovered = recover(conversation, { id: "task", projectId: "p", conversationId: "c",
    status: "completed", submittedAt: 1, result: { components: ["一", "二"].map(name => ({
      name, description: "", html: '<div class="root"><span>正文</span></div>', css: "", screen_id: "title",
    })), edits: [] } });
  assert.deepEqual(recovered.creationReviewItems.map(x => x.rect), [rect(0, 2, "title"), rect(1, 2, "title")]);
  assert.deepEqual(conversation, original);
  assert.equal(recover(original, { id: "different", projectId: "p", conversationId: "c", status: "completed" }), undefined);
});
