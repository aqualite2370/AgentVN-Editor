"use strict";
// Receipt-bound reuse of the preserved complete author/native/audit workflows.
// No historical source/report edits and no product/version overrides.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { readHistoricalTitlePlayer } = require("./lib/renpy-title-old-runtime-current-evidence.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
const pins = {
  author: ["candidate-1924-author-export.cjs", "1ae532bce6d93d8781449cbf7bd3b9b63b76fc36ea723db7f0b9172a485cb284"],
  run: ["renpy-title-old-runtime-native.cjs", "f5cfae42ecc117d9a172d7406644cd2b9f3e17494370a3eb51a239bebb835e74"],
  audit: ["renpy-title-old-runtime-audit.cjs", "1ad16dcf368a1341a64fc75053a0a0eafe0b3e23b8daa006487db94dcc858902"],
};
const prefix = "--candidate-config=";
const flag = process.argv.find(a => a.startsWith(prefix));
assert(flag, "Explicit current installation config required");
const configFile = path.resolve(flag.slice(prefix.length));
const config = validateCandidateConfig(read(configFile));
const base = config.qa, stamp = config.version.replaceAll(".", "");
const installation = path.join(base, "derived-installed-01.json");
const installed = read(installation), actual = deriveActual(config.actual, config.version);
for (const key of Object.keys(actual)) assert.deepEqual(installed[key], actual[key], key);
for (const f of [installed.executable, ...installed.resources, ...installed.protectedFiles])
  assert.equal(sha(f.path), f.sha256, f.path);
const prerequisite = path.join(base, "abilities-audit-01/report.json");
const prior = read(prerequisite);
assert.equal(prior.status, "PASS");
assert.equal(prior.scope, `INSTALLED_${config.version.replaceAll(".", "_")}_INHERITANCE_ANCHORS_QUICK_LIBRARY_AUDIT`);
assert(prior.finishedAt && !prior.error && prior.checks.length === 4 && prior.checks.every(c => c.status === "PASS"));
const authorScope = `ACTUAL_INSTALLED_${config.version.replaceAll(".", "_")}_FRESH_UI_EXPORT_NARRATIVE_AND_TITLE_NOT_STANDALONE_OR_ANDROID`;
const args = process.argv.slice(2).filter(a => !a.startsWith(prefix));
const [action, attempt, authorAttempt] = args;
assert(["self-test", ...Object.keys(pins)].includes(action));
assert.match(attempt || "", /^\d{2}$/);
assert(action === "self-test" || action === "author" ? args.length === 2
  : args.length === 3 && /^\d{2}$/.test(authorAttempt));
const old = readHistoricalTitlePlayer();
const authorPath = path.join(base, `author-export-${authorAttempt || attempt}/report.json`);
const nativeDir = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/title-old-${stamp}-${attempt}`);
const auditDir = path.join(base, `title-old-audit-${attempt}`);

function adapt(kind) {
  const file = path.join(__dirname, pins[kind][0]);
  assert.equal(sha(file), pins[kind][1], "Preserved workflow changed");
  let source = fs.readFileSync(file, "utf8");
  const changes = [];
  function replace(before, after, name) {
    assert.equal(source.split(before).length - 1, 1, name || before);
    source = source.replace(before, after); changes.push(name || before);
  }
  if (kind === "author") {
    const cacheDir = path.join(base, `session-${Number(attempt) + 80}`);
    assert(Number(attempt) < 20, "Reserved exact cache-guard slot");
    replace('const base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01"',
      `const base = ${JSON.stringify(base)}`, "Current candidate root");
    replace('path.join(base, "installation.json")', JSON.stringify(installation), "Actual installation receipt");
    replace('"安装版 1.9.24 自定义标题"', JSON.stringify(`安装版 ${config.version} 自定义标题`), "Current authored title");
    replace('"ACTUAL_INSTALLED_1_9_24_FRESH_UI_EXPORT_NARRATIVE_AND_TITLE_NOT_STANDALONE_OR_ANDROID"',
      JSON.stringify(authorScope), "Explicit current scope");
    replace('assert.equal(installed.executable.version, "1.9.24")',
      `assert.equal(installed.executable.version, ${JSON.stringify(config.version)})`, "Current PE version");
    replace('const narrative = read(path.join(base, `narrative-audit-${attempt}/report.json`));\n' +
      '  assert.equal(narrative.status, "PASS"); assert.equal(narrative.sourceConclusion, "PASS");\n' +
      '  assert.equal(narrative.coverageComplete, true);\n' +
      '  report.narrativeAudit = desc(path.join(base, `narrative-audit-${attempt}/report.json`));',
      `const narrative = read(${JSON.stringify(prerequisite)});\n` +
      '  assert.equal(narrative.status, "PASS"); assert(narrative.finishedAt && !narrative.error);\n' +
      '  assert.equal(narrative.checks.length, 4); assert(narrative.checks.every(c => c.status === "PASS"));\n' +
      `  report.narrativeAudit = desc(${JSON.stringify(prerequisite)});`,
      "Actual current installed narrative prerequisite, no invented prior pass");
    replace('tools: [__filename,', `tools: [__filename, ${JSON.stringify(__filename)}, ${JSON.stringify(configFile)},`,
      "Freeze current binding and adapter");
    replace("let owner, page;", `let owner, page, cachePrepared = false;
const cacheDirectory = ${JSON.stringify(cacheDir)};
function cache(action) {
  const result = require("node:child_process").spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/installed-layout-cache-session.ps1",
    "-Action", action, "-RunDirectory", cacheDirectory, "-AllowedRunRoot", ${JSON.stringify(base)}, "-CodexCacheView"
  ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", windowsHide: true, timeout: 45000 });
  (report.cache ??= []).push({ action, code: result.status, stdout: result.stdout, stderr: result.stderr });
  report.cacheDirectory = cacheDirectory; save();
  assert.equal(result.status, 0, result.stdout + result.stderr);
}`, "Protect real native Editor cache with the established exact boundary");
    replace("save(); verify();", `save(); verify();
  assert(!fs.existsSync(cacheDirectory)); fs.mkdirSync(cacheDirectory);
  cache("SelfTest"); cachePrepared = true; cache("Prepare");`, "Prepare only an empty exact QA cache guard");
    replace('  report.finishedAt = new Date().toISOString(); save();', `  if (cachePrepared) {
    try { cache("Restore"); report.nativeCacheRestoration = "PASS"; }
    catch (error) { report.status = "FAILED"; report.cacheCleanupError = String(error.stack || error); process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString(); save();`, "Finally restore cache even if Editor teardown fails");
    replace('"scripts/lib/installed-acceptance.cjs", "scripts/lib/current-native-capture.cjs"]',
      '"scripts/lib/installed-acceptance.cjs", "scripts/lib/current-native-capture.cjs", "scripts/installed-layout-cache-session.ps1"]',
      "Freeze the actual native cache guard");
  } else {
    replace('"./lib/renpy-title-old-runtime-evidence.cjs"',
      '"./lib/renpy-title-old-runtime-current-evidence.cjs"', "Real historical GameCLI wording");
    const historicalNative = 'F:/AgentVN/QA/Native-Runtime-State-20261020-01/title-old-026-${attempt}';
    replace(historicalNative, `F:/AgentVN/QA/Native-Runtime-State-20261020-01/title-old-${stamp}-\${attempt}`,
      "Independent current native evidence directory");
    if (kind === "run") {
      replace('const base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01"',
        `const base = ${JSON.stringify(base)}`, "Current author root");
      replace('path.join(base, `author-export-${attempt}/report.json`)',
        JSON.stringify(authorPath), "Exact current UI author report");
      replace('"ACTUAL_INSTALLED_1_9_24_FRESH_UI_EXPORT_NARRATIVE_AND_TITLE_NOT_STANDALONE_OR_ANDROID"',
        JSON.stringify(authorScope), "Current author scope");
      replace('const tools = [__filename,', `const tools = [__filename, ${JSON.stringify(__filename)}, ` +
        `${JSON.stringify(configFile)}, "scripts/lib/renpy-title-old-runtime-current-evidence.cjs",`,
        "Freeze adapter, current receipt and wording helper");
    } else {
      replace('F:/AgentVN/QA/Editor-1.9.24-20261024-01/title-old-audit-${attempt}',
        `${base.replaceAll("\\", "/")}/title-old-audit-\${attempt}`, "Independent current audit directory");
      replace('assert.equal(read(r.author.path).status, "PASS");',
        `assert.equal(path.resolve(r.author.path), ${JSON.stringify(path.resolve(authorPath))});\n` +
        `    assert.equal(read(r.author.path).scope, ${JSON.stringify(authorScope)});\n` +
        '    assert.equal(read(r.author.path).status, "PASS");', "Exact current author provenance");
    }
  }
  new vm.Script(Module.wrap(source));
  return { file, source, changes };
}
if (action === "self-test") {
  const adapted = Object.fromEntries(Object.keys(pins).map(k => [k, adapt(k)]));
  assert.equal(old.executable.sha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");
  assert(Object.values(adapted).every(a => a.changes.length > 0));
  console.log(JSON.stringify({ status: "PASS", version: config.version,
    currentInstallation: describe(installation), realOldPlayer: old.executable,
    prerequisite: describe(prerequisite),
    adaptations: Object.fromEntries(Object.entries(adapted).map(([k, v]) => [k, v.changes])),
    productStarts: 0, modelRequests: 0 }));
} else {
  const adapted = adapt(action);
  const out = action === "author" ? path.join(base, `author-export-${attempt}`)
    : action === "run" ? nativeDir : auditDir;
  assert(!fs.existsSync(out), "Never overwrite historical evidence");
  if (action !== "author") {
    const authored = read(authorPath);
    assert.equal(authored.status, "PASS"); assert.equal(authored.scope, authorScope);
    assert(authored.finishedAt && !authored.cleanupError);
    assert.equal(authored.steps.length, 5); assert(authored.steps.every(s => s.status === "PASS"));
    assert.equal(authored.installation.sha256, sha(installation));
    assert.equal(authored.cartridges.length, 2);
    for (const f of authored.cartridges) assert.equal(sha(f.path), f.sha256);
  }
  const preparation = path.join(base, `old-runtime-preparation-${action}-${attempt}`);
  fs.mkdirSync(preparation);
  const executed = path.join(preparation, "executed-workflow.cjs");
  fs.writeFileSync(executed, adapted.source, { flag: "wx" });
  fs.writeFileSync(path.join(preparation, "binding.json"), JSON.stringify({
    version: config.version, action, attempt, authorAttempt, out,
    adapter: describe(__filename), candidateConfig: describe(configFile), installation: describe(installation),
    prerequisite: describe(prerequisite), historicalPlayer: old,
    original: describe(adapted.file), executed: describe(executed), adaptations: adapted.changes,
    productChanges: 0, builds: 0, modelRequests: 0,
  }, null, 2), { flag: "wx" });
  process.argv = [process.argv[0], adapted.file, attempt];
  const worker = new Module(adapted.file, module);
  worker.filename = adapted.file; worker.paths = Module._nodeModulePaths(path.dirname(adapted.file));
  worker._compile(adapted.source, adapted.file);
}
