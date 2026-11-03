const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { build } = require("../GameCli_framework/node_modules/esbuild");

const repoRoot = path.resolve(__dirname, "..");
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-runtime-close-"));
const outputFile = path.join(outputDirectory, "runtimeWindowClose.cjs");

async function compile() { await build({
  entryPoints: [path.join(repoRoot, "GameCli_framework", "src", "utils", "runtimeWindowClose.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: outputFile,
  logLevel: "silent",
  plugins: [{
    name: "native-window-boundary",
    setup(build) {
      build.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: "core", namespace: "native-exit" }));
      build.onLoad({ filter: /.*/, namespace: "native-exit" }, () => ({
        contents: "export const invoke = (...args) => globalThis.__nativeInvoke(...args);",
        loader: "js",
      }));
      build.onResolve({ filter: /^@tauri-apps\/api\/window$/ }, () => ({ path: "window", namespace: "native-window" }));
      build.onLoad({ filter: /.*/, namespace: "native-window" }, () => ({
        contents: "export const getCurrentWindow = () => globalThis.__nativeWindow;",
        loader: "js",
      }));
    },
  }],
});
}

async function main() {
  await compile();
  const { closeStandaloneRuntimeWindow, routeRuntimeWindowCloseRequest } = require(outputFile);
  let closeCalls = 0;
  let prevented = false;
  let confirmations = 0;
  assert.equal(routeRuntimeWindowCloseRequest(
    { preventDefault: () => { prevented = true; } },
    () => { confirmations += 1; },
  ), "confirmation-required");
  assert.equal(prevented, true, "unconfirmed native close must be prevented");
  assert.equal(confirmations, 1, "unconfirmed native close must open shared confirmation");

  let nativeDestroyCount = 0;
  const nativeCommands = [];
  globalThis.__nativeInvoke = async (command) => { nativeCommands.push(command); };
  let queuedCloseEvents = 0;
  globalThis.__nativeWindow = {
    close: async () => {
      setImmediate(() => {
        queuedCloseEvents += 1;
        routeRuntimeWindowCloseRequest(
          { preventDefault() {} },
          () => { confirmations += 1; },
        );
      });
    },
    destroy: async () => { nativeDestroyCount += 1; },
  };
  const nativeResult = await closeStandaloneRuntimeWindow({
    isEmbedded: () => false,
    isTauri: () => true,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nativeResult.status, "closed");
  assert.deepEqual(nativeCommands, ["exit_runtime"],
    "confirmed exit must use the platform-aware native command; Android window destroy leaves the real APK pending");
  assert.equal(nativeDestroyCount, 0,
    "the frontend must not send window destroy on Android or guess the platform from viewport size");
  assert.equal(queuedCloseEvents, 0, "confirmed exit must not enqueue a second confirmation event");
  assert.equal(confirmations, 1);

  const embedded = await closeStandaloneRuntimeWindow({
    isEmbedded: () => true,
    isTauri: () => true,
    closeWindow: async () => { closeCalls += 1; },
  });
  assert.equal(embedded.status, "preview");
  assert.equal(closeCalls, 0);
  assert.equal(nativeCommands.length, 1, "embedded preview must not send native exit");

  const browser = await closeStandaloneRuntimeWindow({
    isEmbedded: () => false,
    isTauri: () => false,
    closeWindow: async () => { closeCalls += 1; },
  });
  assert.equal(browser.status, "preview");
  assert.equal(closeCalls, 0);
  assert.equal(nativeCommands.length, 1, "browser preview must not send native exit");

  const closed = await closeStandaloneRuntimeWindow({
    isEmbedded: () => false,
    isTauri: () => true,
    closeWindow: async () => {
      closeCalls += 1;
    },
  });
  assert.equal(closed.status, "closed");
  assert.equal(closeCalls, 1);

  let reportedError;
  const failed = await closeStandaloneRuntimeWindow({
    isEmbedded: () => false,
    isTauri: () => true,
    closeWindow: async () => { throw new Error("close denied"); },
    reportError: (error) => { reportedError = error; },
  });
  assert.equal(failed.status, "failed");
  assert.match(String(reportedError), /close denied/);
  assert.equal(routeRuntimeWindowCloseRequest(
    { preventDefault: () => { prevented = true; } },
    () => { confirmations += 1; },
  ), "confirmation-required", "failed close must not leave authorization for a later user close");

  console.log("runtime-window-close-test: PASS");
}

main()
  .finally(() => fs.rmSync(outputDirectory, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
