"use strict";
// Supplemental actual-device evidence. Never clears lifecycle/log blockers.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence: desc } = require("./android-acceptance-evidence.cjs");
const { validateFrame } = require("./lib/android-player-aspect-flow.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
function audit(bindingFile, runtimeReceiptFile, number) {
  assert.match(number, /^\d{2}$/);
  const binding = read(bindingFile), runtimeReceipt = read(runtimeReceiptFile);
  const out = `${binding.output}-aspect-audit-${number}`;
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const runtimeFile = path.join(binding.output, "runtime/runtime-smoke-report.json");
  const r = { status: "RUNNING", startedAt: new Date().toISOString(),
    runtime: desc(runtimeReceiptFile), binding: desc(bindingFile),
    source: desc(__filename), checks: [], builds: 0, deviceOperations: 0, modelRequests: 0 };
  const check = (name, fn) => {
    const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.evidence = fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
  };
  try {
    const raw = read(runtimeFile), a = raw.playerAspect;
    check("Same frozen APK, bound executed helper and completed primary audit", () => {
      assert(runtimeReceipt.finishedAt);
      assert(binding.sources.some(f => f.path === path.resolve(helperPath(binding)) && f.sha256 === desc(f.path).sha256));
      const helper = binding.sources.find(f => path.basename(f.path) === "android-player-aspect-flow.cjs");
      assert(helper); assert.equal(desc(helper.path).sha256, helper.sha256);
      assert.equal(raw.sourceApk.sha256, read(binding.audit.path).apk.sha256);
      assert.equal(r.runtime.sha256, desc(runtimeReceiptFile).sha256);
      assert.equal(a.status, "PASS"); assert.deepEqual(a.cases.map(c => c.value), ["16:9", "16:10", "4:3", "default"]);
      return { helper, apk: raw.sourceApk, runtime: r.runtime, primaryStatus: raw.status,
        failureCode: raw.failureCode, finishedAt: raw.finishedAt };
    });
    check("Four real settings selections, actual safe frame, nine actions and unchanged story", () => {
      for (const row of a.cases) {
        assert.equal(row.status, "PASS");
        validateFrame(row.geometry, row.value === "default" ? "16:9" : row.value);
        assert.deepEqual(row.after, a.original);
        const touches = raw.touches.filter(t => t.label === `aspect choose ${row.value}`);
        assert.equal(touches.length, 1);
        assert.equal(touches[0].selector, `[data-testid="settings-aspect-${row.value}"]`);
        assert(Number.isFinite(touches[0].x) && Number.isFinite(touches[0].y));
      }
      return { selections: 4, sameStory: a.original, finalRatio: a.cases.at(-1).geometry.ratio,
        persistence: a.persistence };
    });
    check("Four native PNG/XML captures match actual device dimensions", () => {
      const images = [];
      for (const row of a.cases) {
        const label = `player-aspect-${row.value.replace(":", "-")}`;
        assert(raw.screens.some(s => s.label === label));
        const png = path.join(binding.output, "runtime", label + ".png");
        const xml = path.join(binding.output, "runtime", label + ".xml");
        const bytes = fs.readFileSync(png);
        assert.equal(bytes.subarray(1, 4).toString(), "PNG");
        assert.equal(bytes.readUInt32BE(16), raw.viewport.physical.width);
        assert.equal(bytes.readUInt32BE(20), raw.viewport.physical.height);
        assert.match(fs.readFileSync(xml, "utf8"), /<hierarchy[ >]/);
        images.push({ png: desc(png), xml: desc(xml) });
      }
      return images;
    });
    r.functionalStatus = r.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
    r.status = r.functionalStatus === "FAILED" ? "FAILED" : raw.status;
    r.limitations = ["Immediate ratio selection and relative safe-area anchoring only",
      "Mobile ratio persistence across process restart NOT_RUN in this supplemental flow",
      "Primary lifecycle, warnings and cleanup status retained without exemptions"];
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); }
  r.finishedAt = new Date().toISOString();
  const file = path.join(out, "report.json");
  fs.writeFileSync(file, JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, functionalStatus: r.functionalStatus, report: desc(file),
    checks: r.checks.map(({ name, status }) => ({ name, status })), error: r.error }));
  if (r.status === "FAILED") process.exitCode = 1;
}
if (require.main === module) audit(...process.argv.slice(2));
function helperPath(binding) {
  const entry = binding.sources.find(f => path.basename(f.path) === "android-candidate-1940-device.cjs");
  assert(entry); return entry.path;
}
module.exports = { audit };
