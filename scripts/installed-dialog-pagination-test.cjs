"use strict";

const assert = require("node:assert/strict");
const { walkDialoguePages } = require("./lib/installed-dialog-pagination.cjs");

async function collect({ initialPages, counts, texts, nextOverride }) {
  let index = 0, advances = 0;
  const visited = [];
  const value = () => ({ scene: "bubble", command: "8", page: index + 1,
    pages: counts[index], done: true, text: texts[index] });
  await walkDialoguePages({
    initial: { ...value(), pages: initialPages },
    reveal: async () => value(),
    next: async () => { advances++; index++; return nextOverride?.(value()) ?? value(); },
    visit: async current => { visited.push(current); },
  });
  return { text: visited.map(row => row.text).join(""), visited, advances };
}

(async () => {
  const changing = await collect({ initialPages: 4, counts: [5, 5, 5, 5, 5],
    texts: ["甲", "乙", "丙", "丁", "末页七十字"] });
  assert.equal(changing.text, "甲乙丙丁末页七十字",
    "A late 4→5 page measurement must not drop the final fragment");
  assert.equal(changing.advances, 4);
  const later = await collect({ initialPages: 2, counts: [2, 3, 3], texts: ["a", "b", "c"] });
  assert.equal(later.text, "abc", "Read the live page count on every page, not just the first reveal");
  const shrinking = await collect({ initialPages: 4, counts: [2, 2], texts: ["一", "二"] });
  assert.equal(shrinking.text, "一二");
  assert.equal(shrinking.advances, 1, "Never advance past the actual final page");
  const single = await collect({ initialPages: 1, counts: [1], texts: ["short"] });
  assert.equal(single.advances, 0);
  await assert.rejects(collect({ initialPages: 2, counts: [2, 2], texts: ["a", "b"],
    nextOverride: state => ({ ...state, page: 3 }) }), /skip or repeat/);
  await assert.rejects(collect({ initialPages: 2, counts: [2, 2], texts: ["a", "b"],
    nextOverride: state => ({ ...state, command: "9" }) }), /authored command/);
  await assert.rejects(collect({ initialPages: 1, counts: [0], texts: ["a"] }), /Invalid measured/);
  console.log("PASS: live pagination growth, shrink, single page, skipped page, command change and invalid state (7 cases)");
})().catch(error => { console.error(error); process.exitCode = 1; });
