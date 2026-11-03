"use strict";
// Reuse the five complete installed-preview flows and independent audit.
// Only candidate identity/readiness changes; historical tools remain untouched.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { ps, rows } = require("./lib/current-native-editor-session.cjs");
const candidate = process.env.AGENTVN_EXIT_CANDIDATE_CONFIG
  ? require("./lib/candidate-1924-quick-adapter.cjs").quickCandidate() : null;
const base = candidate?.base || "F:/AgentVN/QA/Editor-1.9.30-20261026-01";
const receipt = candidate?.installation || path.join(base, "derived-components-installation-01.json");
const version = candidate?.version || "1.9.30";
const entries = {
  run: ["installed-preview-current.cjs", "e6e30db3f3abfcb46ffb1215135ecfdd544f4f4daa4cf8d734eb67eb2e783883"],
  audit: ["installed-preview-current-audit.cjs", "1e313973e70a90dad9e536ee9b52afc25a2405129f97eb058b8ecc43db5f5d8a"],
};
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
function build(action, original) {
  let source = original; const changes = [];
  function replace(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.split(before).join(after); changes.push({ before, after, count });
  }
  replace('qa = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01"',
    `qa = ${JSON.stringify(base)}`);
  replace('path.join(qa, "installation.json")', JSON.stringify(receipt), action === "run" ? 2 : 1);
  if (action === "run") {
    replace('project.title = "1.9.14安装版真实预览";', `project.title = ${JSON.stringify(version + "安装版真实预览")};`);
    replace('version: "1.9.14"', `version: ${JSON.stringify(version)}`);
    replace('assert.equal(installation.executable.version, report.version);',
      'assert.equal(installation.version, report.version);');
    replace('path.resolve(qa, "installed-editor")', 'path.resolve(installation.installRoot)');
    replace('const protectedFiles = [...read(path.join(qa, "checkpoint-01/report.json")).frozen,',
      'const protectedFiles = [...installation.protectedFiles,');
    replace('playerPage = playerBrowser.contexts().flatMap(c => c.pages()).find(p => /tauri\\.localhost|^tauri:/.test(p.url())); assert(playerPage);',
      'await until(() => { playerPage = playerBrowser.contexts().flatMap(c => c.pages()).find(p => /tauri\\.localhost|^tauri:/.test(p.url())); return !!playerPage; }, "Actual external WebView application URL");');
    replace('save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
      'save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);\n' +
      '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });');
  } else {
    replace('assert.equal(run.version, "1.9.14")', `assert.equal(run.version, ${JSON.stringify(version)})`);
    replace('sha(path.resolve(__dirname, "installed-preview-current.cjs"))', 'sha(__filename)');
  }
  new vm.Script(Module.wrap(source));
  return { source, changes };
}
function original(action) {
  const [file, digest] = entries[action], target = path.join(__dirname, file);
  assert.equal(sha(target), digest, "Historical full-flow source changed");
  return fs.readFileSync(target, "utf8");
}
// The Node-spawned PowerShell must see the same physical volume and directory
// through each normal/Codex alias. Only three originals are moved by the helper.
function aliases() {
  const normal = ["Roaming/com.agentvn.player", "Local/com.agentvn.player",
    "Local/com.agentvn.editor/gamecli-preview"];
  const roots = normal.flatMap(t => ["C:/Users/1/AppData/" + t,
    "C:/Users/1/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/" + t]);
  const script = `
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PreviewDirectoryIdentity {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint mode, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint GetFinalPathNameByHandle(IntPtr handle, StringBuilder name, uint length, uint flags);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static string Resolve(string name) {
    IntPtr handle = CreateFile(name, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
    if (handle == new IntPtr(-1)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {
      var buffer = new StringBuilder(32768);
      uint length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 1);
      if (length == 0 || length >= buffer.Capacity) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      return buffer.ToString();
    } finally { CloseHandle(handle); }
  }
}
'@
$paths=@(${roots.map(r => "'" + r.replaceAll("/", "\\") + "'").join(",")})
$result=@(foreach($p in $paths) {
  if(!(Test-Path -LiteralPath $p -PathType Container)){throw "Existing directory required: $p"}
  $final=[PreviewDirectoryIdentity]::Resolve($p)
  $identity=(& fsutil.exe file queryfileid $p|Out-String)
  if($LASTEXITCODE -ne 0 -or $identity -notmatch '0x[0-9a-fA-F]+'){throw "Cannot read File ID: $p"}
  [PSCustomObject]@{path=$p;final=$final;directoryId=$Matches[0].ToLowerInvariant()}
})
$result|ConvertTo-Json -Depth 3`;
  const result = JSON.parse(ps(script)); assert.equal(result.length, 6);
  for (let i = 0; i < result.length; i += 2) {
    assert(/^\\\\\?\\Volume\{[^}]+\}\\/.test(result[i].final), "Actual volume GUID required");
    assert.equal(result[i].final.toLowerCase(), result[i + 1].final.toLowerCase());
    assert.equal(result[i].directoryId, result[i + 1].directoryId);
  }
  assert.equal(new Set(result.map(r => r.final.toLowerCase())).size, 3);
  return result;
}
function selfTest() {
  let rejected = 0;
  for (const action of Object.keys(entries)) {
    const input = original(action), result = build(action, input);
    assert(result.source.includes(JSON.stringify(receipt)));
    assert(result.source.includes(JSON.stringify(version)));
    for (const change of result.changes) {
      assert.throws(() => build(action, input.replace(change.before, ""))); rejected++;
    }
    for (const requirement of action === "run"
      ? ['assert.equal(report.steps.length, 5)', 'assert.equal(report.cases.length, 12)',
        'profile("Restore")', 'await closePlayer(port)', 'await frame.getByTestId("settings-screen").waitFor()']
      : ['assert.equal(run.cases.length, 12)', 'assert.equal(journal.records.length, 3)',
        'assert.equal(png.readUInt32BE(16), s.before.width * s.before.dpr)'])
      assert(result.source.includes(requirement), requirement);
  }
  const physical = aliases();
  console.log(JSON.stringify({ status: "PASS", candidateVersion: version, rejectedSourceDrift: rejected,
    physicalDirectories: 3, readOnlyAliases: physical, nativeApps: 0, modelRequests: 0 }));
}
function main() {
  if (process.argv[2] === "--self-test") return selfTest();
  const [action, attempt, auditAttempt] = process.argv.slice(2);
  assert(entries[action]); assert.match(attempt || "", /^\d{2}$/);
  if (!candidate) assert.equal(attempt, "04");
  if (action === "run") assert.deepEqual(process.argv.slice(4), []);
  else {
    assert.match(auditAttempt || "", /^\d{2}$/);
    assert.deepEqual(process.argv.slice(4), [auditAttempt]);
  }
  require("./candidate-1930-exit.cjs").validateInstallation(receipt);
  assert(!rows().some(p => /^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  const built = build(action, original(action));
  const prep = path.join(base, `preview-preparation-${attempt}`);
  if (action === "run") {
    assert(!fs.existsSync(prep)); fs.mkdirSync(prep);
    const identities = aliases(), executed = path.join(prep, "executed-business.cjs");
    fs.writeFileSync(executed, built.source, { flag: "wx" });
    fs.writeFileSync(path.join(prep, "binding.json"), JSON.stringify({
      original: desc(path.join(__dirname, entries.run[0])), adapter: desc(__filename),
      executed: desc(executed), changes: built.changes, installation: desc(receipt), aliases: identities,
      candidateVersion: version,
    }, null, 2), { flag: "wx" });
  } else {
    const binding = read(path.join(prep, "binding.json"));
    for (const f of [binding.original, binding.adapter, binding.executed, binding.installation])
      assert.equal(sha(f.path), f.sha256);
    assert.deepEqual(aliases(), binding.aliases);
    const run = build("run", original("run"));
    assert.deepEqual(run.changes, binding.changes);
    assert.equal(run.source, fs.readFileSync(binding.executed.path, "utf8"));
    assert.equal(run.source, fs.readFileSync(
      `F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-02/installed-${attempt}/executed-business.cjs`, "utf8"));
  }
  process.argv.splice(2, process.argv.length - 2, attempt, ...(auditAttempt ? [auditAttempt] : []));
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = built.source; worker._compile(built.source, __filename);
}
module.exports = { build };
if (require.main === module) main();
