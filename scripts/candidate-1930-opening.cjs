"use strict";
// Current installed Player, unchanged complete 32-flow opening regression.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows } = require("./lib/current-native-editor-session.cjs");
const options = process.env.AGENTVN_EXIT_CANDIDATE_CONFIG
  ? require("./lib/candidate-1924-quick-adapter.cjs").quickCandidate() : null;
const version = options?.version || "1.9.30", stamp = version.replaceAll(".", "");
const base = options?.base || "F:/AgentVN/QA/Editor-1.9.30-20261026-01";
const receipt = options?.installation || path.join(base, "derived-components-installation-01.json");
const nativeRoot = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const files = {
  run: path.join(__dirname, "candidate-1924-opening-playwright.cjs"),
  audit: path.join(__dirname, "candidate-1924-opening-audit.cjs"),
  session: path.join(__dirname, "lib/candidate-1924-opening-session.cjs"),
};
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
function openingCandidateEvidence(file, out) {
  assert.equal(path.resolve(file), path.resolve(receipt));
  const installed = require("./candidate-1930-exit.cjs").validateInstallation(file);
  assert.equal(path.dirname(path.resolve(out)), path.resolve(nativeRoot));
  assert.match(path.basename(out), new RegExp(`^opening-installed-${stamp}-\\d{2}$`));
  return { executable: installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"),
    receipt: desc(file) };
}
function build(action, original) {
  let source = original; const changes = [];
  const replace = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after); changes.push({ before, after });
  };
  if (action === "session") {
    const begin = original.indexOf("function openingCandidateEvidence(file,out){");
    const end = original.indexOf("async function candidateOpeningSession(", begin);
    assert(begin >= 0 && end > begin);
    replace(original.slice(begin, end),
      'const { openingCandidateEvidence } = require("../candidate-1930-opening.cjs");\n');
  } else {
    replace('require("./lib/candidate-1924-opening-session.cjs")',
      action === "run" ? 'require("./candidate-1930-opening.cjs").session()'
        : 'require("./candidate-1930-opening.cjs")');
    replace('opening-installed-1924-${attempt}', `opening-installed-${stamp}-\${attempt}`);
    if (action === "run") {
      replace('const installationFile="F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";',
        `const installationFile=${JSON.stringify(receipt)};`);
      replace('scope:"INSTALLED_1_9_24_BUNDLED_NATIVE_PREVIEW_NOT_AUTHOR_EXPORT_STANDALONE_UPGRADE_OR_ANDROID"',
        `scope:"INSTALLED_${version.replaceAll(".", "_")}_BUNDLED_NATIVE_PREVIEW_NOT_AUTHOR_EXPORT_STANDALONE_UPGRADE_OR_ANDROID"`);
    } else {
      replace('base="F:/AgentVN/QA/Editor-1.9.24-20261024-01"', `base=${JSON.stringify(base)}`);
      replace('path.join(base,"installation.json")', JSON.stringify(receipt));
      replace('scope:"INSTALLED_1_9_24_BUNDLED_OPENING_NOT_AUTHOR_EXPORT_STANDALONE_UPGRADE_OR_ANDROID"',
        `scope:"INSTALLED_${version.replaceAll(".", "_")}_BUNDLED_OPENING_NOT_AUTHOR_EXPORT_STANDALONE_UPGRADE_OR_ANDROID"`);
    }
  }
  new vm.Script(Module.wrap(source));
  return { source, changes };
}
function session() {
  const file = files.session, built = build("session", fs.readFileSync(file, "utf8"));
  const worker = new Module(file, module); worker.filename = file;
  worker.paths = Module._nodeModulePaths(path.dirname(file)); worker._compile(built.source, file);
  return worker.exports;
}
function validatePredecessor(predecessor) {
  assert.equal(predecessor.status, "PASS");
  assert(predecessor.finishedAt && !predecessor.cleanupError && !predecessor.error);
  if (options) {
    assert.equal(predecessor.scope, `INSTALLED_${version.replaceAll(".", "_")}_INHERITANCE_ANCHORS_QUICK_LIBRARY_AUDIT`);
    assert.equal(predecessor.checks.length, 4);
    assert(predecessor.checks.every(c => c.status === "PASS"));
    assert.equal(predecessor.checks[0].detail.cells, 12);
    assert.equal(predecessor.checks[1].detail.actualBusinessChecks, 192);
    for (const k of ["modelRequests", "productChanges", "builds"]) assert.equal(predecessor[k], 0);
    assert.equal(sha(predecessor.input.path), predecessor.input.sha256);
  } else {
    assert.equal(predecessor.groups.length, 5);
    assert(predecessor.groups.every(g => g.status === "PASS"));
  }
}
function selfTest() {
  let rejected = 0;
  for (const action of Object.keys(files)) {
    const original = fs.readFileSync(files[action], "utf8"), built = build(action, original);
    for (const c of built.changes) {
      assert.throws(() => build(action, original.replace(c.before, ""))); rejected++;
    }
    for (const needle of action === "run" ? [
      'assert.equal(report.cases.length,32)', 'assert.equal(report.screenshots.length,28)',
      'profile("Restore")', 'row.input.focused&&row.input.backgroundInert&&row.input.titleBlocked',
    ] : action === "audit" ? [
      'assert.equal(r.cases.length,32)', 'assert.equal(video.length,24)',
      'assert(entry.length>=2)', 'assert.equal(png.readUInt32BE(16),shot.before.width*shot.before.dpr)',
    ] : ['assert.equal(gpu.featureStatus.gpu_compositing,"enabled")',
      'await until(()=>!rows().some(n=>known.has(`${n.ProcessId}:${n.Created}`))'])
      assert(built.source.includes(needle), needle);
  }
  for (const args of [
    ["F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json", `${nativeRoot}/opening-installed-${stamp}-01`],
    [receipt, "D:/AgentVN"], [receipt, `${nativeRoot}/opening-installed-${stamp}-01/nested`],
    [receipt, `${nativeRoot}/opening-installed-${stamp}-001`],
    [receipt, `${nativeRoot}/opening-installed-${stamp}-01/../neighbour`],
    [receipt, `${nativeRoot}/opening-installed-1924-01`],
  ]) { assert.throws(() => openingCandidateEvidence(...args)); rejected++; }
  const positive = openingCandidateEvidence(receipt, `${nativeRoot}/opening-installed-${stamp}-01`);
  assert.equal(sha(positive.executable.path), positive.executable.sha256);
  assert.equal(positive.receipt.sha256, sha(receipt));
  if (options) {
    const predecessor = read(options.binding.predecessor.path);
    validatePredecessor(predecessor);
    for (const mutate of [
      p => { p.checks = []; }, p => { p.status = "FAILED"; },
      p => { p.checks[0].status = "FAILED"; }, p => { p.checks[0].detail.cells = 0; },
      p => { p.checks[1].detail.actualBusinessChecks = 0; },
      p => { p.modelRequests = 1; }, p => { delete p.finishedAt; },
      p => { p.input.sha256 = "other"; }, p => { p.scope = "OTHER"; },
    ]) {
      const bad = structuredClone(predecessor); mutate(bad);
      assert.throws(() => validatePredecessor(bad)); rejected++;
    }
  }
  console.log(JSON.stringify({ status: "PASS", version, rejected, requiredFlows: 32, modelRequests: 0, nativeApps: 0 }));
}
function main() {
  if (process.argv[2] === "--self-test") return selfTest();
  const [action, attempt] = process.argv.slice(2);
  assert(["run", "audit"].includes(action)); assert.equal(attempt, "01");
  assert.equal(process.argv.length, 4);
  openingCandidateEvidence(receipt, `${nativeRoot}/opening-installed-${stamp}-${attempt}`);
  assert(!rows().some(p => /^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  const previewAudit = options?.binding.predecessor.path || path.join(base, "preview-audit-01/report.json");
  const predecessor = read(previewAudit);
  validatePredecessor(predecessor);
  const prep = path.join(base, "opening-preparation-01");
  if (action === "run") {
    assert(!fs.existsSync(prep)); fs.mkdirSync(prep);
    const sources = {};
    for (const name of Object.keys(files)) {
      const built = build(name, fs.readFileSync(files[name], "utf8"));
      const output = path.join(prep, `executed-${name}.cjs`);
      fs.writeFileSync(output, built.source, { flag: "wx" });
      sources[name] = { original: desc(files[name]), executed: desc(output), changes: built.changes };
    }
    fs.writeFileSync(path.join(prep, "binding.json"), JSON.stringify({
      sources, adapter: desc(__filename), installation: desc(receipt), predecessor: desc(previewAudit),
      ...(options ? { candidateBindings: [options.bindingFile,
        ...["candidateConfig", "installation", "predecessor", "exported", "fixture"]
          .map(k => options.binding[k].path)].map(desc) } : {}),
    }, null, 2), { flag: "wx" });
  } else {
    const binding = read(path.join(prep, "binding.json"));
    for (const f of [binding.adapter, binding.installation, binding.predecessor])
      assert.equal(sha(f.path), f.sha256);
    if (options) assert.deepEqual(binding.candidateBindings, [options.bindingFile,
      ...["candidateConfig", "installation", "predecessor", "exported", "fixture"]
        .map(k => options.binding[k].path)].map(desc));
    for (const [name, row] of Object.entries(binding.sources)) {
      assert.equal(sha(row.original.path), row.original.sha256); assert.equal(sha(row.executed.path), row.executed.sha256);
      const built = build(name, fs.readFileSync(files[name], "utf8"));
      assert.deepEqual(built.changes, row.changes);
      assert.equal(built.source, fs.readFileSync(row.executed.path, "utf8"));
    }
  }
  const file = files[action], built = build(action, fs.readFileSync(file, "utf8"));
  process.argv.splice(2, process.argv.length - 2, attempt);
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker._compile(built.source, __filename);
}
module.exports = { build, session, openingCandidateEvidence };
if (require.main === module) main();
