"use strict";

const assert = require("node:assert/strict");
const { validateActiveTaskIndex } = require("./lib/active-task-index.cjs");

const currentIndex = `# AgentVN 持续任务总清单

## 2026-10-31 当前续接：QA门控修正

- 当前项保留 FAILED 原始结果，补充新的 PASS 证据：\`F:\\AgentVN\\QA\\Run-01\\report.json\`。

## 2026-10-30 历史记录：安装版复核

- 历史状态保持 FAILED；证据：\`F:\\AgentVN\\QA\\Old\\report.json\`。
`;

const result = validateActiveTaskIndex(currentIndex);
assert.equal(result.title, "AgentVN 持续任务总清单");
assert.equal(result.activeHeading, "2026-10-31 当前续接：QA门控修正");
assert.equal(result.activeBulletCount, 1);
assert.equal(result.evidenceReferenceCount, 1);
assert.throws(
  () => validateActiveTaskIndex("# AgentVN 持续任务总清单\n\n## Current tasks\n\n- no evidence\n"),
  /dated current entry/,
);
assert.throws(
  () => validateActiveTaskIndex("# AgentVN 持续任务总清单\n\n## 2026-10-31 当前：缺证据\n\n- 当前无路径引用。\n"),
  /evidence reference/,
);

console.log("task ledger index test: PASS");
