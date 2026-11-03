"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { fixture } = require("./lib/editor-ui-acceptance.cjs");
const root = "D:/AgentVN/output/installed-gui-session-20261018-01";
const work = "F:/AgentVN-QA-InstalledGuiSession-20261018-01";
const report = { status: "RUNNING", at: new Date().toISOString(), error: null, realModelRequests: 0 };
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
try {
  assert(!fs.existsSync(path.join(root, "fixtures.json")) && fs.existsSync(work));
  const official = JSON.parse(fs.readFileSync("D:/AgentVN/output/installed-gui-20261018-01/official-generate-02.json", "utf8"));
  assert.equal(official.status, "PASS"); assert.equal(official.generated.images, 24); assert.equal(official.generated.fonts, 1);
  assert.equal(sha(fs.readFileSync(official.generated.archive.path)), official.generated.archive.sha256);
  report.officialArchive = official.generated.archive; report.officialFiles = official.files;
  const project = fixture("installed-gui-isolated-20261018-01"); project.schema_version = "1.1.0";
  project.title = "安装版官方完整GUI验收"; project.nodes[1].data.scene.commands = [
    { type: "narration", text: "QA_OFFICIAL_GUI_EXPORT_STORY" },
  ];
  report.projectId = project.project_id; report.title = project.title;
  report.input = path.join(work, "官方GUI隔离工程.vnproj");
  fs.writeFileSync(report.input, JSON.stringify(project), { flag: "wx" });
  report.inputSha256 = sha(fs.readFileSync(report.input)); report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
fs.writeFileSync(path.join(root, "fixtures.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, projectId: report.projectId, error: report.error }, null, 2));
