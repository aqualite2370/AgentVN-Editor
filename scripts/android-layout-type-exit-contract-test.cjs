"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const runtimeQa = fs.readFileSync(`${__dirname}/android-apk-runtime-qa.cjs`, "utf8");
assert.match(runtimeQa, /assertTitlePolicy\(layoutType, state.buttons\)/);
assert.match(runtimeQa, /document.querySelector\("\[data-layout-type\]"\)/);
console.log("android-layout-type-exit-contract: PASS (AgentVN and Ren'Py title exit policies are tested independently)");
