"use strict";
// Two separate current packaged EXEs, one isolated SQLite database. External
// model responses only are controlled. Never a real-model/Editor-UI claim.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const { qa, summary, exe, sha, desc, load } = require("./packaged-backend-continuation.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { controlledAssistantProvider } = require("./lib/controlled-assistant-provider.cjs");
const stages = [
  "two-genuine-exes-share-isolated-database-and-see-owner-project-task",
  "cross-backend-fifo-and-queued-cancel-with-only-one-running-agent",
  "other-backend-cancels-running-task-and-late-result-is-not-accepted",
  "owner-death-fails-running-and-queued-tasks-without-replaying-and-survivor-resumes",
  "cancel-request-then-owner-death-recovers-cancelled-and-releases-global-lock",
  "new-backend-restart-retains-nine-terminal-tasks-and-unchanged-author-projects",
];
const identity = p => `${p.ProcessId}:${p.Created}`;
async function run(name) {
  assert(/^creation-\d{2}$/.test(name));
  const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const prep = load(path.join(summary, "preparation.json"));
  const build = load(path.join(qa, "build-02/report.json"));
  assert.equal(build.status, "CURRENT_PACKAGED_BACKEND_BUILD_SOURCE_MATCH_PASS");
  assert.equal(sha(exe), build.built.sha256);
  const staged = path.join(out, "copied backend", "creator-backend.exe");
  fs.mkdirSync(path.dirname(staged)); fs.copyFileSync(exe, staged, fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const data = path.join(out, "shared-data"), database = path.join(data, "vn_engine.db");
  fs.mkdirSync(data);
  const r = { status: "RUNNING", at: new Date().toISOString(), executable: desc(staged), database,
    scope: "TWO_REAL_PACKAGED_BACKEND_EXES_SHARED_ISOLATED_DB_CONTROLLED_NATIVE_AGENT_NOT_EDITOR_OR_LIVE_MODEL",
    cases: [], launches: [], cleanups: [], snapshots: [], http: [], realModelRequests: 0, paidModelRequests: 0,
    boundaries: ["Explicitly isolated database, not default installed Editor database validation",
      "Two actual backend EXEs, not two frontend windows sharing one Python backend",
      "Native submit tool is a valid model choice; no mandatory fixed tool ordering",
      "No frontend Runtime preview, reviewer merge, native input or game export in this slice",
      "Exact-owned forced death/restart is fault injection, not normal Editor-close acceptance"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  const slots = new Map(), known = new Map(), initialProjects = new Map();
  let provider;
  const immutable = () => {
    for (const item of [...prep.frozen, ...prep.products, prep.input, prep.original,
      ...prep.sources.filter(f => f.path.includes(`${path.sep}backend${path.sep}`) && f.path.endsWith(".py"))])
      assert.equal(sha(item.path), item.sha256, item.path);
    assert.equal(sha(exe), build.built.sha256); assert.equal(sha(staged), build.built.sha256);
  };
  function remember(slot) {
    const all = rows(), owned = ownedProcessTree(all, slot.child.pid, slot.launch.created);
    if (owned.length) slot.launch.created = owned[0].Created;
    for (const p of owned) {
      assert.equal(path.resolve(p.ExecutablePath), staged);
      known.set(identity(p), p); slot.known.set(identity(p), p);
    }
    r.known = [...known.values()]; save(); return all;
  }
  async function freePort() {
    return new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject);
      s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(e => e ? reject(e) : resolve(port)); }); });
  }
  async function start(label) {
    assert(!slots.has(label));
    const port = await freePort(); assert.equal(listeners([port]).length, 0);
    const temp = path.join(out, `temporary-${r.launches.length + 1}`); fs.mkdirSync(temp);
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^(AGENTVN_|LLM_|EMBEDDING_|WEBVIEW2_|DATABASE_PATH$)/.test(key)) delete env[key];
    Object.assign(env, { DATABASE_PATH: database, AGENTVN_BACKEND_PORT: String(port),
      AGENTVN_BACKEND_DATA_DIR: data, AGENTVN_EDITOR_DATA_DIR: data, AGENTVN_LEGACY_DATABASE_PATHS: "",
      AGENTVN_BACKEND_LOG: path.join(out, `backend-${r.launches.length + 1}.log`),
      LLM_API_KEY: "test-only-secret", LLM_BASE_URL: provider.url, LLM_MODEL: "controlled-model",
      EMBEDDING_API_KEY: "test-only-secret", EMBEDDING_BASE_URL: provider.url, TEMP: temp, TMP: temp });
    const fd = fs.openSync(path.join(out, `process-${r.launches.length + 1}.log`), "wx");
    let child;
    try { child = spawn(staged, [], { cwd: path.dirname(staged), env, windowsHide: true,
      stdio: ["ignore", fd, fd] }); } finally { fs.closeSync(fd); }
    let error; child.once("error", e => { error = e; });
    const launch = { label, pid: child.pid, port, startedAt: new Date().toISOString(), database,
      executable: desc(staged), cwd: path.dirname(staged), temp };
    const slot = { child, launch, known: new Map(), base: `http://127.0.0.1:${port}` };
    slots.set(label, slot); r.launches.push(launch); remember(slot);
    await until(async () => {
      if (error) throw error;
      assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
      try {
        const res = await fetch(`${slot.base}/api/health`, { headers: { connection: "close" },
          signal: AbortSignal.timeout(1000) });
        return res.ok && (await res.json()).service === "agentvn-backend";
      } catch { return false; }
    }, `actual packaged backend ${label}`, 90000);
    remember(slot); launch.listeners = listeners([port]);
    assert.equal(launch.listeners.length, 1);
    assert(slot.known.size >= 2);
    assert(launch.listeners.every(l => [...slot.known.values()].some(p => p.ProcessId === l.OwningProcess)));
    return slot;
  }
  async function stop(label, reason) {
    const slot = slots.get(label); if (!slot) return;
    remember(slot);
    const killed = [];
    for (const p of [...slot.known.values()].reverse()) {
      if (!rows().some(n => identity(n) === identity(p))) continue;
      ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
        `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}')` +
        `{Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`); killed.push(identity(p));
    }
    const now = rows(), cleanup = { label, reason, killed, normalCloseClaimed: false,
      survivors: [...slot.known.values()].filter(p => now.some(n => identity(n) === identity(p))),
      listeners: listeners([slot.launch.port]) };
    r.cleanups.push(cleanup); save();
    assert.equal(cleanup.survivors.length, 0); assert.equal(cleanup.listeners.length, 0); slots.delete(label);
  }
  async function api(label, route, body, expected = 200) {
    const slot = slots.get(label); assert(slot && slot.child.exitCode === null && slot.child.signalCode === null);
    const response = await fetch(`${slot.base}${route}`, {
      headers: { connection: "close" },
      ...(body === undefined ? {} : { method: "POST", headers: { connection: "close", "content-type": "application/json" },
        body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
    });
    const value = await response.json();
    r.http.push({ label, route, method: body === undefined ? "GET" : "POST", status: response.status, at: Date.now() });
    save(); assert.equal(response.status, expected, JSON.stringify(value));
    assert(!JSON.stringify(value).includes("test-only-secret"), "Public API response must not leak test key");
    return value;
  }
  const processRoute = id => `/api/assistant/creation/processes/${id}`;
  const task = (label, id) => api(label, processRoute(id));
  const waitTask = (label, id, status, timeout = 45000) => until(async () => {
    const current = await task(label, id); return current.status === status && current;
  }, `${label} observes ${id} ${status}`, timeout);
  async function snapshot(label) {
    const list = (await api(label, "/api/assistant/creation/processes")).processes;
    assert.equal(list.filter(p => ["running", "cancelling"].includes(p.status)).length <= 1, true);
    r.snapshots.push({ label, at: Date.now(), processes: list }); save(); return list;
  }
  async function submit(label, id, marker, project) {
    provider.hold(marker);
    const result = await api(label, "/api/assistant/creation/processes", { id, project_id: project,
      project_title: `隔离队列${project}`, conversation_id: `conversation-${id}`,
      request: { user_request: `${marker} 构建安全的标题关于按钮`, agent_tools: true,
        provider_selection: { connection_id: "qa-local", model_id: "controlled-model",
          base_url: provider.url, api_key: "test-only-secret",
          parameters: { structured_mode: "tools", request_timeout_seconds: 300 } } } }, 202);
    assert.equal(result.id, id); return result;
  }
  async function request(index, marker) {
    const entry = await until(() => provider.requests[index], `external controlled native call ${index}`);
    assert.equal(entry.marker, marker); assert(entry.creation && !entry.stream);
    assert(entry.tools.includes("submit_assistant_component_draft"));
    assert.equal(provider.requests.length, index + 1);
    await snapshot(slots.has("first") ? "first" : "second");
    return entry;
  }
  async function unchanged(label) {
    for (const [id, previous] of initialProjects) {
      const actual = (await api(label, `/api/project/projects/${id}`)).data;
      for (const key of ["nodes", "edges", "editor_settings", "project_id"])
        assert.deepEqual(actual[key], previous[key], `Agent must not mutate ${id}/${key}`);
      const technical = assets => assets.map(a => ({ ...a, metadata: { ...a.metadata, url: undefined } }));
      assert.deepEqual(technical(actual.asset_manifest), technical(previous.asset_manifest));
    }
  }
  async function stage(name, fn) {
    const c = { name, status: "RUNNING", startedAt: new Date().toISOString() }; r.cases.push(c); save();
    console.log(`START ${name}`);
    try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
    finally { c.finishedAt = new Date().toISOString(); save(); }
  }
  const ids = { a: "cross-queue-a", b: "cross-queue-b", c: "cross-queue-c", d: "cross-queue-d",
    deadRunning: "cross-dead-running", deadQueued: "cross-dead-queued", survivor: "cross-survivor",
    cancelDeath: "cross-cancel-death", recovered: "cross-recovered" };
  try {
    immutable(); provider = await controlledAssistantProvider(); r.controlledEndpoint = provider.url;
    await start("first"); await start("second");
    await stage(stages[0], async () => {
      for (const letter of ["a", "b"]) {
        const fixture = load(prep.input.path); fixture.project_id = `packaged-cross-${letter}`;
        fixture.title = `后台双进程隔离${letter}`;
        const input = path.join(out, `${fixture.project_id}.vnproj`);
        fs.writeFileSync(input, JSON.stringify(fixture, null, 2), { flag: "wx" });
        const response = await fetch(`${slots.get("first").base}/api/project/projects/import`, { method: "POST",
          headers: { connection: "close", "content-type": "application/octet-stream" }, body: fs.readFileSync(input),
          signal: AbortSignal.timeout(10000) });
        assert.equal(response.status, 200); const actual = (await response.json()).data;
        initialProjects.set(fixture.project_id, actual);
        assert.deepEqual((await api("second", `/api/project/projects/${fixture.project_id}`)).data.nodes, actual.nodes);
      }
      await submit("first", ids.a, "QUEUE_A", "packaged-cross-a"); await request(0, "QUEUE_A");
      const a = await waitTask("second", ids.a, "running");
      assert.equal(a.projectId, "packaged-cross-a");
      assert.notEqual(r.launches[0].listeners[0].OwningProcess, r.launches[1].listeners[0].OwningProcess);
      return { task: a, launches: r.launches.slice(0, 2), projects: [...initialProjects.keys()] };
    });
    await stage(stages[1], async () => {
      await submit("second", ids.b, "QUEUE_B", "packaged-cross-b");
      await submit("first", ids.c, "QUEUE_C", "packaged-cross-a");
      assert.equal((await task("first", ids.b)).status, "queued");
      assert.equal((await task("second", ids.c)).status, "queued");
      await api("second", `${processRoute(ids.c)}/cancel`, {});
      assert.equal((await task("first", ids.c)).status, "cancelled");
      await submit("first", ids.d, "QUEUE_D", "packaged-cross-a");
      await snapshot("second"); assert.equal(provider.requests.length, 1);
      provider.release("QUEUE_A");
      await waitTask("second", ids.a, "completed"); await request(1, "QUEUE_B");
      assert.equal((await task("second", ids.d)).status, "queued");
      assert.equal((await task("first", ids.b)).status, "running");
      provider.release("QUEUE_B");
      await waitTask("first", ids.b, "completed"); await request(2, "QUEUE_D");
      assert.equal(provider.maxConcurrentCreation, 1);
      return { order: provider.requests.map(p => p.marker), cancelledQueued: await task("second", ids.c),
        maxConcurrentCreation: provider.maxConcurrentCreation };
    });
    await stage(stages[2], async () => {
      const cancelling = await api("second", `${processRoute(ids.d)}/cancel`, {});
      assert.equal(cancelling.status, "cancelling");
      assert.equal((await task("first", ids.d)).status, "cancelling");
      provider.release("QUEUE_D");
      const result = await waitTask("second", ids.d, "cancelled");
      assert(!result.result); assert.equal(provider.requests.length, 3); await unchanged("second");
      return { result, requests: provider.requests.length };
    });
    await stage(stages[3], async () => {
      await submit("second", ids.deadRunning, "PEER_A", "packaged-cross-b"); await request(3, "PEER_A");
      await submit("second", ids.deadQueued, "PEER_C", "packaged-cross-b");
      await submit("first", ids.survivor, "PEER_B", "packaged-cross-a");
      const before = await snapshot("first");
      assert.equal(before.find(p => p.id === ids.deadQueued).status, "queued");
      assert.equal(before.find(p => p.id === ids.survivor).status, "queued");
      await stop("second", "Injected exact-owned death while native model request and next task pending");
      provider.release("PEER_A");
      const runningFailure = await waitTask("first", ids.deadRunning, "failed");
      assert.equal(runningFailure.errorCode, "worker_lost"); assert(!runningFailure.result);
      // The durable queued owner's lease is 30s. Do not falsify its clock or
      // bypass the real expired-lease + OS process-presence recovery check.
      const queuedFailure = await waitTask("first", ids.deadQueued, "failed", 60000);
      assert.equal(queuedFailure.errorCode, "worker_lost");
      await request(4, "PEER_B"); provider.release("PEER_B");
      const survivor = await waitTask("first", ids.survivor, "completed");
      assert(!provider.requests.some(p => p.marker === "PEER_C"));
      assert.equal(provider.requests.filter(p => p.marker === "PEER_A").length, 1);
      await unchanged("first");
      return { runningFailure, queuedFailure, survivor, requests: provider.requests.length };
    });
    await stage(stages[4], async () => {
      await start("second");
      await submit("first", ids.cancelDeath, "INTERRUPTED_A", "packaged-cross-a"); await request(5, "INTERRUPTED_A");
      assert.equal((await api("second", `${processRoute(ids.cancelDeath)}/cancel`, {})).status, "cancelling");
      await stop("first", "Injected exact-owned death after other backend requests cancellation");
      provider.release("INTERRUPTED_A");
      const result = await waitTask("second", ids.cancelDeath, "cancelled");
      assert.equal(result.errorCode, "worker_lost"); assert(!result.result);
      await submit("second", ids.recovered, "RESUME_A", "packaged-cross-b"); await request(6, "RESUME_A");
      provider.release("RESUME_A");
      const recovered = await waitTask("second", ids.recovered, "completed");
      assert.equal(provider.requests.length, 7); assert.equal(provider.maxConcurrentCreation, 1);
      return { result, recovered, noReplayedRequest: true };
    });
    await stage(stages[5], async () => {
      const finalBefore = await snapshot("second");
      assert.equal(finalBefore.length, 9);
      await stop("second", "Intentional exact-owned restart after all queue tasks become terminal");
      await start("second");
      const after = await snapshot("second"); assert.deepEqual(after, finalBefore);
      const expected = [[ids.a, "completed"], [ids.b, "completed"], [ids.c, "cancelled"],
        [ids.d, "cancelled"], [ids.deadRunning, "failed"], [ids.deadQueued, "failed"],
        [ids.survivor, "completed"], [ids.cancelDeath, "cancelled"], [ids.recovered, "completed"]];
      for (const [id, status] of expected) assert.equal(after.find(p => p.id === id)?.status, status);
      await unchanged("second"); assert.equal(provider.requests.length, 7);
      r.finalTasks = after; r.initialProjects = [...initialProjects.values()];
      return { expected, tasks: after, projectsUnchanged: true, modelRequests: provider.requests.length };
    });
    assert.equal(r.cases.length, stages.length); assert(r.cases.every(c => c.status === "PASS"));
    r.status = "CURRENT_PACKAGED_CREATION_CROSS_PROCESS_PASS";
  } catch (e) {
    r.status = "FAILED"; r.error = String(e.stack || e);
    if (e.cause) r.errorCause = { message: e.cause.message, code: e.cause.code, stack: e.cause.stack };
    process.exitCode = 1;
  }
  finally {
    for (const label of [...slots.keys()]) {
      try { await stop(label, "Final exact-owned cleanup; not normal-close evidence"); }
      catch (e) { (r.cleanupErrors ??= []).push(String(e)); r.status = "FAILED"; process.exitCode = 1; }
    }
    if (provider) {
      r.controlledRequests = provider.requests; r.providerCleanup = await provider.stop();
      r.providerListenersAfterCleanup = listeners([Number(new URL(provider.url).port)]);
      if (r.providerListenersAfterCleanup.length) { r.status = "FAILED"; process.exitCode = 1; }
    }
    try { immutable(); r.protectedInputsUnchanged = true; }
    catch (e) { r.immutabilityError = String(e); r.status = "FAILED"; process.exitCode = 1; }
    if (fs.existsSync(database)) r.finalDatabase = desc(database);
    r.finishedAt = new Date().toISOString(); r.testSource = desc(__filename); save();
    console.log(JSON.stringify({ status: r.status, cases: r.cases.map(c => ({ name: c.name, status: c.status })),
      out, error: r.error, cleanupErrors: r.cleanupErrors }));
  }
}
if (require.main === module) run(process.argv[2]).catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { stages };
