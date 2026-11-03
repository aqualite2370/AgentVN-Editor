"use strict";
// Full existing eleven-type replacement authoring and ten-type active Player
// consumption, rebound to the actual frozen installation rather than an older
// executable with the same version string. No product or original-test edits.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const vm = require("node:vm"), assert = require("node:assert/strict");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { receipt } = require("./current-novel-task-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Assets-Frozen-1.9.35-20261102-01";
const checkpointRoot = "F:/AgentVN/Checkpoints/Assets-Frozen-1.9.35-20261102-01";
const playerOut = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/installed-assets-frozen-01";
const helper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const fixtureFile = "D:/AgentVN/output/installed-assets-20261018-01/fixtures.json";
const installed = descriptor(), read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const candidate = { current: true, qaRoot: qa, checkpointRoot, fixtureFile,
  editor: { version: "1.9.35", sha256: installed.executable.sha256 },
  player: { sha256: installed.resources.find(r => path.basename(r.path) === "agentvn-player.exe").sha256, multiframeVideo: true },
  installationFile: receipt, protectedSourceFile: qa + "/protected-installation.json" };
const originals = { editor: "installed-assets-current.cjs", player: "installed-assets-current-player.cjs" };
function build(mode) {
  const filename = path.join(__dirname, originals[mode]); let source = fs.readFileSync(filename, "utf8"); const edits = [];
  function change(before, after) {
    assert.equal(source.split(before).length - 1, 1, "Exact QA adaptation required: " + before);
    source = source.replace(before, () => after); edits.push({ before, after });
  }
  change('require("./lib/installed-assets-candidate.cjs")', 'module.qaCandidate');
  if (mode === "editor") {
    change('page.locator(".recent-project-open:not(:disabled):visible")',
      'page.locator(\'[data-help-key="home.recentProject"]:not(:disabled):visible\')');
    change('    ...(candidate.current ? ["-CodexCacheView"] : [])],',
      '    "-AllowedRunRoot", qa, ...(candidate.current ? ["-CodexCacheView"] : [])],');
    change('{ encoding: "utf8", windowsHide: true, timeout: 45000 });',
      '{ encoding: "utf8", windowsHide: true, timeout: 45000,\n' +
      '    env: { ...process.env, AGENTVN_INSTALLED_GUI_QA_ROOT: qa } });');
  } else {
    change('const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-assets-${videoMode ? "video-" : ""}current-${attempt}`);',
      `const out = ${JSON.stringify(playerOut)};`);
    change('const checkpoint = `F:/AgentVN/Checkpoints/Installed-Assets-20261021-01/${videoMode ? "video-" : ""}player-${attempt}`;',
      `const checkpoint = ${JSON.stringify(checkpointRoot + "/player-01")};`);
    change('assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint);',
      'assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint,{recursive:true});');
    change('path.join(root, "scripts/native-dev-preview-profile.ps1")', JSON.stringify(helper));
    change('"-Action", action, "-RunDirectory", out],', '"-Action", action, "-RunDirectory", out, "-CodexCacheView"],');
    change('page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\\.localhost|^tauri:/.test(p.url())), "Player page");',
      'page = await require("./lib/wait-native-runtime-page.cjs").waitNativeRuntimePage(browser);');
    change('    AGENTVN_TEST_PROJECT: source.portable.path, AGENTVN_WORKSPACE_OUTPUT: out });',
      '    AGENTVN_TEST_PROJECT: source.portable.path, AGENTVN_WORKSPACE_OUTPUT: out,\n' +
      '    TEMP:path.join(out,"temporary"),TMP:path.join(out,"temporary") });\n  fs.mkdirSync(env.TEMP);');
    // A missing decoded frame or broken audio pipeline is a functional failure,
    // not motion polish. Preserve it once rather than repeat it twelve times.
    change('    save(); console.log(`${currentCase.status} ${m.width}/${m.dpr}/${m.reduced}: ten replaced media; videoTime=${currentCase.video.map(v => v.time).join(",")}`);',
      '    save(); console.log(`${currentCase.status} ${m.width}/${m.dpr}/${m.reduced}: ten replaced media; videoTime=${currentCase.video.map(v => v.time).join(",")}`);\n' +
      '    assert.equal(currentCase.status,"PASS","Preserve first functional media failure without replay");');
  }
  new vm.Script(Module.wrap(source));
  return { filename, source, edits };
}
function audit() {
  const authorFile = path.join(qa, "editor-01/report.json"), consumerFile = path.join(playerOut, "report.json");
  const author = read(authorFile), consumer = read(consumerFile);
  const business = require("./lib/installed-assets-evidence.cjs").validate(author, candidate.editor);
  const media = require("./lib/installed-assets-player-evidence.cjs").validate(consumer, candidate.player);
  for (const f of [author.installation, author.fixture, author.portable, author.cartridge, consumer.source,
    consumer.executable, consumer.cartridge, ...author.protectedFiles]) assert.equal(sha(f.path), f.sha256);
  assert.equal(consumer.cartridge.sha256, author.cartridge.sha256);
  for (const r of [author, consumer]) for (const s of r.screenshots) {
    const bytes = fs.readFileSync(s.path);
    assert.equal(sha(s.path), s.sha256);
    assert.equal(bytes.readUInt32BE(16), Math.round(s.before.width * s.before.dpr));
    assert.equal(bytes.readUInt32BE(20), Math.round(s.before.height * s.before.dpr));
    assert.deepEqual(s.before, s.after);
  }
  const owned = [...author.knownProcesses, ...consumer.knownProcesses];
  const current = rows(); assert(!current.some(n => owned.some(p => p.ProcessId === n.ProcessId && p.Created === n.Created)));
  const ports = [...author.launches.flatMap(l => l.ports), ...consumer.launches.map(l => l.port)];
  assert.equal(listeners(ports).length, 0);
  assert.equal(read(author.cacheRestoration.path).status, "PASS"); assert.equal(read(consumer.profileRestoration.path).status, "PASS");
  for (const mode of ["editor", "player"]) {
    const binding = read(path.join(qa, mode + "-binding.json"));
    for (const k of ["adapter", "original", "executed", "installation", "profileHelper", "fixture"])
      assert.equal(sha(binding[k].path), binding[k].sha256);
    assert.equal(fs.readFileSync(binding.executed.path, "utf8"), build(mode).source);
  }
  const result = { status: "PASS", at: new Date().toISOString(), author: desc(authorFile), consumer: desc(consumerFile),
    business, media, ownedIdentities: owned.length, ports: ports.length,
    screenshots: author.screenshots.length + consumer.screenshots.length,
    boundary: "Animation JSON portable preservation only; dedicated export/runtime consumption remains undefined",
    productChanges: 0, modelRequests: 0, builds: 0 };
  fs.writeFileSync(path.join(qa, "audit-01.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify(result));
}
function main() {
  const mode = process.argv[2]; assert(["self-test", "editor", "player", "audit"].includes(mode));
  assert.deepEqual(read(receipt).executable, installed.executable);
  const fixture = read(fixtureFile); assert.equal(sha(fixture.input), fixture.inputSha256);
  for (const r of fixture.types) for (const f of Object.values(r.files)) assert.equal(sha(f.path), f.sha256);
  if (mode === "audit") return audit();
  if (mode === "self-test") {
    for (const k of ["editor", "player"]) {
      const b = build(k); let reversed = b.source;
      for (const e of [...b.edits].reverse()) reversed = reversed.replace(e.after, () => e.before);
      assert.equal(reversed, fs.readFileSync(b.filename, "utf8"));
    }
    console.log(JSON.stringify({ status: "PASS", editor: candidate.editor, player: candidate.player,
      fixtureTypes: fixture.types.length, nativeStarts: 0 })); return;
  }
  assert(!rows().some(p => /^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  if (mode === "editor") {
    assert(!fs.existsSync(qa)); fs.mkdirSync(qa);
    const actual = read(installed.actualInstallation.path);
    assert.equal(sha(actual.installer.path), actual.installer.sha256);
    fs.writeFileSync(candidate.protectedSourceFile, JSON.stringify({ ...installed, package: actual.installer }, null, 2), { flag: "wx" });
  }
  const b = build(mode), executed = path.join(qa, mode + "-executed.cjs");
  fs.writeFileSync(executed, b.source, { flag: "wx" });
  fs.writeFileSync(path.join(qa, mode + "-binding.json"), JSON.stringify({ adapter: desc(__filename), original: desc(b.filename),
    executed: desc(executed), installation: desc(receipt), profileHelper: desc(helper), fixture: desc(fixtureFile),
    candidate, edits: b.edits, productChanges: 0, modelRequests: 0 }, null, 2), { flag: "wx" });
  const worker = new Module(b.filename, module);
  Object.assign(worker, { filename: b.filename, paths: Module._nodeModulePaths(__dirname), qaCandidate: candidate });
  process.argv.splice(2, process.argv.length - 2, ...mode === "player" ? ["01", "01"] : ["01"]);
  worker._compile(b.source, b.filename);
}
if (require.main === module) main();
