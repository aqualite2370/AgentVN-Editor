"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const esbuild = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, "..");
const run = path.join(root, "output/old-runtime-refusal-20261018-01");
const workspace = "F:\\AgentVN-QA-OldRuntime-20261018-01";
const attempt = process.argv[2] || "02";
assert(/^\d{2}$/.test(attempt));
const destination = path.join(run, `fixtures-${attempt}.json`);
assert(!fs.existsSync(destination), "Fresh fixture report required");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { status: "RUNNING", scope: "REAL_OLD_PE_AND_GENUINE_NEW_CAPABILITY_FIXTURES",
  startedAt: new Date().toISOString(), fixtures: [], realModelRequests: 0 };
(async () => {
  const prior = JSON.parse(fs.readFileSync(path.join(run, "preparation.json"), "utf8"));
  assert.equal(sha(prior.source.path), prior.source.sha256);
  const exe = path.join(workspace, "old-player/agentvn-player.exe");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    `(Get-Item -LiteralPath '${exe}').VersionInfo.ProductVersion`], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0); assert.equal(result.stdout.trim(), "1.8.0");
  const bytes = fs.readFileSync(exe);
  // Rust concatenates adjacent static strings; this binary does not contain
  // a JSON Tauri configuration. Preserve the actual observed bytes as evidence.
  const identifiers = [...new Set(bytes.toString("utf8").match(/com\.agentvn\.[A-Za-z0-9._-]+/g) || [])];
  assert.deepEqual(identifiers, ["com.agentvn.playermainindex.html"]);
  report.oldExecutable = { path: exe, sha256: sha(exe), actualPeVersion: "1.8.0",
    identifierEvidence: identifiers, intendedProfileId: "com.agentvn.player" };
  const frozen = JSON.parse(fs.readFileSync(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"), "utf8"));
  report.candidateSources = [];
  for (const relative of ["shared/cartridge/packer.ts", "shared/cartridge/runtimeCapabilities.ts",
    "shared/cartridge/uiLayoutProfiles.ts", "GameCli_framework/src/cartridge/importCartridge.ts"]) {
    const absolute = path.join(root, relative);
    const row = frozen.source.find(r => path.resolve(r.path).toLowerCase() === absolute.toLowerCase());
    assert(row, `Missing frozen source ${relative}`);
    assert.equal(sha(absolute), row.sha256);
    report.candidateSources.push({ relative, sha256: row.sha256 });
  }
  const built = esbuild.buildSync({ stdin: { contents: `
    export { packCartridgeToUint8Array } from "./shared/cartridge/packer";
    export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";
    export { minimumRuntimeVersionForScript, minimumRuntimeVersionForLayout,
      runtimeScriptSchemaVersion } from "./shared/cartridge/runtimeCapabilities";
    export { importRuntimeCartridgeFromArrayBuffer } from "./GameCli_framework/src/cartridge/importCartridge";
  `, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "cjs",
    write: false, nodePaths: [path.join(root, "editor/node_modules")] });
  const mod = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(require, mod, mod.exports);
  const api = mod.exports;
  const fixtures = [
    { id: "legacy-control", expected: "ACCEPT", title: "Old Runtime Legacy Control" },
    { id: "nvl-inheritance", expected: "REJECT", title: "New NVL Inheritance", presentation: "nvl" },
    { id: "advanced-layout", expected: "REJECT", title: "New Advanced Layout", advanced: true }
  ];
  for (const row of fixtures) {
    const script = { schema_version: "1.1.0", game_id: `qa-old-runtime-${row.id}`,
      title: row.title, entry_scene_id: "start",
      ...(row.presentation ? { default_dialog_presentation: row.presentation } : {}),
      scenes: [{ scene_id: "start", title: "Start", summary: "Isolated compatibility probe", chapter: 1,
        tags: [], is_ending: true, commands: [{ type: "narration",
          text: `${row.id.toUpperCase()}_PLAYED_SHOULD_${row.expected === "ACCEPT" ? "BE_VISIBLE" : "NEVER_BE_VISIBLE"}` }] }] };
    script.schema_version = api.runtimeScriptSchemaVersion(script);
    const uiSkin = row.advanced ? api.createRenpyUILayout() : undefined;
    if (uiSkin) {
      const menu = uiSkin.screens.find(screen => screen.screen_id === "game_menu");
      assert(menu, "Real advanced shared-menu screen required");
      menu.components.push({ component_id: "qa_shared_menu_mask", component_type: "mask",
        label: "Shared Menu Compatibility Probe", visible: true, zIndex: 0,
        rect: { x: 1, y: 1, width: 98, height: 98 },
        style: { backgroundColor: "rgba(0,0,0,0.08)", borderWidth: 0, borderRadius: 0 } });
    }
    const required = api.minimumRuntimeVersionForLayout(api.minimumRuntimeVersionForScript(script), uiSkin);
    if (row.presentation) assert.equal(required, "0.18.0");
    if (row.advanced) assert.equal(required, "0.21.0");
    const now = new Date().toISOString();
    const manifest = { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: required,
      game_id: script.game_id, title: row.title, author: "Isolated AgentVN QA", description: "No user data or AI",
      version: "1.0.0", language: "zh-CN", tags: [], entry_script: "script.json", entry_scene_id: "start",
      assets: [], created_at: now, updated_at: now,
      ...(uiSkin ? { ui_skin: { path: "ui/layout.json", version: uiSkin.ui_layout_version, name: uiSkin.name } } : {}) };
    const packed = await api.packCartridgeToUint8Array({ manifest, script, uiSkin });
    // The real current candidate importer validates the exact fixture bytes.
    // This is fixture validity, not proof that the old binary rejects anything.
    const current = await api.importRuntimeCartridgeFromArrayBuffer(packed.buffer, `${row.id}.vncart`);
    assert.equal(current.validation.ok, true);
    const file = path.join(workspace, `${row.id}-${attempt}.vncart`);
    fs.writeFileSync(file, packed, { flag: "wx" });
    report.fixtures.push({ id: row.id, path: file, title: row.title, expectedOldBehavior: row.expected,
      minimumRuntimeVersion: required, scriptSchema: script.schema_version, bytes: packed.length,
      sha256: sha(file), candidateValidation: "PASS", genuineFeature: row.presentation || (row.advanced ? "renpy-shared-layout" : "legacy"),
      sentinel: script.scenes[0].commands[0].text });
  }
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
  });
