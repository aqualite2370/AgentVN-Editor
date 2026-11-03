"use strict";
// Explicit, sealed expectations. Never infer the expected identity from a report.
const assert = require("node:assert/strict");
const current = process.env.AGENTVN_COMPONENTS_CANDIDATE === "1.9.22";
const current1925 = process.env.AGENTVN_COMPONENTS_CANDIDATE === "1.9.25";
const current1930 = process.env.AGENTVN_COMPONENTS_CANDIDATE === "1.9.30";
assert([undefined, "1.9.22", "1.9.25", "1.9.30"].includes(process.env.AGENTVN_COMPONENTS_CANDIDATE));
if (current1930) {
  const fs = require("node:fs"), crypto = require("node:crypto"), path = require("node:path");
  const receipt = JSON.parse(fs.readFileSync("F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json", "utf8"));
  const bytes = fs.readFileSync(receipt.actualInstallation.path);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), receipt.actualInstallation.sha256);
  const actual = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  assert.equal(actual.status, "PASS"); assert.equal(actual.exitCode, 0); assert.equal(actual.registryRestored, true);
  assert.equal(path.resolve(actual.installRoot), path.resolve(receipt.installRoot));
  assert.equal(actual.executable.sha256, receipt.executable.sha256);
  assert.equal(actual.installer.sha256, "6c8d1109f297d91e4a0a79202882cdbb8402ce8a2850d86360a60c56d6cd72ce");
}
module.exports = current1930 ? {
  current: true,
  expected: { version: "1.9.30", sha256: "a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577" },
  installationFile: "F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json",
  protectedSourceFile: "F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json",
} : current1925 ? {
  current: true,
  expected: { version: "1.9.25", sha256: "8dbbbcca6f7752c8a01ff21beaba836cfa0930cc1773ab2f6600ebcc89030fa2" },
  installationFile: "F:/AgentVN/QA/Editor-1.9.25-20261025-01/derived-installation-02.json",
  protectedSourceFile: "F:/AgentVN/QA/Editor-1.9.25-20261025-01/installation.json",
} : current ? {
  current: true,
  expected: { version: "1.9.22", sha256: "189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc" },
  installationFile: "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json",
  protectedSourceFile: "F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json",
} : {
  current: false,
  expected: { version: "1.9.14", sha256: "57e280c16cea0cadf41fe55608e94c5216e46cf15c71c75872a2acf415c867af" },
  installationFile: "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01/installation.json",
  protectedSourceFile: "F:/AgentVN/QA/Installed-Assets-20261021-01/editor-03/report.json",
};
