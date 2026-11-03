"use strict";
const { fork } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { pathToFileURL } = require("node:url");

async function startOwnedViteServer({ root, configFile, port = 0, logFile, timeoutMs = 60000 }) {
  const runId = randomUUID();
  const worker = fork(__filename, ["--worker", JSON.stringify({ root, configFile, port, runId })], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let logs = "";
  const log = logFile ? fs.createWriteStream(logFile, { flags: "wx" }) : undefined;
  for (const stream of [worker.stdout, worker.stderr]) stream.on("data", data => {
    logs += data.toString();
    log?.write(data);
  });
  const stopped = new Promise(resolve => worker.once("exit", resolve));
  let stopping = false;
  const stop = async () => {
    if (!stopping && worker.exitCode === null && worker.signalCode === null) {
      stopping = true;
      if (worker.connected) worker.send({ type: "stop", runId });
      else worker.kill();
    }
    const timer = setTimeout(() => {
      if (worker.exitCode === null && worker.signalCode === null) worker.kill();
    }, 5000);
    await stopped;
    clearTimeout(timer);
    log?.end();
  };
  try {
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Owned Vite readiness timeout: ${logs}`)), timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        worker.removeListener("message", onMessage);
        worker.removeListener("exit", onExit);
        worker.removeListener("error", onError);
      };
      const onMessage = value => {
        if (value?.type !== "ready" || value.runId !== runId || value.pid !== worker.pid) return;
        cleanup();
        resolve(value);
      };
      const onExit = (code, signal) => {
        cleanup();
        reject(new Error(`Owned Vite exited before ready (${code}/${signal}): ${logs}`));
      };
      const onError = error => { cleanup(); reject(error); };
      worker.on("message", onMessage);
      worker.once("exit", onExit);
      worker.once("error", onError);
    });
    const owner = {
      url: message.url, pid: worker.pid, runId, stop,
      async run(operation) {
        await this.assertAlive();
        let onExit;
        const terminated = new Promise((resolve, reject) => {
          onExit = (code, signal) => reject(new Error(`Owned Vite exited during acceptance (${code}/${signal}): ${runId}`));
          worker.once("exit", onExit);
        });
        try {
          return await Promise.race([Promise.resolve().then(operation), terminated]);
        } finally {
          worker.removeListener("exit", onExit);
        }
      },
      async assertAlive() {
        if (stopping || worker.exitCode !== null || worker.signalCode !== null)
          throw new Error(`Owned Vite is stopped/exited: ${runId}`);
        const response = await fetch(`${message.url}/__agentvn_acceptance_owner/${runId}`, {
          signal: AbortSignal.timeout(3000),
        });
        const identity = await response.json();
        if (!response.ok || identity.runId !== runId || identity.pid !== worker.pid)
          throw new Error(`Vite service ownership mismatch: ${runId}`);
      },
    };
    await owner.assertAlive();
    return owner;
  } catch (error) {
    await stop();
    throw error;
  }
}

async function workerMain() {
  const options = JSON.parse(process.argv[3]);
  if (options.port === 0) {
    options.port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const port = probe.address().port;
        probe.close(error => error ? reject(error) : resolve(port));
      });
    });
  }
  const { createServer } = await import(pathToFileURL(path.join(options.root, "node_modules/vite/dist/node/index.js")).href);
  const server = await createServer({
    root: options.root,
    configFile: options.configFile,
    configLoader: "native",
    server: { host: "127.0.0.1", port: options.port, strictPort: true, open: false },
    plugins: [{
      name: "agentvn-acceptance-owner",
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url?.split("?")[0] !== `/__agentvn_acceptance_owner/${options.runId}`) return next();
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ runId: options.runId, pid: process.pid }));
        });
      },
    }],
  });
  const shutdown = async () => { await server.close(); process.exit(0); };
  process.on("message", value => {
    if (value?.type === "stop" && value.runId === options.runId) void shutdown();
  });
  process.once("disconnect", () => void shutdown());
  await server.listen();
  const address = server.httpServer.address();
  process.send({ type: "ready", runId: options.runId, pid: process.pid, url: `http://127.0.0.1:${address.port}` });
}

if (process.argv[2] === "--worker") workerMain().catch(error => { console.error(error); process.exit(1); });
module.exports = { startOwnedViteServer };
