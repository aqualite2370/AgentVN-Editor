"use strict";
const assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");

async function startOwnedCreationApi(output) {
  const root = path.resolve(__dirname, "../..");
  const child = spawn("python", ["-u", path.join(__dirname, "assistant-creation-acceptance-host.py"),
    path.join(output, "isolated-creation.db")], {
    cwd: path.join(root, "backend"), windowsHide: true,
    env: { ...process.env, PYTHONUTF8: "1" }, stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "", stderr = "", cleanup;
  const logFile = path.join(output, "creation-api.log");
  const log = fs.createWriteStream(logFile, { flags: "wx" });
  child.stdout.on("data", data => log.write(data));
  child.stderr.on("data", data => log.write(data));
  let doneResolve;
  const done = new Promise(resolve => { doneResolve = resolve; });
  child.once("exit", (code, signal) => doneResolve({ code, signal }));
  child.stderr.on("data", data => { stderr += data.toString(); });
  let stopped;
  const stop = () => stopped ??= (async () => {
    child.stdin.end("stop\n");
    const timer = setTimeout(() => child.kill(), 15000);
    const exit = await done;
    clearTimeout(timer);
    await new Promise(resolve => log.end(resolve));
    return { ...exit, ...cleanup };
  })();
  try {
    const identity = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Owned creation API readiness timed out")), 25000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", (code, signal) => { clearTimeout(timer); reject(new Error(`Owned creation API exited ${code}/${signal}: ${stderr}`)); });
      child.stdout.on("data", data => {
        stdout += data.toString();
        const ready = stdout.match(/^AGENTVN_CREATION_HOST_READY (.+)$/m);
        const cleaned = stdout.match(/^AGENTVN_CREATION_HOST_CLEANUP (.+)$/m);
        if (cleaned) cleanup = JSON.parse(cleaned[1]);
        if (ready) { clearTimeout(timer); resolve(JSON.parse(ready[1])); }
      });
    });
    assert.equal(identity.pid, child.pid, "Creation API ownership mismatch");
    return { ...identity, stop, assertAlive() {
      assert.equal(child.exitCode, null, "Owned creation API must still be running");
      assert.equal(child.signalCode, null, "Owned creation API must not have been terminated");
    } };
  } catch (error) {
    await stop();
    throw error;
  }
}
async function startOwnedCreationSidecar(output, executable) {
  executable = path.resolve(executable);
  assert(fs.existsSync(executable), "The new packaged backend must exist");
  const host = await startOwnedCreationApi(output);
  let child;
  let stopped;
  const stop = () => stopped ??= (async () => {
    let taskkill = null;
    if (child && child.exitCode === null && child.signalCode === null) {
      taskkill = await new Promise(resolve => execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true }, error => resolve(error ? error.code : 0)));
    }
    const sourceCleanup = await host.stop();
    return { ...sourceCleanup, sidecarTaskkill: taskkill,
      code: sourceCleanup.code === 0 && (taskkill === null || taskkill === 0) ? 0 : 1 };
  })();
  try {
    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const port = probe.address().port;
        probe.close(error => error ? reject(error) : resolve(port));
      });
    });
    const apiUrl = `http://127.0.0.1:${port}`;
    const database = path.join(path.resolve(output), "packaged-creation.db");
    child = spawn(executable, [], {
      cwd: path.dirname(executable), windowsHide: true, stdio: "ignore",
      env: { ...process.env, DATABASE_PATH: database, AGENTVN_BACKEND_PORT: String(port),
        AGENTVN_BACKEND_LOG: path.join(path.resolve(output), "packaged-backend-errors.log"),
        AGENTVN_BACKEND_DATA_DIR: path.resolve(output), AGENTVN_EDITOR_DATA_DIR: path.resolve(output),
        AGENTVN_LEGACY_DATABASE_PATHS: "", LLM_API_KEY: "test-only-secret", LLM_BASE_URL: host.modelUrl,
        LLM_MODEL: "controlled-model", EMBEDDING_API_KEY: "test-only-secret", EMBEDDING_BASE_URL: host.modelUrl },
    });
    let startupError;
    child.once("error", error => { startupError = error; });
    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("Owned sidecar exited before readiness");
      try {
        const response = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok && (await response.json()).service === "agentvn-backend") { ready = true; break; }
      } catch (_) { /* An owned service can still be starting; deadline and exit checks above remain binding. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(ready, "Owned packaged backend readiness timed out");
    const exeSha256 = crypto.createHash("sha256").update(fs.readFileSync(executable)).digest("hex");
    return { apiUrl, modelUrl: host.modelUrl, database, executable, exeSha256,
      pid: child.pid, modelHostPid: host.pid, mode: "packaged-sidecar-controlled-external-model-not-installed-editor",
      stop, assertAlive() {
        host.assertAlive();
        assert.equal(child.exitCode, null, "Owned packaged sidecar exited");
        assert.equal(child.signalCode, null, "Owned packaged sidecar was terminated");
      } };
  } catch (error) { await stop(); throw error; }
}
module.exports = { startOwnedCreationApi, startOwnedCreationSidecar };
