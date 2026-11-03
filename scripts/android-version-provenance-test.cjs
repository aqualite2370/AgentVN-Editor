"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { createBuildEvidence, verifyProvenance } = require("./android-acceptance-evidence.cjs");
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-versions-"));
  try {
    const install = path.join(temp, "独立 安装目录"), runtime = path.join(install, "GameCli_framework");
    fs.mkdirSync(path.join(runtime, "src-tauri"), { recursive: true });
    fs.mkdirSync(path.join(install, "shared/cartridge"), { recursive: true });
    const cargo = path.join(runtime, "src-tauri/Cargo.toml");
    const constants = path.join(install, "shared/cartridge/constants.ts");
    const tauri = path.join(runtime, "src-tauri/tauri.conf.json");
    const input = {
      apk: path.join(install, "隔离 游戏.apk"), source: path.join(install, "源.vncart"),
      layout: path.join(install, "layout.json"), runId: "versions-isolated", packageName: "com.test.game",
      editorVersion: "2.3.4", gameVersion: "0.4.2",
      // This legacy field must never override actual recorded engine sources.
      runtimeVersion: "0.1.0", runtimeCargoToml: cargo, runtimeProtocolConstants: constants,
      symlinkProbe: { isElevated: true, success: true },
    };
    fs.writeFileSync(cargo, '\uFEFF[package]\r\nname = "agentvn-player"\r\nversion = "2.3.4" # engine\r\n[dependencies]\r\nother = { version = "9.9.9" }\r\n');
    fs.writeFileSync(constants, '\uFEFFexport const SUPPORTED_RUNTIME_VERSION = "0.21.0";\r\n');
    fs.writeFileSync(tauri, '{"version":"0.1.0","productName":"用户已有游戏身份"}');
    const tauriBefore = fs.readFileSync(tauri);
    fs.writeFileSync(input.layout, "{}");
    fs.writeFileSync(input.source, "source cartridge bytes, not an APK manifest");
    const zip = new JSZip();
    zip.file("assets/embedded-cartridge/manifest.json", JSON.stringify({
      version: input.gameVersion, runtime_version: "0.18.0", ui_skin: { path: "ui/layout.json" },
    }));
    zip.file("assets/embedded-cartridge/ui/layout.json", "{}");
    fs.writeFileSync(input.apk, await zip.generateAsync({ type: "nodebuffer" }));
    const evidence = await createBuildEvidence(input);
    assert.equal(evidence.runtimeVersion, "2.3.4", "runtimeVersion must describe the engine, never a stale Tauri game identity");
    assert.equal(evidence.engineVersion, "2.3.4");
    assert.equal(evidence.gameVersion, "0.4.2");
    assert.equal(evidence.runtimeProtocolVersion, "0.21.0");
    assert.equal(evidence.minimumRuntimeVersion, "0.18.0");
    assert.equal(evidence.versionEvidence.schemaVersion, 1);
    assert.equal(evidence.versionEvidence.runtimeVersionMeaning, "engine-cargo-package");
    assert.equal(evidence.versionEvidence.sources.engine.path, cargo);
    assert.equal(evidence.versionEvidence.sources.protocol.path, constants);
    assert.match(evidence.versionEvidence.sources.engine.sha256, /^[a-f0-9]{64}$/);
    assert.equal(verifyProvenance(input.apk, evidence).versionStatus, "RECORDED");
    assert.deepEqual(fs.readFileSync(tauri), tauriBefore, "do not rewrite user game identity to repair metadata");
    for (const change of [
      { engineVersion: "9.0.0" }, { runtimeVersion: "0.1.0" },
      { gameVersion: "" }, { runtimeProtocolVersion: "" }, { minimumRuntimeVersion: "" },
      { versionEvidence: undefined },
    ]) assert.equal(verifyProvenance(input.apk, { ...evidence, ...change }).status, "BLOCKED");
    const cliInput = path.join(install, "input.json");
    fs.writeFileSync(cliInput, JSON.stringify(input));
    execFileSync(process.execPath, [path.join(__dirname, "android-acceptance-evidence.cjs"), cliInput], {
      cwd: install, windowsHide: true, stdio: "pipe",
    });
    const sidecar = JSON.parse(fs.readFileSync(input.apk + ".acceptance.json"));
    assert.equal(sidecar.engineVersion, "2.3.4");
    assert.equal(sidecar.runtimeProtocolVersion, "0.21.0");
    await assert.rejects(createBuildEvidence({ ...input, runtimeCargoToml: path.join(install, "missing.toml") }),
      /APK_VERSION_SOURCE_MISSING/);
    await assert.rejects(createBuildEvidence({ ...input, runtimeProtocolConstants: undefined }),
      /APK_VERSION_SOURCE_MISSING/);
    await assert.rejects(createBuildEvidence({ ...input, gameVersion: "different-game" }), /APK_GAME_VERSION_MISMATCH/);
    const cargoBefore = fs.readFileSync(cargo), constantsBefore = fs.readFileSync(constants);
    for (const invalid of ['[package]\nname = "x"\n', '[package]\nversion.workspace = true\n',
      '[package]\nversion = ""\n', '[package]\nversion = "1.2.3"\nversion = "9.9.9"\n',
      '[dependencies]\nversion = "9.9.9"\n']) {
      fs.writeFileSync(cargo, invalid);
      await assert.rejects(createBuildEvidence(input), /APK_ENGINE_VERSION_INVALID/);
    }
    fs.writeFileSync(cargo, cargoBefore);
    for (const invalid of ['export const SUPPORTED_RUNTIME_VERSION = arbitraryCode();',
      'export const SUPPORTED_RUNTIME_VERSION = "";',
      'export const SUPPORTED_RUNTIME_VERSION = "0.21.0";\nexport const SUPPORTED_RUNTIME_VERSION = "9.9.9";']) {
      fs.writeFileSync(constants, invalid);
      await assert.rejects(createBuildEvidence(input), /APK_PROTOCOL_VERSION_INVALID/);
    }
    fs.writeFileSync(constants, constantsBefore);
    const legacyInput = { ...input };
    delete legacyInput.runtimeCargoToml; delete legacyInput.runtimeProtocolConstants;
    const legacy = await createBuildEvidence(legacyInput);
    assert.equal(legacy.runtimeVersion, "0.1.0", "legacy input remains readable without relabelling historical values");
    assert.equal(legacy.versionEvidence, undefined);
    assert.equal(verifyProvenance(input.apk, legacy).versionStatus, "LEGACY_UNVERIFIED");
    console.log("android-version-provenance: PASS (engine/game/protocol sources, installed-root CLI, invalid sources, legacy compatibility)");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
