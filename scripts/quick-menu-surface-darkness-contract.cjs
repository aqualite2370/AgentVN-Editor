#!/usr/bin/env node
"use strict";
const fs=require("node:fs");const path=require("node:path");const assert=require("node:assert/strict");const root=path.resolve(__dirname,"..");const css=fs.readFileSync(path.join(root,"GameCli_framework/src/styles/quick-menu-contract.css"),"utf8"),vars=fs.readFileSync(path.join(root,"GameCli_framework/src/styles/variables.css"),"utf8");
assert.match(css,/--runtime-quick-menu-glass-background:[\s\S]*?skin-background[\s\S]*?material-alpha,\s*66%/i,"quick-menu surface must use the low-saturation skin glass material");
assert.match(css,/\.playback-controls\s*\{[\s\S]*opacity:\s*1;/,"quick-menu root opacity must remain stable so collapsed toggle is not dimmed");
assert.match(vars,/--runtime-quick-menu:\s*[^;]+/,"runtime quick-menu token must exist");
console.log("quick-menu-surface-darkness-contract: PASS");
