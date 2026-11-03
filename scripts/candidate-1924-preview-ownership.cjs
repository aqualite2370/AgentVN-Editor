"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { ps } = require("./lib/current-native-editor-session.cjs");
// Explicit current candidates reuse the same three real ownership flows.
// Keep the historical recovery-specific entry below unchanged.
if (process.env.AGENTVN_EXIT_CANDIDATE_CONFIG) {
  currentCandidate();
} else {
const inputAudit = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/preview-recovery-audit-02/report.json";
assert.equal(sha(inputAudit), "147aeec394522f290a78a5f521907666cc61712c297f6d7f003f38090c013bf8");
const proven = JSON.parse(fs.readFileSync(inputAudit, "utf8")); assert.equal(proven.status, "PASS");
const correctionFile = "F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-02/installed-03/profile-restoration-correction.json";
const correction = JSON.parse(fs.readFileSync(correctionFile, "utf8"));
assert.equal(correction.status, "PASS"); assert.equal(correction.deletedUserFiles, 0);
assert.equal(correction.removedOwnedNestedJunctions.length, 3);
for (const l of correction.removedOwnedNestedJunctions) assert(!fs.existsSync(l.path));
const original = path.join(__dirname, "installed-preview-ownership-current.cjs");
assert.equal(sha(original), "5fa8696e842b1b4673fef625da283dcfa88ff11fae5e333d1e610f56d13b32a6");
const installationFile = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
const installation = JSON.parse(fs.readFileSync(installationFile, "utf8"));
assert.equal(installation.status, "PASS"); assert.equal(installation.executable.version, "1.9.24");
for (const f of [installation.executable, ...installation.resources, ...installation.protectedFiles]) assert.equal(sha(f.path), f.sha256);
function adapt() {
  let source = fs.readFileSync(original, "utf8"); const changes = [];
  function replace(before, after) {
    assert.equal(source.split(before).length - 1, 1, before); source = source.replace(before, after);
    changes.push({ before, after });
  }
  replace('qa = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01"',
    'qa = "F:/AgentVN/QA/Editor-1.9.24-20261024-01"');
  replace('"installed-01/report.json"', '"installed-03/report.json"');
  replace('assert.equal(source.status, "PASS")',
    'assert.equal(source.status, "FAILED"); assert(source.steps.length === 5 && source.steps.every(s => s.status === "PASS")); assert(module.qaRecoveryAudit)');
  replace('version: "1.9.14"', 'version: "1.9.24"');
  replace('const page = browser.contexts().flatMap(c => c.pages()).find(p => /tauri\\.localhost|^tauri:/.test(p.url())); assert(page);',
    'let page; await until(() => { page = browser.contexts().flatMap(c => c.pages()).find(p => /tauri\\.localhost|^tauri:/.test(p.url())); return !!page; }, "Actual owned WebView application URL");');
  replace('fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
    'fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);\n' +
    '  report.aliasProof = module.qaAliasProof; report.separateRecoveryAudit = module.qaRecoveryAudit;\n' +
    '  fs.writeFileSync(path.join(out,"executed-business.cjs"),module.qaSource,{flag:"wx"});\n' +
    '  fs.writeFileSync(path.join(out,"candidate-adaptations.json"),JSON.stringify(module.qaChanges,null,2),{flag:"wx"});');
  new vm.Script(Module.wrap(source), { filename: __filename }); return { source, changes };
}
if (process.argv[2] === "--self-test") {
  console.log(JSON.stringify({ status: "PASS", changes: adapt().changes.length, productLaunches: 0 }));
} else {
  assert.equal(process.argv[2], "03");
  assert.equal(sha("scripts/native-dev-preview-profile.ps1"), "e20d360c7c7708fdbc0e6e77125cdc49cd8b77beac4f379331afae66942af77f");
  const originals = ["C:/Users/1/AppData/Roaming/com.agentvn.player",
    "C:/Users/1/AppData/Local/com.agentvn.player", "C:/Users/1/AppData/Local/com.agentvn.editor/gamecli-preview"];
  const physical = ["Roaming/com.agentvn.player", "Local/com.agentvn.player", "Local/com.agentvn.editor/gamecli-preview"]
    .map(s => "C:/Users/1/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/" + s);
  const aliasProof = originals.map((p, i) => {
    const id = name => {
      const result = ps(`fsutil file queryfileid '${name}'`), match = result.match(/0x[0-9a-f]+/i);
      assert(match); return match[0].toLowerCase();
    };
    const directoryId = id(p); assert.equal(id(physical[i]), directoryId);
    return { original: path.resolve(p), alias: path.resolve(physical[i]), directoryId, movedOnlyOnce: true };
  });
  const adapted = adapt(), checkpoint = "F:/AgentVN/Checkpoints/Installed-Preview-Owned-1924-20261025-02";
  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint);
  for (const f of [__filename, original, path.resolve("scripts/native-dev-preview-profile.ps1"),
    path.resolve("plans/ACTIVE_TASKS.md")]) fs.copyFileSync(f, path.join(checkpoint, path.basename(f)), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(checkpoint, "alias-proof.json"), JSON.stringify(aliasProof, null, 2), { flag: "wx" });
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  Object.assign(worker, { qaSource: adapted.source, qaChanges: adapted.changes, qaAliasProof: aliasProof,
    qaRecoveryAudit: { path: inputAudit, sha256: sha(inputAudit), originalRunStatus: "FAILED",
      cleanupCorrection: { path: correctionFile, sha256: sha(correctionFile) } } });
  worker._compile(adapted.source, __filename);
}
}

function currentCandidate() {
  const { spawnSync } = require("node:child_process");
  const { rows } = require("./lib/current-native-editor-session.cjs");
  const previewAttempt = process.env.AGENTVN_PREVIEW_ATTEMPT ?? "05";
  assert.match(previewAttempt, /^\d{2}$/, "Preview attempt must be exactly two digits");
  const candidate = require("./lib/candidate-1924-quick-adapter.cjs").quickCandidate();
  const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
  const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
  const work = "F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-02";
  const upstream = path.join(work, `installed-${previewAttempt}/report.json`);
  const upstreamAudit = path.join(candidate.base, "preview-audit-01/report.json");
  const upstreamBinding = path.join(candidate.base, `preview-preparation-${previewAttempt}/binding.json`);
  const original = path.join(__dirname, "installed-preview-ownership-current.cjs");
  const raw = fs.readFileSync(original, "utf8");
  assert.equal(sha(original), "5fa8696e842b1b4673fef625da283dcfa88ff11fae5e333d1e610f56d13b32a6");
  const receipt = require("./candidate-1930-exit.cjs").validateInstallation(candidate.installation);
  function validateUpstream(run, audit, binding) {
    assert.equal(run.status, "PASS"); assert.equal(run.version, candidate.version);
    assert(run.finishedAt && !run.cleanupError);
    assert.equal(run.steps.length, 5); assert(run.steps.every(s => s.status === "PASS"));
    assert.equal(run.cases.length, 12); assert.equal(run.modelRequests, 0);
    assert.equal(audit.status, "PASS"); assert.equal(audit.groups.length, 5);
    assert(audit.finishedAt && audit.groups.every(g => g.status === "PASS"));
    assert.equal(path.resolve(audit.source.path), path.resolve(upstream));
    assert.equal(audit.source.sha256, sha(upstream));
    assert.equal(run.launches[0].executable.sha256, receipt.executable.sha256);
    assert.equal(run.player.sha256, receipt.resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256);
    assert.equal(binding.candidateVersion, candidate.version);
    assert.equal(path.resolve(binding.installation.path), path.resolve(candidate.installation));
    for (const f of [binding.original, binding.adapter, binding.executed, binding.installation,
      run.input, ...run.protectedFiles]) assert.equal(sha(f.path), f.sha256, f.path);
    assert.equal(fs.readFileSync(binding.executed.path, "utf8"),
      fs.readFileSync(path.join(path.dirname(upstream), "executed-business.cjs"), "utf8"));
  }
  const run = read(upstream), audit = read(upstreamAudit), binding = read(upstreamBinding);
  validateUpstream(run, audit, binding);
  function aliases() {
    // Reuse the already frozen Node -> PowerShell volume/File ID proof.
    const result = spawnSync(process.execPath, [path.join(__dirname, "candidate-1930-preview.cjs"), "--self-test"],
      { env: process.env, encoding: "utf8", windowsHide: true, timeout: 60000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const proof = JSON.parse(result.stdout); assert.equal(proof.status, "PASS");
    assert.equal(proof.candidateVersion, candidate.version); assert.equal(proof.physicalDirectories, 3);
    assert.deepEqual(proof.readOnlyAliases, binding.aliases);
    return proof.readOnlyAliases;
  }
  function build(input = raw) {
    let source = input; const changes = [];
    function replace(before, after) {
      assert.equal(source.split(before).length - 1, 1, before);
      source = source.replace(before, after); changes.push({ before, after });
    }
    replace('qa = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01"',
      `qa = ${JSON.stringify(candidate.base)}`);
    replace('"installed-01/report.json"', JSON.stringify(`installed-${previewAttempt}/report.json`));
    replace('version: "1.9.14"', `version: ${JSON.stringify(candidate.version)}`);
    replace('path.join(qa, "installation.json")', JSON.stringify(candidate.installation));
    replace('const page = browser.contexts().flatMap(c => c.pages()).find(p => /tauri\\.localhost|^tauri:/.test(p.url())); assert(page);',
      'let page; await until(() => { page = browser.contexts().flatMap(c => c.pages()).find(p => /tauri\\.localhost|^tauri:/.test(p.url())); return !!page; }, "Actual owned WebView application URL");');
    replace('fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
      'fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);\n' +
      '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
      '  report.candidateBinding = module.qaBinding; report.aliasProof = module.qaAliases;');
    new vm.Script(Module.wrap(source), { filename: __filename });
    return { source, changes };
  }
  const built = build();
  const action = process.argv[2];
  if (action === "--self-test") {
    assert.equal(process.argv.length, 3);
    let rejected = 0;
    for (const change of built.changes) {
      assert.throws(() => build(raw.replace(change.before, ""))); rejected++;
    }
    for (const [object, key, value] of [[run, "version", "0.0.0"], [run, "status", "FAILED"],
      [run, "cases", []], [run, "steps", []], [audit, "groups", []],
      [audit, "status", "FAILED"], [binding, "candidateVersion", "0.0.0"]]) {
      const altered = structuredClone(object); altered[key] = value;
      assert.throws(() => validateUpstream(object === run ? altered : run,
        object === audit ? altered : audit, object === binding ? altered : binding)); rejected++;
    }
    for (const required of ['assert.equal(report.steps.length, 3)',
      'assert.notEqual(proc.ParentProcessId, host.current.pid)',
      'sameExecutableAndRoot: true, actualIndependentStoryAdvance: true',
      'profile("Restore")', 'await controlPage.locator(".dialog-box").click()'])
      assert(built.source.includes(required), required);
    console.log(JSON.stringify({ status: "PASS", candidateVersion: candidate.version,
      rejectedSourceOrEvidenceDrift: rejected, aliases: aliases(), nativeLaunches: 0, modelRequests: 0 }));
    return;
  }
  const [attempt, auditAttempt] = process.argv.slice(3);
  assert.equal(attempt, previewAttempt); assert(action === "run" || action === "audit");
  assert.deepEqual(process.argv.slice(3), action === "run" ? [attempt] : [attempt, auditAttempt]);
  if (action === "audit") assert.match(auditAttempt || "", /^\d{2}$/);
  assert(!rows().some(p => /^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  const proof = aliases(), prep = path.join(candidate.base, `preview-ownership-preparation-${attempt}`);
  let executed = built.source, filename = __filename;
  if (action === "run") {
    assert(!fs.existsSync(prep)); assert(!fs.existsSync(path.join(work, `ownership-${attempt}`)));
    fs.mkdirSync(prep);
    fs.writeFileSync(path.join(prep, "executed-business.cjs"), executed, { flag: "wx" });
    fs.writeFileSync(path.join(prep, "binding.json"), JSON.stringify({
      candidateVersion: candidate.version, adapter: desc(__filename), original: desc(original),
      executed: desc(path.join(prep, "executed-business.cjs")), installation: desc(candidate.installation),
      upstream: desc(upstream), upstreamAudit: desc(upstreamAudit), upstreamBinding: desc(upstreamBinding),
      changes: built.changes, aliases: proof,
    }, null, 2), { flag: "wx" });
  } else {
    const ownBinding = read(path.join(prep, "binding.json"));
    for (const f of [ownBinding.adapter, ownBinding.original, ownBinding.executed, ownBinding.installation,
      ownBinding.upstream, ownBinding.upstreamAudit, ownBinding.upstreamBinding]) assert.equal(sha(f.path), f.sha256);
    assert.deepEqual(ownBinding.aliases, proof); assert.deepEqual(ownBinding.changes, built.changes);
    assert.equal(fs.readFileSync(ownBinding.executed.path, "utf8"), built.source);
    const ownerRoot = path.join(work, `ownership-${attempt}`), owner = read(path.join(ownerRoot, "report.json"));
    assert.equal(owner.status, "PASS"); assert(owner.finishedAt && !owner.cleanupError);
    assert.deepEqual(owner.candidateBinding, desc(path.join(prep, "binding.json")));
    assert.deepEqual(owner.aliasProof, proof);
    assert.equal(sha(path.join(ownerRoot, "executed-test.cjs")), sha(__filename));
    assert.equal(sha(path.join(ownerRoot, "executed-business.cjs")), ownBinding.executed.sha256);
    const auditSource = path.join(__dirname, "installed-preview-current-audit.cjs");
    assert.equal(sha(auditSource), "1e313973e70a90dad9e536ee9b52afc25a2405129f97eb058b8ecc43db5f5d8a");
    executed = require("./candidate-1930-preview.cjs").build("audit", fs.readFileSync(auditSource, "utf8")).source;
    filename = path.join(__dirname, "candidate-1930-preview.cjs");
    fs.writeFileSync(path.join(prep, `executed-audit-${auditAttempt}.cjs`), executed, { flag: "wx" });
  }
  process.argv.splice(2, process.argv.length - 2, attempt, ...(auditAttempt ? [auditAttempt, "--ownership=" + attempt] : []));
  const worker = new Module(filename, module); worker.filename = filename; worker.paths = module.paths;
  Object.assign(worker, { qaSource: built.source, qaBinding: desc(path.join(prep, "binding.json")), qaAliases: proof });
  worker._compile(executed, filename);
}
