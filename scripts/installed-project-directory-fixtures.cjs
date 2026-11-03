"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const run = "D:/AgentVN/output/installed-project-directory-20261018-01";
const work = "F:/AgentVN-QA-InstalledProjectDirectory-20261018-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", at: new Date().toISOString(), projects: [], realModelRequests: 0, error: null };
try {
  const prep = read(path.join(run, "preparation.json"));
  assert.equal(prep.status, "PASS"); assert.equal(prep.verifiedOriginalFiles, 55);
  assert(prep.profiles.every(p => fs.existsSync(p.held)));
  assert(!fs.existsSync(path.join(run, "fixtures.json")));
  for (const suffix of ["a", "b"]) {
    const p = fixture(`installed-project-directory-${suffix}-20261018-01`);
    p.schema_version = "1.1.0"; p.title = `QA保存目录工程${suffix.toUpperCase()}_20261018`;
    p.nodes[0].data.loadingAnimation = { kind: "default" }; p.nodes[0].data.openingAudio = [];
    const input = path.join(work, `分工程保存 工程${suffix.toUpperCase()}.vnproj`);
    fs.writeFileSync(input, JSON.stringify(p), { flag: "wx" });
    const directory = path.join(work, suffix === "a" ? "中文 保存目录甲" : "中文 保存目录乙");
    fs.mkdirSync(directory);
    report.projects.push({ projectId: p.project_id, title: p.title, input, directory,
      sha256: sha256(fs.readFileSync(input)) });
  }
  Object.assign(report, report.projects[0]); report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
fs.writeFileSync(path.join(run, "fixtures.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
