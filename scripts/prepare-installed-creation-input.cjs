"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const root = path.resolve(__dirname, "..");
assert(process.argv[2], "Pass a fresh run directory");
const out = path.resolve(process.argv[2]);
assert(out.startsWith(path.join(root, "output") + path.sep), "Input evidence must remain in this run's output");
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, "创造验收 小工程.vnproj");
assert(!fs.existsSync(file), "Never overwrite an existing project fixture");
const compiled = buildSync({
  stdin: { resolveDir: root, loader: "ts", contents:
    'export { switchRuntimeUILayoutType } from "./shared/cartridge/uiLayoutProfiles";' },
  bundle: true, format: "cjs", platform: "node", write: false,
}).outputFiles[0].text;
const mod = { exports: {} };
new Function("module", "exports", compiled)(mod, mod.exports);
const project = fixture("installed_creation_smoke_20261014");
project.title = "创造模式安装版验收";
project.editor_settings = mod.exports.switchRuntimeUILayoutType({}, "renpy");
fs.writeFileSync(file, JSON.stringify(project, null, 2), { flag: "wx" });
console.log(JSON.stringify({ file, projectId: project.project_id, title: project.title,
  nodes: project.nodes.length, layoutType: project.editor_settings.runtimeUILayoutProfiles.activeType }));
