"use strict";
// Independent, read-only product/evidence checks for the exact 1.9.14 UI exports.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { verifyPortrait, verifyCustom } = require("./lib/portrait-installed-observation.cjs");
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const qa = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01";
const sourceFile = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-dialog-release-${attempt}/report.json`;
const out = path.join(qa, `player-audit-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const sha = f => hash(fs.readFileSync(f));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [], modelRequests: 0,
  scope: "INSTALLED_PLAYER_CONSUMPTION_ONLY_NOT_STANDALONE_SETUP_ANDROID_UPGRADE",
  source: { path: sourceFile, sha256: sha(sourceFile) } };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function check(label, fn) {
  const row = { label, status: "RUNNING" }; report.groups.push(row); save();
  try { row.result = await fn(); row.status = "PASS"; console.log(`PASS ${label}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; } finally { save(); }
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  const run = read(sourceFile), installation = read(path.join(qa, "installation.json"));
  const author = read(run.source.path);
  await check("Exact new installation and two actual UI exports", async () => {
    assert.equal(run.status, "PASS"); assert.equal(run.version, "1.9.14");
    assert.equal(run.cleanupError, undefined); assert.deepEqual(run.errors, []);
    assert.equal(run.modelRequests, 0); assert.equal(sha(run.source.path), run.source.sha256);
    assert.equal(author.status, "PASS"); assert.equal(author.version, run.version);
    assert.equal(author.cartridges.length, 2); assert.equal(author.steps.length, 5);
    assert(author.steps.every(s => s.status === "PASS"));
    assert.equal(path.resolve(run.executable.path), path.resolve(installation.installRoot, "agentvn-player.exe"));
    assert.equal(sha(run.executable.path), run.executable.sha256);
    assert.equal(run.executable.sha256, installation.resources.find(f =>
      path.resolve(f.path) === path.resolve(run.executable.path)).sha256);
    for (const c of author.cartridges) {
      assert.equal(sha(c.path), c.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(c.path), { checkCRC32: true });
      assert.equal(hash(await zip.file("ui/layout.json").async("nodebuffer")), c.layoutSha256);
      assert.equal(hash(await zip.file(c.assetPath).async("nodebuffer")), c.portraitSha256);
    }
    return { playerSha256: run.executable.sha256, cartridges: author.cartridges.map(c => c.sha256) };
  });
  await check("24 distinct real WebView cases, resource bytes, anchors and actual advance", () => {
    assert.equal(run.cases.length, 24);
    const actual = new Set();
    for (const c of run.cases) {
      const key = `${c.type}/${c.width}/${c.dpr}/${c.reduced}`; assert(!actual.has(key)); actual.add(key);
      assert.equal(c.status, "PASS"); assert.equal(c.checks.length, 2);
      validateNativeViewport(c.bound.viewport, c);
      const cart = author.cartridges.find(a => a.type === c.type); assert(cart);
      verifyPortrait(c.bound, cart.portraitSha256); verifyCustom(c.bound, cart.layout.dialogPortrait);
      assert.deepEqual(c.unboundBody, c.bound.body);
    }
    for (const type of ["agentvn", "renpy"]) for (const width of [1920, 2560, 3840])
      for (const dpr of [1, 2]) for (const reduced of [false, true])
        assert(actual.has(`${type}/${width}/${dpr}/${reduced}`));
    assert.equal(run.launches.length, 2); assert.equal(run.screenshots.length, 4);
    for (const s of run.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const png = fs.readFileSync(s.path);
      assert.equal(png.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(png.readUInt32BE(20), s.before.height * s.before.dpr);
    }
    return { cases: actual.size, screenshots: run.screenshots.length };
  });
  await check("Owned processes and ports cleared, original profiles and protected files restored", () => {
    assert.equal(run.cleanups.length, 2); assert(run.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
    const known = new Set(run.knownProcesses.map(p => `${p.ProcessId}:${p.Created}`)); assert(known.size > 0);
    assert(!rows().some(p => known.has(`${p.ProcessId}:${p.Created}`)));
    assert.equal(listeners(run.launches.map(l => l.port)).length, 0);
    assert.equal(sha(run.profileRestoration.path), run.profileRestoration.sha256);
    const restoration = read(run.profileRestoration.path);
    assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
    assert.equal(restoration.restored.length, 2);
    for (const r of restoration.restored) {
      assert(!fs.existsSync(r.original + ".qa-hold-native-preview-20261020"));
      if (r.directoryId) {
        const id = ps(`$v=(& fsutil.exe file queryfileid '${r.original}'|Out-String);` +
          `if($LASTEXITCODE -ne 0 -or $v -notmatch '0x[0-9a-fA-F]+'){throw 'Missing ID'};$Matches[0].ToLowerInvariant()`);
        assert.equal(id, r.directoryId);
      }
      for (const f of r.files) assert.equal(sha(path.join(r.original, f.relative)), f.sha256);
    }
    assert(run.protectedFiles.length > 0);
    for (const f of run.protectedFiles) assert.equal(sha(f.path), f.sha256);
    return { knownProcesses: known.size, ports: run.launches.map(l => l.port), protectedFiles: run.protectedFiles.length };
  });
  await check("Git publishing dry-run only; generated reports excluded and regression source retained", () => {
    const root = path.resolve(__dirname, "..");
    const git = args => {
      const r = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
      assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
    };
    const before = { head: git(["rev-parse", "HEAD"]), index: sha(path.join(root, ".git/index")) };
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "scripts/push-agentvn-editor.ps1", "-CheckOnly"], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60000 });
    fs.writeFileSync(path.join(out, "git-check-only.log"), (r.stdout || "") + (r.stderr || ""), { flag: "wx" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual({ head: git(["rev-parse", "HEAD"]), index: sha(path.join(root, ".git/index")) }, before);
    assert.equal(git(["check-ignore", "output/runtime-dialog-release-player-20261021-01/REPORT.md"]),
      "output/runtime-dialog-release-player-20261021-01/REPORT.md");
    const ignored = spawnSync("git", ["check-ignore", "scripts/installed-dialog-release-player-audit.cjs"],
      { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(ignored.status, 1);
    return { ...before, actualStageCommitFetchPush: false, dryRunLogSha256: sha(path.join(out, "git-check-only.log")) };
  });
  assert.equal(report.groups.length, 4); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); });
