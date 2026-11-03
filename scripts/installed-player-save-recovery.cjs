"use strict";
// Bind the established six-flow real-writer recovery suite to an installed
// NSIS Player. Preserve the original runner/audit and every previous report.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { ps } = require("./lib/current-native-editor-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const locked = {
  run: ["runtime-exit-recovery-native.cjs", "fbb20fc83939f8815d71f552636f062facb583cd086fb14bc2f082038d26da11"],
  audit: ["runtime-exit-recovery-native-audit.cjs", "0a6d7f7b3e1b0480093f4926115356ccaa30821865b0d06bfdac1265ce3fd480"],
};
function bind(kind, input, c, attempt, generated) {
  let source = input;
  const changes = [], one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, `${kind}: ambiguous or missing ${before}`);
    source = source.replace(before, () => after); changes.push({ before, after });
  };
  const output = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/save-recovery-installed-${c.version}-${attempt}`);
  const scope = `ACTUAL_NSIS_${c.version.replaceAll(".", "_")}_SHIPPED_PLAYER_REAL_DISK_ACL_NOT_STANDALONE_OR_ANDROID`;
  one('`F:/AgentVN/QA/Native-Runtime-State-20261020-01/exit-recovery-20261027-${attempt}`', JSON.stringify(output));
  one('"NEW_DEV_RESOURCE_NATIVE_PLAYER_REAL_DISK_ACL_AND_CONFIRMED_EXIT_NOT_INSTALLED_OR_ANDROID"', JSON.stringify(scope));
  if (kind === "run") {
    one('const executable = delivery.players.find(p => /binaries/.test(p.path)); assert(executable);\n' +
      'for (const f of [executable, delivery.dev, ...source.artifacts]) assert.equal(sha(f.path), f.sha256, f.path);',
    `const executable = ${JSON.stringify(c.player)};\n` +
      'for (const f of [executable, ...source.artifacts]) assert.equal(sha(f.path), f.sha256, f.path);');
    one('sources: [deliveryFile, sourceFile, __filename,',
      `installation: ${JSON.stringify(c.installation)},\n  sources: [deliveryFile, sourceFile, __filename, ` +
      `${JSON.stringify(generated)}, ${JSON.stringify(path.join(path.dirname(generated), "acl.ps1"))}, ` +
      `${JSON.stringify(c.installation.actualInstallation.path)},`);
    one('await command(path.join(root, "scripts/runtime-exit-recovery-native-acl.ps1"),',
      `await command(${JSON.stringify(path.join(path.dirname(generated), "acl.ps1"))},`);
    one('"Library saves in protected physical roaming, not standalone EXE-adjacent saves or installation acceptance"',
      '"Actual NSIS shipped Player; library saves in protected physical roaming, not standalone EXE-adjacent saves"');
    one('fs.copyFileSync(__filename, path.join(out, "executed-runner.cjs"), fs.constants.COPYFILE_EXCL)',
      `fs.copyFileSync(${JSON.stringify(generated)}, path.join(out, "executed-runner.cjs"), fs.constants.COPYFILE_EXCL)`);
  } else {
    one('"NATIVE_REAL_DISK_TIMING_GATED_QA_NOT_INSTALL_STANDALONE_ANDROID"',
      '"INSTALLED_NSIS_PLAYER_REAL_DISK_TIMING_GATED_QA_NOT_STANDALONE_ANDROID"');
    one('assert.equal(r.scope, ', 'assert.equal(r.installation.installerSHA256, ' +
      `${JSON.stringify(c.installation.installerSHA256)});\n  assert.equal(r.scope, `);
  }
  new vm.Script(Module.wrap(source));
  return { source, changes, output };
}
function main() {
  const [action, configFile, attempt] = process.argv.slice(2);
  assert(["--self-test", "run", "audit"].includes(action) && configFile);
  assert.match(attempt || "", /^\d{2}$/);
  const config = read(configFile);
  assert.equal(sha(config.actualInstallation.path), config.actualInstallation.sha256);
  const actual = read(config.actualInstallation.path);
  assert.equal(actual.status, "PASS"); assert.equal(actual.exitCode, 0); assert.equal(actual.registryRestored, true);
  assert.equal(actual.installer.sha256, config.installerSHA256);
  assert.equal(sha(actual.installer.path), config.installerSHA256);
  assert.equal(sha(actual.executable.path), actual.executable.sha256);
  assert.equal(ps(`(Get-Item -LiteralPath '${actual.executable.path}').VersionInfo.ProductVersion`), config.version);
  const player = describe(path.join(actual.installRoot, "agentvn-player.exe"));
  const prep = path.join(path.dirname(configFile), `player-save-preparation-${attempt}`);
  const c = { version: config.version, player, installation: {
    ...actual, actualInstallation: config.actualInstallation, installerSHA256: config.installerSHA256 } };
  const all = {};
  for (const [kind, [name, hash]] of Object.entries(locked)) {
    const file = path.join(__dirname, name); assert.equal(sha(file), hash);
    all[kind] = bind(kind, fs.readFileSync(file, "utf8"), c, attempt, path.join(prep, "run.cjs"));
  }
  if (action === "--self-test") {
    assert(!fs.existsSync(prep)); fs.mkdirSync(prep);
    const aclFile = path.join(__dirname, "runtime-exit-recovery-native-acl.ps1");
    assert.equal(sha(aclFile), "092fe384e910df805717e7ba5aa0ae66b1ad59432230e58250961fb78c3ed09c");
    let acl = fs.readFileSync(aclFile, "utf8");
    const guard = "[IO.Path]::GetFileName($qaRun) -notmatch '^exit-recovery-20261027-\\d{2}$'";
    assert.equal(acl.split(guard).length - 1, 1);
    acl = acl.replace(guard, `[IO.Path]::GetFileName($qaRun) -cne '${path.basename(all.run.output)}'`)
      .replace(". (Join-Path $PSScriptRoot 'lib\\runtime-qa-acl.ps1')",
        `. '${path.join(__dirname, "lib/runtime-qa-acl.ps1")}'`);
    fs.writeFileSync(path.join(prep, "acl.ps1"), acl, { flag: "wx" });
    let rejected = 0;
    for (const [kind, result] of Object.entries(all)) {
      for (const change of result.changes) {
        const input = fs.readFileSync(path.join(__dirname, locked[kind][0]), "utf8");
        // Dependent replacements are tested only after their original prefix
        // is present; every preserved-source change is checked independently.
        if (input.includes(change.before)) {
          assert.throws(() => bind(kind, input.replace(change.before, ""), c, attempt, path.join(prep, "run.cjs"))); rejected++;
        }
      }
      fs.writeFileSync(path.join(prep, `${kind}.cjs`), result.source, { flag: "wx" });
    }
    const binding = { status: "PREPARED_NOT_TESTED", output: all.run.output, c, rejectedSourceDrift: rejected,
      files: [__filename, configFile, config.actualInstallation.path,
        ...Object.values(locked).map(([name]) => path.join(__dirname, name)),
        aclFile, path.join(prep, "acl.ps1"),
        path.join(prep, "run.cjs"), path.join(prep, "audit.cjs")].map(describe) };
    fs.writeFileSync(path.join(prep, "binding.json"), JSON.stringify(binding, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: "PASS", rejectedSourceDrift: rejected, nativeApps: 0, modelRequests: 0, output: binding.output }));
    return;
  }
  const binding = read(path.join(prep, "binding.json"));
  assert.deepEqual(binding.c, c);
  for (const f of binding.files) assert.equal(sha(f.path), f.sha256);
  const kind = action === "run" ? "run" : "audit";
  assert.equal(fs.readFileSync(path.join(prep, `${kind}.cjs`), "utf8"), all[kind].source);
  process.argv.splice(2, process.argv.length - 2, attempt);
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker._compile(all[kind].source, __filename);
}
if (require.main === module) main();
