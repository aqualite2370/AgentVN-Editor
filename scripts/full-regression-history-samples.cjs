"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(process.argv[2] && !fs.existsSync(out), "Pass fresh evidence JSON path");
const samples = [
  { version: "1.9.8", stem: "AgentVN_Editor_v1.9.8_20260925_101446", purpose: "LATEST_VERIFIED_OLDER_EDITOR" },
  { version: "1.7.1", stem: "AgentVN_Editor_v1.7.1_20260804_173759",
    purpose: "CROSS_GENERATION_CANDIDATE_MIGRATION_BOUNDARY_NOT_YET_PROVEN" },
];
const report = { status: "RUNNING", scope: "LOCAL_RELEASE_SAMPLE_PROVENANCE_NOT_UPGRADE_PASS",
  startedAt: new Date().toISOString(), samples: [], upgradeStatus: "NOT_RUN" };
async function describe(file) {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  const stat = fs.statSync(file);
  return { path: file, bytes: stat.size, sha256: h.digest("hex"), modifiedAt: stat.mtime.toISOString(),
    source: "Existing repository releases/editor; not freshly rebuilt or chosen by mtime" };
}
(async () => {
  for (const sample of samples) {
    const installer = path.join(root, "releases/editor", sample.stem + ".exe");
    const version = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      "(Get-Item -LiteralPath $env:AGENTVN_OLD_INSTALLER).VersionInfo.ProductVersion"],
    { encoding: "utf8", windowsHide: true, env: { ...process.env, AGENTVN_OLD_INSTALLER: installer } }).trim();
    assert.equal(version, sample.version, "Use actual PE version, not filename");
    const files = [];
    for (const suffix of [".exe", "_en-US.msi", "_zh-CN.msi"])
      files.push(await describe(path.join(root, "releases/editor", sample.stem + suffix)));
    report.samples.push({ ...sample, actualPeVersion: version, files });
  }
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, samples: report.samples.length, out, error: report.error }));
});
