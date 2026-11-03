"use strict";
// Current-candidate adapter. The historical 1.9.22 defaults remain available,
// while newer sealed installs may pass an explicit receipt and version.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { installedReleaseSession } = require("./installed-release-session.cjs");
const { sha256 } = require("./installed-acceptance.cjs");
const defaultReceipt = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json";
const defaultVersion = "1.9.22";
const defaultSha = "189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc";
function novel1922Session({ out, input, report, save, receiptFile = defaultReceipt,
  expectedVersion = defaultVersion, expectedSha = defaultSha, qaRoot }) {
  assert.equal(path.dirname(path.resolve(out)), path.resolve(qaRoot || "F:/AgentVN/QA/Installed-Novel-1922-20261022-01"));
  assert.match(path.basename(out), /^session-\d{2}$/);
  const receipt = path.resolve(receiptFile);
  const install = JSON.parse(fs.readFileSync(receipt, "utf8"));
  assert.equal(install.version, expectedVersion); assert.equal(install.executable.sha256, expectedSha);
  report.nativeSession ??= { launches: [], cleanups: [], errors: [], screenshots: [] };
  report.installation = { path: receipt, sha256: sha256(fs.readFileSync(receipt)), ...install };
  const native = installedReleaseSession({ installationFile: receipt, out, input, report: report.nativeSession, save });
  function verify() {
    for (const f of [install.executable, ...install.resources])
      assert.equal(sha256(fs.readFileSync(f.path)), f.sha256);
    return { exeSha256: expectedSha };
  }
  return {
    verify,
    async start() {
      verify();
      try { await native.start(); }
      catch (error) { await native.stop("startup failure"); throw error; }
      const current = native.current;
      const state = {
        installRoot: install.installRoot, databasePath: path.join(current.data, "backend/vn_engine.db"),
        dataRoot: current.data, webviewRoot: current.webview, backendPort: current.ports[0], cdpPort: current.ports[1],
        editorPid: current.pid, backendPid: current.backend.ProcessId, startedAt: current.at,
        hostCreated: current.created, source: false, manualBackendSpawn: false,
      };
      return {
        state,
        async stop() {
          await native.stop("attributed novel QA termination; not normal native close");
          assert.equal(report.nativeSession.errors.length, 0);
          return { editor: { exitCode: 0 }, backend: { exitCode: 0 },
            attributed: report.nativeSession.cleanups.at(-1), normalCloseClaimed: false };
        },
      };
    },
  };
}
module.exports = { novel1922Session };
