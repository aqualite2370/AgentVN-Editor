"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const work = "F:/AgentVN/QA/Editor-Mask-20261019-01";
const output = path.join(root, "output/editor-selection-mask-20261019-01");
const attempt = process.argv.find(arg => arg.startsWith("--attempt="))?.slice(10) || "01";
assert(/^\d{2}$/.test(attempt), "Audit attempt must be two digits");
const auditPath = path.join(output, `terminal-audit-${attempt}.json`);
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { at: new Date().toISOString(), layer: "Editor", installedAcceptance: false,
  status: "RUNNING", checks: [], sources: [], tests: [] };
const sourceFiles = [
  "editor/src/components/common/GlassSelectionGroup.tsx",
  "editor/src/components/editor/EditorToolbar.tsx",
  "editor/src/components/advanced/AdvancedToolsPanel.tsx",
  "editor/src/utils/editorTransitionPresentation.ts",
  "editor/src/styles/variables.css", "editor/src/styles/editor-topbar.css", "editor/src/styles/editor-shell.css",
];
async function main() {
  assert(!fs.existsSync(auditPath), "Refuse to overwrite a historical audit");
  try {
    for (const file of sourceFiles)
      report.sources.push({ file, sha256: sha(path.join(root, file)),
        modifiedAt: fs.statSync(path.join(root, file)).mtime.toISOString() });
    for (const dpr of [1, 2]) for (const reduced of [0, 1]) {
      const file = path.join(work, `final-matrix-dpr${dpr}-reduced${reduced}-01/report.json`);
      const test = JSON.parse(fs.readFileSync(file));
      assert.equal(test.status, "PASS", `Final mask matrix failed: ${file}`);
      assert.equal(test.dpr, dpr);
      assert.equal(test.reducedMotion, Boolean(reduced));
      assert.equal(test.cases.length, 27, "Empty or incomplete final matrix");
      const combinations = new Set();
      const expectedOrder = ["history:pointer", "library:pointer", "layout:pointer", "library:pointer",
        "assets:pointer", "history:pointer", "settings:pointer", "history:keyboard", "settings:rapid-redirect"];
      let index = 0;
      for (const item of test.cases) {
        assert.equal(item.failures.length, 0);
        assert(item.frames.length >= 3);
        const viewportName = { 1920: "1080p", 2560: "1440p", 3840: "4k" }[item.viewport.width];
        assert(viewportName, "Unexpected actual viewport");
        assert.equal(item.viewport.height, { "1080p": 1080, "1440p": 1440, "4k": 2160 }[viewportName]);
        assert.equal(item.viewport.dpr, dpr);
        assert.equal(item.reduced, Boolean(reduced));
        assert.equal(item.frames.at(-1).active, item.target);
        assert.equal(`${item.target}:${item.method}`, expectedOrder[index % 9]);
        combinations.add(`${viewportName}:${index % 9}:${item.target}:${item.method}`);
        index++;
      }
      assert.equal(combinations.size, 27, "Duplicate/missing final scenarios");
      assert.equal(test.cleanup?.status, "PASS");
      for (const image of fs.readdirSync(path.dirname(file)).filter(name => name.endsWith(".png"))) {
        const png = fs.readFileSync(path.join(path.dirname(file), image));
        const sizeName = image.split("-")[0];
        const size = { "1080p": [1920, 1080], "1440p": [2560, 1440], "4k": [3840, 2160] }[sizeName];
        assert(size, `Unknown screenshot viewport: ${image}`);
        assert.equal(png.readUInt32BE(16), size[0] * dpr);
        assert.equal(png.readUInt32BE(20), size[1] * dpr);
      }
      report.tests.push({ file, sha256: sha(file), cases: test.cases.length, status: test.status });
    }
    report.checks.push({ name: "12 desktop combinations / 108 actual behavior cases", status: "PASS" });
    for (const name of ["surface-normal-04", "surface-dpr1-reduced1-01",
      "surface-dpr2-reduced0-01", "surface-dpr2-reduced1-01"]) {
      const file = path.join(work, name, "report.json");
      const test = JSON.parse(fs.readFileSync(file));
      assert.equal(test.status, "PASS", `Workspace surface regression failed: ${file}`);
      assert.equal(test.results.length, 3, "Missing workspace surface desktop matrix");
      for (const result of test.results) {
        const frames = result.optionsOpenTransition.frames;
        assert(frames.length >= 3, "Missing real workspace opening frames");
        for (const frame of frames) {
          assert.equal(frame.viewport.width, result.viewport.width);
          assert.equal(frame.viewport.height, result.viewport.height);
          assert.equal(frame.viewport.dpr, test.deviceScaleFactor);
        }
        for (const suffix of ["assistant", "options", "preview", "publish", "rapid-publish"]) {
          const image = path.join(work, name, `${result.viewport.name}-${suffix}.png`);
          const png = fs.readFileSync(image);
          assert.equal(png.readUInt32BE(16), result.viewport.width * test.deviceScaleFactor);
          assert.equal(png.readUInt32BE(20), result.viewport.height * test.deviceScaleFactor);
        }
      }
      report.tests.push({ file, sha256: sha(file), viewports: test.results.length,
        dpr: test.deviceScaleFactor, reduced: test.reducedMotion, status: test.status });
    }
    report.checks.push({ name: "12 workspace surface/focus/input/background combinations", status: "PASS" });
    const baseline = JSON.parse(fs.readFileSync(path.join(root,
      "output/full-regression-20261017-01/candidate-02/manifest.json")));
    assert.equal(baseline.source.length, 560);
    const changed = baseline.source.filter(file => sha(file.path) !== file.sha256)
      .map(file => path.relative(root, file.path).replaceAll("\\", "/")).sort();
    assert.deepEqual(changed, [...sourceFiles].sort(), "Changes escaped the seven authorized Editor sources");
    report.scopeAudit = { baselineSourceCount: 560, changed,
      runtimeSourceUnchanged: true, unchanged: 560 - changed.length };
    report.checks.push({ name: "Exactly seven authorized Editor source changes; Runtime intact", status: "PASS" });
    const old = "F:/AgentVN/Checkpoints/Editor-Selection-Mask-20261019-01";
    for (const file of ["editor/src/app/App.css", "editor/src/app/App.tsx", "editor/src/styles/layout.css"])
      assert.equal(sha(path.join(root, file)), sha(path.join(old, "files", file)),
        `Unrelated baseline unexpectedly changed: ${file}`);
    report.checks.push({ name: "Homepage container and global layout unchanged", status: "PASS" });
    const installed = "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/agentvn-editor.exe";
    assert.equal(sha(installed), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    report.installed = { file: installed, sha256: sha(installed), unchanged: true, newlyTested: false };
    const workspace = path.join(root, "editor/src-tauri/bundle-workspace");
    const versions = JSON.parse(fs.readFileSync(path.join(workspace, "build-versions.json"), "utf8").replace(/^\uFEFF/, ""));
    const config = JSON.parse(fs.readFileSync(path.join(root, "editor/src-tauri/tauri.conf.json"), "utf8"));
    assert.equal(versions.editorVersion, config.version);
    const runtimeFiles = baseline.source.filter(file => /[\\/]GameCli_framework[\\/]src[\\/]|[\\/]shared[\\/]/.test(file.path));
    for (const file of runtimeFiles) {
      const relative = path.relative(root, file.path);
      const bundled = path.join(workspace, relative);
      assert.equal(sha(bundled), sha(file.path), `Stale bundled runtime/shared file: ${relative}`);
    }
    report.bundled = { editorVersion: versions.editorVersion, comparedFiles: runtimeFiles.length,
      scriptCount: 0 };
    const scripts = JSON.parse(fs.readFileSync(path.join(root, "scripts/standalone-build-scripts.json")));
    for (const name of scripts.scripts)
      assert.equal(sha(path.join(workspace, "scripts", name)), sha(path.join(root, "scripts", name)));
    report.bundled.scriptCount = scripts.scripts.length;
    report.checks.push({ name: "Refreshed bundle versions/runtime/shared/scripts match actual sources", status: "PASS" });
    const dev = path.join(root, "AgentVN Dev.exe");
    const built = path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe");
    report.dev = { file: dev, sha256: sha(dev), builtSha256: sha(built),
      modifiedAt: fs.statSync(dev).mtime.toISOString(),
      oldSha256: "ceb15d74880bbdee426c0a597734324878dec406583318992193c1cde432be96" };
    assert.equal(report.dev.sha256, report.dev.builtSha256, "Root Dev was not actually overwritten");
    report.dev.binaryHashChanged = report.dev.sha256 !== report.dev.oldSha256;
    const buildLog = path.join(work, "dev-build.log");
    assert(fs.readFileSync(buildLog, "utf8").includes("[AgentVN] Dev container built: D:\\AgentVN\\AgentVN Dev.exe"),
      "Missing actual completed Dev overwrite log");
    report.dev.buildLog = { file: buildLog, sha256: sha(buildLog) };
    report.checks.push({ name: "Dev root/build hash match (actual copy also requires build log)", status: "PASS" });
    for (const evidence of report.tests) {
      const test = JSON.parse(fs.readFileSync(evidence.file));
      for (const url of [test.owner.url, `${test.owner.backendUrl}/api/health`]) {
        let responds = false;
        try { await fetch(url, { signal: AbortSignal.timeout(1000) }); responds = true; } catch {}
        assert(!responds, `Owned test endpoint remains: ${url}`);
      }
    }
    report.checks.push({ name: "Final matrix owned endpoints stopped", status: "PASS" });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack;
    process.exitCode = 1;
  } finally {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(auditPath, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, output }));
  }
}
void main();
