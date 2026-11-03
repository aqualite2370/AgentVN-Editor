#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const projectStore = read("editor/src/store/projectStore.ts");
assert.match(projectStore, /export function createUniqueProjectId/, "project store exposes a dedicated unique id generator");
assert.match(projectStore, /generatedProjectIdSequence/, "project ids include a same-millisecond sequence guard");
assert.match(projectStore, /randomProjectIdSuffix/, "project ids include a random suffix for cross-session collision resistance");
assert.doesNotMatch(projectStore, /project_\$\{Date\.now\(\)\}/, "project ids must not be plain Date.now strings");
assert.doesNotMatch(projectStore, /projectId:\s*\`project_\$\{Date\.now\(\)\}\`/, "createProject must not reuse Date.now as the whole id");

const app = read("editor/src/app/App.tsx");
assert.match(app, /createProjectInFlightRef/, "home create-project action is guarded against rapid repeat clicks");
assert.match(app, /rememberProject\(currentDraft,\s*"new_project"\)/, "new project archives the current draft before replacing the active project");
assert.match(app, /recent_projects:\s*archivedRecentProjects\.map/, "new project preserves archived recent projects during the shared-state write");
assert.match(app, /project_graph:\s*{[\s\S]*nodes:\s*nextEditor\.nodes[\s\S]*project_metadata:\s*{[\s\S]*projectId:\s*nextProject\.projectId/, "new project writes graph and metadata in the same shared-state transaction");

console.log("Project creation safety contract: passed");
