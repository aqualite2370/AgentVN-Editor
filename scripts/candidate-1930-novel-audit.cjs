"use strict";
// QA binding only; retain the complete fresh default and floating evidence oracles.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { validateInstallation } = require("./candidate-1930-exit.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
function parseOptions(args) {
  const allowed = ["candidate-config", "installation-file", "default-root", "floating-root"];
  const options = {}, positional = [];
  for (const arg of args) {
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    if (arg === "--self-test") { assert(!options.selfTest); options.selfTest = true; continue; }
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    assert(match && allowed.includes(match[1]), "Unknown audit option");
    assert(!options[match[1]], "Duplicate audit option");
    options[match[1]] = match[2];
  }
  const current = Boolean(options["candidate-config"]);
  assert(current || allowed.slice(1).every(key => !options[key]), "Explicit candidate config required");
  if (current) for (const key of allowed) assert(options[key], `Missing ${key}`);
  if (options.selfTest) assert.equal(positional.length, 0);
  else if (require.main === module) {
    assert(["default", "floating"].includes(positional[0]));
    assert.equal(positional.length, positional[0] === "default" ? 2 : 3);
    for (const value of positional.slice(1)) assert.match(value, /^\d{2}$/);
    if (positional[0] === "default") assert.equal(positional[1], "01");
  }
  return { options, positional, current };
}
const cli = parseOptions(process.argv.slice(2));
const config = cli.current ? validateCandidateConfig(read(cli.options["candidate-config"])) : null;
const base = config?.qa || path.resolve("F:/AgentVN/QA/Editor-1.9.30-20261026-01");
const receipt = config ? path.resolve(cli.options["installation-file"]) : path.join(base, "derived-components-installation-01.json");
const version = config?.version || "1.9.30";
const qaRoot = kind => config ? path.resolve(cli.options[`${kind}-root`]) :
  path.resolve(`F:/AgentVN/QA/Installed-Novel-${kind === "default" ? "Default" : "Floating"}-1930-20261026-01`);
if (config) {
  const child = path.relative(base, receipt);
  assert(child && !child.startsWith("..") && !path.isAbsolute(child));
  for (const kind of ["default", "floating"]) assert.equal(path.dirname(qaRoot(kind)), path.resolve("F:/AgentVN/QA"));
  assert.notEqual(qaRoot("default"), qaRoot("floating"));
}
function validateReceipt(file) {
  if (!config) return validateInstallation(file);
  assert.equal(path.resolve(file), receipt);
  const installed = read(file), actual = deriveActual(config.actual, config.version);
  for (const key of Object.keys(actual)) assert.deepEqual(installed[key], actual[key], key);
  assert.equal(installed.protectedFiles.length, 13);
  assert.equal(installed.protectedAbsent.length, 2);
  for (const item of [...installed.protectedFiles, installed.executable, ...installed.resources])
    assert.equal(sha(item.path), item.sha256, item.path);
  for (const absent of installed.protectedAbsent) assert(!fs.existsSync(absent), absent);
  return installed;
}
const filename = kind => path.join(__dirname, kind === "default"
  ? "candidate-1924-novel-audit.cjs" : "installed-novel-1922-audit.cjs");
const oracleHashes = {
  default: "2a3302d3ec63404c44d446171abdf93bd8f54e738c7dbafe253bbd75271ef525",
  floating: "1b0bc44a4a8a74d7bf0e570ef3dd3814f487c1f98f3b9b91f3675189567692af",
};
function protectedProducts(r, installed = validateReceipt(r.installation.path)) {
  assert.equal(path.resolve(r.installation.path), receipt);
  assert.equal(sha(receipt), r.installation.sha256);
  for (const key of Object.keys(installed)) assert.deepEqual(r.installation[key], installed[key], key);
  assert(Array.isArray(r.installation.protectedFiles) && r.installation.protectedFiles.length >= 3);
  return r.installation.protectedFiles;
}
function build(kind, original) {
  assert(["default", "floating"].includes(kind));
  const result = { source: original, changes: [] };
  function one(before, after, reason) {
    assert.equal(result.source.split(before).length - 1, 1, reason);
    result.source = result.source.replace(before, () => after); result.changes.push({ before, after, reason });
  }
  one(`const qa = "F:/AgentVN/QA/Installed-Novel-${kind === "default" ? "Default-1922" : "1922"}-20261022-01";`,
    `const qa = ${JSON.stringify(qaRoot(kind))};`, "Only fresh current-candidate evidence");
  if (kind === "default") {
    for (const before of ['assert.equal(r.version, "1.9.24")', 'assert.equal(r.version, "1.9.24")']) {
      // Two sites: keep distinct context so a changed source fails closed.
      const suffix = result.changes.some(c => c.reason === "Current validator version")
        ? ";\n    const i" : "; assert(r.finishedAt);";
      one(before + suffix, before.replace("1.9.24", version) + suffix,
        suffix.includes("const i") ? "Current audit version" : "Current validator version");
    }
    one('assert.equal(attempt, "07");', 'assert.equal(attempt, "01");', "One fresh attempt, no inherited stages");
    one('const out = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/novel-audit-01";',
      `const out = ${JSON.stringify(path.join(base, "novel-default-audit-01"))};`, "New independent output");
    one('assert.equal(i.executable.sha256, "ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143");',
      'require("./candidate-1930-novel-audit.cjs").validateReceipt(r.installation.path);',
      "Actual NSIS receipt and current Editor/backend/player hashes");
    one("return { version: i.executable.version, rawStatus: r.status };",
      "return { version: i.version, rawStatus: r.status };", "Current receipt version field");
  } else {
    one('assert.equal(r.version, "1.9.22");',
      `assert.equal(r.version, ${JSON.stringify(version)}); assert(!r.continuation, "Fresh current matrix only");`,
      "No old or continued matrix may satisfy this candidate");
    one('assert.equal(launch.executable.sha256, "189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc");',
      `assert.equal(launch.executable.sha256, ${JSON.stringify(config ? validateReceipt(receipt).executable.sha256 :
        "a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577")});`,
      "Current actual installed Editor for each launch");
    one('editorPE: "1.9.22", playerPE: "1.9.1", compiledThisRun: false',
      `editorPE: ${JSON.stringify(version)}, runtimeBinaryValidatedByReceipt: true, compiledThisRun: false`,
      "Do not copy historical Player version label");
    one('await check("both-original-qa-failures-retained-and-all-attempt-processes-cleaned",',
      'if (r.continuation) await check("both-original-qa-failures-retained-and-all-attempt-processes-cleaned",',
      "Fresh matrix does not invent old failed attempts in its new root");
    one('for (const f of [...r.tools, ...r.protectedFiles]) assert.equal(sha(f.path), f.sha256, f.path);',
      'const protectedFiles = require("./candidate-1930-novel-audit.cjs").protectedProducts(r);\n' +
      '      for (const f of [...r.tools, ...protectedFiles]) assert.equal(sha(f.path), f.sha256, f.path);',
      "Verify current nested protected files against hashed actual installation receipt");
    one('protectedFiles: r.protectedFiles.length', 'protectedFiles: protectedFiles.length',
      "Count verified nested protected products; missing evidence remains an error");
  }
  new vm.Script(Module.wrap(result.source));
  return result;
}
function compile(source, file) {
  const worker = new Module(file, module); worker.filename = file; worker.paths = Module._nodeModulePaths(__dirname);
  worker._compile(source, file); return worker.exports;
}
function validator(kind) {
  const file = filename(kind);
  if (config) assert.equal(sha(file), oracleHashes[kind], "Frozen independent audit source changed");
  const result = build(kind, fs.readFileSync(file, "utf8"));
  if (kind === "default") {
    const at = result.source.indexOf("\nconst attempt = process.argv[2];");
    assert(at > 0);
    return compile(result.source.slice(0, at) + "\nmodule.exports={validate};", file).validate;
  }
  return compile(result.source, path.join(__dirname, "__current-floating-audit.cjs")).validate;
}
module.exports = { build, validator, qaRoot, protectedProducts, validateReceipt, parseOptions };
if (require.main === module) {
  if (cli.options.selfTest) {
    validateReceipt(receipt);
    for (const kind of ["default", "floating"]) {
      assert.equal(sha(filename(kind)), oracleHashes[kind]);
      const source = fs.readFileSync(filename(kind), "utf8"), result = build(kind, source);
      assert(result.changes.length > 0);
      assert.throws(() => build(kind, source.replace("const qa =", "const changedQa =")));
      assert.equal(typeof validator(kind), "function");
    }
    for (const bad of [
      ["--unknown=true"], ["--candidate-config=a", "--candidate-config=b"],
      ["--installation-file=x"], ["--self-test", "default"],
    ]) assert.throws(() => parseOptions(bad));
    console.log(JSON.stringify({ status: "PASS", version, frozenOracles: 2, sourceDriftRejected: 2,
      invalidOptionsRejected: 4, launches: 0, realModelRequests: 0 }));
    return;
  }
  const [kind, attempt, auditAttempt] = cli.positional;
  validateReceipt(receipt);
  process.argv = [process.argv[0], __filename, attempt, ...(auditAttempt ? [auditAttempt] : [])];
  assert.equal(process.argv[2], "01");
  const file = filename(kind);
  if (config) assert.equal(sha(file), oracleHashes[kind]);
  const result = build(kind, fs.readFileSync(file, "utf8"));
  const raw = JSON.parse(fs.readFileSync(path.join(qaRoot(kind), "session-01/report.json"), "utf8"));
  assert.equal(path.resolve(raw.installation.path), receipt);
  validateReceipt(raw.installation.path);
  if (kind === "floating") {
    assert.match(process.argv[3] || "", /^\d{2}$/);
    assert(!fs.existsSync(path.join(qaRoot(kind), `audit-${process.argv[3]}`)));
    // This is the existing unchanged independent asynchronous audit entry.
    const ending = "if (require.main === module) run(process.argv[2], process.argv[3]);";
    assert.equal(result.source.split(ending).length - 1, 1);
    result.source = result.source.replace(ending, "run(process.argv[2], process.argv[3]);");
  }
  const suffix = kind === "floating" ? `-${process.argv[3]}` : "";
  const preparation = path.join(base, config ? "novel-preparation-01" : "editor-novel-preparation-01");
  fs.mkdirSync(preparation, { recursive: true });
  const archive = path.join(preparation, `novel-${kind}-audit${suffix}-executed.cjs`);
  fs.writeFileSync(archive, result.source, { flag: "wx" });
  fs.writeFileSync(archive + ".adaptations.json", JSON.stringify(result.changes, null, 2), { flag: "wx" });
  compile(result.source, file);
}
