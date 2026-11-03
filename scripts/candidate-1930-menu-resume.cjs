"use strict";
// QA-only continuation: keep the original failed audit and its pinned sources.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const menus = require("./candidate-1930-menus.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Editor-1.9.30-20261026-01";
const native = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
function buildMotionAudit(original) {
  const result = menus.buildAudit("motion", original);
  const before = "const buttons = m.quickGeometry.buttons; assert.equal(buttons.length, 8);";
  const after = 'const buttons = m.quickGeometry.buttons; assert.equal(buttons.length, 9);\n' +
    '        assert.equal(require("./lib/installed-runtime-motion-1922-policy.cjs")\n' +
    '          .validateQuickBar({ ...m.quickGeometry, width: m.width }).status, "PASS");';
  assert.equal(result.source.split(before).length - 1, 1, "Exactly one obsolete eight-action assertion");
  result.source = result.source.replace(before, after);
  result.adaptations.push({ before, after, reason: "Current nine ordered actions including Hide; preserve full frame/hit/bounds/cleanup oracle" });
  return result;
}
function compile(result, file) {
  new vm.Script(Module.wrap(result.source));
  const worker = new Module(file, module); worker.filename = file;
  worker.paths = Module._nodeModulePaths(path.dirname(file)); worker._compile(result.source, file);
}
function run(mode) {
  assert(["audit", "settings"].includes(mode));
  require("./candidate-1930-exit.cjs").validateInstallation(path.join(base, "derived-components-installation-01.json"));
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)),
    "No overlapping native profile operations");
  const session = read(path.join(native, "installed-motion-current-30/installed-session.json"));
  const raw = read(path.join(native, "installed-motion-current-30/motion.json"));
  menus.validator("motion")(session, raw);
  const failed = read(path.join(native, "installed-motion-current-30-audit-01/report.json"));
  assert.equal(failed.status, "FAILED"); assert.match(failed.error, /9 !== 8/);
  assert.equal(failed.session.sha256, sha(path.join(native, "installed-motion-current-30/installed-session.json")));
  assert.equal(failed.raw.sha256, sha(path.join(native, "installed-motion-current-30/motion.json")));
  assert(failed.finishedAt);
  if (mode === "settings") {
    const audit = read(path.join(native, "installed-motion-current-30-audit-02/report.json"));
    assert.equal(audit.status, "PASS"); assert(audit.finishedAt && !audit.error);
    assert.equal(audit.session.sha256, failed.session.sha256);
    assert.equal(audit.raw.sha256, failed.raw.sha256);
    assert.equal(audit.groups.length, 6);
    assert(audit.groups.every(g => g.status === "PASS"));
    assert.equal(audit.groups.at(-1).detail.currentQuickActions, 9);
    const binding = read(path.join(base, "menu-resume-settings/audit-binding.json"));
    for (const f of [binding.original, binding.executed, ...binding.tools]) assert.equal(sha(f.path), f.sha256);
  }
  const file = path.join(__dirname, mode === "audit" ? "installed-runtime-motion-current-audit.cjs"
    : "installed-runtime-settings-current.cjs");
  const result = mode === "audit" ? buildMotionAudit(fs.readFileSync(file, "utf8"))
    : menus.buildSession("settings", fs.readFileSync(file, "utf8"));
  const out = path.join(base, "menu-resume-settings");
  if (!fs.existsSync(out)) fs.mkdirSync(out);
  const executed = path.join(out, mode === "audit" ? "executed-motion-audit.cjs" : "executed-settings-session.cjs");
  fs.writeFileSync(executed, result.source, { flag: "wx" });
  fs.writeFileSync(path.join(out, `${mode}-binding.json`), JSON.stringify({
    at: new Date().toISOString(), original: desc(file), executed: desc(executed),
    tools: [__filename, path.join(__dirname, "candidate-1930-menus.cjs"),
      path.join(__dirname, "candidate-1930-menu-resume-test.cjs")].map(desc),
    adaptations: result.adaptations, failedAuditPreserved: desc(path.join(native, "installed-motion-current-30-audit-01/report.json")),
    productChanges: 0, modelRequests: 0,
  }, null, 2), { flag: "wx" });
  process.argv = [process.argv[0], file, "30", ...(mode === "audit" ? ["02"] : [])];
  compile(result, file);
}
module.exports = { buildMotionAudit };
if (require.main === module) run(process.argv[2]);
