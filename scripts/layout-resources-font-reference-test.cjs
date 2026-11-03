"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { api, root, resourceFixture, inputFor, sha } = require("./layout-resources-source-test.cjs");
const output = process.argv[2]; assert(output && !fs.existsSync(output));
const report = { status: "RUNNING", cases: [], modelRequests: 0 };
(async () => {
  const a = api(), fontId = "qa-padded-font";
  const bytes = fs.readFileSync(path.join(root, "GameCli_framework/node_modules/harfbuzzjs/test/fonts/noto/NotoSans-Regular.ttf"));
  for (const mode of ["layout-font", "choice-font"]) {
    const c = { mode, status: "RUNNING" }; report.cases.push(c);
    try {
      const { project } = resourceFixture(), input = inputFor(project, "renpy", true);
      const ref = { asset_id: fontId, asset_type: "font", metadata: { filename: "font.ttf", project_path: "assets/font/font.ttf",
        mime_type: "font/ttf", data_url: `data:font/ttf;base64,${bytes.toString("base64")}` } };
      input.projectAssetRefs.push(ref); input.projectAssets.push(a.assetRefToManifestItem(ref));
      if (mode === "layout-font") input.uiSkin.tokens.fontAssetId = ` ${fontId} `;
      else input.script.scenes[0].commands.push({ type: "choice", choices: [{
        choice_id: "one", text: "字体引用", target_scene_id: "ui_acceptance", conditions: [],
        button_style: { fontAssetId: ` ${fontId} ` },
      }] });
      const before = structuredClone(input), result = await a.exportEditorCartridge(input);
      const font = result.manifest.assets.find(a => a.asset_id === fontId);
      assert(font, "Runtime trims fontAssetId, so dependency selection must preserve the same supported reference");
      const zip = await require("../editor/node_modules/jszip").loadAsync(await result.blob.arrayBuffer());
      assert.equal(sha(await zip.file(font.path).async("nodebuffer")), sha(bytes));
      assert.deepEqual(input, before); c.status = "PASS";
    } catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); }
  }
  assert.equal(report.cases.length, 2); assert(report.cases.every(c => c.status === "PASS")); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, cases: report.cases.map(c => [c.mode, c.status]), output }));
});
