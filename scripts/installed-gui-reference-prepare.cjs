"use strict";
// Prepare authentic, version-locked official GUI test inputs; never use user projects.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync, execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const root = "D:/AgentVN/output/installed-gui-20261018-01";
const work = "F:/AgentVN-QA-InstalledGui-20261018-01";
const repo = "D:/AgentVN/output/reference/renpy-template-20261011-01";
const ref = "39895c1e017f0b36ffea2447d97eccd69d76ee1c";
const stage = process.argv[2] || "download";
const attempt = Number(process.argv[3] || 1);
const reportFile = path.join(root, `official-${stage}${attempt === 1 ? "" : `-${String(attempt).padStart(2, "0")}`}.json`);
assert(["download", "extract", "generate"].includes(stage) && !fs.existsSync(reportFile));
const report = { status: "RUNNING", at: new Date().toISOString(), stage, error: null,
  sourceRelease: "https://www.renpy.org/release/8.5.3", tag: "8.5.3.26051504", ref, work,
  productChanges: 0, realModelRequests: 0 };
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const sdkZip = path.join(work, "renpy-8.5.3-sdk.zip"), sdkRoot = path.join(work, "renpy-8.5.3-sdk");
function run(exe, args, options = {}) {
  const r = spawnSync(exe, args, { windowsHide: true, encoding: "utf8", timeout: 120000, ...options });
  report.command = { exe, args, exitCode: r.status, stdout: r.stdout, stderr: r.stderr };
  assert.equal(r.status, 0, `${exe}: ${r.error || r.stderr}`); return r.stdout;
}
(async () => {
  if (stage === "download") {
    if (attempt === 1) {
      assert(!fs.existsSync(root) && !fs.existsSync(work)); fs.mkdirSync(root); fs.mkdirSync(work);
    } else {
      const previous = JSON.parse(fs.readFileSync(path.join(root, "official-download.json"), "utf8"));
      assert.equal(previous.status, "FAILED"); assert(!fs.existsSync(sdkZip));
      report.continuation = "Previous checksum selector chose MD5 row; no SDK downloaded or executed";
    }
    const release = "https://www.renpy.org/dl/8.5.3/";
    const response = await fetch(`${release}checksums.txt`, { signal: AbortSignal.timeout(30000) });
    assert(response.ok); const checksums = await response.text();
    const checksumFile = path.join(work, "official-checksums.txt");
    if (fs.existsSync(checksumFile)) assert.equal(fs.readFileSync(checksumFile, "utf8"), checksums);
    else fs.writeFileSync(checksumFile, checksums, { flag: "wx" });
    const line = checksums.split(/\r?\n/).find(l => /^[0-9a-f]{64} renpy-8\.5\.3-sdk\.zip$/i.test(l)); assert(line);
    const expected = line.match(/\b[0-9a-f]{64}\b/i)?.[0]?.toLowerCase(); assert(expected, line);
    run("curl.exe", ["--fail", "--location", "--retry", "0", "--output", sdkZip, `${release}renpy-8.5.3-sdk.zip`],
      { timeout: 600000 });
    const bytes = fs.readFileSync(sdkZip); assert.equal(sha(bytes), expected);
    report.download = { path: sdkZip, bytes: bytes.length, sha256: expected, checksumLine: line };
  } else {
    const downloaded = JSON.parse(fs.readFileSync(path.join(root, "official-download-02.json"), "utf8"));
    assert.equal(downloaded.status, "PASS");
    const bytes = fs.readFileSync(sdkZip); assert.equal(sha(bytes), downloaded.download.sha256);
    if (stage === "extract") {
      assert(!fs.existsSync(sdkRoot));
      const zip = await JSZip.loadAsync(bytes), entries = Object.values(zip.files);
      assert(entries.length > 100 && entries.length < 30000);
      let total = 0; const outputs = [];
      for (const entry of entries) {
        assert(entry.name.startsWith("renpy-8.5.3-sdk/") && !entry.name.includes("\\"));
        assert(!entry.name.split("/").some(p => p === ".." || p === "."));
        assert(!entry.unsafeOriginalName || entry.unsafeOriginalName === entry.name);
        const unix = typeof entry.unixPermissions === "number" ? entry.unixPermissions : parseInt(entry.unixPermissions || "0", 8);
        assert.notEqual(unix & 0o170000, 0o120000);
        if (entry.dir) continue;
        const output = path.resolve(work, entry.name);
        assert(output.toLowerCase().startsWith(path.resolve(sdkRoot).toLowerCase() + path.sep));
        const data = await entry.async("nodebuffer"); total += data.length;
        assert(total < 1500 * 1024 * 1024);
        fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, data, { flag: "wx" });
        outputs.push({ relative: entry.name, bytes: data.length, sha256: sha(data) });
      }
      const sources = ["gui/game/gui.rpy", "gui/game/screens.rpy", "launcher/game/gui7/images.py",
        "launcher/game/gui7/code.py", "launcher/game/gui7/parameters.py", "launcher/game/gui7/__init__.py"];
      report.sourceComparison = [];
      for (const relative of sources) {
        const locked = execFileSync("git", ["-C", repo, "show", `${ref}:${relative}`], { maxBuffer: 10 * 1024 * 1024 });
        const actual = fs.readFileSync(path.join(sdkRoot, relative));
        // Release packaging may normalize CRLF. Compare UTF-8 decoded source
        // only for line endings, never alter the input template.
        const normalized = b => b.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
        assert.equal(normalized(actual), normalized(locked), `SDK source differs from locked tag: ${relative}`);
        report.sourceComparison.push({ relative, actualSha256: sha(actual), gitBlobSha256: sha(locked), onlyLineEndingNormalization: true });
      }
      report.extraction = { files: outputs.length, bytes: total, exeSha256: sha(fs.readFileSync(path.join(sdkRoot, "renpy.exe"))) };
      fs.writeFileSync(path.join(work, "sdk-files.json"), JSON.stringify(outputs, null, 2), { flag: "wx" });
    } else {
      const extracted = JSON.parse(fs.readFileSync(path.join(root, "official-extract.json"), "utf8"));
      assert.equal(extracted.status, "PASS");
      const target = path.join(work, "官方完整模板 中文 1280x720");
      if (attempt === 1) {
        assert(!fs.existsSync(target));
        const state = path.join(work, "official-sdk-state"); fs.mkdirSync(state);
        const env = { ...process.env, RENPY_PATH_TO_SAVES: state, RENPY_LOG_TO: state };
        for (const key of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(key)) delete env[key];
        run(path.join(sdkRoot, "renpy.exe"), ["launcher", "generate_gui", target, "--width", "1280", "--height", "720",
          "--accent", "#00b8c3", "--boring", "#000000", "--start"],
        { cwd: sdkRoot, env, timeout: 180000 });
      } else {
        const previous = JSON.parse(fs.readFileSync(path.join(root, "official-generate.json"), "utf8"));
        assert.equal(previous.status, "FAILED"); assert.equal(previous.command.exitCode, 0);
        report.command = previous.command;
        report.continuation = "No generator rerun; replace invented >30 image count with complete official 24-file set; resolve common font dependency";
      }
      const game = path.join(target, "game"); assert(fs.existsSync(path.join(game, "gui.rpy")));
      report.resolvedCommonDependencies = [];
      for (const relative of ["renpy/common/DejaVuSans.ttf", "renpy/common/DejaVuSans.txt"]) {
        const data = fs.readFileSync(path.join(sdkRoot, relative));
        const locked = execFileSync("git", ["-C", repo, "show", `${ref}:${relative}`], { maxBuffer: 10 * 1024 * 1024 });
        assert(data.equals(locked));
        const output = path.join(game, path.basename(relative)); assert(!fs.existsSync(output));
        fs.writeFileSync(output, data, { flag: "wx" });
        report.resolvedCommonDependencies.push({ from: relative, path: output, sha256: sha(data) });
      }
      function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
      const inputs = files(game).filter(f => /\.(png|ttf|otf|woff2|rpy|txt)$/i.test(f));
      const images = inputs.filter(f => /\.png$/i.test(f)), fonts = inputs.filter(f => /\.(ttf|otf|woff2)$/i.test(f));
      const expectedImages = [
        "gui/bubble.png", "gui/button/choice_hover_background.png", "gui/button/choice_idle_background.png",
        "gui/button/quick_hover_background.png", "gui/button/quick_idle_background.png", "gui/frame.png",
        "gui/game_menu.png", "gui/main_menu.png", "gui/namebox.png", "gui/notify.png", "gui/nvl.png",
        "gui/overlay/confirm.png", "gui/overlay/game_menu.png", "gui/overlay/main_menu.png",
        "gui/phone/button/choice_hover_background.png", "gui/phone/button/choice_idle_background.png",
        "gui/phone/nvl.png", "gui/phone/overlay/game_menu.png", "gui/phone/overlay/main_menu.png",
        "gui/phone/textbox.png", "gui/skip.png", "gui/textbox.png", "gui/thoughtbubble.png", "gui/window_icon.png",
      ];
      assert.deepEqual(images.map(f => path.relative(game, f).split(path.sep).join("/")).sort(), expectedImages.sort());
      assert.equal(fonts.length, 1);
      const archive = new JSZip(); report.files = [];
      for (const file of inputs) {
        const relative = path.relative(game, file).split(path.sep).join("/");
        const data = fs.readFileSync(file); archive.file(`官方模板 中文/game/${relative}`, data);
        report.files.push({ relative, bytes: data.length, sha256: sha(data) });
      }
      const data = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      const output = path.join(work, "官方完整界面模板.zip"); fs.writeFileSync(output, data, { flag: "wx" });
      report.generated = { directory: game, images: images.length, fonts: fonts.length,
        archive: { path: output, bytes: data.length, sha256: sha(data) } };
    }
  }
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, stage, generated: report.generated, error: report.error, reportFile }, null, 2));
});
