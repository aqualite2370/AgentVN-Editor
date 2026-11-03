const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildSync } = require("../GameCli_framework/node_modules/esbuild");

const repoRoot = path.resolve(__dirname, "..");
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-exit-flow-"));
const outputFile = path.join(outputDirectory, "runtimeExitFlow.cjs");

buildSync({
  entryPoints: [path.join(repoRoot, "GameCli_framework", "src", "utils", "runtimeExitFlow.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: outputFile,
  logLevel: "silent",
});

const { closeAfterSave, closeWithoutSave } = require(outputFile);

async function main() {
  let finishSave;
  let closeCount = 0;
  const attempt = closeAfterSave(
    () => new Promise((resolve) => { finishSave = resolve; }),
    async () => { closeCount += 1; return { status: "closed" }; },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeCount, 0, "窗口必须保持打开，直到存档落盘完成");
  finishSave({ status: "saved" });
  assert.deepEqual(await attempt, { status: "closed" });
  assert.equal(closeCount, 1);

  let shouldNotClose = 0;
  const failed = await closeAfterSave(
    async () => ({ status: "failed", message: "disk full" }),
    async () => { shouldNotClose += 1; return { status: "closed" }; },
  );
  assert.deepEqual(failed, { status: "save-failed", message: "disk full" });
  assert.equal(shouldNotClose, 0, "保存失败时不得默认关闭窗口");

  const unexpectedFailure = await closeAfterSave(
    async () => { throw new Error("storage connection lost"); },
    async () => { shouldNotClose += 1; return { status: "closed" }; },
  );
  assert.deepEqual(unexpectedFailure, { status: "save-failed", message: "storage connection lost" },
    "unexpected persistence rejection must stay visible in the exit dialog rather than becoming unhandled");
  assert.equal(shouldNotClose, 0);

  const discarded = await closeWithoutSave(async () => {
    shouldNotClose += 1;
    return { status: "closed" };
  });
  assert.deepEqual(discarded, { status: "closed" }, "显式放弃保存应走单独的关闭路径");
  assert.equal(shouldNotClose, 1);
  console.log("runtime-exit-flow-test: PASS");
}

main()
  .finally(() => fs.rmSync(outputDirectory, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
