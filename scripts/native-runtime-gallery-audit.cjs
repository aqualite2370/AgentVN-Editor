"use strict";
// Read-only audit: a sound evidence collection does not make product failures PASS.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const qa = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
function validate(full, targeted) {
  for (const r of [full, targeted]) {
    assert.equal(r.status, "FAILED"); assert.equal(r.error, null); assert.equal(r.cleanupError, null);
    for (const k of ["productChanges", "builds", "realModelRequests", "installs"]) assert.equal(r[k], 0);
    assert.deepEqual(r.pageErrors, []);
    assert(r.launches.length > 0 && r.launches.every(l => l.cleanup?.status === "PASS"));
  }
  // gallery-02 predates the targeted-only option; exact 12 cases + 24 cells
  // below establish its scope without inventing a historical field.
  assert(full.returnOnly === undefined || full.returnOnly === false);
  assert.equal(targeted.returnOnly, true);
  assert.equal(full.cases.length, 12); assert.equal(targeted.cases.length, 4);
  const expected = ["agentvn", "renpy"].flatMap(layout => [1920, 2560, 3840].flatMap(width =>
    [1, 2].flatMap(dpr => [false, true].map(reduced => ({ layout, width, height: width * 9 / 16, dpr, reduced })))));
  assert.deepEqual(full.matrix.map(({ layout, width, height, dpr, reduced }) =>
    ({ layout, width, height, dpr, reduced })), expected);
  assert(full.matrix.every(c => c.status === "PASS")); assert.deepEqual(targeted.matrix, []);
  assert.equal(full.brokenObservations.length, 2);
  for (const layout of ["agentvn", "renpy"]) {
    const broken = full.brokenObservations.find(r => r.layout === layout); assert(broken);
    assert.equal(broken.visibleDiagnostic, false); assert.equal(broken.returned, "main_menu");
    assert.equal(broken.geometry.cards[0].image.width, 0); assert.equal(broken.geometry.cards[0].image.height, 0);
    const source = full.cases.find(c => c.layout === layout && c.name.startsWith("Real story progression"));
    assert.equal(source.status, "PASS"); assert(source.detail.before.text.includes("GALLERY_AFTER"));
    const replay = targeted.cases.find(c => c.layout === layout && c.name.startsWith("Replay ends"));
    assert.equal(replay.status, "FAILED"); assert.match(replay.error, /preserve the active-story origin/);
    const returned = targeted.replayReturnObservations.find(r => r.layout === layout); assert(returned);
    assert.equal(returned.destination, "title_menu"); assert.equal(returned.afterReturn.playerCount, 0);
    assert.equal(returned.afterReturn.scene, null);
    assert(full.cases.some(c => c.layout === layout && c.name.startsWith("Native unlock") && c.status === "PASS"));
    assert(full.cases.some(c => c.layout === layout && c.name.startsWith("Invalid image") && c.status === "FAILED"));
  }
  assert.equal(full.screenshots.length, 8);
  assert(full.screenshots.every(s => s.png.width === s.before.width * s.before.dpr
    && s.png.height === s.before.height * s.before.dpr
    && JSON.stringify(s.before) === JSON.stringify(s.after)));
}
const out = path.join(qa, process.argv[2] || "gallery-audit-01");
assert(/^gallery-audit-\d{2}$/.test(path.basename(out))); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", productStatus: "FAILED", at: new Date().toISOString(),
  scope: "CURRENT_NATIVE_PLAYER_GALLERY_EVIDENCE_AUDIT_NOT_PRODUCT_PASS", checks: [], error: null };
function check(name, fn) {
  const r = { name, status: "RUNNING" }; report.checks.push(r);
  try { r.detail = fn(); r.status = "PASS"; }
  catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); throw e; }
}
try {
  const files = ["gallery-01", "gallery-02", "gallery-03"].map(n => path.join(qa, n, "report.json"));
  const [prior, full, targeted] = files.map(read);
  check("Complete independent workflows and explicit product failures", () => {
    validate(full, targeted);
    return { reports: files.map(desc), historicalFixtureFailurePreserved: prior.cases.some(c => /null/.test(c.error || "")),
      matrix: 24, brokenResourceLayouts: 2, activeStoryLossLayouts: 2,
      supersededLooseReturnAssertions: "gallery-02 replay rows do not prove story preservation; gallery-03 stricter failures supersede that claim" };
  });
  check("Empty, incomplete, falsely green and inconsistent evidence is rejected", () => {
    const mutations = [
      r => { r[0].cases = []; }, r => { r[0].matrix = []; },
      r => { r[0].matrix[0].dpr = 3; }, r => { r[0].matrix[0].status = "FAILED"; },
      r => { r[0].brokenObservations = []; }, r => { r[0].brokenObservations[0].visibleDiagnostic = true; },
      r => { r[1].cases[1].status = "PASS"; }, r => { r[1].replayReturnObservations[0].destination = "main_menu"; },
      r => { r[0].launches[0].cleanup.status = "FAILED"; }, r => { r[0].screenshots[0].png.width = 1; },
    ];
    for (const mutate of mutations) {
      const data = structuredClone([full, targeted]); mutate(data);
      assert.throws(() => validate(...data));
    }
    return { rejected: mutations.length };
  });
  check("Original bytes, screenshot dimensions, product identities and profile restoration", () => {
    for (let i = 0; i < files.length; i++) {
      const r = [prior, full, targeted][i];
      for (const item of [...r.tools, ...r.sources, ...r.products, r.profileRestoration, ...r.screenshots])
        assert.equal(sha(item.path), item.sha256, item.path);
      for (const item of r.cartridges.concat(r.brokenCartridges)) assert.equal(sha(item.path), item.sha256);
      for (const item of r.screenshots) {
        const bytes = fs.readFileSync(item.path);
        assert.equal(bytes.readUInt32BE(16), item.png.width); assert.equal(bytes.readUInt32BE(20), item.png.height);
      }
      assert.equal(read(r.profileRestoration.path).status, "PASS");
      assert.equal(read(r.profileRestoration.path).deletedUserFiles, 0);
      const archived = path.join(path.dirname(files[i]), "player-roaming/gallery");
      for (const item of r.cases.filter(c => c.name.startsWith("Real story progression") && c.status === "PASS"))
        assert.equal(sha(path.join(archived, path.basename(path.dirname(item.detail.physical.path)),
          path.basename(item.detail.physical.path))), item.detail.physical.sha256);
    }
    return { launches: prior.launches.length + full.launches.length + targeted.launches.length,
      screenshots: prior.screenshots.length + full.screenshots.length + targeted.screenshots.length,
      terminationIsNotNormalClose: true, physical4kClaim: false };
  });
  check("Owned Player identities and debug ports are no longer active", () => {
    const all = [...prior.launches, ...full.launches, ...targeted.launches];
    const pids = [...new Set(all.map(l => l.pid))].join(",");
    const ports = [...new Set(all.map(l => l.port))].join(",");
    const output = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);` +
      `$qaIds=@(${pids});$qaPorts=@(${ports});$qaActive=@(Get-CimInstance Win32_Process|Where-Object {` +
      `$_.ProcessId -in $qaIds -or ($_.Name -eq 'msedgewebview2.exe' -and ` +
      `$_.CommandLine -like '*Native-Runtime-State-20261020-01*gallery-*')})|` +
      `Select-Object ProcessId,ExecutablePath,CreationDate;` +
      `$qaListeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|` +
      `Where-Object {$_.LocalPort -in $qaPorts}|Select-Object LocalAddress,LocalPort,OwningProcess);` +
      `@{processes=@($qaActive);listeners=@($qaListeners)}|ConvertTo-Json -Depth 5 -Compress`],
    { encoding: "utf8", windowsHide: true, timeout: 20000 }).trim();
    const remaining = JSON.parse(output.replace(/^\uFEFF/, ""));
    assert.equal(remaining.processes.length, 0, "A session process or WebView remains; cleanup is incomplete");
    assert.equal(remaining.listeners.length, 0, "An owned CDP port is still listening");
    return { pids: all.map(l => l.pid), cdpPorts: all.map(l => l.port), remaining };
  });
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
