const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const tauri = path.join(root, "editor/src-tauri");
const config = JSON.parse(fs.readFileSync(path.join(tauri, "tauri.conf.json"), "utf8"));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-version-安装 空格-"));
try {
  // Use the actual installer resource map, not the contents of bundle-workspace alone.
  for (const [source, target] of Object.entries(config.bundle.resources)) {
    if (target === "build-versions.json") {
      fs.copyFileSync(path.join(tauri, source), path.join(fixture, target));
    }
  }
  assert.ok(fs.existsSync(path.join(fixture, "build-versions.json")), "installer resource root omits build-versions.json");
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, "build-versions.json"), "utf8")).editorVersion, config.version);
  // An isolated wrapper fixture exercises the skip flag without touching real resources.
  fs.mkdirSync(path.join(fixture, "scripts"));
  fs.copyFileSync(path.join(root, "scripts/prepare-editor-runtime-resources.ps1"), path.join(fixture, "scripts/prepare-editor-runtime-resources.ps1"));
  fs.mkdirSync(path.join(fixture, "editor/src-tauri"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "editor/src-tauri/tauri.conf.json"), JSON.stringify(config));
  const runPrepared = () => spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(fixture, "scripts/prepare-editor-runtime-resources.ps1")], {
    encoding: "utf8", windowsHide: true, env: { ...process.env, AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED: "1" },
  });
  const result = runPrepared();
  assert.notEqual(result.status, 0, "prepared flag accepted missing/stale resources");
  const bundle = path.join(fixture, "editor/src-tauri/bundle-workspace");
  const write = (name, value) => {
    const target = path.join(fixture, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  };
  write("scripts/standalone-build-scripts.json", JSON.stringify({ schemaVersion: 1, scripts: ["helper.cjs"] }));
  write("scripts/helper.cjs", "fixture");
  write("editor/src-tauri/binaries/agentvn-player.exe", "player-desktop.log player-frontend.log");
  for (const name of [
    "scripts/helper.cjs", "GameCli_framework/package.json", "GameCli_framework/src-tauri/src/lib.rs",
    "GameCli_framework/node_modules/lucide-react/dist/cjs/lucide-react.js",
    "GameCli_framework/node_modules/lucide-react/dist/lucide-react.d.ts",
    "GameCli_framework/node_modules/sharp/dist/index.cjs", "shared/cartridge/types.ts",
    "windows-offline-tools/NSIS/makensis.exe", "windows-offline-tools/NSIS/Bin/makensis.exe",
    "windows-offline-tools/NSIS/Include/MUI2.nsh",
    "windows-offline-tools/NSIS/Plugins/x86-unicode/additional/nsis_tauri_utils.dll",
  ]) write(`editor/src-tauri/bundle-workspace/${name}`, "fixture");
  for (const [name, contents] of [
    ["invalid", "{"], ["empty", '{"editorVersion":""}'], ["old-cache", '{"editorVersion":"0.0.0"}'],
    ["valid", JSON.stringify({ editorVersion: config.version })],
  ]) {
    fs.writeFileSync(path.join(bundle, "build-versions.json"), contents);
    const check = runPrepared();
    assert.equal(check.status === 0, name === "valid", `${name}: ${check.stdout}\n${check.stderr}`);
  }
  fs.writeFileSync(path.join(bundle, "scripts/helper.cjs"), "stale");
  assert.notEqual(runPrepared().status, 0, "prepared flag accepted stale bundled helper");
  console.log("PASS installed version mapping; missing/invalid/empty/mismatch/valid/stale-helper prepared-cache cases (Unicode + spaces)");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
