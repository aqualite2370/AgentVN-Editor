"use strict";
// Calls the real publishing entry with --validate-only. Mutated reports are
// negative fixtures, never product evidence, and cannot build/install.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
assert(process.argv[2] && process.argv[3], "Pass completed Runtime and card gates");
const root = path.resolve(__dirname, ".."), runtimeFile = path.resolve(process.argv[2]), cardFile = path.resolve(process.argv[3]);
const card = JSON.parse(fs.readFileSync(cardFile));
assert.equal(card.status, "NOVEL_CARD_POSITION_SOURCE_AND_DEV_PASS");
const out = path.join(root, "output/novel-card-position-release-validation", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", runtimeFile, cardFile, cases: [], startedAt: new Date().toISOString() };
function check(name, file, expected, args = []) {
  const target = path.join(out, name + "-would-be-release");
  const result = spawnSync(process.execPath, [path.join(root, "scripts/installed-player-authoring-release.cjs"),
    runtimeFile, target, "--runtime-webview", "--validate-only", `--card-position-gate=${file}`, ...args],
  { cwd: root, windowsHide: true, encoding: "utf8", timeout: 30000 });
  const row = { name, expected, exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
  report.cases.push(row);
  assert.equal(fs.existsSync(target), false, "Validation must not create/build/install a release");
  assert.equal(result.status === 0, expected, `${name}: ${result.stderr || result.error}`);
  if (expected) assert.equal(JSON.parse(result.stdout).status, "RUNTIME_WEBVIEW_CARD_POSITION_RELEASE_GATE_VALIDATED_ONLY");
  row.status = "PASS";
}
function reject(name, mutate) {
  const value = structuredClone(card); mutate(value);
  const file = path.join(out, name + "-negative-fixture.json");
  fs.writeFileSync(file, JSON.stringify(value), { flag: "wx" }); check(name, file, false);
}
function rejectBrowser(name, mutate) {
  reject(name, value => {
    const row = value.steps.find(step => step.name === "card-position-browser-matrix");
    const body = JSON.parse(fs.readFileSync(row.evidence.path)); mutate(body);
    const file = path.join(out, name + "-browser-negative-fixture.json");
    fs.writeFileSync(file, JSON.stringify(body), { flag: "wx" });
    row.evidence = { ...row.evidence, path: file,
      sha256: require("node:crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex") };
  });
}
try {
  check("actual-completed-both-gates", cardFile, true);
  reject("unfinished-card-gate", value => { value.status = "RUNNING"; });
  reject("zero-steps", value => { value.steps = []; });
  reject("failed-step", value => { value.steps[0].status = "FAILED"; });
  reject("missing-native-files", value => { value.steps = value.steps.filter(row => row.name !== "native-position-files"); });
  reject("missing-browser-matrix", value => { value.steps = value.steps.filter(row => row.name !== "card-position-browser-matrix"); });
  reject("missing-full-dev-build", value => { value.steps = value.steps.filter(row => row.name !== "full-dev-build"); });
  reject("missing-native-product-source", value => { value.sources = value.sources.filter(row => !row.file.endsWith("novel_card_position.rs")); });
  reject("source-byte-drift", value => { value.sources[0].sha256 = "0".repeat(64); });
  reject("escaping-source", value => { value.sources[0].file = "../outside"; });
  reject("runtime-link-different", value => { value.inheritedRuntime.sha256 = "0".repeat(64); });
  reject("changed-historical-dev-identity", value => { value.devBefore.sha256 = "0".repeat(64); });
  reject("pending-dev", value => { value.dev.pending = true; });
  reject("debug-byte-mismatch", value => { value.dev.compiledSha256 = "0".repeat(64); });
  reject("old-runtime-dev-pretends-to-be-card-dev", value => { value.dev = value.inheritedRuntime.originalDev; });
  rejectBrowser("empty-browser-matrix", value => { value.cases = []; });
  rejectBrowser("duplicate-browser-matrix", value => { value.cases[1] = structuredClone(value.cases[0]); });
  rejectBrowser("fake-reduced-label", value => { value.cases.find(row => row.reduced).geometry.actual.reduced = false; });
  rejectBrowser("fake-dpr-label", value => { value.cases.find(row => row.dpr === 2).geometry.actual.dpr = 1; });
  rejectBrowser("missing-error-retry-coverage", value => {
    value.cases[0].checks = value.cases[0].checks.filter(name => name !== "visible-write-error-preserves-old-bytes-and-real-retry");
  });
  rejectBrowser("no-hit-test", value => { value.cases[0].geometry.hit = false; });
  rejectBrowser("matrix-has-overflow", value => { value.cases[0].geometry.overflow = 50; });
  rejectBrowser("wrong-matrix-scope", value => { value.scope = "INSTALLED_PASS"; });
  rejectBrowser("unclean-browser-service", value => { value.cleanup.serverStopped = false; });
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
}
