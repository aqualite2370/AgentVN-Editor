"use strict";
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const vm = require("node:vm"), assert = require("node:assert/strict");
const { receipt } = require("./current-novel-task-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { qa } = require("./current-assistant-batch-review.cjs");
const originalFile = path.join(__dirname, "installed-assistant-export-player-current.cjs");
const out = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/assistant-batch-consumer-01";
const helper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function build(original) {
  let source = original; const edits = [];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  function region(start, end, replacement) {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    assert(a > 0 && b > a); change(source.slice(a, b), replacement);
  }
  region("const currentCandidate = process.argv.includes", "const read = f =>",
    `const currentCandidate = true, expectedVersion = "1.9.35";
const qa = ${JSON.stringify(qa)}, root = path.resolve(__dirname, "..");
const out = ${JSON.stringify(out)}; assert(!fs.existsSync(out)); fs.mkdirSync(out);
`);
  change('path.join(qa, `editor-${editorAttempt}/report.json`)', 'path.join(qa, "session-03/report.json")');
  region("const installationFile = currentCandidate ?", "const installation = read(installationFile);",
    `const installationFile = ${JSON.stringify(receipt)};\n`);
  change('"scripts/native-dev-preview-profile.ps1"', JSON.stringify(helper), 2);
  change(`path.join(root, ${JSON.stringify(helper)})`, JSON.stringify(helper));
  change('"-Action", action, "-RunDirectory", out]', '"-Action", action, "-RunDirectory", out, "-CodexCacheView"]');
  change('scope: "ACTUAL_NSIS_INSTALLED_PLAYER_UI_EXPORTED_ASSISTANT_COMPONENTS_PREVIEW_MODE",',
    'scope: "ACTUAL_1935_INSTALLED_PLAYER_BATCH_COMPONENTS_AUTHORIZED_BYTES_ACTIONS_NOT_REAL_MODEL", qaBinding: module.qaBinding,');
  change('    ps(`$owned=Get-CimInstance Win32_Process -Filter \'ProcessId=${p.ProcessId}\';` +\n' +
    '      `if($owned -and $owned.CreationDate.ToUniversalTime().ToString(\'o\') -eq \'${p.Created}\'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);',
    '    require("./lib/owned-process-stop.cjs").stopOwnedProcess(p, ps);');
  change('page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\\.localhost|^tauri:/.test(p.url())), "Player document");',
    'page = await require("./lib/wait-native-runtime-page.cjs").waitNativeRuntimePage(browser);');
  change('    if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)\n      report.screenshots.push',
    '    report.screenshots.push');
  change('    AGENTVN_TEST_PROJECT: source.input.path, AGENTVN_WORKSPACE_OUTPUT: out });',
    '    AGENTVN_TEST_PROJECT: source.input.path, AGENTVN_WORKSPACE_OUTPUT: out,\n' +
    '    TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary") });\n  fs.mkdirSync(env.TEMP);');
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function main(mode) {
  assert(["self-test", "run"].includes(mode));
  const result = build(fs.readFileSync(originalFile, "utf8"));
  if (mode === "self-test") {
    let replay = fs.readFileSync(originalFile, "utf8");
    for (const e of result.edits) {
      assert.equal(replay.split(e.before).length - 1, e.count);
      replay = replay.replaceAll(e.before, () => e.after);
    }
    assert(replay === result.source); assert.throws(() => build(""));
    console.log(JSON.stringify({ status: "PASS", adaptations: result.edits.length, starts: 0 })); return;
  }
  const binding = path.join(qa, "player-binding.json"), executed = path.join(qa, "player-executed.cjs");
  assert(!fs.existsSync(binding)); assert(!fs.existsSync(executed));
  fs.writeFileSync(executed, result.source, { flag: "wx" });
  fs.writeFileSync(binding, JSON.stringify({ original: desc(originalFile), adapter: desc(__filename),
    executed: desc(executed), inputReport: desc(path.join(qa, "session-03/report.json")),
    helper: desc(helper), installation: desc(receipt), edits: result.edits }, null, 2), { flag: "wx" });
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname), qaBinding: desc(binding) });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(process.argv[2]);
module.exports = { out };
