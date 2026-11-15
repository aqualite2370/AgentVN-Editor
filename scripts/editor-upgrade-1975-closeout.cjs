"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const cp = require("node:child_process");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const base = "F:/testavn/Windows-Isolated-1975-20261116-02";
const mode = process.argv[2];
assert(["--archive", "--audit"].includes(mode)); assert.equal(process.argv.length, 3);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size, sha256: sha(file) });
const verify = file => assert.equal(sha(file.path), file.sha256, file.path);
if (mode === "--archive") {
  const output = path.join(base, "qa-sources.json");
  assert(!fs.existsSync(output));
  const audit = read(path.join(base, "terminal-audit-02.json"));
  assert.equal(audit.status, "PASS_RECENT_EDITOR_CLOSED_HOST_UPGRADE");
  assert.equal(audit.scope, "REAL_RECENT_EDITOR_UPGRADE_1974_TO_1975_NOT_CROSS_GENERATION_OR_GAME_UPGRADE");
  const staging = read(path.join(base, "staging.json"));
  for (const entry of staging.copies) verify(entry.staged);
  const files = [], destination = path.join(base, "qa-sources-02");
  assert(!fs.existsSync(destination));
  const validate = source => {
    const item = fs.lstatSync(source);
    assert(!item.isSymbolicLink(), "No linked QA source");
    if (item.isDirectory()) {
      if (path.basename(source) === "__pycache__") return;
      for (const child of fs.readdirSync(source)) validate(path.join(source, child));
    } else assert(/\.(cjs|ps1|py|psm1)$/.test(source), "Retain source only: " + source);
  };
  const copy = (source, target) => {
    const item = fs.lstatSync(source);
    assert(!item.isSymbolicLink(), "No linked QA source");
    if (item.isDirectory()) {
      if (path.basename(source) === "__pycache__") return;
      fs.mkdirSync(target);
      for (const child of fs.readdirSync(source)) copy(path.join(source, child), path.join(target, child));
    } else {
      assert(/\.(cjs|ps1|py|psm1)$/.test(source), "Retain source only");
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(source), sha(target));
      files.push({ ...desc(target), source });
    }
  };
  validate(path.join(base, "harness/scripts"));
  copy(path.join(base, "harness/scripts"), destination);
  assert(files.length >= staging.copies.length);
  fs.writeFileSync(output, JSON.stringify({ status: "PASS", at: new Date().toISOString(), files }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: "PASS", files: files.length, output }));
} else {
  const output = path.join(base, "completion-review-01.json");
  assert(!fs.existsSync(output));
  const r = { status: "RUNNING", at: new Date().toISOString(), checks: [], inputs: [], builds: 0, models: 0 };
  function input(file) { r.inputs.push(desc(file)); return read(file); }
  function check(name, fn) { const detail = fn(); r.checks.push({ name, status: "PASS", detail }); }
  try {
    const audit = input(path.join(base, "terminal-audit-02.json"));
    const run = input(path.join(base, "resource-01/report.json"));
    const control = input(path.join(base, "account-controller.json"));
    const retirement = input(path.join(base, "account-retirement-01.json"));
    check("actual recent upgrade, old and new editing, default profile restart and three natural closes", () => {
      assert.equal(audit.status, "PASS_RECENT_EDITOR_CLOSED_HOST_UPGRADE");
      assert.equal(audit.scope, "REAL_RECENT_EDITOR_UPGRADE_1974_TO_1975_NOT_CROSS_GENERATION_OR_GAME_UPGRADE");
      assert.equal(audit.checks.length, 5); assert(audit.checks.every(c => c.status === "PASS"));
      for (const e of audit.inputs) verify(e);
      const prior = input(path.join(base, "terminal-audit-01.json"));
      assert.equal(prior.status, "FAILED");
      assert(prior.error.includes("ENOENT") && prior.error.includes("account-retirement-01.json"));
      assert.equal(run.status, "PASS"); assert.equal(run.stages.length, 4);
      assert(run.stages.every(c => c.status === "PASS")); assert.equal(run.launches.length, 3);
      assert.equal(run.cleanups.length, 3);
      assert(run.cleanups.every(c => c.method === "WM_CLOSE" && c.receipt.normalClose && c.killed.length === 0));
      verify(run.oldPortable); verify(run.newPortable);
      assert.equal(run.screenshots.length, 4);
      for (const shot of run.screenshots) {
        verify(shot); assert.deepEqual(shot.before, shot.after);
        const png = fs.readFileSync(shot.path);
        assert.equal(png.readUInt32BE(16), shot.before.width * shot.before.dpr);
        assert.equal(png.readUInt32BE(20), shot.before.height * shot.before.dpr);
      }
      return { phases: 4, naturalCloses: 3, screenshots: 4, boundaries: run.boundaries };
    });
    check("owned standard account, profile, download, process and port retirement", () => {
      assert.equal(control.status, "FINISHED");
      assert.equal(control.account.sid, "S-1-5-21-2093805479-91935561-747405786-1121");
      assert.equal(retirement.status, "PASS"); verify(retirement.databaseEvidence);
      assert(retirement.cleanup.accountDeleted && retirement.cleanup.profileDeleted);
      const state = JSON.parse(ps(`@{user=[bool](Get-LocalUser -SID '${control.account.sid}' -ErrorAction SilentlyContinue);` +
        `profile=[bool](Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ '${control.account.sid}')}|ConvertTo-Json -Compress`));
      assert.equal(state.user, false); assert.equal(state.profile, false);
      assert(!fs.existsSync(run.identity.profile));
      assert(!rows().some(p => run.editorKnown.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
      assert.equal(listeners([...new Set(run.launches.flatMap(l => l.ports))]).length, 0);
      assert.equal(run.downloadsRemoved, 2);
      assert(run.ownedDownloads.every(f => !fs.existsSync(f.path)));
      return { sid: control.account.sid, accountDeleted: true, profileDeleted: true, ownedPorts: 0 };
    });
    check("three exact temporary trees removed and source evidence retained", () => {
      const cleanup = input(path.join(base, "artifact-cleanup-01.json"));
      const inventory = input(path.join(base, "artifact-cleanup-inventory-01.json"));
      const source = input(path.join(base, "qa-sources.json"));
      assert.equal(cleanup.status, "PASS"); assert.equal(cleanup.targets.length, 3);
      assert.deepEqual(cleanup.targets.map(t => t.path).sort(),
        ["installed-editor", "harness", "qa-temp"].map(n => path.join(base, n)).sort());
      assert(cleanup.targets.every(t => t.removed && !fs.existsSync(t.path)));
      assert.equal(inventory.length, cleanup.files);
      assert.equal(inventory.reduce((total, f) => total + f.bytes, 0), cleanup.logicalBytes);
      for (const f of [...cleanup.retained, ...source.files]) verify(f);
      return { files: cleanup.files, logicalBytes: cleanup.logicalBytes, physicalFreeSpaceMeasured: false,
        retainedSources: source.files.length };
    });
    check("frozen installers, daily Dev and real HEAD/index protected; no paid model or product build", () => {
      const seal = input(path.join(base, "upgrade-candidate.json"));
      verify(seal.old); verify(seal.current);
      assert.equal(seal.old.version, "1.9.74"); assert.equal(seal.current.version, "1.9.75");
      const protectedState = input(path.join(base, "checkpoint/protected.json"));
      const head = cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
      assert.equal(head, protectedState.head); verify(protectedState.index); verify(protectedState.dailyDev);
      assert.equal(run.modelRequests, 0); assert.equal(run.builds, 0);
      const tests = input("F:/testavn/Editor-Upgrade-1975-Preparation-20261116-01/scope-tests-02.json");
      assert.equal(tests.status, "PASS"); assert.equal(tests.cases.length, 17);
      assert(tests.cases.every(c => c.status === "PASS"));
      return { head, dailyDev: protectedState.dailyDev, productBuilds: 0, modelRequests: 0 };
    });
    r.status = "PASS_CURRENT_1974_TO_1975_EDITOR_UPGRADE_AND_EXACT_CLEANUP";
    r.boundaries = ["Current machine standard QA profile, not clean VM or physical phone",
      "Recent Editor upgrade only; Android logs, external-cartridge permission failure and other historic items unchanged",
      "No claim of completing the overall active goal"];
  } catch (error) { r.status = "FAILED"; r.error = error.stack; process.exitCode = 1; }
  finally {
    r.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(r, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: r.status, checks: r.checks.length, error: r.error, output }));
  }
}
