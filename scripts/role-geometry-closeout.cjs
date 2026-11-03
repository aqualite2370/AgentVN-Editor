"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Role-Geometry-Source-20261020-02";
const checkpoint = "F:/AgentVN/Checkpoints/Role-Geometry-Source-20261020-02";
const output = path.join(root, "output/role-geometry-source-20261020-01"); assert(!fs.existsSync(output));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const describe = file => ({ path: file, sha256: sha(file), bytes: fs.statSync(file).size, generatedAt: fs.statSync(file).mtime.toISOString() });
const changed = ["shared/cartridge/renpyGui.ts", "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  "GameCli_framework/src/styles/renpy-button-roles.css", "editor/src/components/advanced/RenpyButtonRoleEditor.tsx"];
const report = { status: "RUNNING", at: new Date().toISOString(), modelRequests: 0, checks: [],
  scope: "SOURCE_NAVIGATION_MODAL_GEOMETRY_AND_DEV_BUILD_ONLY_NOT_ALL_ROLES_OR_NEW_INSTALLED_UI",
  sources: changed.map(file => ({ file, ...describe(path.join(root, file)) })),
  historicalInstalledLedger: { PASS: 3, FAILED: 9, BLOCKED: 6, unchanged: true } };
const check = (name, run) => { const detail = run(); report.checks.push({ name, status: "PASS", detail }); };
try {
  const fullFile = path.join(qa, "green-full-01/report.json"), full = read(fullFile);
  const explicitFile = path.join(qa, "explicit-smoke-02/report.json"), explicit = read(explicitFile);
  check("Nonempty full matrix, original strict boundaries/colors and source identity", () => {
    assert.equal(full.status, "PASS"); assert.equal(full.cases.length, 12);
    assert.equal(full.cartridge.sha256, "732d005961601f5d6eae9bdee242202751c6ed004b5b3c6163425f4910005199");
    for (const source of full.sources) assert.equal(sha(path.join(root, source.file)), source.sha256);
    for (const c of full.cases) {
      assert.equal(c.status, "PASS"); assert.equal(c.samples.length, 17); assert.equal(c.violations.length, 0);
      assert.deepEqual(c.pageErrors, []);
      const shot = c.screenshot; assert.equal(sha(shot.path), shot.sha256);
      assert.equal(shot.png.width, c.width * c.dpr); assert.equal(shot.png.height, c.height * c.dpr);
      assert.deepEqual(shot.before, shot.after);
      assert.equal(c.modalButtons.length, 3);
      // Supplement the UI run's sampled controls with ALL recorded modal
      // rectangles, including close; do not assume there are only two.
      for (const b of c.modalButtons) assert(b.left >= -1 && b.top >= -1 && b.right <= c.width + 1 && b.bottom <= c.height + 1);
      for (let i = 0; i < c.modalButtons.length; i++) for (let j = i + 1; j < c.modalButtons.length; j++) {
        const a = c.modalButtons[i], b = c.modalButtons[j];
        assert(Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1
          || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1, "Modal rectangles overlap");
      }
    }
    return { ...describe(fullFile), combinations: 12, samples: 204, physicalDisplayClaim: false,
      allSixRolesCompleteClaim: false, normalReducedIndependent: true };
  });
  check("Explicit dimensions, maximum state envelope and original artifact preserved", () => {
    assert.equal(explicit.status, "PASS"); assert.equal(explicit.cases.length, 2);
    assert(explicit.controlledVariant); assert.equal(sha(explicit.controlledVariant.path), explicit.controlledVariant.sha256);
    assert(explicit.cases.every(c => c.status === "PASS" && c.samples.length === 17));
    assert.equal(sha(full.cartridge.path), full.cartridge.sha256);
    return { ...describe(explicitFile), combinations: 2, samples: 34, controlledVariantNotEditorAuthorship: true };
  });
  check("Direct related behaviors and sequential builds", () => {
    report.commands = [];
    for (const [folder, count] of [["related-05", 12], ["build-01", 4], ["dev-01", 1]]) {
      const file = path.join(qa, folder, "report.json"), r = read(file);
      assert.equal(r.status, "PASS"); assert.equal(r.steps.length, count);
      assert(r.steps.every(s => s.status === "PASS" && s.exitCode === 0));
      for (const source of r.sources) assert.equal(sha(path.join(root, source.file)), source.sha256);
      report.commands.push(...r.steps.map(s => ({ ...s, logfile: path.join(qa, folder, `${s.name}.log`),
        logSha256: sha(path.join(qa, folder, `${s.name}.log`)) })));
      if (folder === "dev-01") report.dev = r.dev;
    }
    assert.equal(report.dev.sha256, sha(report.dev.path));
    assert.equal(report.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    assert(!report.dev.pending);
    return { commands: report.commands.length, dev: report.dev };
  });
  check("Bundled runtime source equality and unmodified neighboring product files", () => {
    report.resources = collectStageResourceEvidence(root, changed);
    const original = read(path.join(checkpoint, "manifest.json"));
    const unchanged = original.entries.filter(e => !changed.includes(e.file) && !e.file.startsWith("plans/"));
    for (const file of unchanged) assert.equal(sha(path.join(root, file.file)), file.sha256);
    report.player = describe(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    assert.equal(report.player.sha256, sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
    report.compiledResources = [];
    for (const [relative, token] of [
      ["editor/dist/assets", "宽度：内置最小值，随文字扩展。"],
      ["GameCli_framework/dist/assets", "--renpy-role-min-width"],
      ["editor/dist/gamecli-preview/assets", "--renpy-role-min-width"],
    ]) {
      const dir = path.join(root, relative);
      const matches = fs.readdirSync(dir).filter(file => /\.(css|js)$/.test(file)
        && fs.readFileSync(path.join(dir, file), "utf8").includes(token));
      assert(matches.length > 0, `Compiled content missing: ${relative}/${token}`);
      report.compiledResources.push(...matches.map(file => describe(path.join(dir, file))));
    }
    return { unchanged, editorSourceNotInBundledWorkspace: true };
  });
  check("Frozen installed candidate unchanged", () => {
    const installed = "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor";
    const expected = [
      ["agentvn-editor.exe", "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c"],
      ["agentvn-player.exe", "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a"],
      ["creator-backend.exe", "db44bd510997a73aee80ba5419d0c9c55e6f73f9a01ad65003915ea089eb5155"],
    ];
    return expected.map(([file, hash]) => {
      const actual = describe(path.join(installed, file)); assert.equal(actual.sha256, hash); return actual;
    });
  });
  check("Owned services and actual browser parameters", () => {
    const files = [fullFile, explicitFile, path.join(qa, "red-smoke-01/report.json"), path.join(qa, "diagnostic-01/report.json"),
      path.join(qa, "green-smoke-01/report.json"), path.join(qa, "explicit-smoke-01/report.json")];
    for (const folder of ["related-02", "related-03", "related-04", "related-05"]) {
      const record = read(path.join(qa, folder, "report.json"));
      for (const step of record.steps) for (const evidence of step.evidencePaths || [])
        files.push(evidence.endsWith(".json") ? evidence : path.join(evidence, "report.json"));
    }
    const build = read(path.join(qa, "build-01/report.json"));
    for (const step of build.steps) for (const evidence of step.evidencePaths || [])
      files.push(evidence.endsWith(".json") ? evidence : path.join(evidence, "report.json"));
    const services = [...new Map(files.map(f => read(f)).filter(r => r.service)
      .map(r => [r.service.pid, r.service])).values()];
    for (const service of services) {
      const alive = execFileSync("powershell.exe", ["-NoProfile", "-Command",
        `$p = Get-Process -Id ${Number(service.pid)} -ErrorAction SilentlyContinue; if ($p) { 'ALIVE' } else { 'ABSENT' }`],
      { windowsHide: true, encoding: "utf8" }).trim();
      assert.equal(alive, "ABSENT", `Owned service PID still exists: ${service.pid}`);
    }
    return { services, allRecordedPidsAbsent: true };
  });
  report.remaining = ["new Dev native UI", "new Release installation and Windows/Android exports/runtime/upgrades",
    "all six roles and full authoring suite", "category vertical content-box diagnostic",
    "OPACITY-02 scope decision", "avatar layout position editing", "other active ledger requirements"];
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "receipt.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, output, error: report.error }));
}
