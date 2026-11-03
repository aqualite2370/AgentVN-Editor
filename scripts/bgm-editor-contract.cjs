#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[PASS] ${message}`);
}

const editor = read("editor/src/components/command-editors/BgmCommandEditor.tsx");
const workbench = read("editor/src/components/command-editors/FloatingCommandWorkbench.tsx");
const commands = read("editor/src/utils/commandTools.ts");
const types = read("shared/cartridge/types.ts");

assert(editor.includes("播放效果") && editor.includes("停止效果"), "普通 BGM 编辑器为播放和停止分别提供效果选项");
assert(editor.includes("DEFAULT_BGM_FADE_MS") && editor.includes("淡入时长（毫秒）") && editor.includes("淡出时长（毫秒）"), "普通 BGM 编辑器支持 500ms 默认值和方向化时长输入");
assert(workbench.includes("DEFAULT_BGM_FADE_MS") && workbench.includes("立即播放") && workbench.includes("立即停止"), "浮动事件工作台支持渐变/立即模式");
assert(commands.includes('fade_ms: 500') && commands.includes("淡入") && commands.includes("淡出"), "新建命令默认 500ms 且摘要显示渐变方向");
assert(!types.includes('action: "play" | "stop" | "fade"'), "共享卡带类型不再导出旧 fade 动作");

if (process.exitCode) process.exit(process.exitCode);
