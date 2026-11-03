"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const run = path.resolve(__dirname, "../output/installed-real-model-20261019-01");
const handoff = JSON.parse(fs.readFileSync(path.join(run, "credential-handoff.json")));
const bytes = fs.readFileSync(handoff.project.path);
assert.equal(sha256(bytes), handoff.project.sha256);
const project = JSON.parse(bytes);
project.project_id = "installed-real-model-component-20261019-01";
project.title = "真实Agent新组件 隔离小工程";
const file = "F:/AgentVN-QA-InstalledRealModel-20261019-01/真实Agent组件 隔离小工程.vnproj";
const output = Buffer.from(JSON.stringify(project, null, 2));
fs.writeFileSync(file, output, { flag: "wx" });
const record = { path: file, projectId: project.project_id, title: project.title, sha256: sha256(output),
  createdAt: new Date().toISOString(), independentOfFirstFailedProject: true };
fs.writeFileSync(path.join(run, "component-fixture.json"), JSON.stringify(record, null, 2), { flag: "wx" });
console.log(JSON.stringify(record));
