"use strict";
// Read-only on product, installed files and prior evidence. No native launch,
// provider request, cache redirection, or access to the default user database.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { createRequire } = require("node:module");
const { rows } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), req = createRequire(path.join(root, "editor/package.json"));
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = `F:/AgentVN/QA/Layout-Pages-Evidence-20261021-01/preflight-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const previousFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-31/report.json";
const receiptFile = "F:/AgentVN/QA/Editor-1.9.13-20261021-01/installation.json";
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "OFFLINE_REPLAY_OF_INSTALLED_HEALTH_VALIDATOR_ON_PRIOR_PERSISTED_PROFILES_NOT_NEW_UI_ACCEPTANCE",
  modelRequests: 0, productChanges: 0, pages: [], sources: [], previousEvidence: [] };
try {
  const checkpoint = "F:/AgentVN/Checkpoints/Layout-Pages-20261021-" + attempt;
  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint, { recursive: true });
  for (const file of [__filename, path.join(root, "scripts/installed-layout-pages-current.cjs"),
    path.join(root, "scripts/lib/installed-release-session.cjs"),
    path.join(root, "scripts/installed-layout-cache-session.ps1")]) {
    const relative = path.relative(root, file), target = path.join(checkpoint, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
    report.sources.push({ path: file, checkpoint: target, sha256: sha(file) });
  }
  const receipt = read(receiptFile), previous = read(previousFile);
  assert.equal(receipt.status, "PASS"); assert.equal(previous.status, "PASS");
  for (const file of [receiptFile, previousFile]) report.previousEvidence.push({ path: file, sha256: sha(file) });
  for (const entry of [receipt.executable, ...receipt.resources]) assert.equal(sha(entry.path), entry.sha256);
  const source = path.join(receipt.installRoot, "shared/cartridge/uiSkin.ts");
  const module = { exports: {} };
  new Function("module", "exports", "require", req("esbuild").buildSync({
    stdin: { resolveDir: receipt.installRoot, loader: "ts",
      contents: 'export { validateUISkinHealth, validateUISkinLayout } from "./shared/cartridge/uiSkin";' },
    bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
    plugins: [],
  }).outputFiles[0].text)(module, module.exports, req);
  report.validator = { path: source, sha256: sha(source),
    equalsCurrentSource: sha(source) === sha(path.join(root, "shared/cartridge/uiSkin.ts")) };
  const profiles = previous.persistedProfiles;
  assert(profiles && Object.keys(profiles.profiles).length === 2);
  for (const [type, profile] of Object.entries(profiles.profiles)) {
    const original = JSON.stringify(profile);
    const health = module.exports.validateUISkinHealth(profile, { availableAssetIds: [], availableAssetPaths: [] });
    const schema = module.exports.validateUISkinLayout(profile);
    for (const screen of profile.screens) {
      const issues = [...health.errors, ...health.warnings].filter(issue =>
        issue.path?.startsWith(`ui.${screen.screen_id}.`) || issue.path?.startsWith("ui.tokens."));
      report.pages.push({ type, screen: screen.screen_id, issues,
        health: issues.some(i => i.severity === "error") ? "ERROR" : issues.length ? "WARNING" : "OK" });
    }
    assert.equal(JSON.stringify(profile), original, "Health inspection must not mutate persisted layout");
    (report.validation ??= []).push({ type, schema, health });
  }
  report.liveSessions = rows().filter(p => /^(AgentVN Dev|agentvn-editor|creator-backend)\.exe$/i.test(p.Name));
  report.nativeUiAvailability = report.liveSessions.length
    ? { status: "BLOCKED", reason: "Unowned Editor is active; shared native cache must not be moved", processesStopped: 0 }
    : { status: "AVAILABLE", processesStopped: 0 };
  report.counts = report.pages.map(p => ({ type: p.type, page: p.screen, health: p.health, issues: p.issues.length }));
  assert(report.pages.length >= 16);
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.copyFileSync(__filename, path.join(out, "executed-tool.cjs"), fs.constants.COPYFILE_EXCL);
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, out, counts: report.counts,
  nativeUiAvailability: report.nativeUiAvailability, error: report.error }, null, 2));
