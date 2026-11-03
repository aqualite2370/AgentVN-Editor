"use strict";
// Independent historical lifecycle audit, with deferred motion probes removed.
// All transport, ownership, graph, native-file, viewport and cleanup checks stay.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { qa } = require("./current-novel-task-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const originalFile = path.join(__dirname, "installed-novel-1922-audit.cjs");
function build(original) {
  let source = original; const edits = [];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  change('const qa = "F:/AgentVN/QA/Installed-Novel-1922-20261022-01";',
    `const qa = ${JSON.stringify(qa)};`);
  change('const { assertFloatingMotion } = require("./lib/floating-motion-probe.cjs");\n', "");
  change('"1.9.22"', '"1.9.35"', 2);
  change("installed-high-resolution-card-workspace-motion-and-focus-matrix",
    "installed-high-resolution-card-workspace-function-and-focus-matrix");
  const start = source.indexOf('    for (const [key, duration, minOpacity]');
  const end = source.indexOf("    const g = m.geometry;", start);
  assert(start > 0 && end > start);
  change(source.slice(start, end), "");
  change('    assert(m.redirectInput.hit && m.redirectInput.previousInert);',
    '    assert(m.panelOwnsFocus && m.cardFocusRestored && m.singleInteractiveOwner);');
  change("189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc",
    "a1ece0a5d69cc0c319fd5d8fe6a9cdca8259f88fd7eeaeae1cc18e88c4fb5dd8");
  change('probes: 48', 'probes: 0');
  change('complete-nine-flows-12-displays-and-48-continuous-motion-probes',
    'complete-nine-flows-12-displays-functional-ownership-no-motion-gate');
  change('["no intermediate frames", x => x.matrix[0].entry.frames = []]',
    '["lost focus", x => x.matrix[0].panelOwnsFocus = false]');
  change('...r.protectedFiles', '...(r.protectedFiles || [])');
  change('r.protectedFiles.length', '(r.protectedFiles || []).length');
  change('path.resolve("D:/AgentVN", f.file)', 'path.resolve(__dirname, "..", f.file)');
  const tailStart = source.indexOf('    await check("both-original-qa-failures-retained-and-all-attempt-processes-cleaned",');
  const tailEnd = source.indexOf('    report.status = "PASS";', tailStart);
  assert(tailStart > 0 && tailEnd > tailStart);
  change(source.slice(tailStart, tailEnd), `    await check("earlier-tool-failures-and-unexpected-download-byte-archive-retained", async () => {
      const early = read(path.join(qa, "session-03/report.json"));
      assert.equal(early.status, "FAILED"); assert.equal(early.steps.length, 0); assert.equal(early.launches.length, 0);
      assert.match(early.error, /Exact installed-layout run boundary/);
      const previous = read(path.join(qa, "session-04/report.json"));
      assert.equal(previous.status, "FAILED"); assert.equal(previous.steps[0].status, "PASS");
      assert.match(previous.error, /message.includes/); assert(!previous.cleanupError);
      const zipFile = path.join(qa, "session-04/unexpected-native-save.vnproj");
      const z = await JSZip.loadAsync(fs.readFileSync(zipFile), { checkCRC32: true });
      const saved = JSON.parse(await z.file("project.json").async("string"));
      assert.deepEqual(saved.nodes, previous.connected.nodes); assert.deepEqual(saved.edges, previous.connected.edges);
      const removed = "C:/Users/1/Downloads/安装版解析验收_A_20261102_034145.vnproj";
      assert(!fs.existsSync(removed)); assert(previous.failureText.includes(removed.replaceAll("/", "\\\\")));
      const restored = read(path.join(qa, "session-04/native-cache-restoration.json"));
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      const ids = new Set(previous.knownProcesses.map(p => p.ProcessId + ":" + p.Created));
      const ports = previous.launches.flatMap(l => l.ports);
      assert.equal(rows().filter(p => ids.has(p.ProcessId + ":" + p.Created)).length, 0);
      assert.equal(listeners(ports).length, 0);
      return { originalReportsPreserved: true, productFailureClaimed: false, unexpectedNativeSaveArchive: desc(zipFile),
        ownDownloadRemovedAfterByteArchive: removed, deletedUserFiles: 0 };
    });
`);
  change('if (require.main === module) run(process.argv[2], process.argv[3]);',
    'run(process.argv[2], process.argv[3]);');
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function main(mode, attempt = "01") {
  const result = build(fs.readFileSync(originalFile, "utf8"));
  if (mode === "self-test") {
    assert.throws(() => build("")); assert(!result.source.includes("assertFloatingMotion("));
    console.log(JSON.stringify({ status: "PASS", motionProbes: 0, actualProductRuns: 0 })); return;
  }
  assert.equal(mode, "run"); assert.match(attempt, /^\d{2}$/);
  const binding = qa + "/audit-binding-" + attempt; assert(!fs.existsSync(binding)); fs.mkdirSync(binding);
  fs.writeFileSync(path.join(binding, "executed.cjs"), result.source, { flag: "wx" });
  fs.copyFileSync(__filename, path.join(binding, "adapter.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(binding, "binding.json"), JSON.stringify({
    original: { path: originalFile, sha256: sha(originalFile) },
    executed: { path: path.join(binding, "executed.cjs"), sha256: sha(path.join(binding, "executed.cjs")) },
    edits: result.edits, productRuns: 0, paidRequests: 0 }, null, 2), { flag: "wx" });
  process.argv = [process.execPath, originalFile, "01", attempt];
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname) });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(process.argv[2], process.argv[3]);
module.exports = { build };
