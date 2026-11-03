"use strict";
// Rejected paths never reach Get-Item or an ACL write. The accepted path is
// exercised separately by the installed Editor's real denial/recovery test.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const attempt = process.argv[2];
assert.match(attempt || "", /^\d{2}$/);
const out = path.resolve("F:/AgentVN/QA/Editor-Repair-Release-20261024-01", `acl-guard-${attempt}`);
assert(!fs.existsSync(out));
fs.mkdirSync(out);
const script = path.resolve(__dirname, "project-directory-write-acl.ps1");
const digest = () => createHash("sha256").update(fs.readFileSync(script)).digest("hex");
const report = { status: "RUNNING", at: new Date().toISOString(),
  scope: "POWERSHELL_PARSE_AND_REJECTED_PATHS_ONLY_NO_ACL_CHANGED",
  script: { path: script, sha256: digest() }, cases: [] };
try {
  const parse = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "$parseTokens=$null; $parseErrors=$null; " +
    "[void][System.Management.Automation.Language.Parser]::ParseFile('" +
    script.replace(/'/g, "''") + "',[ref]$parseTokens,[ref]$parseErrors); " +
    "if($parseErrors.Count){$parseErrors | Out-String | Write-Error; exit 1}"],
  { encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.equal(parse.status, 0, parse.stdout + parse.stderr);
  report.cases.push({ name: "powershell-parser", status: "PASS" });
  const base = "F:\\AgentVN\\QA\\Editor-Repair-Release-20261024-01\\directory\\green-02";
  for (const [name, directory, receipt] of [
    ["workspace-root", "D:\\AgentVN", "D:\\acl-before.json"],
    ["qa-root", "F:\\AgentVN\\QA", "F:\\AgentVN\\acl-before.json"],
    ["install-root", "F:\\AgentVN\\QA\\Editor-Repair-Release-20261024-01\\installed-editor",
      "F:\\AgentVN\\QA\\Editor-Repair-Release-20261024-01\\acl-before.json"],
    ["wrong-receipt-name", base + "\\owned-save-directory", base + "\\other.json"],
    ["wrong-receipt-parent", base + "\\owned-save-directory",
      base + "\\subdirectory\\acl-before.json"],
    ["unapproved-attempt", base.replace("green-02", "green-999") + "\\owned-save-directory",
      base.replace("green-02", "green-999") + "\\acl-before.json"],
    ["different-release", base.replace("-01\\directory", "-02\\directory") + "\\owned-save-directory",
      base.replace("-01\\directory", "-02\\directory") + "\\acl-before.json"],
    ["wrong-leaf", base + "\\not-owned", base + "\\acl-before.json"],
  ]) {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", script, "-Mode", "deny", "-Directory", directory, "-Receipt", receipt],
    { encoding: "utf8", windowsHide: true, timeout: 30000 });
    const text = result.stdout + result.stderr;
    assert.notEqual(result.status, 0, name);
    assert(text.includes("Only the owned regression directory and its sibling receipt may be used."), text);
    report.cases.push({ name, directory, receipt, status: "PASS", exitCode: result.status, output: text });
  }
  assert.equal(digest(), report.script.sha256);
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED";
  report.error = String(error.stack || error);
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, error: report.error }));
  if (report.status !== "PASS") process.exitCode = 1;
}
