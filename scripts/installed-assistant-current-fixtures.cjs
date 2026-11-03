"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const recovery = process.env.AGENTVN_ASSISTANT_SESSION === "recovery";
const review = process.env.AGENTVN_ASSISTANT_SESSION === "review";
const motion = process.env.AGENTVN_ASSISTANT_SESSION === "editor-motion";
const run = motion ? "D:/AgentVN/output/installed-editor-motion-20261018-01" : review ? "D:/AgentVN/output/installed-assistant-review-20261018-01" : recovery ? "D:/AgentVN/output/installed-assistant-recovery-20261018-01" : "D:/AgentVN/output/installed-assistant-session-20261018-01";
const work = motion ? "F:/AgentVN-QA-InstalledEditorMotion-20261018-01" : review ? "F:/AgentVN-QA-InstalledAssistantReview-20261018-01" : recovery ? "F:/AgentVN-QA-InstalledAssistantRecovery-20261018-01" : "F:/AgentVN-QA-InstalledAssistant-20261018-01";
const report = { status: "RUNNING", at: new Date().toISOString(), projects: [], realModelRequests: 0, error: null };
try {
  assert(fs.existsSync(work) && !fs.existsSync(path.join(run, "fixtures.json")));
  const compiled = buildSync({ stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "ts",
    contents: 'export {switchRuntimeUILayoutType} from "./shared/cartridge/uiLayoutProfiles"; export {useProjectStore} from "./editor/src/store/projectStore";' },
    bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text;
  const mod = { exports: {} }; new Function("module", "exports", compiled)(mod, mod.exports);
  for (const suffix of ["a", "b"]) {
    const p = fixture(`installed-${motion ? "editor-motion" : `assistant-${review ? "review" : recovery ? "recovery" : "current"}`}-${suffix}-20261018-01`);
    p.schema_version = "1.1.0"; p.title = motion ? `安装版编辑器交互验收工程${suffix.toUpperCase()}` : `安装版创造工作台${review ? "审核" : recovery ? "恢复" : "隔离"}工程${suffix.toUpperCase()}`;
    const defaults = structuredClone(mod.exports.useProjectStore.getState().settings);
    p.editor_settings = { ...defaults, ...mod.exports.switchRuntimeUILayoutType(defaults, "renpy") };
    p.nodes[0].data.loadingAnimation = { kind: "default" }; p.nodes[0].data.openingAudio = [];
    if (review && suffix === "a") {
      // Reuse a separately traced, genuine PNG fixture; no optional pngjs
      // dependency or fabricated image header. Never touch its original bytes.
      const source = JSON.parse(fs.readFileSync("D:/AgentVN/output/installed-components-20261018-01/fixtures.json", "utf8")).images[0];
      const image = fs.readFileSync(source.path); assert.equal(sha256(image), source.sha256);
      assert.equal(image.readUInt32BE(16), 48); assert.equal(image.readUInt32BE(20), 32);
      p.asset_manifest = [
        { asset_id: "private-project-badge", asset_type: "ui", metadata: { display_name: "工程徽章", filename: "中文 徽章.png", mime_type: "image/png",
          data_url: `data:image/png;base64,${image.toString("base64")}`, prompt: "private-generation", filePath: "C:\\private\\badge.png" } },
        { asset_id: "private-project-unselected", asset_type: "ui", metadata: { display_name: "未授权工程图片", filename: "PRIVATE_UNSELECTED.png",
          mime_type: "image/png", data_url: `data:image/png;base64,${image.toString("base64")}` } }
      ];
      report.image = { sha256: sha256(image), width: 48, height: 32, source: source.path };
    }
    const file = path.join(work, `创造工作台 工程${suffix.toUpperCase()}.vnproj`);
    fs.writeFileSync(file, JSON.stringify(p), { flag: "wx" });
    report.projects.push({ projectId: p.project_id, title: p.title, input: file, sha256: sha256(fs.readFileSync(file)) });
  }
  Object.assign(report, report.projects[0]); report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
fs.writeFileSync(path.join(run, "fixtures.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
