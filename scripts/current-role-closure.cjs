"use strict";
// Current installed-candidate QA only. Keep the original six-role business
// assertions, observable author inputs, exact bytes and fresh evidence paths.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const current = require("./current-layout-closure.cjs");
const qa = "F:/AgentVN/QA/Roles-1.9.35-20261102-01";
const checkpoint = "F:/AgentVN/Checkpoints/Current-Roles-QA-20261102-01";
const editorRoot = "F:/AgentVN/QA/Installed-Layout-20261101-01";
const runtimeRoot = "F:/AgentVN/QA/Native-Runtime-State-20261101-01";
const authorRoot = editorRoot + "/editor-09";
const playerRoot = runtimeRoot + "/roles-installed-1935-02";
const configFile = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/current-layout-candidate.json";
const baseline = editorRoot + "/editor-02/report.json";
const receipt = "F:/AgentVN/QA/Controls-1.9.35-20261102-01/derived-actual-installation.json";
const profileHelper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const files = { author: "candidate-role-author.cjs", player: "candidate-role-player.cjs", audit: "candidate-role-audit.cjs" };
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function build(mode, original) {
  let source = original; const edits = [];
  const change = (before, after, count = 1) => {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  };
  change("F:/AgentVN/QA/Installed-Layout-20261021-01", editorRoot, mode === "author" ? 2 : 1);
  if (mode === "author") {
    change('const preparation = path.join(config.qa, `role-author-preparation-${attempt}`);',
      `const preparation = ${JSON.stringify(qa + "/author-preparation")};`);
    change(editorRoot + "/editor-92/report.json", baseline);
    change('const protection = read(path.join(config.qa, "control-preparation-98/derived-installed.json"));',
      `const protection = read(${JSON.stringify(receipt)});`);
    change('const expected = Object.fromEntries',
      'for (const role of roles) for (const key of Object.keys(role[2]))\n' +
      '  role[2][key] += ({ width: 8, height: 4, fontSize: 1, paddingX: 1, paddingY: 1 })[key];\n' +
      'const expected = Object.fromEntries');
    change('opacity: [1, 1, .95, .65][j]', 'opacity: [.96, .99, .95, .65][j]');
    change('const report = { status: "RUNNING", startedAt:',
      'const report = { status: "RUNNING", originalBusiness: module.qaOriginal, ' +
      'executedBusinessSha256: module.qaSourceSha256, startedAt:');
    change('  save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
      '  save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);\n' +
      '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });');
  } else if (mode === "player") {
    change("F:/AgentVN/QA/Native-Runtime-State-20261020-01", runtimeRoot);
    change('path.join(__dirname, "native-dev-preview-profile.ps1")', JSON.stringify(profileHelper));
    change('new vm.Script(Module.wrap(source), { filename: __filename });',
      'replace("Actual installed library Player consumes the unchanged authored all-role cartridge", ' +
      '"Actual NSIS-installed Player consumes the current authored six-role cartridge");\n' +
      'replace("nativeLibraryPreparation:true,nativePickerClaim:false", ' +
      '"nativeLibraryPreparation:false,publicPreview:true,nativePickerClaim:false");\n' +
      'replace("story choice selected/disabled not sampled", "story choice transient disabled not sampled");\n' +
      'new vm.Script(Module.wrap(source), { filename: __filename });');
  } else if (mode === "audit") {
    change("F:/AgentVN/QA/Native-Runtime-State-20261020-01", runtimeRoot);
    change('const out = path.join(config.qa, `role-complete-audit-${auditAttempt}`);',
      `const out = path.join(${JSON.stringify(qa)}, \`closure-audit-\${auditAttempt}\`);`);
    change('const key = r => `${r.width}/${r.height}/${r.dpr}/${r.reduced}`;',
      'const key = r => `${r.width}/${r.height}/${Number(r.dpr.toFixed(6))}/${r.reduced}`;');
    change('assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);\n' +
      '      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr);',
      'const display = matrix.find(d => key(d) === key(s.before)); assert(display);\n' +
      '      assert.equal(bytes.readUInt32BE(16), display.width * display.dpr);\n' +
      '      assert.equal(bytes.readUInt32BE(20), display.height * display.dpr);');
    change('const script = JSON.parse(await cart.file("scripts/main.json").async("string"));',
      'const manifest = JSON.parse(await cart.file("manifest.json").async("string"));\n' +
      '  assert.equal(typeof manifest.entry_script, "string");\n' +
      '  assert(!manifest.entry_script.includes("\\\\") && !manifest.entry_script.includes(":") &&\n' +
      '    !manifest.entry_script.split("/").some(p => !p || p === "." || p === ".."));\n' +
      '  const entry = cart.file(manifest.entry_script); assert(entry);\n' +
      '  const scriptBytes = await entry.async("nodebuffer");\n' +
      '  const checksum = JSON.parse(await cart.file("checksum.json").async("string"));\n' +
      '  const matches = checksum.files.filter(f => f.path === manifest.entry_script); assert.equal(matches.length, 1);\n' +
      '  assert.equal(matches[0].size_bytes, scriptBytes.length);\n' +
      '  assert.equal(matches[0].hash_sha256, require("node:crypto").createHash("sha256").update(scriptBytes).digest("hex"));\n' +
      '  const script = JSON.parse(scriptBytes.toString("utf8"));');
  } else assert.fail(mode);
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function prepare() {
  const actual = descriptor();
  assert.deepEqual(read(receipt).executable, actual.executable);
  assert.equal(read(baseline).status, "PASS");
  assert.equal(read(read(baseline).installation).executable.sha256, actual.executable.sha256);
  assert(!fs.existsSync(qa)); assert(!fs.existsSync(checkpoint));
  fs.mkdirSync(checkpoint);
  const copies = [];
  for (const name of ["AGENTS.md", "plans/ACTIVE_TASKS.md", "scripts/current-role-closure.cjs",
    ...Object.values(files).map(f => "scripts/" + f)]) {
    const input = path.resolve(name), copy = path.join(checkpoint, name);
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(input, copy, fs.constants.COPYFILE_EXCL);
    copies.push({ input: describe(input), copy: describe(copy) });
  }
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=normal"],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  fs.writeFileSync(path.join(checkpoint, "worktree-status.txt"), status, { flag: "wx" });
  fs.writeFileSync(path.join(checkpoint, "report.json"), JSON.stringify({
    status: "PASS", at: new Date().toISOString(),
    scope: "QA_SLICE_CHECKPOINT_PRIOR_PRODUCT_CHECKPOINTS_RETAINED_NO_PRODUCT_EDITS",
    actualInstallation: actual.actualInstallation, products: [actual.executable, ...actual.resources],
    copies, baseline: describe(baseline), originalProtection: describe(receipt),
    productChanges: 0, builds: 0, modelRequests: 0,
  }, null, 2), { flag: "wx" });
  fs.mkdirSync(qa);
  console.log(JSON.stringify({ status: "PASS", checkpoint, qa, productStarts: 0 }));
}
function previewSession(prep) {
  // The original shared QA constructor allows only the historical evidence
  // root. Relocate that exact guard in memory; preserve all other checks and
  // save both sources. Do not change shared helpers used by prior evidence.
  const baseFile = path.join(__dirname, "lib/installed-runtime-session.cjs");
  const previewFile = path.join(__dirname, "lib/installed-runtime-preview-1922-session.cjs");
  const before = '"F:\\\\AgentVN\\\\QA\\\\Native-Runtime-State-20261020-01\\\\"';
  const after = '"F:\\\\AgentVN\\\\QA\\\\Native-Runtime-State-20261101-01\\\\"';
  const original = fs.readFileSync(baseFile, "utf8");
  assert.equal(original.split(before).length - 1, 1);
  const source = original.replace(before, after);
  fs.writeFileSync(path.join(prep, "runtime-session.cjs"), source, { flag: "wx" });
  fs.copyFileSync(previewFile, path.join(prep, "preview-session.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(prep, "session-binding.json"), JSON.stringify({
    base: describe(baseFile), preview: describe(previewFile),
    adaptedBase: describe(path.join(prep, "runtime-session.cjs")),
    edits: [{ before, after, reason: "Exact current QA evidence root only" }],
  }, null, 2), { flag: "wx" });
  const base = new Module(baseFile, module);
  base.filename = baseFile; base.paths = Module._nodeModulePaths(path.dirname(baseFile));
  base._compile(source, baseFile);
  const preview = new Module(previewFile, module);
  preview.filename = previewFile; preview.paths = Module._nodeModulePaths(path.dirname(previewFile));
  preview.require = function(request) {
    if (request === "./installed-runtime-session.cjs") return base.exports;
    return Module.prototype.require.call(this, request);
  };
  preview._compile(fs.readFileSync(previewFile, "utf8"), previewFile);
  return preview.exports;
}
function run(mode, auditAttempt = "01") {
  const actual = descriptor();
  current.validateCandidateConfig(read(configFile));
  if (mode === "self-test") {
    for (const [kind, name] of Object.entries(files)) {
      const text = fs.readFileSync(path.join(__dirname, name), "utf8"), result = build(kind, text);
      assert(result.edits.length >= 3); assert.throws(() => build(kind, ""));
    }
    console.log(JSON.stringify({ status: "PASS", adapters: 3, emptySourcesRejected: 3,
      candidate: actual.executable, productStarts: 0, modelRequests: 0 }));
    return;
  }
  if (mode === "prepare") return prepare();
  assert(Object.hasOwn(files, mode)); assert(fs.existsSync(qa));
  const prep = path.join(qa, mode === "audit" ? `audit-binding-${auditAttempt}` :
    mode === "player" ? "player-binding-02" : mode + "-binding");
  assert(!fs.existsSync(prep)); fs.mkdirSync(prep);
  const file = path.join(__dirname, files[mode]), original = describe(file);
  const result = build(mode, fs.readFileSync(file, "utf8"));
  fs.writeFileSync(path.join(prep, "executed.cjs"), result.source, { flag: "wx" });
  fs.copyFileSync(__filename, path.join(prep, "adapter.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(prep, "binding.json"), JSON.stringify({
    original, executed: describe(path.join(prep, "executed.cjs")), adapter: describe(__filename),
    edits: result.edits, config: describe(configFile), actualInstallation: actual.actualInstallation,
    productChanges: 0, builds: 0, modelRequests: 0,
  }, null, 2), { flag: "wx" });
  process.env.AGENTVN_INSTALLED_GUI_QA_ROOT = path.resolve(editorRoot);
  process.argv = [process.execPath, file, "run", "09",
    ...(mode !== "author" ? ["02"] : []),
    ...(mode === "audit" ? [auditAttempt] : []), "--candidate-config=" + configFile];
  const worker = new Module(file, module);
  Object.assign(worker, { filename: file, paths: Module._nodeModulePaths(path.dirname(file)),
    qaOriginal: original, qaSource: result.source,
    qaSourceSha256: crypto.createHash("sha256").update(result.source).digest("hex") });
  let session;
  worker.require = function(request) {
    if (request === "./candidate-layout-consumption.cjs")
      return { ...require(request), validateCandidateConfig: current.validateCandidateConfig };
    if (mode === "player" && request === "./lib/installed-runtime-preview-1922-session.cjs")
      return session ??= previewSession(prep);
    return Module.prototype.require.call(this, request);
  };
  worker._compile(result.source, file);
}
if (require.main === module) run(process.argv[2], process.argv[3]);
module.exports = { build, qa, checkpoint, editorRoot, runtimeRoot, authorRoot, playerRoot, files };
