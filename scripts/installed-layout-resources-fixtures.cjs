"use strict";
// Controlled small-project preparation. No model calls, user assets or product writes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const root = "D:/AgentVN", run = path.join(root, "output/installed-layout-resources-20261018-01");
const work = "F:/AgentVN-QA-InstalledLayoutResources-20261018-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const prep = read(path.join(run, "preparation.json"));
assert.equal(prep.status, "PASS"); assert(prep.profiles.every(p => fs.existsSync(p.held)));
assert(!fs.existsSync(path.join(run, "fixtures.json")));
const req = createRequire(path.join(root, "editor/package.json"));
const compiled = req("esbuild").buildSync({
  stdin: { contents: `
    export { getDefaultUISkinLayout } from './shared/cartridge/uiSkin';
    export { createRenpyUILayout, resolveRuntimeUILayoutSettings } from './shared/cartridge/uiLayoutProfiles';
  `, resolveDir: root, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", "require", compiled.outputFiles[0].text)(loaded, loaded.exports, req);
const { getDefaultUISkinLayout, createRenpyUILayout, resolveRuntimeUILayoutSettings } = loaded.exports;
const p = fixture("installed-layout-resources-20261018-01");
p.title = "双布局资源隔离验收"; p.author = "QA";
const ids = ["agent-only", "renpy-only", "shared", "story-protected", "shell-protected", "gallery-protected", "unused-library"];
const resources = ids.map((id, i) => {
  const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#${(0x183148 + i * 0x10100).toString(16)}"/><text x="80" y="140" fill="white" font-size="40">${id}</text></svg>`);
  const assetId = `qa-res-${id}`, zipPath = `assets/ui/${assetId}.svg`;
  p.asset_manifest.push({ asset_id: assetId, asset_type: "ui", metadata: {
    filename: `${id}.svg`, project_path: zipPath, mime_type: "image/svg+xml", width: 1280, height: 720,
    data_url: `data:image/svg+xml;base64,${bytes.toString("base64")}`, size_bytes: bytes.length,
    hash_sha256: sha256(bytes), source: "imported",
  } });
  return { id: assetId, role: id, sha256: sha256(bytes), bytes: bytes.length, projectPath: zipPath };
});
const agent = getDefaultUISkinLayout(), renpy = createRenpyUILayout();
agent.name = "QA AgentVN 独立资源"; renpy.name = "QA RenPy 独立资源";
for (const [type, layout] of [["agentvn", agent], ["renpy", renpy]]) {
  // Explicit declared dependencies are distinct from an unrelated library file.
  // Protected assets also appear in only the Renpy layout: story/shell/gallery must win.
  const roles = type === "agentvn" ? ["agent-only", "shared"]
    : ["renpy-only", "shared", "story-protected", "shell-protected", "gallery-protected"];
  layout.assets = resources.filter(r => roles.includes(r.role)).map(r => ({ asset_id: r.id, path: r.projectPath }));
  const hero = layout.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === "title_hero");
  assert(hero);
  hero.style = { ...hero.style, backgroundImage: `asset:${type === "agentvn" ? "qa-res-agent-only" : "qa-res-renpy-only"}` };
}
p.editor_settings = {
  ...resolveRuntimeUILayoutSettings({ runtimeUILayoutProfiles: {
    version: 1, activeType: "agentvn", profiles: { agentvn: agent, renpy },
  } }),
  packageAppearance: { titleBackgroundAssetId: "qa-res-shell-protected", titleBackgroundFit: "stretch" },
};
p.nodes[1].data.scene.commands = [
  { type: "show_image", image_id: "qa-res-story-protected", duration: 0 },
  { type: "narration", text: "RESOURCE_STORY：共享剧情素材不可因非活动布局裁剪。" },
  { type: "gallery_anchor", anchor_id: "qa-res-gallery", asset_id: "qa-res-gallery-protected", title: "资源依赖画廊" },
  { type: "narration", text: "RESOURCE_END：布局切换不改变剧情或原素材。" },
];
const input = path.join(work, "中文 双布局资源隔离工程.vnproj");
fs.writeFileSync(input, JSON.stringify(p), { flag: "wx" });
fs.writeFileSync(path.join(run, "fixtures.json"), JSON.stringify({
  status: "PASS", at: new Date().toISOString(), input, inputSha256: sha256(fs.readFileSync(input)),
  projectId: p.project_id, title: p.title, resources,
  profiles: p.editor_settings.runtimeUILayoutProfiles, controlledProjectFixture: true,
  nativeProjectPickerClaim: false, productChanges: 0, realModelRequests: 0,
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", input, resources: resources.length }));
