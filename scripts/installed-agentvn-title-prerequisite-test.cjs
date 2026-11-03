"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { validateInstalledDefaultTitle } = require("./lib/installed-agentvn-title-prerequisite.cjs");
const { sha256 } = require("./lib/installed-acceptance.cjs");
assert.equal(process.argv.length, 5, "node script <Windows-title-report> <installation-audit> <fixture-report>");
const [sourceFile, auditFile, fixtureFile] = process.argv.slice(2).map(p => path.resolve(p));
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const base = read(sourceFile), fixture = read(fixtureFile);
const root = path.resolve(__dirname, ".."), out = path.join(root, "output/installed-title-prerequisite-tests",
  new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const originals = [sourceFile, auditFile, fixtureFile].map(file => ({ file, sha256: sha256(fs.readFileSync(file)) }));
const report = { status: "RUNNING", scope: "Read-only validator controls using actual Windows title evidence; not new device tests", cases: [] };
function test(name, run) { run(); report.cases.push({ name, status: "PASS" }); }
function rejected(name, mutate) {
  test(name, () => {
    const changed = structuredClone(base); mutate(changed);
    const file = path.join(out, `${report.cases.length}.json`);
    fs.writeFileSync(file, JSON.stringify(changed), { flag: "wx" });
    assert.throws(() => validateInstalledDefaultTitle(file, { auditFile, fixture }), name);
  });
}
try {
  test("actual current Windows proof accepted", () => {
    assert.equal(validateInstalledDefaultTitle(sourceFile, { auditFile, fixture }).matrix, 12);
  });
  rejected("unfinished report", r => { r.status = "RUNNING"; });
  rejected("wrong game", r => { r.fixture.projectId = "other"; });
  rejected("authored layout source", r => { r.fixture.layoutSource = "authored"; });
  rejected("wrong installation", r => { r.installRoot = path.join(out, "another-install"); });
  rejected("editor hash drift", r => { r.executable.sha256 = "0".repeat(64); });
  rejected("player hash drift", r => { r.player.sha256 = "0".repeat(64); });
  rejected("installed resource drift", r => { r.resources[0].installed.sha256 = "0".repeat(64); });
  rejected("missing import", r => { r.commands = r.commands.filter(c => c.name !== "native-project-import"); });
  rejected("failed export", r => { r.commands.find(c => c.name === "windows-ui-export").exitCode = 1; });
  rejected("cleanup failure", r => { r.editorCleanup.editor.exitCode = 1; });
  rejected("page errors", r => { r.errors.push("Original application exception"); });
  rejected("empty matrix", r => { r.cases = []; });
  rejected("duplicate combinations", r => { r.cases[1] = structuredClone(r.cases[0]); });
  rejected("failed native case", r => { r.cases[0].status = "FAILED"; });
  rejected("native cleanup failure", r => { r.cases[0].cleanup.exitCode = 1; });
  rejected("missing actual DPR samples", r => { r.cases[0].viewportChecks = []; });
  rejected("actual DPR differs", r => { r.cases[0].viewportChecks[0].dpr = 3; });
  rejected("missing title return evidence", r => { r.cases[0].screenshots.pop(); });
  rejected("capture reset DPR", r => { r.cases[0].screenshots[0].after.dpr = 3; });
  rejected("dark old inherited color", r => { r.cases[0].metrics.color = "rgb(11, 29, 46)"; });
  rejected("low title contrast", r => { r.cases[0].contrast = 1.1695; });
  rejected("RenPy DOM", r => { r.cases[0].metrics.renpyCount = 1; });
  for (const item of originals) assert.equal(sha256(fs.readFileSync(item.file)), item.sha256, "Never rewrite original evidence");
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
}
