"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const out = "F:/AgentVN/QA/Windows-Recent-Upgrade-1940-20261103-01/preflight-pass-01.json";
assert(!fs.existsSync(out));
const config = require("F:/AgentVN/QA/Windows-Recent-Upgrade-1940-20261103-01/config.json");
const policy = require("./lib/windows-next-upgrade-fixture.cjs");
const loader = require("./lib/windows-next-native-source.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const report = { status: "RUNNING", at: new Date().toISOString(), productStarts: 0,
  builds: 0, modelRequests: 0, checks: [], sources: [] };
function check(name, fn) {
  const item = { name, status: "RUNNING" }; report.checks.push(item);
  item.detail = fn(); item.status = "PASS";
}
try {
  check("new-game-changes-only-version-and-body-not-game-or-graph", () => {
    const value = policy.fixtureFor(config);
    assert.equal(value.version, "1.0.5");
    const before = require("./installed-editor-windows-upgrade-candidate.cjs").fixtureFor("1.9.40");
    const project = structuredClone(value.project);
    project.nodes[1].data.scene.commands = before.project.nodes[1].data.scene.commands;
    assert.deepEqual(project, before.project);
    value.project.nodes[1].data.scene.commands.forEach((c, i) => {
      assert.equal(c.type, "narration"); assert(c.text.includes(`QA_WINDOWS_UPGRADE_CURRENT_${i}`));
      assert(c.text.includes("新版1.0.5"));
    });
    for (const key of ["version", "upgradeFromEditor", "nativeAutomation", "gameVersion"])
      assert.throws(() => policy.fixtureFor({ ...config, [key]: "wrong" }));
    return { rejectedVariants: 4, commands: 3, graphIdentityPreserved: true };
  });
  check("retained1935-game104-exact-report-binary-and-resource-provenance", () => {
    const value = read("F:/AgentVN/QA/Windows-Package-20261021-01/editor-18/report.json");
    const retained = loader.validateRetained1935Source(value);
    for (const mutate of [
      v => { v.status = "RUNNING"; }, v => { v.projectId = "wrong"; },
      v => { v.windowsInstaller.sha256 = "0".repeat(64); },
      v => { v.upgradeFixture.version = "1.0.5"; }, v => { v.steps.pop(); },
    ]) {
      const changed = structuredClone(value); mutate(changed);
      assert.throws(() => loader.validateRetained1935Source(changed));
    }
    return { retained, rejectedVariants: 5 };
  });
  check("pinned-workflow-and-auditor-compile-without-product-start", () => {
    const result = spawnSync(process.execPath,
      [path.join(__dirname, "installed-windows-game-upgrade-1935.cjs"), "--check-adapter"],
      { windowsHide: true, encoding: "utf8" });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
    require("./installed-windows-next-build-audit.cjs");
    require("./installed-windows-game-upgrade-1935-audit.cjs");
    return { exitCode: 0, stdout: result.stdout.trim(), compilationOnly: true };
  });
  check("preference-migration-allows-only-new-default-aspect", () =>
    require("./lib/windows-upgrade-preference-contract.cjs").selfTest());
  report.sources = [__filename, "installed-editor-windows-next-native.cjs", "installed-windows-next-build-audit.cjs",
    "lib/windows-next-native-source.cjs", "lib/windows-next-upgrade-fixture.cjs",
    "installed-windows-game-upgrade-1935.cjs", "installed-windows-game-upgrade-1935-audit.cjs",
    "windows-next-setup-payload-audit.cjs"].map(f => path.isAbsolute(f) ? f : path.join(__dirname, f))
    .map(f => ({ path: f, sha256: sha(f) }));
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, out, checks: report.checks, error: report.error }, null, 2));
