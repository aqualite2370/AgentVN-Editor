"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const common = [
  ['require("./installed-windows-native-ui-current-audit.cjs")', 'require("./candidate-1924-windows-native-audit.cjs")', 1],
  ['nativeUI ? "1.9.22" : "1.9.16"', 'nativeUI ? "1.9.24" : "1.9.16"', null],
  ['"setup-payload-audit-02/report.json"', '"setup-payload-audit-04/report.json"', 1],
];
const specs = {
  run: {
    file: "installed-windows-setup-current.cjs",
    hash: "875e71718ea3e28b5cc6d5c2129a22132a254314b2a0e151e11120ee6c113235",
    args: ["18", "--native-ui", "--native-close"],
    replacements: [
      ...common.map(([a, b, n]) => [a, b, n ?? 2]),
      ['require("./lib/windows-portable-current-evidence.cjs")', 'require("./lib/windows-1924-portable-evidence.cjs")', 1],
      ['"editor-03/report.json"', '"editor-05/report.json"', 1],
      ['"native-ui-audit-02/report.json"', '"native-ui-audit-04/report.json"', 1],
      ['"runtime-10/report.json"', '"runtime-16/report.json"', 1],
      ['nativeUI ? "QA_WINDOWS_NATIVE" : "QA_WINDOWS_SAVE"', 'nativeUI ? "QA_WINDOWS_UPGRADE_NEW" : "QA_WINDOWS_SAVE"', 1],
      ['"windows-setup-session.ps1"', '"candidate-1924-windows-setup-session.ps1"', 7],
      ['["installed-windows-setup-current.cjs",', '["candidate-1924-windows-setup.cjs",', 1],
    ],
  },
  audit: {
    file: "installed-windows-setup-current-audit.cjs",
    hash: "e8f72f50f005d0781c54acfd2461d044b8334871ca62b0d917d0ca8ebe9e173c",
    args: ["18", "04", "--native-ui"],
    replacements: [
      ...common.map(([a, b, n]) => [a, b, n ?? 1]),
      ['require("./lib/windows-setup-current-evidence.cjs")', 'require("./lib/windows-1924-setup-evidence.cjs")', 1],
    ],
  },
};
function adapt(name) {
  const spec = specs[name]; assert(spec); const file = path.join(__dirname, spec.file);
  assert.equal(sha(file), spec.hash); let source = fs.readFileSync(file, "utf8");
  const changes = spec.replacements.map(([before, after, count]) => {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.split(before).join(after); return { before, after, count };
  });
  new vm.Script(Module.wrap(source), { filename: __filename }); return { source, changes, spec };
}
if (process.argv[2] === "--self-test") {
  const { validateSetupEvidence } = require("./lib/windows-1924-setup-evidence.cjs");
  const baseline = JSON.parse(fs.readFileSync(
    "F:/AgentVN/QA/Windows-Package-20261021-01/runtime-12/report.json", "utf8"));
  validateSetupEvidence(baseline, { editorVersion: "1.9.22" });
  const candidate = structuredClone(baseline); candidate.editorVersion = "1.9.24";
  candidate.gameId = "qa_windows_pkg_20261021_01";
  candidate.source.path = "F:/AgentVN/QA/Windows-Package-20261021-01/editor-05/report.json";
  candidate.sourceAudit.path = "F:/AgentVN/QA/Windows-Package-20261021-01/native-ui-audit-04/report.json";
  candidate.payload.path = "F:/AgentVN/QA/Windows-Package-20261021-01/setup-payload-audit-04/report.json";
  validateSetupEvidence(candidate, { editorVersion: "1.9.24" });
  const mutations = [
    x => x.source.path = baseline.source.path, x => x.sourceAudit.path = baseline.sourceAudit.path,
    x => x.payload.path = baseline.payload.path, x => x.gameId = baseline.gameId,
    x => x.checks.pop(), x => x.setupCleanup = false, x => x.profilesRestored = false,
    x => x.launches[0].storage.portable = false, x => x.checks[2].result.loaded.pop(),
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(candidate); mutate(bad);
    assert.throws(() => validateSetupEvidence(bad, { editorVersion: "1.9.24" }));
  }
  console.log(JSON.stringify({ status: "PASS", scope: "SYNTHETIC_VALIDATOR_AND_EXACT_ADAPTATION_ONLY",
    adaptations: Object.fromEntries(Object.keys(specs).map(n => [n, adapt(n).changes.length])),
    rejectedEvidenceVariants: mutations.length, productLaunches: 0 }));
} else {
  const name = process.argv[2], adapted = adapt(name);
  fs.writeFileSync(`F:/AgentVN/QA/Windows-Package-20261021-01/candidate-1924-setup-${name}-${adapted.spec.args[0]}-adaptations.json`,
    JSON.stringify({ source: adapted.spec.file, sha256: adapted.spec.hash, changes: adapted.changes }, null, 2),
    { flag: "wx" });
  process.argv = [process.argv[0], __filename, ...adapted.spec.args];
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker._compile(adapted.source, __filename);
}
