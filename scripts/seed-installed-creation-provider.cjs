"use strict";
// Copy only the user's current selected text connection into an isolated local
// installation session; never emit credentials, user projects or other models.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { readInstalledSession } = require("./lib/installed-acceptance.cjs");
assert(process.argv[2], "Pass the exact isolated installed session");
const out = path.resolve(process.argv[2]);
const { state } = readInstalledSession(out);
const source = path.join(process.env.APPDATA, "com.agentvn.editor/backend/vn_engine.db");
assert.notEqual(path.resolve(source), path.resolve(state.databasePath));
async function main() {
  const db = new DatabaseSync(source, { readOnly: true });
  let payload, summary;
  try {
    const read = key => {
      const row = db.prepare("SELECT value FROM editor_shared_state WHERE key=?").get(key);
      return row ? JSON.parse(row.value) : null;
    };
    const selected = read("provider_selections")?.text_generation;
    const model = (read("provider_models") || []).find(item => item.provider_id === selected);
    assert(model?.enabled && model.capabilities.includes("text_generation"), "No enabled selected text model");
    const connection = (read("provider_connections") || []).find(item => item.connection_id === model.connection_id);
    const secret = read("provider_secrets")?.[connection?.connection_id];
    assert(connection?.enabled && secret, "Selected text connection has no persisted credential");
    payload = { provider_connections: [connection], provider_models: [model],
      provider_selections: { text_generation: selected }, provider_secrets: { [connection.connection_id]: secret } };
    summary = { mode: "existing-user-selected-text-model", model: model.model_name,
      endpointHost: new URL(connection.base_url).host, connectionCount: 1, modelCount: 1,
      projectDataCopied: false, sourceReadOnly: true, credentialInReport: false };
  } finally { db.close(); }
  const response = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/state`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  assert(response.ok, `Isolated provider configuration HTTP ${response.status}`);
  const result = await response.json();
  assert(result.ok);
  const file = path.join(out, "live-provider-setup.json");
  fs.writeFileSync(file, JSON.stringify({ ...summary, setupAt: new Date().toISOString(),
    cleanupRequired: "Clear only this isolated session's provider_secrets when finished" }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ ...summary, report: file }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
