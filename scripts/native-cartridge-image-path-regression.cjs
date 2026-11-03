const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const sharp = require("../GameCli_framework/node_modules/sharp");

(async () => {
  sharp.cache(false);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "av-path-"));
  const results = [];
  const name = "98430f7e-c311-4444-93c4-502b35afaaf2-98430f7e-c311-4444-93c4-502b35afaaf2.png";
  const makePath = length => {
    const padding = length - root.length - name.length - 2;
    assert(padding > 0 && padding < 240);
    return path.join(root, "a".repeat(padding), name);
  };
  try {
    const nsis = process.env.AGENTVN_MAKENSIS || path.join(process.env.LOCALAPPDATA || "", "tauri", "NSIS", "makensis.exe");
    if (process.platform === "win32") assert(fs.existsSync(nsis), "NSIS required for the real Windows path regression");
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#467fa5" } }).png().toBuffer();
    for (const length of [262, 245]) {
      const source = makePath(length);
      fs.mkdirSync(path.dirname(source));
      fs.writeFileSync(source, bytes);
      let metadata, error;
      try { metadata = await sharp(source).metadata(); } catch (reason) { error = reason.message; }
      // Exercise the actual release image worker, not only sharp metadata.
      const converted = source.replace(/\.png$/, ".webp");
      const worker = spawnSync(process.execPath, [
        path.join(__dirname, "optimize-release-image.cjs"), source, converted, "lossless",
      ], { encoding: "utf8", windowsHide: true });
      let nsisStatus = null;
      if (process.platform === "win32") {
        const script = path.join(root, `probe-${length}.nsi`);
        const installer = path.join(root, `probe-${length}.exe`);
        const quote = value => value.replace(/\$/g, "$$").replace(/"/g, '$\\"');
        fs.writeFileSync(script, [
          'Unicode true', 'Name "AgentVN path regression"', 'RequestExecutionLevel user',
          `OutFile "${quote(installer)}"`, "Section", 'SetOutPath "$TEMP"',
          `File "${quote(source)}"`, "SectionEnd", "",
        ].join("\n"), "utf8");
        const packaging = spawnSync(nsis, ["/V2", script], { encoding: "utf8", windowsHide: true });
        nsisStatus = packaging.status;
        if (length === 245) {
          assert.equal(packaging.status, 0, packaging.stderr || packaging.stdout || String(packaging.error));
          assert(fs.statSync(installer).size > 0, "NSIS must generate an actual installer");
        }
      }
      if (length === 245) {
        assert.equal(worker.status, 0, worker.stderr || String(worker.error));
        const output = await sharp(converted).metadata();
        assert.equal(output.width, 8);
        assert.equal(output.height, 8);
        assert.deepEqual(fs.readFileSync(source), bytes, "the worker must preserve its source");
      }
      results.push({ length: source.length, exists: fs.existsSync(source), readable: Boolean(metadata),
        imageWorkerStatus: worker.status, nsisStatus, error });
    }
    assert.equal(results[1].readable, true, "established short path must be usable by image optimizer");
  } finally {
    const resolvedRoot = fs.realpathSync(root);
    const resolvedTemp = fs.realpathSync(os.tmpdir());
    assert(resolvedRoot.startsWith(resolvedTemp + path.sep) && path.basename(resolvedRoot).startsWith("av-path-"));
    fs.rmSync(resolvedRoot, { recursive: true, maxRetries: 5, retryDelay: 100 });
  }
  console.log(JSON.stringify({ status: "PASS", results, cleanup: "PASS" }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
