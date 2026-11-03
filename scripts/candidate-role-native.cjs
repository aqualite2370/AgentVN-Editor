"use strict";
// Reuse the complete author/menu/story checks against the newly built native
// Player. Explicit installed operations bind to the current real NSIS receipt;
// historical native operations remain separate from frozen installed evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const [operation, ...args] = process.argv.slice(2);
assert(["player", "audit", "installed-player", "installed-audit"].includes(operation));
const installed = operation.startsWith("installed-"), kind = operation.replace("installed-", "");
let installationBinding;
if (installed) {
  const configArgs = args.filter(a => a.startsWith("--candidate-config=")); assert.equal(configArgs.length, 1);
  const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
  const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
  const { deriveActual } = require("./installed-profile-data-replay.cjs");
  const configFile = configArgs[0].slice("--candidate-config=".length);
  const config = validateCandidateConfig(read(configFile)), actual = deriveActual(config.actual, config.version);
  const player = actual.resources.filter(f => path.resolve(f.path) === path.join(actual.installRoot, "agentvn-player.exe"));
  assert.equal(player.length, 1); assert.equal(sha(player[0].path), player[0].sha256);
  installationBinding = { actual, configFile, player: player[0] };
}
const binary = installationBinding?.player.path ??
  path.resolve(__dirname, "../GameCli_framework/src-tauri/target/release/agentvn-player.exe");
const built = { path: binary, sha256: sha(binary), bytes: fs.statSync(binary).size };
const file = path.join(__dirname, kind === "player" ? "candidate-role-player.cjs" : "candidate-role-audit.cjs");
assert.equal(sha(file), kind === "player"
  ? "f1740c27013717e4ee31b794fab78ccdb1529788ef9f0489ca3cf6724116a66e"
  : "a8278b7a7b0c1779300348d4d4c039fd11b3a0b4fdf18a88b769d44c20e365b9");
let source = fs.readFileSync(file, "utf8");
const modifications = [];
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); modifications.push({ before, after });
}
if (!installed) replace("roles-installed-${config.version.replaceAll", "roles-native-${config.version.replaceAll");
if (kind === "player") {
  replace('executable: actual.resources.find(f => path.basename(f.path) === "agentvn-player.exe"),',
    "executable: module.qaNativePlayer,");
  replace('"CURRENT_INSTALLED_PREVIEW_PLAYER_AUTHORED_SIX_ROLE_NATURAL_STATES_NOT_SETUP_ANDROID_OR_FULL_24_STATE_COVERAGE"',
    installed
      ? '"CURRENT_NSIS_INSTALLED_PLAYER_AUTHORED_SIX_ROLE_NATURAL_STATES_NOT_SETUP_UPGRADE_ANDROID_OR_FULL_24_STATE_COVERAGE"'
      : '"NEW_NATIVE_PLAYER_AUTHORED_SIX_ROLE_NATURAL_STATES_NOT_FROZEN_INSTALL_SETUP_ANDROID_OR_FULL_24_STATE_COVERAGE"');
  replace('s.launch.scope="ACTUAL_CURRENT_NSIS_SHIPPED_PLAYER_PUBLIC_PREVIEW_NOT_LIBRARY_OR_STANDALONE";',
    installed
      ? 's.launch.scope="ACTUAL_CURRENT_NSIS_SHIPPED_PLAYER_PUBLIC_PREVIEW_NOT_LIBRARY_OR_STANDALONE";' +
        's.launch.provenance="ACTUAL_CURRENT_NSIS_INSTALL_RECEIPT";'
      : 's.launch.scope="NEW_NATIVE_PLAYER_PUBLIC_PREVIEW_NOT_FROZEN_INSTALL_OR_STANDALONE";' +
        's.launch.provenance="NEW_SOURCE_BUILT_PLAYER_NOT_FROZEN_NSIS";');
  replace("new vm.Script(Module.wrap(source), { filename: __filename });",
    'replace("Actual installed library Player consumes the unchanged authored all-role cartridge",' +
    JSON.stringify(installed
      ? "Actual installed Player consumes the unchanged current-installed-author all-role cartridge"
      : "New native Player consumes the unchanged installed-author all-role cartridge") + ");\n" +
    'replace("nativeLibraryPreparation:true,nativePickerClaim:false",' +
    '"nativeLibraryPreparation:false,publicPreview:true,nativePickerClaim:false");\n' +
    'replace("story choice selected/disabled not sampled","story choice transient disabled not sampled");\n' +
    "new vm.Script(Module.wrap(source), { filename: __filename });");
  replace("qaBinding: { config: desc(configFile)", installed
    ? "qaBinding: { installedPlayer: module.qaNativePlayer, config: desc(configFile)"
    : "qaBinding: { nativePlayer: module.qaNativePlayer, config: desc(configFile)");
  replace('await choice.click();await s.command("ui_acceptance",0);await p.mouse.move(0,0);',
    `await p.evaluate(() => {
        const observation = { active: true, frames: [] }; window.__qaNativeChoiceExit = observation;
        function sample() {
          const node = document.querySelector(".choice-panel.is-exiting .choice-option");
          if(node) {
            const css = getComputedStyle(node);
            observation.frames.push({ at: performance.now(), opacity: Number(css.opacity),
              transform: css.transform, animation: css.animationName, disabled: node.disabled });
          }
          if(observation.active) requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      await choice.click();await s.command("ui_acceptance",0);await p.mouse.move(0,0);
      row.exitMotion = await p.evaluate(() => {
        window.__qaNativeChoiceExit.active = false; return window.__qaNativeChoiceExit.frames;
      });
      assert(row.exitMotion.some(frame => frame.disabled && frame.animation.startsWith("choice-fade-out")
        && frame.opacity > 0.001 && frame.opacity < 0.99), "Native branch exit has no visible intermediate frame");
      if(reduced) assert(row.exitMotion.every(frame => frame.transform === "none"),
        "Native reduced-motion branch moved in space");`);
} else {
  replace('actual.resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256',
    "module.qaNativePlayer.sha256");
  replace('"SIX_ROLE_AUTHOR_AND_CURRENT_PLAYER_NATURAL_STATES_NOT_FULL_24_NATURAL_STATES_SETUP_UPGRADE_ANDROID"',
    installed
      ? '"CURRENT_INSTALLED_AUTHOR_AND_NSIS_PLAYER_NATURAL_STATES_NOT_FULL_24_STATES_SETUP_UPGRADE_ANDROID"'
      : '"INSTALLED_AUTHOR_AND_NEW_NATIVE_PLAYER_NOT_FROZEN_INSTALL_OR_FULL_24_NATURAL_STATES_SETUP_UPGRADE_ANDROID"');
  replace("p.author, p.qaBinding.config", installed
    ? "p.qaBinding.installedPlayer, p.author, p.qaBinding.config"
    : "p.qaBinding.nativePlayer, p.author, p.qaBinding.config");
  // Review the exact archived tool bytes that executed the player run. A
  // subsequent audit-only fix must neither rewrite that receipt nor require
  // another product run just to restore a mutable workspace filename.
  replace("\n    assert.equal(sha(f.path), f.sha256);\n  assert.equal(p.author.sha256",
    '\n    assert.equal(sha(f === p.tool ? path.join(pRoot, "executed-test.cjs") : f.path), f.sha256);\n  assert.equal(p.author.sha256');
  replace('const script = JSON.parse(await cart.file("scripts/main.json").async("string"));',
    `const manifest = JSON.parse(await cart.file("manifest.json").async("string"));
  assert.equal(typeof manifest.entry_script, "string");
  assert(!manifest.entry_script.includes("\\\\") && !manifest.entry_script.includes(":")
    && !manifest.entry_script.split("/").some(part => !part || part === "." || part === ".."));
  const entry = cart.file(manifest.entry_script); assert(entry, "Declared entry script is missing");
  const scriptBytes = await entry.async("nodebuffer");
  const checksum = JSON.parse(await cart.file("checksum.json").async("string"));
  const checksums = checksum.files.filter(file => file.path === manifest.entry_script);
  assert.equal(checksums.length, 1); assert.equal(checksums[0].size_bytes, scriptBytes.length);
  assert.equal(checksums[0].hash_sha256,
    require("node:crypto").createHash("sha256").update(scriptBytes).digest("hex"));
  const script = JSON.parse(scriptBytes.toString("utf8"));`);
  replace("return { exactToolAndInstallHashes: true,",
    'return { executedPlayerTool: desc(path.join(pRoot, "executed-test.cjs")),' +
    ' mutablePlayerToolChanged: sha(p.tool.path) !== p.tool.sha256, exactToolAndInstallHashes: true,');
  replace("assert.equal(story[0].samples.length, 6);",
    `assert.equal(story[0].samples.length, 6);
    assert(story[0].exitMotion.some(frame => frame.disabled && frame.animation.startsWith("choice-fade-out")
      && frame.opacity > 0.001 && frame.opacity < 0.99), "Missing native exit presentation");
    if(d.reduced) assert(story[0].exitMotion.every(frame => frame.transform === "none"));`);
}
new vm.Script(Module.wrap(source), { filename: __filename });
const worker = new Module(__filename, module);
Object.assign(worker, { filename: __filename, paths: module.paths, qaNativePlayer: built });
process.argv = [process.execPath, __filename, ...args];
worker._compile(source, __filename);
