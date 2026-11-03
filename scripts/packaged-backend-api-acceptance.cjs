"use strict";
// Real copied PyInstaller EXE, HTTP, SQLite and process restarts. Only the
// external model endpoint is controlled; no AgentVN route/store mocks.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const { qa, summary, exe, load, sha, desc } = require("./packaged-backend-continuation.cjs");
const { controlledNovelFailureProvider } = require("./lib/controlled-novel-failure-provider.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");

async function run(name, buildName) {
  assert(/^api-\d{2}$/.test(name)); assert(/^build-\d{2}$/.test(buildName));
  const out = path.join(qa, name);
  assert(!fs.existsSync(out), "Never overwrite a previous run");
  fs.mkdirSync(out);
  const prep = load(path.join(summary, "preparation.json"));
  const buildFile = path.join(qa, buildName, "report.json"), build = load(buildFile);
  assert.equal(build.status, "CURRENT_PACKAGED_BACKEND_BUILD_SOURCE_MATCH_PASS");
  assert.equal(sha(exe), build.built.sha256);
  const staged = path.join(out, "isolated executable", "creator-backend.exe");
  fs.mkdirSync(path.dirname(staged));
  fs.copyFileSync(exe, staged, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(staged), build.built.sha256);
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const data = path.join(out, "data"), temp = path.join(out, "temporary");
  fs.mkdirSync(data); fs.mkdirSync(temp);
  const database = path.join(data, "vn_engine.db");
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), build: desc(buildFile),
    executable: desc(staged), input: prep.input, database, cases: [], launches: [], cleanups: [], http: [],
    realModelRequests: 0, paidModelRequests: 0,
    scope: "COPIED_CURRENT_PACKAGED_BACKEND_REAL_HTTP_AND_SQLITE_NOT_INSTALLED_EDITOR",
    boundaries: ["Controlled loopback external model responses; no AgentVN API/store mocks",
      "Explicit isolated database, working directory and temporary extraction path",
      "Workspace remains present on this host; not proof of a development-directory-free installation",
      "Forced exact-owned process restart; not proof of normal Editor close",
      "No Windows game/Android export, native folder selection or installer acceptance"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  const pidKey = p => `${p.ProcessId}:${p.Created}`;
  const known = new Map();
  let child, active, base, provider, completedJob, pausedJob, cancelledJob, imported;
  function immutable() {
    for (const item of [...prep.frozen, ...prep.products, prep.input, prep.original,
      ...prep.sources.filter(f => f.path.includes(`${path.sep}backend${path.sep}`) && f.path.endsWith(".py"))])
      assert.equal(sha(item.path), item.sha256, `Protected artifact changed: ${item.path}`);
    assert.equal(sha(staged), build.built.sha256);
    assert.equal(sha(exe), build.built.sha256);
  }
  function remember() {
    const all = rows();
    if (child && active) {
      const owned = ownedProcessTree(all, child.pid, active.created);
      if (owned.length) active.created = owned[0].Created;
      for (const p of owned) {
        assert.equal(path.resolve(p.ExecutablePath).toLowerCase(), staged.toLowerCase(),
          "Unexpected process executable in isolated backend tree");
        known.set(pidKey(p), p);
      }
      r.known = [...known.values()]; save();
    }
    return all;
  }
  async function freePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer(); server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port; server.close(e => e ? reject(e) : resolve(port));
      });
    });
  }
  async function api(route, body, method = "POST", expected = 200) {
    assert(child && child.exitCode === null && child.signalCode === null, "Owned EXE must be alive");
    const response = await fetch(`${base}${route}`, {
      ...(body === undefined ? {} : { method, headers: { "content-type": "application/json" },
        body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
    });
    const value = await response.json();
    r.http.push({ at: new Date().toISOString(), route, method: body === undefined ? "GET" : method,
      status: response.status }); save();
    assert.equal(response.status, expected, JSON.stringify(value));
    assert(!JSON.stringify(value).includes("test-only-secret"), "Public API must redact the provider key");
    return value;
  }
  async function start() {
    const port = await freePort(); assert.equal(listeners([port]).length, 0);
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$|LLM_|EMBEDDING_)/.test(key)) delete env[key];
    Object.assign(env, { AGENTVN_BACKEND_PORT: String(port), AGENTVN_BACKEND_DATA_DIR: data,
      AGENTVN_EDITOR_DATA_DIR: data, DATABASE_PATH: database, AGENTVN_LEGACY_DATABASE_PATHS: "",
      AGENTVN_BACKEND_LOG: path.join(out, `backend-${r.launches.length + 1}.log`),
      LLM_API_KEY: "test-only-secret", LLM_BASE_URL: provider.url, LLM_MODEL: "controlled-novel-fault",
      EMBEDDING_API_KEY: "test-only-secret", EMBEDDING_BASE_URL: provider.url,
      TEMP: temp, TMP: temp });
    const fd = fs.openSync(path.join(out, `process-${r.launches.length + 1}.log`), "wx");
    try { child = spawn(staged, [], { cwd: path.dirname(staged), env, windowsHide: true,
      stdio: ["ignore", fd, fd] }); } finally { fs.closeSync(fd); }
    let spawnError; child.once("error", e => { spawnError = e; });
    active = { pid: child.pid, port, startedAt: new Date().toISOString(), executable: desc(staged),
      cwd: path.dirname(staged), database, environment: { TEMP: temp, TMP: temp,
        AGENTVN_BACKEND_DATA_DIR: data, AGENTVN_LEGACY_DATABASE_PATHS: "" } };
    r.launches.push(active); base = `http://127.0.0.1:${port}`; remember();
    await until(async () => {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
      try {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
        return response.ok && (await response.json()).service === "agentvn-backend";
      } catch { return false; }
    }, "copied packaged backend readiness", 90000);
    remember(); active.listeners = listeners([port]);
    assert.equal(active.listeners.length, 1);
    assert(active.listeners.every(l => [...known.values()].some(p => p.ProcessId === l.OwningProcess)));
    // Health readiness does not promise eager schema/file creation. On restart
    // the previously persisted database must already exist.
    if (r.launches.length > 1) assert(fs.existsSync(database), "Persisted database must survive restart");
    save();
  }
  async function stop(reason) {
    if (!child) return;
    remember();
    const killed = [];
    for (const p of [...known.values()].reverse()) {
      if (!rows().some(now => pidKey(now) === pidKey(p))) continue;
      ps(`$owned=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
        `if($owned -and $owned.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}')` +
        `{Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
      killed.push(pidKey(p));
    }
    const now = rows(), result = { reason, killed, normalCloseClaimed: false,
      survivors: [...known.values()].filter(p => now.some(n => pidKey(n) === pidKey(p))),
      listeners: listeners([active.port]) };
    r.cleanups.push(result); save();
    assert.equal(result.survivors.length, 0); assert.equal(result.listeners.length, 0);
    child = undefined;
  }
  async function step(name, fn) {
    const c = { name, status: "RUNNING", startedAt: new Date().toISOString() }; r.cases.push(c); save();
    console.log(`START ${name}`);
    try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
    finally { c.finishedAt = new Date().toISOString(); save(); }
  }
  const route = (id, suffix = "") => `/api/novel/processing/execute/jobs/${id}${suffix}`;
  const job = id => api(route(id));
  async function request(index, chapter) {
    const found = await until(() => provider.requests[index]?.input && provider.requests[index],
      `controlled external request ${index}`, 45000);
    assert.equal(provider.requests.length, index + 1, "No unexpected automatic retries");
    assert.equal(found.input.chapterIndex, chapter); return found;
  }
  async function terminal(id, status) {
    return until(async () => {
      const state = await job(id);
      if (!["completed", "failed", "failed_partial", "cancelled"].includes(state.status)) return false;
      assert.equal(state.status, status, JSON.stringify(state)); return state;
    }, `job ${id} ${status}`);
  }
  async function phase(id, status) {
    const snapshot = await api(route(id, "/panel"));
    const phases = snapshot.phaseProgress.filter(p => ["import_write", "validation"].includes(p.phase));
    assert.equal(phases.length, 2);
    for (const p of phases) { assert.equal(p.percent, 0); assert.equal(p.status, status); }
    return phases;
  }
  async function create(book) {
    return api("/api/novel/processing/execute/jobs", {
      bookId: book, title: "发布后台隔离回归", userInstruction: "改编为旁白，不生成素材引用。",
      outputFormat: "scene_fragment", promptVersion: "novel-process-v3", maxConcurrency: 1, maxRetries: 0,
      chunks: [0, 1].map(i => ({ chunkId: `${book}-chapter-${i}`, chapterIndex: i, chunkIndex: 0,
        chapterTitle: `第${i + 1}章`, chunkText: "雨停了，窗边留下了雨水，远处的灯光逐渐明亮。",
        startOffset: 0, endOffset: 29 })),
      providerSelection: { connection_id: "qa-loopback", model_id: "controlled-novel-fault",
        base_url: provider.url, api_key: "test-only-secret",
        parameters: { structured_mode: "json_object", request_timeout_seconds: 300 } },
    });
  }
  const fixture = load(prep.input.path);
  const expected = new Map(fixture.asset_manifest.map(a => [a.asset_id,
    Buffer.from(decodeURIComponent(a.metadata.data_url.split(",").slice(1).join(",")), "utf8")]));
  async function assets(project) {
    assert.equal(project.asset_manifest.length, 7);
    const records = [];
    for (const a of project.asset_manifest) {
      const target = new URL(a.metadata.url);
      assert.equal(target.origin, base, "Only fetch this run's owned asset service");
      assert(target.pathname.startsWith("/api/project/assets/"));
      assert(path.resolve(a.metadata.filePath).startsWith(path.resolve(data) + path.sep));
      const response = await fetch(target, { signal: AbortSignal.timeout(10000) });
      assert(response.ok);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(bytes, expected.get(a.asset_id));
      assert.deepEqual(fs.readFileSync(a.metadata.filePath), bytes);
      records.push({ id: a.asset_id, path: a.metadata.filePath, sha256: sha(a.metadata.filePath), bytes: bytes.length });
    }
    return records;
  }
  try {
    immutable(); provider = await controlledNovelFailureProvider(); r.controlledEndpoint = provider.url;
    await start();
    await step("actual-exe-asset-import-exact-bytes-and-invalid-update-rollback", async () => {
      const response = await fetch(`${base}/api/project/projects/import`, { method: "POST",
        headers: { "content-type": "application/octet-stream" }, body: fs.readFileSync(prep.input.path),
        signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200); imported = (await response.json()).data;
      assert(fs.existsSync(database), "Actual import must create the isolated SQLite file");
      const consumed = await assets(imported);
      const bad = structuredClone(fixture);
      bad.asset_manifest[0].metadata.data_url = "data:image/svg+xml;base64,INVALID-PRIVATE-BYTES!";
      bad.asset_manifest[0].metadata.blob_url = bad.asset_manifest[0].metadata.data_url;
      const failure = await api(`/api/project/projects/${fixture.project_id}`, bad, "PUT", 422);
      assert(JSON.stringify(failure).includes("PROJECT_ASSET_DATA_URL_INVALID"));
      assert(!JSON.stringify(failure).includes("INVALID-PRIVATE-BYTES"));
      assert.deepEqual((await api(`/api/project/projects/${fixture.project_id}`)).data, imported);
      return { consumed, invalidUpdateStatus: 422, previousProjectPreserved: true };
    });
    await step("partial-failure-truthful-panel-and-manual-retry-only-failed-chapter", async () => {
      completedJob = (await create("packaged-partial")).jobId;
      await request(0, 0); provider.release(0);
      await request(1, 1); provider.release(1, "failed");
      const partial = await terminal(completedJob, "failed_partial");
      assert.equal(partial.completedChunks, 1); assert.equal(partial.failedChunks, 1);
      const originalChapter = partial.chapterResults.find(c => c.chapterIndex === 0);
      assert(originalChapter?.scene);
      const failedPhases = await phase(completedJob, "waiting");
      await api(route(completedJob, "/retry_failed_chunks"), {});
      await request(2, 1); provider.release(2);
      const result = await terminal(completedJob, "completed");
      assert.equal(result.completedChunks, 2); assert.equal(result.failedChunks, 0);
      assert.deepEqual(result.chapterResults.find(c => c.chapterIndex === 0).scene, originalChapter.scene);
      assert.equal(result.agentTasks.filter(t => t.chapterIndex === 0).length, 1);
      assert.equal(result.agentTasks.filter(t => t.chapterIndex === 1).length, 2);
      const finalPhases = await phase(completedJob, "waiting");
      const results = await api(route(completedJob, "/results"));
      assert.equal(results.completedChapterResults.length, 2);
      assert.equal(provider.requests.length, 3);
      r.completed = result;
      return { id: completedJob, partial: "failed_partial", final: result.status,
        completedResults: results.completedChapterResults, failedPhases, finalPhases };
    });
    await step("pause-blocks-next-chapter-and-resume-continues-without-reprocessing", async () => {
      pausedJob = (await create("packaged-pause")).jobId;
      await request(3, 0);
      const paused = await api(route(pausedJob, "/pause"), {}); assert.equal(paused.status, "paused");
      provider.release(3);
      const idle = await until(async () => {
        const state = await job(pausedJob); return state.completedChunks === 1 && state.runningTasks === 0 && state;
      }, "paused task finishes in-flight chapter");
      assert.equal(idle.status, "paused"); assert.equal(provider.requests.length, 4);
      assert.equal(idle.chunks.filter(c => ["pending", "waiting"].includes(c.status)).length, 1);
      await api(route(pausedJob, "/resume"), {});
      await request(4, 1); provider.release(4);
      const done = await terminal(pausedJob, "completed");
      assert.equal(done.completedChunks, 2); assert.equal(done.agentTasks.length, 2);
      r.pausedThenCompleted = done; return { id: pausedJob, paused: idle, final: done };
    });
    await step("cancel-discards-late-response-and-never-dispatches-queued-chapter", async () => {
      cancelledJob = (await create("packaged-cancel")).jobId;
      await request(5, 0);
      const cancelled = await api(route(cancelledJob, "/cancel"), {});
      assert.equal(cancelled.status, "cancelled");
      const immediate = await job(cancelledJob);
      assert.equal(immediate.completedChunks, 0);
      assert.equal(immediate.chunks.filter(c => c.status === "cancelled").length, 1);
      provider.release(5);
      const done = await until(async () => {
        const state = await job(cancelledJob); return state.runningTasks === 0 && state.cancelledChunks === 2 && state;
      }, "cancelled late response settles");
      assert.equal(done.status, "cancelled"); assert.equal(done.completedChunks, 0);
      const result = await api(route(cancelledJob, "/results"));
      assert.equal(result.completedResults.length, 0);
      assert.equal(result.completedChapterResults.length, 0);
      const phases = await phase(cancelledJob, "cancelled");
      assert.equal(provider.requests.length, 6); r.cancelled = done;
      return { id: cancelledJob, immediate, final: done, phases, result };
    });
    await step("actual-exe-restart-retains-job-results-project-graph-and-seven-asset-bytes", async () => {
      assert.deepEqual((await api(`/api/project/projects/${fixture.project_id}`)).data, imported);
      await stop("Intentional exact-owned forced restart; not normal Editor close");
      await start();
      const reopened = (await api(`/api/project/projects/${fixture.project_id}`)).data;
      assert.deepEqual(reopened.nodes, imported.nodes); assert.deepEqual(reopened.edges, imported.edges);
      const consumed = await assets(reopened);
      const results = [];
      for (const [id, expectedJob] of [[completedJob, r.completed], [pausedJob, r.pausedThenCompleted],
        [cancelledJob, r.cancelled]]) {
        const restored = await job(id);
        assert.deepEqual(restored, expectedJob);
        const phases = await phase(id, id === cancelledJob ? "cancelled" : "waiting");
        results.push({ id, status: restored.status, phases });
      }
      assert.equal(provider.requests.length, 6, "Reopening terminal jobs must not dispatch model calls");
      return { results, consumed, graphUnchanged: true };
    });
    assert.equal(r.cases.length, 5); assert(r.cases.every(c => c.status === "PASS"));
    r.status = "CURRENT_PACKAGED_BACKEND_API_PASS";
  } catch (e) {
    r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1;
  } finally {
    try { await stop("Final exact-owned cleanup; no normal-close claim"); }
    catch (e) { r.cleanupError = String(e.stack || e); r.status = "FAILED"; process.exitCode = 1; }
    if (provider) {
      r.controlledRequests = provider.requests;
      r.providerCleanup = await provider.stop();
      const port = Number(new URL(provider.url).port);
      r.providerListenersAfterCleanup = listeners([port]);
      if (r.providerListenersAfterCleanup.length) { r.status = "FAILED"; process.exitCode = 1; }
    }
    try { immutable(); r.protectedInputsUnchanged = true; }
    catch (e) { r.immutabilityError = String(e); r.status = "FAILED"; process.exitCode = 1; }
    if (fs.existsSync(database)) r.finalDatabase = desc(database);
    r.finishedAt = new Date().toISOString(); r.testSource = desc(__filename); save();
    console.log(JSON.stringify({ status: r.status, cases: r.cases.map(c => ({ name: c.name, status: c.status })),
      out, error: r.error, cleanupError: r.cleanupError }));
  }
}
if (require.main === module) run(...process.argv.slice(2)).catch(e => { console.error(e); process.exitCode = 1; });
