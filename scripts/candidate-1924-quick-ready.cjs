"use strict";
// Apply the same actual-document prerequisite to the next native QA flow.
// Only Node-side QA source is adapted; product UI, IO and business assertions remain real.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const adapter = require("./lib/candidate-1924-quick-adapter.cjs");
const originalSessionAdapter = adapter.adaptQuickSession;
const mode = process.argv.splice(2, 1)[0];
assert(["session", "flow", "audit", "self-test"].includes(mode));
const originalFiles = {
  session: ["candidate-1924-quick-session.cjs", "2337fcfbfa5e2e117d5eb2f261a21a8ed7d2e2ddc0d9579c9682049eb173270a"],
  flow: ["candidate-1924-quick-flow.cjs", "58ac731ed3d9dbe14ba8c814213c28617f94417cad094e58c37c33a482f3d3b9"],
  audit: ["candidate-1924-quick-audit.cjs", "4da37ac2947b24cb7b02b83755af4454ec6b27a3515ed053fcc89ce1b68509b6"],
};
function exact(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, before); return source.replace(before, after);
}
function readySession(original) {
  const result = originalSessionAdapter(original);
  const before = '    this.page = this.browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(this.page);';
  const after = `    this.launch.targetReadiness = { initialURLs: this.browser.contexts().flatMap(c => c.pages()).map(p => p.url()), events: [] };
    this.save();
    this.page = await require("./wait-native-runtime-page.cjs").waitNativeRuntimePage(this.browser, {
      observe: event => { this.launch.targetReadiness.events.push({ ...event, at: new Date().toISOString() }); this.save(); }
    });
    this.launch.targetReadiness.readyURL = this.page.url();
    this.launch.targetReadiness.readyAt = new Date().toISOString(); this.save();`;
  result.source = exact(result.source, before, after);
  result.adaptations.push({ before, after, reason: "Await actual document creation/navigation before issuing native UI actions" });
  return result;
}
// Exported adapters and the actual class loader share the same implementation,
// so archived executed bytes match what the real QA process loads.
adapter.adaptQuickSession = readySession;
adapter.candidateQuickRuntime = () => {
  const file = path.join(__dirname, "lib/installed-runtime-session.cjs");
  return adapter.loadModule(readySession(fs.readFileSync(file, "utf8")).source, file);
};
if (mode === "self-test") {
  const file = path.join(__dirname, "lib/installed-runtime-session.cjs"), original = fs.readFileSync(file, "utf8");
  const result = readySession(original); let replay = original;
  for (const change of result.adaptations) replay = exact(replay, change.before, change.after);
  assert.equal(replay, result.source); assert.equal(result.adaptations.length, 3);
  new vm.Script(Module.wrap(result.source));
  assert(result.source.includes("await this.ready(\"title_menu\")"));
  assert(result.source.includes("assert.deepEqual(await this.saves(), before)"));
  for (const [name, digest] of Object.values(originalFiles)) assert.equal(sha(path.join(__dirname, name)), digest);
  assert.throws(() => readySession(original.replace("assert(this.page);", "")));
  console.log(JSON.stringify({ status: "PASS", scope: "QUICK_QA_READINESS_SOURCE_ONLY", transformations: 3 }));
} else {
  assert(mode === "flow" || process.argv[2] === "05");
  const [name, digest] = originalFiles[mode], file = path.join(__dirname, name);
  assert.equal(sha(file), digest); let source = fs.readFileSync(file, "utf8");
  if (mode === "session") {
    source = exact(source, '["scripts/candidate-1924-quick-flow.cjs", "--current-native-preparation", file]',
      '["scripts/candidate-1924-quick-ready.cjs", "flow", "--current-native-preparation", file]');
    source = exact(source, "const tools = [__filename,", 'const tools = [__filename, ' +
      '"scripts/candidate-1924-quick-session.cjs", "scripts/lib/wait-native-runtime-page.cjs",');
  } else if (mode === "audit") {
    source = exact(source, '  report.status = "PASS";', `
  group("Every actual launch waits for its unique native document before UI actions", () => {
    assert(raw.launches.length > 0);
    for (const launch of raw.launches) {
      const ready = launch.targetReadiness;
      assert(ready && ready.readyAt && ready.events.length > 0);
      assert.equal(new URL(ready.readyURL).hostname, "tauri.localhost");
      assert.equal(ready.events.at(-1).candidates, 1);
    }
    return { actualLaunches: raw.launches.length };
  });
  report.status = "PASS";`);
  }
  new vm.Script(Module.wrap(source), { filename: file });
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker._compile(source, __filename);
}
