"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const ts = require("../editor/node_modules/typescript");
require.extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, f);
const { runExportPreflight } = require("../editor/src/cartridge/preflight.ts");
const attempt = process.argv[2];
assert.match(attempt || "", /^(red|green)-\d{2}$/);
const out = path.join("F:/AgentVN/QA/Preflight-Optional-Guidance-20261108-01", attempt);
assert(!fs.existsSync(out), "Preserve previous test evidence");
fs.mkdirSync(out, { recursive: true });
const scene = { scene_id: "intro", title: "测试", summary: "", chapter: 1, tags: [],
  commands: [{ type: "dialog", character_id: "alice", text: "测试对白" }] };
const input = {
  script: { entry_scene_id: "intro", scenes: [scene], characters: [{ character_id: "alice", name: "测试角色" }] },
  nodes: [{ id: "node", data: { nodeKind: "scene", label: "测试场景", scene } }],
  edges: [], assets: [],
  metadata: { gameId: "optional_guidance_test", title: "测试", author: "QA", description: "预检建议回归" },
};
const report = runExportPreflight(input);
const check = report.checks.find(row => row.id === "audio_performance_options");
const cases = [];
for (const [label, target, excluded] of [
  ["添加场景背景", /背景/, /音频|语音|音效/],
  ["添加角色图像", /立绘|角色图像/, /音频|语音|音效/],
  ["添加对白头像", /头像/, /音频|语音|音效/],
  ["添加场景音乐", /背景音乐/, /头像|立绘/],
  ["添加对白语音", /语音/, /头像|立绘/],
  ["添加音效", /音效/, /头像|立绘/],
  ["添加演出效果", /演出|镜头/, /补充对应音频/],
]) {
  try {
    const row = check.issues.find(item => item.message.includes(label));
    assert(row, "Expected optional issue: " + label);
    assert.equal(row.severity, "warning"); assert.equal(row.code, "optional_audio_performance_missing");
    assert(row.subject, "Preserve precise navigation subject");
    assert.match(row.solution, target); assert.doesNotMatch(row.solution, excluded);
    assert.match(row.solution, /可选|无需|不需要|可保持/);
    cases.push({ name: label, status: "PASS", issue: row });
  } catch (e) { cases.push({ name: label, status: "FAILED", error: String(e.stack) }); }
}
try {
  assert.equal(check.issues.length, 7);
  assert.equal(check.status, "warning");
  assert(!report.blockers.some(row => row.code === "optional_audio_performance_missing"));
  const missingScene = { ...scene, commands: [{ type: "background", background_id: "missing_background" }, ...scene.commands] };
  const missing = runExportPreflight({ ...input,
    script: { ...input.script, scenes: [missingScene] },
    nodes: [{ ...input.nodes[0], data: { ...input.nodes[0].data, scene: missingScene } }],
  });
  assert(missing.warnings.some(row => row.code === "asset_reference_missing"
    && row.subject === "missing_background"), "Preserve the existing placeholder-export warning");
  assert(!missing.checks.find(row => row.id === check.id).issues.some(row => row.message.includes("添加场景背景")),
    "Do not invent an optional background suggestion when a background command exists");
  const invalidOpening = runExportPreflight({ ...input,
    script: { ...input.script, loading_animation: { kind: "video", video_asset_id: "" } },
  });
  assert(invalidOpening.blockers.some(row => row.code === "loading_animation_video_missing"),
    "An invalid opening video remains blocking");
  cases.push({ name: "Optional scope and explicit missing-reference severity preserved", status: "PASS" });
} catch (e) { cases.push({ name: "Optional scope and explicit missing-reference severity preserved",
  status: "FAILED", error: String(e.stack) }); }
const result = { status: cases.every(row => row.status === "PASS") ? "PASS" : "FAILED",
  scope: "Public export preflight entry; seven optional resource kinds; controlled minimal project",
  sources: [__filename, path.resolve(__dirname, "../editor/src/cartridge/preflight.ts"),
    path.resolve(__dirname, "../editor/src/utils/assetAudit.ts")].map(file => ({
      path: file, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    })),
  cases, modelRequests: 0, builds: 0 };
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (result.status !== "PASS") process.exitCode = 1;
