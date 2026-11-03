"use strict";
// QA-only collection: preserve nonzero UIAutomator outcomes as evidence gaps,
// while continuing independent functionality. A gap can never yield PASS.
const fs = require("node:fs"), assert = require("node:assert/strict"), Module = require("node:module");
const vm = require("node:vm");
const candidateFile = require.resolve("./android-candidate-device.cjs");
function replace(s, a, b) {
  assert.equal(s.split(a).length - 1, 1, "Exact preserved collection seam required");
  return s.replace(a, () => b);
}
function enrich(source) {
  source = replace(source, '        cmd(["shell", "uiautomator", "dump", remote]);',
    `        const dump = cmd(["shell", "uiautomator", "dump", remote], false, true);
        sample.uiautomatorCommand = { exitCode: dump.status, stdout: dump.stdout, stderr: dump.stderr };
        if (dump.status !== 0) {
          (r.evidenceGaps ??= []).push({ label, kind: "UIAUTOMATOR_NONZERO_EXIT",
            ...sample.uiautomatorCommand });
        }`);
  source = replace(source, '        const xml = text(["exec-out", "cat", remote]);',
    `        const xmlRead = cmd(["exec-out", "cat", remote], false, true);
        assert.equal(xmlRead.status, 0, "Current UIAutomator XML must actually exist");
        const xml = xmlRead.stdout;
        const parsed = await client.evaluate(\`(() => {
          const d = new DOMParser().parseFromString(\${JSON.stringify(xml)}, "application/xml");
          return { valid: !d.querySelector("parsererror") && d.documentElement.tagName === "hierarchy",
            packageNodes: [...d.querySelectorAll("node")].filter(n => n.getAttribute("package") === \${JSON.stringify(pkg)}).length };
        })()\`);
        assert(parsed.valid && parsed.packageNodes > 0, "Fresh actual package hierarchy must parse");
        sample.uiautomatorParse = parsed;`);
  source = replace(source, '    r.status = r.logs.warnings.length ? "BLOCKED" : "PARTIAL_PASS";',
    `    r.status = r.logs.warnings.length || r.evidenceGaps?.length ? "BLOCKED" : "PARTIAL_PASS";
    r.uiautomatorStatus = r.evidenceGaps?.length ? "BLOCKED_NONZERO_EXIT" : "PASS";`);
  new vm.Script(Module.wrap(source)); return source;
}
function adapter() {
  let source = fs.readFileSync(candidateFile, "utf8");
  source = replace(source, '"executed-runner.cjs": runnerSource(c),',
    '"executed-runner.cjs": module.enrich(runnerSource(c)),');
  source = replace(source, 'sources: [...preserved(), desc(__filename), desc(configFile), desc(auditFile),',
    'sources: [...preserved(), desc(__filename), desc(module.captureAdapter), desc(configFile), desc(auditFile),');
  const worker = new Module(candidateFile, module); worker.filename = candidateFile; worker.paths = module.paths;
  worker.enrich = enrich; worker.captureAdapter = __filename;
  worker._compile(source, candidateFile); return worker.exports;
}
if (require.main === module) {
  const [mode, config, audit, attempt] = process.argv.slice(2);
  if (mode === "self-test") {
    const c = JSON.parse(fs.readFileSync(config, "utf8"));
    const source = require(candidateFile).runnerSource(c);
    const generated = enrich(source);
    assert.throws(() => enrich(generated));
    assert(generated.includes('r.evidenceGaps?.length ? "BLOCKED_NONZERO_EXIT" : "PASS"'));
    assert(generated.includes('assert.deepEqual(after.map'));
    assert(generated.includes('assert.deepEqual(await settings(), pref)'));
    assert(generated.includes('assertPreservedUpgradeData(args, preservationWindow, cleanup)'));
    console.log(JSON.stringify({ status: "PASS", doubleTransformRejected: true,
      savePreservationAndPreferenceAssertionsRetained: true, nonzeroExitCannotPass: true,
      productChanges: 0, deviceOperations: 0, builds: 0 }));
  } else {
    assert.equal(mode, "prepare");
    console.log(JSON.stringify(adapter().prepare(config, audit, attempt)));
  }
}
module.exports = { enrich };
