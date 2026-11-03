"use strict";
// Read back exact evidence, packages and current artifacts. Never certifies an installation.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Data-URL-Repair-20261020-01";
const summary = path.join(root, "output/data-url-repair-20261020-01");
const iteration = process.argv[2] || "01", out = path.join(qa, `closeout-${iteration}`);
assert(/^\d{2}$/.test(iteration)); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const digest = b => crypto.createHash("sha256").update(b).digest("hex");
const sha = f => digest(fs.readFileSync(f));
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const evidence = relative => {
  const file = path.join(qa, relative);
  return { data: read(file), reference: describe(file) };
};
const receipt = { status: "RUNNING", at: new Date().toISOString(), checks: [], modelRequests: 0,
  scope: "DATAURL_BACKEND_SOURCE_REAL_BROWSER_PACKAGED_SIDECAR_AND_DEV_NOT_INSTALLED_ACCEPTANCE",
  historicalInstalledLedger: { PASS: 3, FAILED: 9, BLOCKED: 6 },
  notProven: ["New Dev native UI", "New Release installation and Windows/Android acceptance",
    "Real paid-model tasks or final project", "Frontend in-memory rollback on rejected imports",
    "Current rebuilt backend full controlled AI protocol matrix (prior binary evidence is historical)"] };
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; receipt.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
}
(async () => {
  const fixture = read(path.join(summary, "fixture.json")), preparation = read(path.join(summary, "preparation.json"));
  const flow = evidence("flow-01/report.json"), sidecar = evidence("sidecar-01/report.json");
  await check("Original failing bytes, red tests, green tests and checkpoint retained", () => {
    assert.equal(sha(fixture.input), fixture.sha256); assert.equal(sha(fixture.original), fixture.originalSha256);
    assert.equal(fixture.sha256, "210fe9d66a77166111b0ae857813def084041adf1ed6ed2c962ed83447363cb1");
    for (const f of preparation.files) assert.equal(sha(path.join(preparation.checkpoint, f.file)), f.sha256);
    const red = evidence("red-02/report.json"), green = evidence("green-01/report.json");
    assert.equal(red.data.steps[0].exitCode, 1); assert.equal(green.data.steps[0].exitCode, 0);
    assert.match(fs.readFileSync(red.data.steps[0].logPath, "utf8"), /34 failed, 2 passed/);
    assert.match(fs.readFileSync(green.data.steps[0].logPath, "utf8"), /83 passed/);
    return { fixture: describe(fixture.input), checkpointFiles: preparation.files.length,
      red: red.reference, redLog: describe(red.data.steps[0].logPath), productRed: "34 FAILED / 2 PASS",
      green: green.reference, greenLog: describe(green.data.steps[0].logPath), productGreen: "83 PASS" };
  });
  await check("Original charset UI import/save/export/player, exact twelve combinations and independent scene policies", () => {
    const f = flow.data; assert.equal(f.status, "PASS"); assert.equal(f.modelRequests, 0);
    assert.equal(f.cases.length, 12); assert.equal(f.checks.length, 180);
    assert.equal(f.fixture.sha256, fixture.sha256); assert.equal(sha(f.fixture.input), fixture.sha256);
    const expected = [1920, 2560, 3840].flatMap(width =>
      [1, 2].flatMap(dpr => [false, true].map(reduced => JSON.stringify([width, dpr, reduced]))));
    assert.deepEqual(f.cases.map(c => JSON.stringify([c.width, c.dpr, c.reduced])).sort(), expected.sort());
    for (const c of f.cases) {
      assert.equal(c.status, "PASS"); assert.equal(c.height, { 1920: 1080, 2560: 1440, 3840: 2160 }[c.width]);
      assert.equal(c.checks.length, 6); assert.equal(c.findings.length, 0); assert.equal(c.transitions.length, 5);
      for (const t of c.transitions) {
        assert(t.activeFrames >= 2);
        if (c.reduced && t.name === "sprite-exit") {
          assert.equal(t.policy, "REDUCED_AUTHORED_EFFECT_SETTLED");
          assert(t.probe.some(p => p.event === "skipped" && p.details?.reason === "prefers-reduced-motion"));
          assert(!t.probe.some(p => p.event === "animate-start"));
          assert.equal(new Set(t.probe.filter(p => p.event === "effect-created").map(p => p.effect_id)).size, 1);
          assert.deepEqual(t.observation.frames.at(-1).ids, []);
        } else { assert.equal(t.policy, "CONTINUOUS_AUTHORED_TRANSITION"); assert(t.distinctPresentations >= 2); }
      }
      for (const s of c.screenshots) {
        assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
        assert.deepEqual(s.before, { width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced });
        const b = fs.readFileSync(s.path);
        assert.equal(b.readUInt32BE(16), c.width * c.dpr); assert.equal(b.readUInt32BE(20), c.height * c.dpr);
      }
    }
    assert.equal(f.cases.flatMap(c => c.screenshots).length, 36);
    return { report: flow.reference, displayCombinations: 12, groupedChecks: 72, packageTitleChecks: 180,
      screenshots: 36, continuousAuthoredEffects: 54, reducedSettledAuthoredEffects: 6 };
  });
  await check("Every package contains exact seven percent-decoded original asset bytes", async () => {
    const originals = read(fixture.input).asset_manifest.map(a => {
      assert(a.metadata.data_url.startsWith("data:image/svg+xml;charset=utf-8,"));
      return { id: a.asset_id, bytes: Buffer.from(decodeURIComponent(a.metadata.data_url.split(",").slice(1).join(",")), "utf8") };
    });
    assert.equal(originals.length, 7); const packages = [];
    for (const c of flow.data.cases) for (const [kind, item] of [["project", c.project], ["cartridge", c.cartridge]]) {
      assert.equal(sha(item.path), item.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(item.path));
      const data = JSON.parse(await zip.file(kind === "project" ? "project.json" : "manifest.json").async("string"));
      const assets = kind === "project" ? data.asset_manifest : data.assets; assert.equal(assets.length, 7);
      for (const original of originals) {
        const asset = assets.find(a => a.asset_id === original.id); assert(asset);
        const filename = kind === "project" ? asset.metadata.project_path : asset.path;
        assert.deepEqual(await zip.file(filename).async("nodebuffer"), original.bytes);
      }
      packages.push({ kind, ...describe(item.path), assets: 7 });
    }
    assert.equal(packages.length, 24); receipt.packages = packages;
    return { packages: 24, exactAssetComparisons: 168 };
  });
  await check("Actual newly built sidecar import, safe 422, disk bytes and restart", () => {
    const s = sidecar.data; assert.equal(s.status, "PASS"); assert.equal(s.checks.length, 3);
    assert.equal(s.modelRequests, 0); assert.equal(s.checks[1].status, 422);
    assert.equal(sha(s.executable.path), s.executable.sha256); assert.equal(s.input.sha256, fixture.sha256);
    assert.equal(s.sessions.length, 2);
    for (const session of s.sessions) {
      assert.equal(session.status, "PASS"); assert.equal(session.cleanup, "PASS"); assert.equal(session.stop.exitCode, 0);
      assert(session.identity.listeners.every(l => session.identity.processes.some(p => p.ProcessId === l.OwningProcess)));
    }
    for (const c of [s.checks[0], s.checks[2]]) {
      assert.equal(c.assets.length, 7);
      for (const a of c.assets) assert.equal(sha(a.path), a.sha256);
    }
    const payload = evidence("payload-01.json");
    assert.equal(payload.data.status, "PASS"); assert.equal(payload.data.sha256, s.executable.sha256);
    assert.equal(payload.data.afterSha256, payload.data.sha256);
    assert.equal(payload.data.appModules, 71); assert.equal(payload.data.launcherModules, 1);
    assert.equal(payload.data.modules.length, 72);
    for (const m of payload.data.modules) { assert(m.codeObjectEqual); assert.equal(sha(m.source), m.sourceSha256); }
    receipt.backend = describe(s.executable.path);
    return { behavior: sidecar.reference, payload: payload.reference, applicationModules: 71, launcherModules: 1,
      unpackagedSourceModules: payload.data.unpackagedSourceModules, scope: s.scope };
  });
  await check("Sequential required builds, actual root Dev overwrite, matching binaries and sampled resources", () => {
    const gates = evidence("gates-01/report.json"), dev = evidence("dev-01/report.json"), backend = evidence("backend-01/report.json");
    for (const r of [gates, dev, backend]) {
      assert.equal(r.data.status, "PASS"); assert(r.data.steps.length);
      assert(r.data.steps.every(s => s.exitCode === 0 && s.status === "PASS"));
    }
    assert.equal(gates.data.steps.length, 3);
    assert.deepEqual(gates.data.steps.map(s => s.command.slice(-1)[0]), ["typecheck", "build", "build"]);
    assert(gates.data.finishedAt <= dev.data.at); assert(flow.data.finishedAt <= gates.data.at);
    assert(read(path.join(qa, "green-01/report.json")).finishedAt <= gates.data.at);
    receipt.commands = [backend, gates, dev].flatMap(r => r.data.steps.map(s =>
      ({ ...s, log: describe(s.logPath) })));
    for (const p of dev.data.products) assert.equal(sha(path.join(root, p.file)), p.sha256);
    const devFile = path.join(root, "AgentVN Dev.exe"), playerFile = path.join(root, "editor/src-tauri/binaries/agentvn-player.exe");
    const oldDev = preparation.files.find(f => f.file === "AgentVN Dev.exe").sha256;
    assert.notEqual(sha(devFile), oldDev);
    assert.equal(sha(devFile), sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    assert(!fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")));
    assert.equal(sha(playerFile), sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
    receipt.dev = { ...describe(devFile), debugSha256: sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")),
      previousSha256: oldDev, pending: false };
    receipt.player = describe(playerFile);
    receipt.compiled = ["GameCli_framework/dist/assets", "editor/dist/gamecli-preview/assets", "editor/dist/assets"].map(dir => {
      const files = fs.readdirSync(path.join(root, dir)).filter(f =>
        dir === "editor/dist/assets" ? /^RuntimeLayoutDesigner-.*\.js$/.test(f) : /^StoryPlayer-.*\.js$/.test(f));
      assert.equal(files.length, 1, `Ambiguous sampled resource in ${dir}`); return describe(path.join(root, dir, files[0]));
    });
    assert.equal(receipt.compiled[0].sha256, receipt.compiled[1].sha256);
    return { backendBuild: backend.reference, gates: gates.reference, devBuild: dev.reference,
      compiledCoverage: "Three sampled JS artifacts only; not all dist files" };
  });
  await check("Current declared source snapshots, bundled parity and frozen installation unchanged", () => {
    receipt.resources = { bundled: [], frontendSources: [], backendSources: [] };
    for (const s of flow.data.productSources) {
      assert.equal(sha(s.path), s.sha256);
      const file = path.relative(root, s.path).replaceAll("\\", "/");
      const target = path.join(out, "sources", file); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(s.path, target, fs.constants.COPYFILE_EXCL); assert.equal(sha(target), s.sha256);
      if (file.startsWith("backend/")) receipt.resources.backendSources.push({ file, sha256: s.sha256 });
      else if (file.startsWith("editor/")) receipt.resources.frontendSources.push({ file, sha256: s.sha256 });
      else if (file.startsWith("shared/") || file.startsWith("GameCli_framework/src/")) {
        const bundled = path.join(root, "editor/src-tauri/bundle-workspace", file);
        assert.equal(sha(bundled), s.sha256); receipt.resources.bundled.push({ file, sha256: s.sha256, bundledSha256: sha(bundled) });
      }
    }
    const prior = read("F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-06/audit.json");
    receipt.frozen = prior.artifactChecks.filter(a => a.label.startsWith("frozen installed"));
    assert.equal(receipt.frozen.length, 3);
    for (const a of receipt.frozen) assert.equal(sha(a.path), a.sha256);
    for (const s of flow.data.testSources) {
      assert.equal(sha(path.join(root, s.file)), s.sha256);
    }
    return { declaredSources: flow.data.productSources.length, frozenArtifacts: receipt.frozen.length,
      qaSourceQualification: "Current bytes match the run-declared SHA; snapshots created at closeout, not claimed to exist at run time",
      qualification: "Declared source set, not every repository file; old installed failures not superseded" };
  });
  await check("Owned services terminated; no recorded process generation or listening port remains", () => {
    assert.equal(flow.data.cleanup.status, "PASS"); assert(flow.data.cleanup.ports.every(p => !p.listening));
    const identities = [...flow.data.services.flatMap(s => s.identity.processes),
      ...sidecar.data.sessions.flatMap(s => s.identity.processes)];
    const pids = [...new Set(identities.map(p => p.ProcessId))];
    const ports = [...new Set([...flow.data.cleanup.ports.map(p => p.port), ...sidecar.data.sessions.map(s => s.port)])];
    const now = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `$p=@(Get-CimInstance Win32_Process -Filter '${pids.map(p => `ProcessId=${p}`).join(" OR ")}'|Select-Object ProcessId,CreationDate);` +
      `$l=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess);` +
      `@{processes=$p;listeners=$l}|ConvertTo-Json -Compress -Depth 4`], { encoding: "utf8", windowsHide: true }));
    const generation = value => Number(String(value).match(/\d+/)?.[0]);
    for (const p of now.processes) assert(!identities.some(old => old.ProcessId === p.ProcessId &&
      generation(old.CreationDate) === generation(p.CreationDate)), `Owned process generation remains: ${p.ProcessId}`);
    assert.equal(now.listeners.length, 0);
    receipt.cleanup = { status: "PASS", pids, ports, current: now };
    return receipt.cleanup;
  });
  receipt.status = "SOURCE_AND_DEV_PASS";
})().catch(error => { receipt.status = "FAILED"; receipt.error = String(error.stack || error); process.exitCode = 1; })
.finally(() => {
  receipt.qaSources = ["scripts/data-url-repair.cjs", "scripts/data-url-sidecar-check.cjs",
    "scripts/data-url-repair-audit.cjs", "scripts/lib/client-experience-current-flow.cjs",
    "scripts/client-experience-final-e2e-playwright.cjs", "backend/tests/test_project_data_url.py"].map(file => {
    const source = path.join(root, file), target = path.join(out, "qa-sources", file);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    return { file, sha256: sha(source), snapshot: target };
  });
  receipt.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  fs.copyFileSync(path.join(out, "receipt.json"), path.join(summary, `receipt-${iteration}.json`), fs.constants.COPYFILE_EXCL);
  console.log(JSON.stringify({ status: receipt.status, out, error: receipt.error }));
});
