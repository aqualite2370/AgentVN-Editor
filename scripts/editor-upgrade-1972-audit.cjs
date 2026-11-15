"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), JSZip = require("../editor/node_modules/jszip");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const args = process.argv.slice(2);
const retirementFollowup = args.includes("--retirement-followup");
assert(args.filter(a => a === "--retirement-followup").length <= 1);
const { cross, base, oldCode, newCode, oldVersion, newVersion, current1975 } =
  require("./lib/editor-upgrade-scope.cjs").upgradeScope(args.filter(a => a !== "--retirement-followup"));
assert.equal(cross, false, "Use the separate cross-generation audit");
assert(!retirementFollowup || current1975, "Only the current exact retirement follow-up is supported");
const out = path.join(base, "resource-01");
const file = path.join(base, retirementFollowup ? "terminal-audit-02.json" : "terminal-audit-01.json"); assert(!fs.existsSync(file));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const result = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [], inputs: [],
  scope: `REAL_RECENT_EDITOR_UPGRADE_${oldCode}_TO_${newCode}_NOT_CROSS_GENERATION_OR_GAME_UPGRADE` };
function input(f) { result.inputs.push({ path: path.resolve(f), sha256: sha(f) }); return read(f); }
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; result.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch(e) { row.status = "FAILED"; row.error = e.stack; throw e; }
}
const content = p => { const c = structuredClone(p); delete c.updated_at; delete c.updatedAt; return c; };
(async () => {
  if (retirementFollowup) {
    const prior = input(path.join(base, "terminal-audit-01.json"));
    assert.equal(prior.status, "FAILED"); assert.equal(prior.checks.length, 5);
    assert(prior.checks.slice(0, 4).every(c => c.status === "PASS"));
    assert.equal(prior.checks[4].status, "FAILED");
    assert(prior.error.includes("ENOENT") && prior.error.includes("account-retirement-01.json"));
    assert(fs.existsSync(path.join(base, "account-retirement-01.json")), "Wait for the actual retirement receipt before audit");
  }
  const control = input(path.join(base, "account-controller.json"));
  const r = input(path.join(out, "report.json")), seal = input(path.join(base, "upgrade-candidate.json"));
  const old = input(path.join(base, "install-old.json")), next = input(path.join(base, "install-new.json"));
  await check("real-installers-same-directory-no-registration-erasure-before-upgrade", () => {
    assert.equal(r.status, "PASS"); assert.equal(r.stages.length, 4);
    assert(r.stages.every(s => s.status === "PASS")); assert.equal(control.status, "FINISHED");
    assert.equal(control.jobs.length, 1); assert.equal(control.jobs[0].status, "PASS");
    assert.equal(control.controller.administrator, true); assert.equal(r.identity.administrator, false);
    assert.equal(control.account.sid, r.identity.sid); assert.equal(r.identity.nativeKnownFolderIsolated, true);
    assert.equal(old.status, "PASS"); assert.equal(next.status, "PASS");
    assert.equal(old.exitCode, 0); assert.equal(next.exitCode, 0); assert.equal(old.installRoot, next.installRoot);
    assert.equal(old.executable.version, oldVersion); assert.equal(next.executable.version, newVersion);
    assert.equal(old.registration.version, oldVersion); assert.equal(next.registration.version, newVersion);
    assert(Date.parse(r.metadataRestoration.at) > Date.parse(r.stages[3].finishedAt));
    for (const pkg of [seal.old, seal.current]) assert.equal(sha(pkg.path), pkg.sha256);
    return { old: old.executable.version, next: next.executable.version, directory: next.installRoot };
  });
  await check("old-and-new-portable-project-content-retained-with-exact-edit", async () => {
    const load = async artifact => {
      assert.equal(sha(artifact.path), artifact.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(artifact.path), { checkCRC32: true });
      return JSON.parse(await zip.file("project.json").async("string"));
    };
    const before = content(await load(r.oldPortable)), after = content(await load(r.newPortable));
    const presentation = after.nodes.find(n => n.id === "start").data.loadingAnimation.presentation;
    assert.deepEqual(presentation, { mode: "centered", fit: "cover", width_percent: 64, height_percent: 72 });
    after.nodes.find(n => n.id === "start").data.loadingAnimation = before.nodes.find(n => n.id === "start").data.loadingAnimation;
    assert.deepEqual(after, before);
    assert.equal(before.editor_settings.runtimeUILayout.gameViewport.aspectRatio, "16:10");
    assert.equal(r.modelRequests, 0); assert.equal(r.builds, 0); assert.equal(r.playerLaunches, 0);
    assert.deepEqual(r.errors, []); assert.equal(r.blockedModelRequests || 0, 0);
    return { retainedProject: before.project_id, authorChange: "start.loadingAnimation.presentation", models: 0 };
  });
  await check("actual-current-installed-resources-match-frozen-installation-receipt", () => {
    const payload = input(seal.newPayload.path); assert.equal(sha(seal.newPayload.path), seal.newPayload.sha256);
    assert.equal(r.installedResources.length, payload.resources.length); assert(payload.resources.length >= 4);
    for (const f of payload.resources) {
      const target = path.join(next.installRoot, path.relative(payload.installRoot, f.path));
      assert.equal(sha(target), f.sha256);
    }
    assert.equal(sha(next.executable.path), seal.newExecutable.sha256);
    return { resources: payload.resources.length, executable: seal.newExecutable.sha256 };
  });
  await check("same-real-default-profile-three-launches-and-natural-close", () => {
    assert.equal(r.launches.length, 3); assert.equal(r.cleanups.length, 3);
    for (const launch of r.launches) {
      assert.equal(launch.database, r.launches[0].database); assert(launch.database.startsWith(r.identity.roaming + path.sep));
      assert.equal(launch.dataDirectoryOverride, false); assert.equal(launch.webviewDirectoryOverride, false);
      assert.equal(launch.sourceServer, false);
    }
    for (const c of r.cleanups) {
      assert.equal(c.method, "WM_CLOSE"); assert.deepEqual(c.killed, []);
      assert.equal(c.receipt.normalClose, true);
      for (const a of [c.receipt.request, c.receipt.nativeEvidence]) assert.equal(sha(a.path), a.sha256);
    }
    assert.equal(r.screenshots.length, 4);
    for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      assert.equal(s.before.width, 1920); assert.equal(s.before.height, 1080); assert.equal(s.before.dpr, 1);
      const b = fs.readFileSync(s.path); assert.equal(b.readUInt32BE(16), 1920); assert.equal(b.readUInt32BE(20), 1080);
    }
    return { launches: 3, naturalCloses: 3, screenshots: 4, retainedTheme: r.theme };
  });
  await check("account-profile-download-and-port-retirement", () => {
    const retirement = input(path.join(base, "account-retirement-01.json"));
    assert.equal(retirement.status, "PASS"); assert.equal(retirement.cleanup.accountDeleted, true);
    assert.equal(retirement.cleanup.profileDeleted, true); assert.equal(r.cleanupStatus, "PASS");
    assert.equal(sha(retirement.databaseEvidence.path), retirement.databaseEvidence.sha256);
    const state = JSON.parse(ps(`@{user=[bool](Get-LocalUser -SID '${control.account.sid}' -ErrorAction SilentlyContinue);` +
      `profile=[bool](Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ '${control.account.sid}')}|ConvertTo-Json -Compress`));
    assert.equal(state.user, false); assert.equal(state.profile, false);
    assert(!fs.existsSync(r.identity.profile));
    assert(!rows().some(p => r.editorKnown.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
    assert.equal(listeners([...new Set(r.launches.flatMap(l => l.ports))]).length, 0);
    assert.equal(r.downloadsRemoved, 2); assert(r.ownedDownloads.every(f => !fs.existsSync(f.path)));
    assert.equal(input(path.join(base, "metadata-restoration.json")).status, "PASS");
    return { accountDeleted: true, profileDeleted: true, downloadsRemoved: 2, databaseRetained: retirement.databaseEvidence };
  });
  assert.equal(result.checks.length, 5); result.status = "PASS_RECENT_EDITOR_CLOSED_HOST_UPGRADE";
})().catch(e => { result.status = "FAILED"; result.error = e.stack; process.exitCode = 1; })
  .finally(() => {
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(result, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: result.status, file, checks: result.checks.length, error: result.error }));
  });
