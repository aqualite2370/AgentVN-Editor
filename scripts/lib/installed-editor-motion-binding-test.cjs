"use strict";
// Offline provenance/path guard only. No Editor, profile or model is started.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { motionBinding, validateMotionPreparation } = require("./installed-editor-motion-binding.cjs");
const candidate = process.env.AGENTVN_EXIT_CANDIDATE_CONFIG
  ? require("./candidate-1924-quick-adapter.cjs").quickCandidate() : null;
const version = candidate?.version || "1.9.30";
const receipt = candidate?.installation ||
  "F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json";
const args = [`--candidate=${version}`, `--installed=${receipt}`];
const binding = motionBinding(args);
assert.equal(binding.version, version);
assert.equal(binding.qa, candidate?.base || path.dirname(path.resolve(receipt)));
assert.equal(binding.installationFile, path.resolve(receipt));
assert.equal(motionBinding([]), undefined);
const rejects = [
  ["missing receipt", [`--candidate=${version}`]],
  ["unknown candidate", ["--candidate=1.9.31", `--installed=${receipt}`]],
  ["duplicate candidate", [...args, `--candidate=${version}`]],
  ["duplicate receipt", [...args, `--installed=${receipt}`]],
  ["other receipt", [`--candidate=${version}`, "--installed=D:/AgentVN/installation.json"]],
];
for (const [, input] of rejects) assert.throws(() => motionBinding(input));
const install = JSON.parse(fs.readFileSync(receipt, "utf8"));
const prep = {
  candidateVersion: version, installationFile: receipt,
  run: path.join(binding.qa, "editor-motion-01"),
  launch: { executable: install.executable.path, executableSha256: install.executable.sha256 },
};
assert.equal(validateMotionPreparation(prep), true);
const invalid = [
  ["missing version", p => delete p.candidateVersion],
  ["other version", p => p.candidateVersion = "1.9.29"],
  ["other receipt", p => p.installationFile = "D:/AgentVN/installation.json"],
  ["workspace output", p => p.run = "D:/AgentVN/output"],
  ["nested output", p => p.run = path.join(binding.qa, "extra/editor-motion-01")],
  ["escaping output", p => p.run = path.join(binding.qa, "../editor-motion-01")],
  ["invalid attempt", p => p.run = path.join(binding.qa, "editor-motion-1")],
  ["wrong binary", p => p.launch.executable = "D:/AgentVN/AgentVN Dev.exe"],
  ["wrong hash", p => p.launch.executableSha256 = "0".repeat(64)],
];
for (const [, mutate] of invalid) {
  const bad = structuredClone(prep); mutate(bad);
  assert.throws(() => validateMotionPreparation(bad));
}
// Exercise the collector's actual preflight as well: a receipt in a
// preparation folder must not silently redefine the allowed session root.
const collectorFile = path.resolve(__dirname, "../native-editor-motion-playwright.cjs");
const collector = fs.readFileSync(collectorFile, "utf8");
const stop = collector.indexOf('const destination = path.join(run, "motion");'); assert(stop > 0);
const preflight = new (require("node:vm").Script)(collector.slice(0, stop), { filename: collectorFile });
const localRequire = require("node:module").createRequire(collectorFile);
function collectPreparation(value) {
  const input = "__qa_motion_preparation_readonly__";
  const readOnlyFs = Object.create(fs);
  readOnlyFs.readFileSync = (file, ...args) => file === input ? JSON.stringify(value) : fs.readFileSync(file, ...args);
  preflight.runInNewContext({ process: { argv: ["node", collectorFile, input] },
    require: id => id === "node:fs" ? readOnlyFs : localRequire(id) });
}
const collectorPrep = { ...prep, scope: "CURRENT_INSTALLED_RELEASE_EDITOR_MOTION_NOT_RUNTIME_OR_PHYSICAL",
  fixture: { input: "__not_opened__" } };
collectPreparation(collectorPrep);
for (const [, mutate] of invalid) {
  const wrong = structuredClone(collectorPrep); mutate(wrong);
  assert.throws(() => collectPreparation(wrong));
}
// Historical report is an in-memory oracle fixture, never current installation evidence.
const { validateTerminal } = require("../installed-editor-motion-1922-audit.cjs");
const historicalRoot = "F:/AgentVN/QA/Installed-Editor-Motion-20261021-01/editor-13";
const owner = JSON.parse(fs.readFileSync(path.join(historicalRoot, "report.json")));
const raw = JSON.parse(fs.readFileSync(path.join(historicalRoot, "motion/report.json")));
Object.assign(owner, { candidateVersion: version, smoke: false,
  deviceOperations: 0, protectedUnchanged: true });
validateTerminal(owner, raw, version);
assert.throws(() => validateTerminal(owner, raw));
const incomplete = [
  ["empty matrix", (s, r) => r.matrix = []],
  ["partial matrix", (s, r) => r.matrix.pop()],
  ["no episodes", (s, r) => r.matrix[0].episodes = []],
  ["no frames", (s, r) => r.matrix[0].episodes[0].trace.frames = 0],
  ["wrong rail width", (s, r) => r.matrix[0].nodeWidthCheck.actual = 999],
  ["paid call", s => s.modelRequests = 1],
  ["wrong candidate", s => s.candidateVersion = "1.9.25"],
  ["smoke substituted", s => s.smoke = true],
  ["unfinished cleanup", s => s.cacheRestored = false],
  ["residual process", s => s.cleanupError = "residual process"],
  ["no protected check", s => s.protectedUnchanged = false],
];
for (const [, mutate] of incomplete) {
  const s = structuredClone(owner), r = structuredClone(raw); mutate(s, r);
  assert.throws(() => validateTerminal(s, r, version));
}
console.log(JSON.stringify({ status: "PASS", rejected: [...rejects, ...invalid].map(x => x[0]),
  invalidTerminalEvidence: incomplete.map(x => x[0]), fixtureOnly: true,
  candidate: version, actualCollectorPreflight: "PASS",
  collectorRejections: invalid.length, launches: 0, profileChanges: 0, modelRequests: 0 }));
