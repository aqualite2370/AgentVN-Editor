#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workbench = fs.readFileSync(
  path.join(root, "editor", "src", "components", "command-editors", "FloatingCommandWorkbench.tsx"),
  "utf8",
);
const commandList = fs.readFileSync(
  path.join(root, "editor", "src", "components", "command-editors", "CommandListEditor.tsx"),
  "utf8",
);
const runtimeTypes = fs.readFileSync(
  path.join(root, "GameCli_framework", "src", "types", "commands.ts"),
  "utf8",
);

assert.doesNotMatch(workbench, /title:\s*"运行时控制"/, "Command workbench must not expose the runtime-control category.");
assert.doesNotMatch(workbench, /types:\s*\[\s*"rollback"\s*\]/, "Command workbench must not offer rollback control for insertion.");
assert.match(commandList, /command\.type === "rollback"/, "Existing rollback commands must remain editable for backward compatibility.");
assert.match(runtimeTypes, /type:\s*"rollback"/, "Runtime rollback command compatibility must remain supported.");

console.log("PASS rollback author control is hidden without removing runtime compatibility");
