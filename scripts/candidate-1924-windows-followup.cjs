"use strict";
// Reuse complete prior user flows with exact, reviewable candidate bindings.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const specs = {
  portable: {
    file: "installed-windows-portable-current.cjs",
    hash: "02e2c5168aa77c048bdc56c18e1d099098898aa7fd8d2d8f666ce38c4a184b27",
    args: ["16", "--native-ui-source=05"],
    replacements: [
      ['require("./installed-windows-native-ui-current-audit.cjs")', 'require("./candidate-1924-windows-native-audit.cjs")'],
      ['"native-ui-audit-02/report.json"', '"native-ui-audit-04/report.json"'],
      ['nativeSource ? "1.9.22" : "1.9.16"', 'nativeSource ? "1.9.24" : "1.9.16"'],
      ['nativeSource ? "QA_WINDOWS_NATIVE" : "QA_WINDOWS_SAVE"', 'nativeSource ? "QA_WINDOWS_UPGRADE_NEW" : "QA_WINDOWS_SAVE"'],
      ['command("native-portable-save-acl.ps1", action)', 'command("candidate-1924-windows-acl.ps1", action)'],
      ['path.join(__dirname, "native-portable-save-acl.ps1")', 'path.join(__dirname, "candidate-1924-windows-acl.ps1")'],
      ['path.join(__dirname, "lib/windows-portable-current-evidence.cjs")', 'path.join(__dirname, "lib/windows-1924-portable-evidence.cjs")'],
    ],
  },
  "portable-audit": {
    file: "installed-windows-portable-current-audit.cjs",
    hash: "1dd258921a89577e55171add98e3e08a5559471d30c15165d411be48985a0b8a",
    args: ["16", "03", "--native-ui"],
    replacements: [
      ['require("./lib/windows-portable-current-evidence.cjs")', 'require("./lib/windows-1924-portable-evidence.cjs")'],
      ['require("./installed-windows-native-ui-current-audit.cjs")', 'require("./candidate-1924-windows-native-audit.cjs")'],
      ['nativeUI ? "1.9.22" : "1.9.16"', 'nativeUI ? "1.9.24" : "1.9.16"'],
    ],
  },
  payload: {
    file: "windows-setup-payload-audit.cjs",
    hash: "473f1d6055158420f7b5006430d4c90ec14ad2f9701aaf60c4fea86db61b8c97",
    args: ["04", "--native-ui", "--upgrade-from-retained"],
    replacements: [
      ['upgrade ? "editor-04/report.json"', 'upgrade ? "editor-05/report.json"'],
      ['require("./installed-windows-native-ui-current-audit.cjs")', 'require("./candidate-1924-windows-native-audit.cjs")'],
      ['require("./lib/windows-game-upgrade-fixture.cjs")', 'require("./lib/windows-1924-upgrade-fixture.cjs")'],
      ['upgrade ? "native-ui-audit-03/report.json"', 'upgrade ? "native-ui-audit-04/report.json"'],
      ['upgrade ? "1.0.1" : "1.0.0"', 'upgrade ? "1.0.2" : "1.0.0"'],
    ],
  },
};
function adapt(name) {
  const spec = specs[name]; assert(spec, "Known followup only");
  const file = path.join(__dirname, spec.file); assert.equal(sha(file), spec.hash);
  let source = fs.readFileSync(file, "utf8");
  const changes = spec.replacements.map(([before, after]) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, after); return { before, after };
  });
  new vm.Script(Module.wrap(source), { filename: __filename });
  return { source, changes, spec };
}
if (process.argv[2] === "--self-test") {
  const { validatePortableEvidence } = require("./lib/windows-1924-portable-evidence.cjs");
  const historical = JSON.parse(fs.readFileSync(
    "F:/AgentVN/QA/Windows-Package-20261021-01/runtime-10/report.json", "utf8"));
  validatePortableEvidence(historical, { editorVersion: "1.9.22" });
  const candidate = structuredClone(historical); candidate.editorVersion = "1.9.24";
  candidate.sourceReport.path = "F:/AgentVN/QA/Windows-Package-20261021-01/editor-05/report.json";
  candidate.sourceAudit.path = "F:/AgentVN/QA/Windows-Package-20261021-01/native-ui-audit-04/report.json";
  validatePortableEvidence(candidate, { editorVersion: "1.9.24" });
  const mutations = [
    x => x.sourceReport.path = historical.sourceReport.path,
    x => x.sourceAudit.path = historical.sourceAudit.path,
    x => x.matrix.pop(), x => x.checks.pop(), x => x.errors.push("error"),
    x => x.acls[0].probe.accessDenied = false, x => x.profilesRestored = false,
    x => x.nativeUIBuildSource = false,
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(candidate); mutate(bad);
    assert.throws(() => validatePortableEvidence(bad, { editorVersion: "1.9.24" }));
  }
  console.log(JSON.stringify({ status: "PASS", scope: "SYNTHETIC_VALIDATOR_AND_EXACT_ADAPTATION_ONLY",
    adaptations: Object.fromEntries(Object.keys(specs).map(n => [n, adapt(n).changes.length])),
    rejectedEvidenceVariants: mutations.length, productLaunches: 0 }));
} else {
  const name = process.argv[2], adapted = adapt(name);
  const evidenceRoot = "F:/AgentVN/QA/Windows-Package-20261021-01";
  const trace = path.join(evidenceRoot, `candidate-1924-${name}-adaptations.json`);
  fs.writeFileSync(trace, JSON.stringify({ source: specs[name].file, sha256: specs[name].hash,
    changes: adapted.changes }, null, 2), { flag: "wx" });
  process.argv = [process.argv[0], __filename, ...adapted.spec.args];
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker._compile(adapted.source, __filename);
}
