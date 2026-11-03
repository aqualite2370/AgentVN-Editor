const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const requireEditor = createRequire(path.resolve(__dirname, "../editor/package.json"));
const compiled = requireEditor("esbuild").buildSync({
  stdin: { contents: 'export { BackendClient } from "./editor/src/api/backendClient";',
    loader: "ts", resolveDir: path.resolve(__dirname, "..") },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  define: { "import.meta.env": "{}" },
});
const moduleValue = { exports: {} };
global.window = { setTimeout, clearTimeout };
new Function("module", "exports", "require", compiled.outputFiles[0].text)(moduleValue, moduleValue.exports, requireEditor);
const { BackendClient } = moduleValue.exports;
const immediate = () => new Promise((resolve) => setImmediate(resolve));
async function main() {
  const requests = [];
  let releaseOld;
  const oldGate = new Promise((resolve) => { releaseOld = resolve; });
  let stored, local = { activeType: "agentvn" };
  global.fetch = async (_url, init) => {
    const body = init.body ? JSON.parse(init.body) : {};
    requests.push(body);
    if (body.marker === "old-autosave") await oldGate;
    stored = body;
    return Response.json({ ok: true, data: body });
  };
  const client = new BackendClient({ baseUrl: "http://test.invalid" });
  const old = client.saveProjectState({ marker: "old-autosave", layout: "agentvn" });
  await immediate();
  const manual = client.saveProjectState({ marker: "explicit-switch", layout: "renpy" }, {
    onPersisted: () => { local = { activeType: "renpy" }; },
  });
  const autosave = client.saveProjectState(() => ({ marker: "latest-autosave", layout: local.activeType }));
  await immediate();
  try {
    assert.equal(requests.length, 1, "project writes must not overtake an earlier in-flight write");
  } finally {
    releaseOld();
    await Promise.all([old, manual, autosave]);
  }
  assert.equal(stored.layout, "renpy", "queued autosave must read the committed layout, not its stale scheduled snapshot");
  assert.deepEqual(requests.map((r) => r.marker), ["old-autosave", "explicit-switch", "latest-autosave"]);
  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.fail) throw new Error("network unavailable");
    return Response.json({ ok: true, data: body });
  };
  await assert.rejects(client.saveProjectState({ fail: true }), /network unavailable/);
  assert.equal((await client.saveProjectState({ marker: "retry" })).marker, "retry", "a failed save must not poison the queue");
  console.log("PASS serialized project writes, commit-before-autosave, deferred snapshots and failure recovery");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
