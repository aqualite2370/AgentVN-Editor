"use strict";
// A single new Android capability batch from the frozen 1.9.81 NSIS and its
// unchanged installed-UI export. This is not another Editor installation.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const JSZip = require("../editor/node_modules/jszip");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Renpy-Quick-Placement-Android-1981-20261116-01";
const release = "F:/testavn/Editor-Quick-Placement-Release-1981-20261116-01";
const installed = "F:/testavn/Windows-Isolated-1981-20261116-04/resource-01/report.json";
const mode = process.argv[2]; assert(["--prepare", "--package-audit"].includes(mode)); assert.equal(process.argv.length, 3);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size, sha256: sha(file) });
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const verify = file => assert.equal(sha(file.path), file.sha256, file.path);
function once(text, before, after) { assert.equal(text.split(before).length, 2, before); return text.replace(before, after); }
async function prepare() {
  assert(!fs.existsSync(base), "Preserve previous evidence"); fs.mkdirSync(base);
  const output = path.join(base, "preparation.json");
  const r = { status: "PREPARING", at: new Date().toISOString(), inputs: [], sources: [], scripts: [], builds: [],
    sourceRoot: path.join(base, "source"), editorBuilds: 0, models: 0,
    scope: "1981_FROZEN_NSIS_INSTALLED_UI_EXPORT_NEW_CUSTOM_POSITION_ANDROID_NOT_PHYSICAL_PHONE" };
  const input = file => { r.inputs.push(desc(file)); return read(file); };
  function script(name, original, transform) {
    const source = path.join(root, "scripts", original), target = path.join(base, "qa-scripts", name);
    r.inputs.push(desc(source)); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, transform(fs.readFileSync(source, "utf8")), { flag: "wx" });
    cp.execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `$e=$null;$t=$null;[void][Management.Automation.Language.Parser]::ParseFile('${target}',[ref]$t,[ref]$e);if($e.Count){throw($e|Out-String)}`],
      { windowsHide: true, timeout: 15000 });
    const entry = desc(target); r.scripts.push(entry); return entry;
  }
  try {
    const build = input(path.join(release, "release/build.json")), author = input(installed);
    assert.equal(build.version, "1.9.81"); assert.equal(build.runtimeVersion, "0.32.0"); verify(build.installer);
    assert.equal(input(path.join(release, "installed-audit-01.json")).status,
      "PASS1981_INSTALLED_AUTHOR_RESTART_UI_EXPORT_NATIVE032_REAL031_REFUSAL");
    assert.equal(author.status, "PASS"); verify(author.cartridge); r.installer = build.installer;
    const extraction = cp.spawnSync("C:/Program Files/7-Zip/7z.exe", ["x", build.installer.path,
      "-o" + r.sourceRoot, "-y", "scripts/*", "shared/*", "GameCli_framework/*", "build-versions.json", "LICENSE", "THIRD_PARTY_NOTICES.md"],
      { windowsHide: true, encoding: "utf8", timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
    fs.writeFileSync(path.join(base, "extraction.log"), (extraction.stdout || "") + (extraction.stderr || ""), { flag: "wx" });
    assert.ifError(extraction.error); assert.equal(extraction.status, 0);
    assert.equal(read(path.join(r.sourceRoot, "build-versions.json")).editorVersion, "1.9.81");
    const bundled = path.join(root, "editor/src-tauri/bundle-workspace");
    function walk(directory) {
      for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name), relative = path.relative(r.sourceRoot, file);
        assert(!item.isSymbolicLink(), "No extracted links");
        if (relative.split(path.sep).some(p => ["node_modules", "target", "dist", "build", "gen", ".gradle", ".git", "embedded-cartridge"].includes(p))) continue;
        if (item.isDirectory()) walk(file);
        else { assert(item.isFile()); assert.equal(sha(file), sha(path.join(bundled, relative)), relative);
          r.sources.push({ file: relative, sha256: sha(file) }); }
      }
    }
    for (const name of ["scripts", "shared", "GameCli_framework"]) walk(path.join(r.sourceRoot, name));
    assert(r.sources.length >= 351);
    for (const pair of build.bundledSources) {
      verify(pair.bundled); const relative = path.relative(bundled, pair.bundled.path);
      assert.equal(sha(path.join(r.sourceRoot, relative)), pair.bundled.sha256);
    }
    for (const module of ["@tauri-apps/cli/package.json", "vite/package.json", "sharp/package.json"])
      assert(fs.statSync(path.join(r.sourceRoot, "GameCli_framework/node_modules", module)).size > 0);
    const zip = await JSZip.loadAsync(fs.readFileSync(author.cartridge.path), { checkCRC32: true });
    const manifest = JSON.parse(await zip.file("manifest.json").async("string")); assert.equal(manifest.runtime_version, "0.32.0");
    const layout = JSON.parse(await zip.file("ui/layout.json").async("string")); assert.equal(layout.layout_type, "renpy");
    const menu = layout.screens.find(s => s.screen_id === "player").components.find(c => c.component_id === "quick_menu");
    assert.equal(menu.style.quickMenuPlacement, "custom"); assert.deepEqual(menu.rect, { x: 50, y: 10, width: 60, height: 6, anchor: "top_center" });
    const dir = path.join(base, "renpy"); fs.mkdirSync(dir);
    const request = { outputDir: path.join(dir, "apk"), diagnosticsDir: path.join(dir, "diagnostics"), cartridgePath: author.cartridge.path,
      iconSource: "default", optimizationProfile: "balanced", runId: "quick-placement-1981-renpy",
      releaseIdentity: { schemaVersion: 1, title: manifest.title, gameId: manifest.game_id, versionName: manifest.version,
        versionCode: 1, androidApplicationId: "com.agentvn.qa.quick1981.renpy" } };
    const requestFile = path.join(dir, "request.json"); fs.writeFileSync(requestFile, JSON.stringify(request, null, 2), { flag: "wx" });
    r.builds.push({ type: "renpy", request: requestFile, cartridge: author.cartridge });
    const tools = path.join(base, "tools");
    r.recovery = script("restore-tools.ps1", "editor-recovery-android-toolchain.ps1", text =>
      once(text, "$base = 'F:\\testavn\\Android-Toolchain-1975-20261116-01'", "$base = '" + tools.replaceAll("/", "\\") + "'"));
    r.launcher = script("build.ps1", "editor-recovery-android-followup.ps1", text => {
      text = once(text, "$base = 'F:\\testavn\\Client-Presentation-Android-1975-20261116-03'", "$base = '" + base.replaceAll("/", "\\") + "'");
      text = once(text, "$tools = 'F:\\testavn\\Android-Toolchain-1975-20261116-01'", "$tools = '" + tools.replaceAll("/", "\\") + "'");
      text = once(text, "$source -cne 'F:\\testavn\\Client-Presentation-Android-1975-20261116-02\\source'", "$source -cne '" + r.sourceRoot.replaceAll("/", "\\") + "'");
      return once(text, "PASS_TWO_INSTALLED_RESOURCE_APK_BUILDS_DEVICE_PENDING", "PASS_ONE1981_INSTALLED_RESOURCE_APK_BUILD_DEVICE_PENDING");
    });
    const git = args => cp.execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
    r.protected = { head: git(["rev-parse", "HEAD"]), index: desc(path.resolve(root, git(["rev-parse", "--git-path", "index"]))),
      dailyDev: desc("D:/AgentVN/AgentVN Dev.exe") };
    r.status = "READY1981_INSTALLED_UI_CARTRIDGE_NORMAL_EMBEDDED_ANDROID_TOOLS_PENDING";
  } catch (error) { r.status = "FAILED"; r.error = error.stack; process.exitCode = 1; }
  finally { r.finishedAt = new Date().toISOString(); fs.writeFileSync(output, JSON.stringify(r, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: r.status, sources: r.sources.length, base, error: r.error })); }
}
async function packageAudit() {
  const output = path.join(base, "package-audit-01.json"); assert(!fs.existsSync(output));
  const r = { status: "RUNNING", at: new Date().toISOString(), cases: [], links: [], inputs: [] };
  try {
    const prep = read(path.join(base, "preparation.json")), build = read(path.join(base, "administrator.json"));
    assert.equal(build.status, "PASS_ONE1981_INSTALLED_RESOURCE_APK_BUILD_DEVICE_PENDING");
    assert(build.isElevated && build.persistentEnvironmentUnchanged); assert.equal(build.builds.length, 1);
    assert.equal(build.builds[0].status, "PASS");
    for (const entry of prep.sources) assert.equal(sha(path.join(prep.sourceRoot, entry.file)), entry.sha256);
    const b = prep.builds[0], manifest = read(path.join(base, "renpy/diagnostics/package-build-manifest.json"));
    const probe = read(path.join(base, "renpy/diagnostics/android-symlink-capability-runner.json"));
    assert.equal(manifest.status, "PASS"); assert(probe.success && probe.isElevated);
    const apk = manifest.artifacts.find(a => a.kind === "android_apk_signed");
    assert.equal(apk.applicationId, "com.agentvn.qa.quick1981.renpy"); assert.equal(apk.versionCode, 1);
    assert.match(apk.certificateSha256, /^[A-F0-9]{64}$/); const artifact = desc(apk.path);
    assert.equal(artifact.sha256, build.builds[0].apk.sha256); verify(b.cartridge);
    const packed = await JSZip.loadAsync(fs.readFileSync(apk.path), { checkCRC32: true });
    const original = await JSZip.loadAsync(fs.readFileSync(b.cartridge.path), { checkCRC32: true });
    const prefix = "assets/embedded-cartridge/", m = JSON.parse(await packed.file(prefix + "manifest.json").async("string"));
    const originalManifest = JSON.parse(await original.file("manifest.json").async("string")); assert.equal(m.runtime_version, "0.32.0");
    for (const file of ["ui/layout.json", originalManifest.entry_script])
      assert.deepEqual(JSON.parse(await packed.file(prefix + file).async("string")), JSON.parse(await original.file(file).async("string")));
    const row = { type: "renpy", apk: artifact, signature: apk.certificateSha256, sourceCartridge: b.cartridge, native: [], status: "PASS" };
    const abis = { "arm64-v8a": "aarch64-linux-android", "armeabi-v7a": "armv7-linux-androideabi", x86: "i686-linux-android", x86_64: "x86_64-linux-android" };
    for (const [abi, target] of Object.entries(abis)) {
      const bytes = await packed.file(`lib/${abi}/libagentvn_player_lib.so`).async("nodebuffer");
      assert(bytes.length > 1000000); assert.equal(bytes.subarray(0, 4).toString("hex"), "7f454c46");
      const link = path.join(prep.sourceRoot, "GameCli_framework/src-tauri/gen/android/app/src/main/jniLibs", abi, "libagentvn_player_lib.so");
      assert(fs.lstatSync(link).isSymbolicLink());
      const destination = fs.realpathSync(link), expected = path.join(prep.sourceRoot, "GameCli_framework/src-tauri/target", target, "release/libagentvn_player_lib.so");
      assert.equal(path.resolve(destination).toLowerCase(), path.resolve(expected).toLowerCase()); assert.equal(sha(destination), hash(bytes));
      row.native.push({ abi, bytes: bytes.length, sha256: hash(bytes) }); r.links.push({ path: link, target: destination, sha256: hash(bytes) });
    }
    assert.equal(row.native.find(n => n.abi === "x86_64").sha256, build.builds[0].nativeLibrary.sha256); r.cases.push(row);
    r.status = "PASS1981_ONE_NATIVE032_APK_REAL_AUTHOR_LAYOUT_FOUR_ABIS_DEVICE_PENDING";
  } catch (error) { r.status = "FAILED"; r.error = error.stack; process.exitCode = 1; }
  finally { r.finishedAt = new Date().toISOString(); fs.writeFileSync(output, JSON.stringify(r, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: r.status, cases: r.cases.length, output, error: r.error })); }
}
(mode === "--prepare" ? prepare() : packageAudit()).catch(error => { console.error(error); process.exitCode = 1; });
