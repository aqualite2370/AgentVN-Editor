"use strict";
// Continue the recorded clone failure; never discard or restore the source VM.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const cli = "C:/Program Files/Oracle/VirtualBox/VBoxManage.exe";
const source = "9215edc0-b3a5-43fe-80bf-888b3b1ef97e";
const clone = "bb73ce25-e07d-4810-926f-e8a88da40527";
const cloneRoot = path.resolve("F:/WinENV/AgentVN-QA/AgentVN-Full-Regression-20261017-01");
const [priorArg, outArg] = process.argv.slice(2);
assert(priorArg && outArg, "Pass failed clone report and fresh continuation directory");
const previous = JSON.parse(fs.readFileSync(path.resolve(priorArg), "utf8"));
assert.equal(previous.status, "FAILED");
assert.equal(previous.source, source);
assert(previous.commands.some(c => c.args[0] === "clonevm" && c.exitCode === 0));
const out = path.resolve(outArg);
assert(!fs.existsSync(out), "Keep every prior attempt");
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", previous: path.resolve(priorArg), source, clone,
  startedAt: new Date().toISOString(), commands: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function run(args) {
  const result = spawnSync(cli, args, { encoding: "utf8", windowsHide: true, timeout: 60000 });
  report.commands.push({ args, exitCode: result.status, stdout: result.stdout, stderr: result.stderr,
    error: result.error ? String(result.error) : null }); save();
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout;
}
function field(text, key) {
  const raw = text.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1];
  assert(raw, `Missing ${key}`);
  // VBox's VMStateFile uses unescaped backslashes unlike CfgFile.
  return key === "VMStateFile" ? raw.slice(1, -1) : JSON.parse(raw);
}
async function hash(file) {
  const digest = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
(async () => {
  const original = run(["showvminfo", source, "--machinereadable"]);
  assert.equal(field(original, "VMState"), "saved");
  const sourceConfig = field(original, "CfgFile"), sourceState = field(original, "VMStateFile");
  report.original = { config: sourceConfig, configSha256: await hash(sourceConfig),
    state: sourceState, stateSha256: await hash(sourceState) };
  if (report.original.configSha256 !== previous.originalConfig.sha256) {
    // VBox 7.2 serializes older config XML on clone registration. Do not rewrite
    // the source to force a hash match: require the prior byte copy plus semantic equality.
    const prev = sourceConfig + "-prev";
    assert.equal(await hash(prev), previous.originalConfig.sha256);
    const script = `
      function Get-Canonical($n) {
        $a = @($n.Attributes | ForEach-Object { $_.Name + "=" + $_.Value } | Sort-Object) -join "|"
        $c = @($n.ChildNodes | Where-Object { $_.NodeType -eq "Element" } | ForEach-Object { Get-Canonical $_ } | Sort-Object) -join ""
        $t = @($n.ChildNodes | Where-Object { $_.NodeType -eq "Text" -or $_.NodeType -eq "CDATA" } | ForEach-Object { $_.Value }) -join ""
        return ("<" + $n.Name + "[" + $a + "]>" + $c + $t + "</" + $n.Name + ">")
      }
      [xml]$a = Get-Content -LiteralPath '${prev.replaceAll("'", "''")}' -Raw
      [xml]$b = Get-Content -LiteralPath '${sourceConfig.replaceAll("'", "''")}' -Raw
      if ((Get-Canonical $a.DocumentElement) -cne (Get-Canonical $b.DocumentElement)) { throw "Source XML settings changed" }
      "PASS: identical XML elements, attributes and values; comments and sibling ordering differ"
    `;
    const check = spawnSync("powershell.exe", ["-NoProfile", "-Command", script],
      { encoding: "utf8", windowsHide: true });
    report.sourceSerialization = { previous: prev, previousSha256: await hash(prev),
      exitCode: check.status, stdout: check.stdout, stderr: check.stderr };
    save();
    assert.equal(check.status, 0, check.stderr);
    fs.copyFileSync(prev, path.join(out, "source-before-clone.vbox"), fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(sourceConfig, path.join(out, "source-after-clone.vbox"), fs.constants.COPYFILE_EXCL);
  }
  const before = run(["showvminfo", clone, "--machinereadable"]);
  assert.equal(field(before, "UUID"), clone);
  assert.equal(path.dirname(path.resolve(field(before, "CfgFile"))), cloneRoot);
  assert.equal(field(before, "VMState"), "saved");
  const cloneState = path.resolve(field(before, "VMStateFile"));
  assert(cloneState.startsWith(cloneRoot + path.sep));
  assert.notEqual(cloneState.toLowerCase(), path.resolve(sourceState).toLowerCase());
  assert(!fs.lstatSync(cloneState).isSymbolicLink());
  const recovery = path.join(cloneRoot, "qa-saved-state-recovery-20261017");
  assert(!fs.existsSync(recovery), "Do not overwrite recovery");
  fs.mkdirSync(recovery);
  const backup = path.join(recovery, path.basename(cloneState));
  fs.copyFileSync(cloneState, backup, fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(field(before, "CfgFile"), path.join(recovery, "before.vbox"), fs.constants.COPYFILE_EXCL);
  report.cloneRecovery = { path: backup, sha256: await hash(backup), bytes: fs.statSync(backup).size };
  assert.equal(report.cloneRecovery.sha256, await hash(cloneState));
  save();
  run(["discardstate", clone]);
  const mutable = run(["showvminfo", clone, "--machinereadable"]);
  for (const match of mutable.matchAll(/^SharedFolderNameGlobalMapping\d+="([^"]+)"$/gm))
    run(["sharedfolder", "remove", clone, `--name=${match[1]}`]);
  const after = run(["showvminfo", clone, "--machinereadable"]);
  assert.equal(field(after, "VMState"), "poweroff");
  assert(!/^SharedFolderPath/gm.test(after));
  assert.equal(await hash(sourceConfig), report.original.configSha256);
  assert.equal(await hash(sourceState), report.original.stateSha256);
  assert.equal(field(run(["showvminfo", source, "--machinereadable"]), "VMState"), "saved");
  report.originalUnchangedDuringContinuation = true;
  report.scope = "TINY11_CLONE_PREPARATION_ONLY_NOT_INSTALLATION_OR_FEATURE_ACCEPTANCE";
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
