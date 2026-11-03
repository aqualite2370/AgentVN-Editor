"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { chromium } = require("../editor/node_modules/playwright");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const importedSession = process.env.AGENTVN_COMPONENTS_SESSION === "import-use";
const run = importedSession ? "D:/AgentVN/output/installed-components-use-20261018-01" : "D:/AgentVN/output/installed-components-20261018-01";
const work = importedSession ? "F:/AgentVN-QA-InstalledComponentsUse-20261018-01" : "F:/AgentVN-QA-InstalledComponents-20261018-01";
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const report = { status: "RUNNING", at: new Date().toISOString(), realModelRequests: 0, images: [], error: null };
let browser;
(async () => {
  assert(fs.existsSync(work) && !fs.existsSync(path.join(run, "fixtures.json")));
  const project = fixture(importedSession ? "installed-components-import-use-20261018-01" : "installed-components-isolated-20261018-01");
  project.schema_version = "1.1.0"; project.title = importedSession ? "安装版ZIP副本实际使用_20261018" : "安装版组件分享验收_20261018";
  project.nodes[1].data.scene.commands = [{ type: "narration", text: "QA_COMPONENTS_EXPORTED_PLAYER_STORY" }];
  report.input = path.join(work, "组件库隔离工程.vnproj");
  report.projectId = project.project_id; report.title = project.title;
  fs.writeFileSync(report.input, JSON.stringify(project), { flag: "wx" });
  report.inputSha256 = sha(fs.readFileSync(report.input));
  const inputs = path.join(work, "中文 分享 输入"); fs.mkdirSync(inputs); report.inputs = inputs;
  browser = await chromium.launch(); const page = await browser.newPage();
  for (const [name, color] of [["红图标", "#b44848"], ["蓝图标", "#4466bb"]]) {
    const data = await page.evaluate(color => {
      const c = document.createElement("canvas"); c.width = 48; c.height = 32;
      const ctx = c.getContext("2d"); ctx.fillStyle = color; ctx.fillRect(0, 0, 48, 32);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(4, 4, 12, 20); return c.toDataURL("image/png").split(",")[1];
    }, color);
    const bytes = Buffer.from(data, "base64"), file = path.join(inputs, `${name}.png`);
    fs.writeFileSync(file, bytes, { flag: "wx" }); report.images.push({ path: file, sha256: sha(bytes), bytes: bytes.length });
  }
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(run, "fixtures.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, images: report.images, error: report.error }, null, 2));
});
