"use strict";

const assert = require("node:assert/strict");

// Walk actual player input and measured page state, without using engine APIs.
async function walkDialoguePages({ initial, reveal, next, visit }) {
  assert(Number.isInteger(initial.pages) && initial.pages >= 1, "Invalid initial page count");
  assert.equal(initial.page, 1, "Full-text acceptance must begin on the first page");
  for (let index = 1; index <= 10000; index++) {
    const current = await reveal();
    assert.equal(current.scene, initial.scene, "Pagination must not change the scene");
    assert.equal(current.command, initial.command, "Pagination must not advance the command");
    assert.equal(current.page, index, "Each measured page must be visited exactly once");
    assert(Number.isInteger(current.pages) && current.pages >= index && current.pages <= 10000,
      "Invalid measured page count");
    await visit(current, index);
    if (index === current.pages) return { pages: index };
    const after = await next();
    assert.equal(after.scene, initial.scene, "Page advance must stay in the authored scene");
    assert.equal(after.command, initial.command, "Page advance must stay in the authored command");
    assert.equal(after.page, index + 1, "Page advance must not skip or repeat a page");
  }
  throw Error("Pagination exceeded its safety limit");
}

module.exports = { walkDialoguePages };
