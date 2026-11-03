"use strict";
// Actual old/current installed hosts consume copies of authentic QA profiles.
// This is explicitly NOT an installer/default-path upgrade test.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const crypto = require("node:crypto"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const describe = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const write = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2), { flag: "wx" });
function boundary(p, parent) {
  const r = path.relative(path.resolve(parent), path.resolve(p));
  assert(r && !r.startsWith("..") && !path.isAbsolute(r), "Exact child boundary required");
}
function inventory(root) {
  const result = [];
  function visit(p) {
    const s = fs.lstatSync(p); assert(!s.isSymbolicLink(), "Profile must not contain links");
    if (s.isDirectory()) for (const n of fs.readdirSync(p).sort()) visit(path.join(p, n));
    else { assert(s.isFile()); result.push({ relative: path.relative(root, p), bytes: s.size, sha256: sha(p) }); }
  }
  visit(root); return result;
}
function validateConfig(c) {
  assert.equal(c.version, "1.9.31"); assert.equal(c.oldVersion, "1.9.30");
  boundary(c.qa, "F:/AgentVN/QA"); boundary(c.out, c.qa);
  assert.match(path.basename(c.out), /^session-\d{2}$/);
  assert.equal(c.scenarios.length, 2);
  assert.deepEqual(c.scenarios.map(s => s.kind), ["assistant", "components"]);
  if (c.only !== undefined) {
    assert.deepEqual(c.only, ["components"], "Only the failed component group may be resumed separately");
    assert(c.continuation && /^[a-f0-9]{64}$/.test(c.continuation.sha256));
    boundary(c.continuation.path, c.qa);
  }
  for (const s of c.scenarios) {
    boundary(s.report.path, "F:/AgentVN/QA"); boundary(s.audit.path, "F:/AgentVN/QA");
    for (const f of [s.report, s.audit]) assert.match(f.sha256, /^[a-f0-9]{64}$/);
  }
}
function deriveActual(f, version) {
  assert.equal(sha(f.path), f.sha256); const actual = read(f.path);
  assert.equal(actual.status, "PASS"); assert.equal(actual.exitCode, 0);
  assert.equal(actual.registryRestored, true);
  assert.equal(sha(actual.executable.path), actual.executable.sha256);
  assert.equal(sha(actual.installer.path), actual.installer.sha256);
  const resources = ["creator-backend.exe", "agentvn-player.exe", "build-versions.json"]
    .map(n => describe(path.join(actual.installRoot, n)));
  const meta = read(resources[2].path); assert(Object.values(meta).includes(version));
  return { status: "PASS", version, metadataRestoration: "PASS",
    scope: "DERIVED_FROM_ACTUAL_NSIS_RECEIPT_NOT_NEW_INSTALLATION_OR_INSTALLER_UPGRADE",
    actualInstallation: f, installRoot: actual.installRoot, executable: actual.executable, resources };
}
async function dbSnapshot(page, name, store) {
  return page.evaluate(async ({ name, store }) => {
    const databases = await indexedDB.databases();
    if (!databases.some(d => d.name === name)) throw new Error("Expected existing database: " + name);
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onupgradeneeded = () => { r.transaction.abort(); reject(new Error("Unexpected schema creation")); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    try {
      const values = await new Promise((resolve, reject) => {
        const r = db.transaction(store, "readonly").objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      if (store === "conversations") return values.sort((a, b) => a.id.localeCompare(b.id));
      return Promise.all(values.sort((a, b) => a.id.localeCompare(b.id)).map(async value => ({
        ...value, assets: await Promise.all((value.assets || []).map(async asset => ({
          ...asset, bytes: undefined, byteLength: new Uint8Array(asset.bytes).length,
          sha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(asset.bytes)))]
            .map(x => x.toString(16).padStart(2, "0")).join(""),
        }))),
      })));
    } finally { db.close(); }
  }, { name, store });
}
const semanticConversations = rows => rows.map(({ updatedAt, ...rest }) => rest);
function verifyResourceLocation(asset, origin) {
  const base = new URL(origin);
  assert.equal(base.protocol, "http:"); assert.equal(base.hostname, "127.0.0.1");
  assert.equal(base.origin, origin); assert(base.port && !base.username && !base.password);
  const m = asset.metadata, u = new URL(m.url), relative = m.backend_asset_path;
  assert(typeof relative === "string" && relative.length > 0);
  assert(relative.split("/").every(p => p && p !== "." && p !== ".." && !/[\\%?#:]/.test(p)));
  assert.equal(u.origin, origin, "Asset must belong to this launch's owned backend");
  assert(!u.username && !u.password && !u.search && !u.hash);
  assert.equal(m.url, origin + "/api/project/assets/" + relative, "Exact project resource URL required");
  return relative;
}
function verifyResource(asset, origin, libraryAssets, bytes, diskBytes) {
  const relative = verifyResourceLocation(asset, origin), m = asset.metadata;
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  assert(bytes.length > 0); assert.equal(bytes.length, m.size_bytes);
  assert.deepEqual(bytes, diskBytes, "Served bytes must equal the copied project's physical asset");
  const matches = libraryAssets.filter(a => a.sha256 === hash && a.byteLength === bytes.length &&
    a.filename === m.filename && a.mimeType === m.mime_type);
  assert(matches.length > 0, "Resource bytes must match authentic library dependency");
  return { assetId: asset.asset_id, backendPath: relative, url: m.url, origin,
    byteLength: bytes.length, sha256: hash, libraryAssetIds: matches.map(a => a.id) };
}
async function verifyProjectResources(projectValue, components, launch, load = async u => {
  const response = await fetch(u, { redirect: "error", signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200); assert.equal(response.url, u);
  return Buffer.from(await response.arrayBuffer());
}) {
  const origin = `http://127.0.0.1:${launch.ports[0]}`, evidence = [];
  const assets = components.flatMap(c => c.assets || []);
  assert(projectValue.asset_manifest.length > 0 && assets.length > 0);
  for (const asset of projectValue.asset_manifest) {
    // Validate before network or filesystem access; a poisoned URL must never be followed.
    const relative = verifyResourceLocation(asset, origin);
    const root = path.join(launch.data, "backend/project_assets"), file = path.join(root, relative);
    boundary(file, root); assert(!fs.lstatSync(file).isSymbolicLink());
    boundary(fs.realpathSync(file), fs.realpathSync(root));
    const item = verifyResource(asset, origin, assets, await load(asset.metadata.url), fs.readFileSync(file));
    evidence.push({ ...item, projectFile: describe(file) });
  }
  return { evidence, value: normalizeVerifiedProject(projectValue, evidence) };
}
function normalizeVerifiedProject(value, evidence) {
  assert.equal(evidence.length, value.asset_manifest.length);
  const result = structuredClone(value);
  for (const asset of result.asset_manifest) {
    const e = evidence.find(e => e.assetId === asset.asset_id);
    assert(e && e.url === asset.metadata.url && e.backendPath === asset.metadata.backend_asset_path);
    assert.match(e.sha256, /^[a-f0-9]{64}$/); assert.equal(e.byteLength, asset.metadata.size_bytes);
    asset.metadata.url = "qa-verified-owned-backend:/api/project/assets/" + e.backendPath;
  }
  return result;
}
async function replay(configFile) {
  const c = read(configFile); validateConfig(c); assert(!fs.existsSync(c.out));
  assert(!rows().some(p => /^(agentvn-editor|AgentVN Dev|agentvn-player|creator-backend)\.exe$/i.test(p.Name)));
  fs.mkdirSync(c.out, { recursive: true });
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), version: c.version,
    scope: "AUTHENTIC_OLD_QA_PROFILE_REPLAY_NOT_INSTALLER_UPGRADE_OR_DEFAULT_PATH_MIGRATION",
    config: describe(configFile), cases: [], launches: [], cleanups: [], screenshots: [], errors: [],
    realModelRequests: 0, blockedModelRequests: 0, modelRequestsObserved: [], productChanges: 0,
    normalCloseClaimed: false, inputs: [], installations: [], sourceRestoration: "NOT_CHECKED" };
  report.executedScenarios = c.only || c.scenarios.map(s => s.kind);
  if (c.continuation) {
    assert.equal(sha(c.continuation.path), c.continuation.sha256);
    report.continuation = { ...c.continuation, scope: "SEPARATE_PRIOR_FAILED_RUN_NOT_REWRITTEN" };
  }
  report.tools = [__filename, path.join(__dirname, "lib/installed-release-session.cjs"),
    path.join(__dirname, "lib/current-native-capture.cjs"), path.join(__dirname, "installed-layout-cache-session.ps1")]
    .map(describe);
  fs.mkdirSync(path.join(c.out, "executed-tools"));
  for (const f of report.tools) fs.copyFileSync(f.path, path.join(c.out, "executed-tools", path.basename(f.path)), fs.constants.COPYFILE_EXCL);
  const save = () => fs.writeFileSync(path.join(c.out, "report.json"), JSON.stringify(report, null, 2));
  save(); let host, cachePrepared = false;
  const originalInventories = [], sinks = [], currentSources = [];
  function cache(action) {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "installed-layout-cache-session.ps1"), "-Action", action,
      "-RunDirectory", c.out, "-AllowedRunRoot", c.qa, "-CodexCacheView"],
    { windowsHide: true, encoding: "utf8", timeout: 60000, maxBuffer: 3e6 });
    (report.cache ??= []).push({ action, exitCode: r.status, stdout: r.stdout, stderr: r.stderr }); save();
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  async function stage(name, fn) {
    const row = { name, status: "RUNNING" }; report.cases.push(row); save(); console.log("START", name);
    try { row.evidence = await fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
    finally { row.finishedAt = new Date().toISOString(); save(); console.log(row.status, name); }
  }
  async function bindSink(url) {
    const u = new URL(url); assert.equal(u.hostname, "127.0.0.1"); assert.equal(u.protocol, "http:");
    assert.equal(listeners([Number(u.port)]).length, 0, "Historical model port now owned by another process");
    const server = http.createServer((req, res) => {
      report.modelRequestsObserved.push({ at: new Date().toISOString(), method: req.method, path: req.url });
      save(); req.resume(); res.writeHead(503).end("QA replay forbids all model requests");
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(+u.port, u.hostname, resolve); });
    sinks.push({ server, port: +u.port });
  }
  async function openProject(page, id) {
    const project = (await host.rawApi("/api/project/projects/" + id)).data; assert(project);
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); return project;
  }
  async function home(page) {
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
    await page.getByRole("button", { name: "返回首页", exact: true }).click();
    await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor(); await settleEditor(page);
  }
  async function inspect(page, scenario, old, baseline) {
    if (scenario.kind === "assistant") {
      const ids = Object.keys(old.baselineProjects); assert.equal(ids.length, 2);
      for (const [i, id] of ids.entries()) {
        const project = await openProject(page, id), expected = old.baselineProjects[id];
        for (const k of ["editor_settings", "edges", "asset_manifest"]) assert.deepEqual(project[k], expected[k]);
        assert.deepEqual(project.nodes.map(({ measured, ...n }) => n), expected.nodes.map(({ measured, ...n }) => n));
        await page.locator('[data-workspace-surface="assistant"]:visible').click(); await settleEditor(page);
        const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel");
        await panel.getByRole("button", { name: "创造模式", exact: true }).click();
        const label = i ? "QUEUE_C组件" : "QUEUE_A组件";
        await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: label, exact: true }).waitFor();
        assert.equal(await panel.getByRole("heading", { name: i ? "QUEUE_A组件" : "QUEUE_C组件", exact: true }).count(), 0);
        await panel.getByRole("button", { name: "问询模式", exact: true }).click();
        assert.equal(await panel.getByRole("heading", { name: label, exact: true }).count(), 0);
        const h = panel.locator(".assistant-history-popover");
        if (!await h.evaluate(n => n.open)) await h.locator("summary").click();
        assert.equal(await h.getByRole("button", { name: /^永久删除 HISTORY_A/ }).count(), 0);
        await host.shot(`${scenario.kind}-${host.current.executable.sha256.slice(0, 6)}-${report.launches.length}-${i}`);
        await home(page);
      }
      const conversations = await dbSnapshot(page, "agentvn-assistant-workbench", "conversations");
      assert(conversations.filter(v => v.mode === "creation").length >= 2);
      assert(conversations.every(v => ids.includes(v.projectId)));
      assert(!conversations.some(v => v.title.includes("HISTORY_A")));
      if (baseline) assert.deepEqual(semanticConversations(conversations), semanticConversations(baseline));
      return conversations;
    }
    const project = await openProject(page, old.finalProject.id);
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
    const details = page.locator("details.renpy-personal-component-library");
    if (!await details.evaluate(n => n.open)) await details.locator("summary").click();
    const library = page.getByTestId("custom-component-library"); await library.waitFor();
    const components = await dbSnapshot(page, "agentvn-personal-component-library", "components");
    assert(components.length >= 2); assert(components.some(v => v.assets?.length >= 2));
    for (const component of components) assert((await library.innerText()).includes(component.name));
    const projectValue = { editor_settings: project.editor_settings, edges: project.edges,
      asset_manifest: project.asset_manifest, nodes: project.nodes.map(({ measured, ...n }) => n) };
    const verified = await verifyProjectResources(projectValue, components, host.current);
    (report.componentResourceChecks ??= []).push({ launch: report.launches.length - 1,
      project: projectValue, resources: verified.evidence }); save();
    if (!report.componentProjectBaseline) report.componentProjectBaseline = verified.value;
    else assert.deepEqual(verified.value, report.componentProjectBaseline);
    if (baseline) assert.deepEqual(components, baseline);
    await host.shot(`${scenario.kind}-${host.current.executable.sha256.slice(0, 6)}-${report.launches.length}`);
    return components;
  }
  try {
    const oldInstall = read(c.oldInstallation.path); assert.equal(sha(c.oldInstallation.path), c.oldInstallation.sha256);
    assert.equal(oldInstall.version, c.oldVersion); assert.equal(oldInstall.status, "PASS");
    assert.equal(oldInstall.metadataRestoration, "PASS");
    const next = deriveActual(c.currentInstallation, c.version);
    write(path.join(c.out, "old-installation.json"), oldInstall);
    write(path.join(c.out, "current-installation.json"), next);
    report.installations = [describe(path.join(c.out, "old-installation.json")), describe(path.join(c.out, "current-installation.json"))];
    currentSources.push(...[oldInstall, next].flatMap(i => [i.executable, ...i.resources]));
    for (const f of currentSources) assert.equal(sha(f.path), f.sha256);
    cache("SelfTest"); cachePrepared = true; cache("Prepare");
    for (const scenario of c.scenarios) {
      if (!report.executedScenarios.includes(scenario.kind)) continue;
      for (const f of [scenario.report, scenario.audit]) assert.equal(sha(f.path), f.sha256);
      const old = read(scenario.report.path); assert.equal(old.status, "PASS");
      assert.equal(read(scenario.audit.path).status, "PASS");
      const work = path.join(c.out, scenario.kind); fs.mkdirSync(work);
      const original = old.launches[0]; assert(original.data && original.webview);
      const input = scenario.kind === "assistant" ? old.inputs[0].path : old.input.path;
      for (const key of ["data", "webview"]) {
        boundary(original[key], "F:/AgentVN/QA");
        const inv = inventory(original[key]); assert(inv.length);
        originalInventories.push({ source: original[key], inventory: inv });
        fs.cpSync(original[key], path.join(work, key), { recursive: true, errorOnExist: true, force: false });
        assert.deepEqual(inventory(path.join(work, key)), inv);
        write(path.join(c.out, scenario.kind + "-" + key + "-input.json"), inv);
      }
      report.inputs.push({ kind: scenario.kind, sourceReport: scenario.report, sourceAudit: scenario.audit,
        sourceProfile: original.webview, scope: "COPIED_AUTHENTIC_QA_PROFILE", input: describe(input) }); save();
      if (old.modelEndpoint) await bindSink(old.modelEndpoint);
      let baseline;
      for (const phase of ["old", "current", "restart"]) {
        await stage(scenario.kind + "-" + phase + "-real-installed-profile-consumption", async () => {
          host = installedReleaseSession({ installationFile: path.join(c.out, phase === "old"
            ? "old-installation.json" : "current-installation.json"), out: work, input, report, save });
          const page = await host.start();
          const value = await inspect(page, scenario, old, baseline);
          if (phase === "old") baseline = value;
          assert.equal(report.modelRequestsObserved.length, 0); assert.equal(report.blockedModelRequests, 0);
          write(path.join(c.out, scenario.kind + "-" + phase + "-records.json"), value);
          await host.stop("QA data replay process boundary; not normal close or installer-upgrade evidence"); host = undefined;
          return { records: value.length, oldVersion: c.oldVersion, currentVersion: phase === "old" ? c.oldVersion : c.version,
            existingResourceBytesUnchanged: true, noModelRequests: true, baselineCompared: phase !== "old" };
        });
      }
    }
    assert.equal(report.cases.length, report.executedScenarios.length * 3);
    assert.equal(report.launches.length, report.executedScenarios.length * 3);
    assert.equal(report.modelRequestsObserved.length, 0); assert.deepEqual(report.errors, []);
    report.status = "PASS_LIMITED_PROFILE_REPLAY";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try { await host?.stop("Failed replay exact owned-process cleanup"); }
    catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    for (const { server } of sinks) await new Promise(resolve => server.close(resolve));
    if (cachePrepared) try { cache("Restore"); report.cacheRestoration = read(path.join(c.out, "native-cache-restoration.json")).status;
      assert.equal(report.cacheRestoration, "PASS"); }
    catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    try {
      for (const v of originalInventories) assert.deepEqual(inventory(v.source), v.inventory);
      for (const f of currentSources) assert.equal(sha(f.path), f.sha256);
      for (const f of report.tools) assert.equal(sha(f.path), f.sha256);
      report.sourceRestoration = "UNCHANGED";
      const owned = new Set([...(report.knownProcesses || []).map(p => `${p.ProcessId}:${p.Created}`),
        ...report.cleanups.flatMap(c => c.killed)]);
      assert(!rows().some(p => owned.has(`${p.ProcessId}:${p.Created}`)));
      assert.equal(listeners([...new Set([...report.launches.flatMap(l => l.ports), ...sinks.map(s => s.port)])]).length, 0);
      report.ownedCleanup = "PASS";
    } catch (e) { report.finalEvidenceError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out: c.out, cases: report.cases.length,
      error: report.error, cleanupError: report.cleanupError, finalEvidenceError: report.finalEvidenceError }));
  }
}
async function selfTest(config) {
  validateConfig(config); let rejected = 0;
  for (const p of ["F:/", "F:/AgentVN", "D:/AgentVN", "C:/Users/1"]) {
    assert.throws(() => validateConfig({ ...config, qa: p })); rejected++;
    assert.throws(() => validateConfig({ ...config, out: p })); rejected++;
  }
  for (const mutate of [c => c.scenarios = [], c => c.scenarios[0].kind = "unknown",
    c => c.scenarios[0].report.sha256 = "invalid", c => c.version = c.oldVersion,
    c => c.only = [], c => c.only = ["assistant"], c => { c.only = ["components"]; delete c.continuation; }]) {
    const bad = structuredClone(config); mutate(bad); assert.throws(() => validateConfig(bad)); rejected++;
  }
  const priorFile = config.continuation?.path || path.join(config.qa, "session-01/report.json");
  const prior = read(priorFile), oldValue = prior.componentProjectBaseline;
  assert.equal(prior.status, "FAILED");
  assert.match(prior.error, /53480/); assert.match(prior.error, /55298/);
  const library = read(path.join(path.dirname(priorFile), "components-old-records.json"));
  const launch = prior.launches[3];
  const verified = await verifyProjectResources(oldValue, library, launch, async u => {
    const asset = oldValue.asset_manifest.find(a => a.metadata.url === u); assert(asset);
    return fs.readFileSync(path.join(launch.data, "backend/project_assets", asset.metadata.backend_asset_path));
  });
  const differentPort = structuredClone(oldValue);
  for (const a of differentPort.asset_manifest) a.metadata.url = a.metadata.url.replace(":55298/", ":53480/");
  const next = await verifyProjectResources(differentPort, library,
    { ...launch, ports: [53480, 53481] }, async u => {
      const asset = differentPort.asset_manifest.find(a => a.metadata.url === u); assert(asset);
      return fs.readFileSync(path.join(launch.data, "backend/project_assets", asset.metadata.backend_asset_path));
    });
  assert.deepEqual(verified.value, next.value);
  const asset = oldValue.asset_manifest[0], origin = "http://127.0.0.1:55298";
  const bytes = fs.readFileSync(path.join(launch.data, "backend/project_assets", asset.metadata.backend_asset_path));
  const cases = [
    a => a.metadata.url = a.metadata.url.replace(":55298", ":55297"),
    a => a.metadata.url = a.metadata.url.replace("127.0.0.1", "example.org"),
    a => a.metadata.url += "?a=1", a => a.metadata.url += "#x",
    a => a.metadata.url = a.metadata.url.replace("/ui/", "/other/"),
    a => a.metadata.backend_asset_path = "../escape.png",
    a => a.metadata.backend_asset_path = "%2e%2e/escape.png",
    a => a.metadata.size_bytes++, a => a.metadata.filename = "wrong.png",
  ];
  for (const mutate of cases) {
    const bad = structuredClone(asset); mutate(bad);
    assert.throws(() => verifyResource(bad, origin, library.flatMap(c => c.assets), bytes, bytes));
  }
  assert.throws(() => verifyResource(asset, origin, library.flatMap(c => c.assets), Buffer.from("bad"), bytes));
  assert.throws(() => verifyResource(asset, origin, [], bytes, bytes));
  assert.throws(() => normalizeVerifiedProject(oldValue, []));
  console.log(JSON.stringify({ status: "PASS", invalidConfigurationsRejected: rejected,
    realFailedEvidenceReplayed: true, resourcePairsCompared: verified.evidence.length,
    invalidResourcesRejected: cases.length + 3, nativeApps: 0, modelRequests: 0 }));
}
module.exports = { validateConfig, inventory, deriveActual, semanticConversations,
  verifyResource, verifyProjectResources, normalizeVerifiedProject };
if (require.main === module) {
  const [action, config] = process.argv.slice(2);
  assert(config && ["self-test", "run"].includes(action));
  if (action === "self-test") selfTest(read(config)).catch(e => { console.error(e); process.exitCode = 1; });
  else replay(config).catch(e => { console.error(e); process.exitCode = 1; });
}
