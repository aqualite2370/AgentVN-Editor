"use strict";
// Independent readback of this QA block; never certifies installed products.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto"), { spawnSync, execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Client-Experience-Safe-20261020-01";
const summary = path.join(root, "output/client-experience-safe-20261020-01");
const read = f => JSON.parse(fs.readFileSync(f));
const digest = b => crypto.createHash("sha256").update(b).digest("hex");
const sha = f => digest(fs.readFileSync(f));
const [mode = "closeout", iteration = "01"] = process.argv.slice(2);
assert(["decoder", "closeout"].includes(mode));
const out = path.join(qa, `${mode}-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", scope: "QA_READBACK_NOT_INSTALLED_NOT_FULL_ACCEPTANCE",
  at: new Date().toISOString(), groups: [] };
async function check(name, work) {
  const row = { name, status: "RUNNING" }; report.groups.push(row);
  try { row.detail = await work(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  console.log(`${row.status} ${name}`);
}
(async () => {
  const fixture = read(path.join(summary, "fixture-base64.json"));
  if (mode === "decoder") {
    await check("Exact backend decoder reproduces charset rejection and byte-identical base64 acceptance", () => {
      const code = [
        "import sys,json,hashlib",
        "from app.services.project_state_service import _decode_data_url",
        "rows=[]",
        "for file in sys.argv[1:]:",
        " p=json.load(open(file,encoding='utf-8'))",
        " rows.append({'path':file,'assets':[{'id':a['asset_id'],'decoded':None if (d:=_decode_data_url(a['metadata']['data_url'])) is None else {'mime':d[0],'sha256':hashlib.sha256(d[1]).hexdigest(),'bytes':len(d[1])}} for a in p['asset_manifest']]})",
        "print(json.dumps(rows))",
      ].join("\n");
      const result = spawnSync("python", ["-c", code, fixture.originalInput, fixture.input],
        { cwd: path.join(root, "backend"), encoding: "utf8", windowsHide: true, timeout: 30000 });
      assert.equal(result.status, 0, result.stderr);
      const rows = JSON.parse(result.stdout);
      assert.equal(rows[0].assets.length, 7); assert(rows[0].assets.every(a => a.decoded === null));
      for (const asset of rows[1].assets) {
        const original = fixture.assets.find(a => a.id === asset.id); assert(original);
        assert.equal(asset.decoded.sha256, original.sha256); assert.equal(asset.decoded.bytes, original.bytes);
      }
      report.productFinding = { id: "DATAURL-01", status: "FAILED", originalAssetsDropped: 7,
        evidence: ["smoke-01", "smoke-02", "smoke-03"], notFixed: true };
      return { command: ["python", "-c", code, fixture.originalInput, fixture.input], rows };
    });
  } else {
    const matrix = read(path.join(qa, "full-02/report.json"));
    await check("Exact twelve-case matrix completed; six reduced-scene failures not disguised as PASS", () => {
      assert.equal(matrix.status, "FAILED"); assert.equal(matrix.cases.length, 12);
      const keys = new Set();
      for (const row of matrix.cases) {
        assert.equal(row.status, row.reduced ? "FAILED" : "PASS"); assert.equal(row.checks.length, 6);
        assert.equal(row.height, { 1920: 1080, 2560: 1440, 3840: 2160 }[row.width]);
        assert([1, 2].includes(row.dpr)); assert.equal(typeof row.reduced, "boolean");
        assert(!keys.has(row.key)); keys.add(row.key);
        assert.equal(row.transitions.length, 5);
        for (const t of row.transitions.filter(t => t.status !== "FAILED")) {
          assert(t.activeFrames >= 2); assert(t.distinctPresentations >= 2);
        }
        if (row.reduced) {
          assert.equal(row.findings.length, 1); assert.equal(row.findings[0].name, "sprite-exit");
          const failed = row.transitions.find(t => t.status === "FAILED");
          assert.match(failed.error, /active flags without rendered visual change/);
          assert.equal(failed.name, "sprite-exit");
          const active = failed.observation.frames.filter(f => f.matched);
          assert(active.length >= 2);
          assert.equal(new Set(active.map(f => JSON.stringify(f.values.map(v => [v.opacity, v.transform])))).size, 1);
          assert.equal(failed.observation.done, true);
          assert.deepEqual(failed.observation.frames.at(-1).ids, []);
        } else assert.equal(row.findings.length, 0);
      }
      assert.equal(matrix.checks.length, 180); assert.equal(matrix.modelRequests, 0);
      report.productFindings = [
        { id: "DATAURL-01", status: "FAILED", notFixed: true },
      ];
      report.qaFindings = [{ id: "RUNTIME-SCENE-REDUCE-01", rawTestStatus: "FAILED",
        disposition: "NORMAL_ASSERTION_APPLIED_TO_REDUCED_AUTHORED_EFFECT", cases: 6, productChanged: false,
        correctionEvidence: path.join(qa, "reduced-01/report.json"),
        scope: "Authored scene effect only; Runtime intentionally skips custom WAAPI effects in reduced motion. Verify actual skip reason/owner and final removal separately. Editor/Runtime page transitions still require continuous handoff." }];
      return { cases: keys.size, normalPass: 6, reducedFailed: 6, groupedObservations: 72,
        packageAndTitleChecks: 180, authoredTransitions: 60, visualPass: 54, visualFailed: 6 };
    });
    await check("Every screenshot has actual viewport/DPR/PNG evidence and immutable bytes", () => {
      let count = 0;
      for (const row of matrix.cases) for (const shot of row.screenshots) {
        assert.equal(sha(shot.path), shot.sha256);
        assert.deepEqual(shot.before, shot.after);
        assert.deepEqual(shot.before, { width: row.width, height: row.height, dpr: row.dpr, reduced: row.reduced });
        const bytes = fs.readFileSync(shot.path);
        assert.equal(bytes.readUInt32BE(16), row.width * row.dpr);
        assert.equal(bytes.readUInt32BE(20), row.height * row.dpr); count++;
      }
      assert.equal(count, 36); return { count };
    });
    await check("Same scene observer revalidated at six reduced displays with actual policy/owner/final-state evidence", () => {
      const file = path.join(qa, "reduced-01/report.json"), reduced = read(file);
      assert.equal(reduced.status, "PASS"); assert.equal(reduced.cases.length, 6);
      assert.equal(reduced.prior.sha256, sha(path.join(qa, "full-02/report.json")));
      assert.equal(reduced.cleanup.status, "PASS");
      for (const row of reduced.cases) {
        const original = matrix.cases.find(c => c.key === row.key); assert(original?.reduced);
        assert.deepEqual(row.cartridge, original.cartridge);
        assert.equal(row.status, "PASS"); assert.equal(row.transition.policy, "REDUCED_AUTHORED_EFFECT_SETTLED");
        assert(row.transition.activeFrames >= 2); assert.equal(row.transition.distinctPresentations, 1);
        assert(row.transition.probe.some(e => e.event === "skipped" && e.details?.reason === "prefers-reduced-motion"));
        assert.deepEqual(row.transition.observation.frames.at(-1).ids, []);
        assert.equal(sha(row.screenshot.path), row.screenshot.sha256);
        assert.equal(row.screenshot.png.width, row.width * row.dpr);
        assert.equal(row.screenshot.png.height, row.height * row.dpr);
      }
      for (const source of matrix.testSources)
        assert.equal(sha(path.join(qa, "full-02/sources", source.file)), source.sha256);
      for (const source of reduced.sources) assert.equal(sha(path.join(root, source.file)), source.sha256);
      report.base64SourceFlowStatus = "PASS_WITH_SEPARATE_NORMAL_AND_REDUCED_SCENE_CONTRACTS";
      return { path: file, sha256: sha(file), correctedCases: 6, additionalScreenshots: 6, originalFailedReportUnchanged: true };
    });
    await check("All exported portable and game packages contain all seven original asset bytes", async () => {
      const packages = [];
      for (const row of matrix.cases) for (const [kind, item] of [["project", row.project], ["cartridge", row.cartridge]]) {
        assert.equal(sha(item.path), item.sha256);
        const zip = await JSZip.loadAsync(fs.readFileSync(item.path));
        const metadata = read(path.join(summary, "fixture-base64.json"));
        const data = JSON.parse(await zip.file(kind === "project" ? "project.json" : "manifest.json").async("string"));
        const assets = kind === "project" ? data.asset_manifest : data.assets;
        assert.equal(assets.length, 7);
        for (const original of metadata.assets) {
          const asset = assets.find(a => a.asset_id === original.id); assert(asset);
          const filename = kind === "project" ? asset.metadata.project_path : asset.path;
          const bytes = await zip.file(filename).async("nodebuffer");
          assert.equal(digest(bytes), original.sha256);
        }
        const stat = fs.statSync(item.path);
        packages.push({ kind, path: item.path, sha256: item.sha256, assets: 7,
          bytes: stat.size, generatedAt: stat.mtime.toISOString() });
      }
      return packages;
    });
    await check("Owned service processes and ports cleaned; sources and Dev/Player unchanged", () => {
      assert.equal(matrix.cleanup.status, "PASS");
      assert(matrix.cleanup.ports.every(p => p.listening === false));
      const reduced = read(path.join(qa, "reduced-01/report.json"));
      const pids = [...matrix.services.flatMap(s => [s.pid, s.backendPid].filter(Boolean)), reduced.service.pid];
      const processes = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
        `@(Get-CimInstance Win32_Process -Filter '${pids.map(p => `ProcessId=${p}`).join(" OR ")}'|Select-Object ProcessId,CreationDate)|ConvertTo-Json -Compress`],
      { encoding: "utf8", windowsHide: true }) || "[]");
      assert.equal(processes.length, 0);
      for (const source of matrix.productSources) assert.equal(sha(source.path), source.sha256);
      for (const product of matrix.productsUnchanged) assert.equal(sha(path.join(root, product.file)), product.sha256);
      return { pids, ports: matrix.cleanup.ports, sourceFiles: matrix.productSources.length, products: matrix.productsUnchanged };
    });
    await check("Safety regressions, original failures, discovered product defect all retained", () => {
      const safety = read(path.join(qa, "green-05/report.json"));
      assert.equal(safety.status, "PASS"); assert.equal(safety.cases.length, 6);
      assert.equal(sha(path.join(root, safety.activeRunner.file)), safety.activeRunner.sha256);
      const red = read(path.join(qa, "red-01/report.json"));
      assert.equal(red.status, "FAILED"); assert.equal(red.cases.filter(c => c.status === "FAILED").length, 3);
      for (const name of ["smoke-01", "smoke-02", "smoke-03", "smoke-04"])
        assert.equal(read(path.join(qa, name, "report.json")).status, "FAILED");
      const failure = read(path.join(qa, "smoke-03/report.json")).cases[0];
      assert(failure.diagnostic.notices.some(n => n.notice.tone === "error" && n.notice.message.includes("没有可读取的素材来源")));
      const decoder = read(path.join(qa, "decoder-01/report.json"));
      assert.equal(decoder.productFinding.status, "FAILED"); assert.equal(decoder.productFinding.notFixed, true);
      return { safety: 6, historicalRed: 3, productFinding: decoder.productFinding };
    });
    await check("Every attempted source-browser run completed cleanup without rewriting earlier results", () => {
      return ["smoke-01", "smoke-02", "smoke-03", "smoke-04", "smoke-05", "full-01", "full-02"].map(name => {
        const file = path.join(qa, name, "report.json"), data = read(file);
        assert.equal(data.cleanup.status, "PASS"); assert(data.finishedAt);
        assert.equal(data.modelRequests, 0);
        return { path: file, sha256: sha(file), status: data.status, cleanup: data.cleanup };
      });
    });
    report.limitations = ["DATAURL-01 remains FAILED; base64 flow does not supersede it",
      "Raw six reduced failures remain unchanged; separate reduced-policy behavior evidence supersedes only that erroneous ordinary-mode assertion",
      "Source browser and isolated Python backend, not native Dev/Release or Windows/Android",
      "External URL opener is intercepted, not real remote navigation",
      "No product changes, new builds, real model calls or final project"];
  }
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  report.testSource = { path: __filename, sha256: sha(__filename) };
  report.qaSources = ["scripts/client-experience-final-e2e-playwright.cjs",
    "scripts/lib/client-experience-current-flow.cjs", "scripts/client-e2e-safety-test.cjs",
    "scripts/client-experience-safe-audit.cjs", "scripts/client-experience-reduced-scenes.cjs"].map(file => {
      const original = path.join(root, file), target = path.join(out, "sources", file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(original, target, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(original), sha(target));
      return { file, sha256: sha(original), snapshot: target };
    });
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
