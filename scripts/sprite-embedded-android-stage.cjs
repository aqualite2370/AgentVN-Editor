"use strict";
// New content, frozen product: ordinary supported Android packaging, no APK
// modification or external-file query. Preserve all earlier method failures.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict"), JSZip = require("../editor/node_modules/jszip");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, "..");
const base = "F:/testavn/Sprite-Embedded-Android-1975-20261116-01";
const author = "F:/testavn/Sprite-Author-Export-1975-20261116-03";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size, sha256: sha(file) });
assert(!fs.existsSync(base), "Preserve prior build evidence");
fs.mkdirSync(base);
const r = { status: "PREPARING", at: new Date().toISOString(), inputs: [], sources: [], builds: [], scripts: [],
  sourceRoot: path.join(base, "source"), editorBuilds: 0, models: 0,
  scope: "FROZEN_1975_INSTALLED_RESOURCES_SOURCE_UI_AUTHOR_EXPORTS_NORMAL_EMBEDDED_APK_NEW_CONTENT" };
const output = path.join(base, "preparation.json");
const save = () => fs.writeFileSync(output, JSON.stringify(r, null, 2));
function input(file) { r.inputs.push(desc(file)); return read(file); }
function once(text, before, after) {
  assert.equal(text.split(before).length, 2, "Unique adaptation anchor: " + before);
  return text.replace(before, after);
}
function script(name, source, transform) {
  const original = path.join(root, "scripts", source), target = path.join(base, "qa-scripts", name);
  r.inputs.push(desc(original)); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, transform(fs.readFileSync(original, "utf8")), { flag: "wx" });
  cp.execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `$e=$null;$t=$null;[void][Management.Automation.Language.Parser]::ParseFile('${target}',[ref]$t,[ref]$e);if($e.Count){throw($e|Out-String)}`],
    { windowsHide: true, timeout: 15000 });
  const descriptor = desc(target); r.scripts.push(descriptor); return descriptor;
}
(async () => {
  try {
    const installation = input("F:/testavn/Windows-Isolated-1975-20261116-01/installation.json");
    const previous = input("F:/testavn/Client-Presentation-Android-1975-20261116-02/preparation.json");
    const authored = input(path.join(author, "report.json"));
    assert.equal(installation.status, "PASS"); assert.equal(installation.executable.version, "1.9.75");
    assert.equal(previous.status, "READY_INSTALLED_RESOURCES_AND_UI_EXPORTS");
    assert.equal(previous.sources.length, 351);
    assert.equal(authored.status, "PASS_SOURCE_AUTHOR_UI_PERSISTENCE_AND_TWO_NORMAL_CARTRIDGES");
    assert.equal(input(path.join(author, "formal-player/report.json")).status,
      "PASS_TWO_UNCHANGED_UI_EXPORTS_FORMAL_FIXED_PLAYER_GEOMETRY");
    assert.equal(sha(installation.package.path), "58c1f44ba6f227c9db4a6a40c3280c97fe502b6538ed7762dd52339c60954e09");
    r.installer = installation.package;
    const extraction = cp.spawnSync("C:/Program Files/7-Zip/7z.exe",
      ["x", installation.package.path, "-o" + r.sourceRoot, "-y", "scripts/*", "shared/*",
        "GameCli_framework/*", "build-versions.json", "LICENSE", "THIRD_PARTY_NOTICES.md"],
      { windowsHide: true, encoding: "utf8", timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
    fs.writeFileSync(path.join(base, "extraction.log"), (extraction.stdout || "") + (extraction.stderr || ""), { flag: "wx" });
    assert.ifError(extraction.error); assert.equal(extraction.status, 0);
    assert.equal(read(path.join(r.sourceRoot, "build-versions.json")).editorVersion, "1.9.75");
    for (const entry of previous.sources) {
      assert(!path.isAbsolute(entry.file) && !entry.file.split(/[\\/]/).includes(".."));
      const file = path.join(r.sourceRoot, entry.file);
      assert(fs.statSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink());
      assert.equal(sha(file), entry.sha256, "Match previous actual installation");
      r.sources.push(entry);
    }
    for (const module of ["@tauri-apps/cli/package.json", "vite/package.json", "sharp/package.json"])
      assert(fs.statSync(path.join(r.sourceRoot, "GameCli_framework/node_modules", module)).size > 0);
    for (const exported of authored.exports) {
      assert.equal(sha(exported.path), exported.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(exported.path), { checkCRC32: true });
      const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      assert.equal(manifest.game_id, "sprite_author_03");
      const dir = path.join(base, exported.type); fs.mkdirSync(dir);
      const request = { outputDir: path.join(dir, "apk"), diagnosticsDir: path.join(dir, "diagnostics"),
        cartridgePath: exported.path, iconSource: "default", optimizationProfile: "balanced",
        runId: "sprite-embedded-1975-" + exported.type,
        releaseIdentity: { schemaVersion: 1, title: manifest.title, gameId: manifest.game_id,
          versionName: manifest.version, versionCode: 1,
          androidApplicationId: "com.agentvn.qa.sprite1975." + exported.type } };
      const file = path.join(dir, "request.json");
      fs.writeFileSync(file, JSON.stringify(request, null, 2), { flag: "wx" });
      r.builds.push({ type: exported.type, request: file, cartridge: exported });
    }
    assert.deepEqual(r.builds.map(b => b.type).sort(), ["agentvn", "renpy"]);
    const tools = path.join(base, "tools");
    r.recovery = script("restore-tools.ps1", "editor-recovery-android-toolchain.ps1", text =>
      once(text, "$base = 'F:\\testavn\\Android-Toolchain-1975-20261116-01'",
        "$base = '" + tools.replaceAll("/", "\\") + "'"));
    r.launcher = script("build.ps1", "editor-recovery-android-followup.ps1", text => {
      text = once(text, "$base = 'F:\\testavn\\Client-Presentation-Android-1975-20261116-03'",
        "$base = '" + base.replaceAll("/", "\\") + "'");
      text = once(text, "$tools = 'F:\\testavn\\Android-Toolchain-1975-20261116-01'",
        "$tools = '" + tools.replaceAll("/", "\\") + "'");
      return once(text, "$source -cne 'F:\\testavn\\Client-Presentation-Android-1975-20261116-02\\source'",
        "$source -cne '" + r.sourceRoot.replaceAll("/", "\\") + "'");
    });
    const git = args => cp.execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
    const index = path.resolve(root, git(["rev-parse", "--git-path", "index"]));
    r.protected = { head: git(["rev-parse", "HEAD"]), index: desc(index),
      dailyDev: desc("D:/AgentVN/AgentVN Dev.exe") };
    r.status = "READY_FROZEN_RESOURCES_TWO_SOURCE_AUTHOR_CARTRIDGES_TOOLS_RECOVERY_PENDING";
  } catch (error) { r.status = "FAILED"; r.error = error.stack; process.exitCode = 1; }
  finally {
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, base, sources: r.sources.length, error: r.error }));
  }
})();
