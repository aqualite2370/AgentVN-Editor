const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildSync } = require("../GameCli_framework/node_modules/esbuild");

const repoRoot = path.resolve(__dirname, "..");
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-save-queue-"));
const outputFile = path.join(outputDirectory, "runtimeSaveQueue.cjs");

buildSync({
  entryPoints: [path.join(repoRoot, "GameCli_framework", "src", "utils", "runtimeSaveQueue.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: outputFile,
  logLevel: "silent",
});

const { createSerialSaveQueue, createSaveWriteBarrier } = require(outputFile);

async function main() {
  const queue = createSerialSaveQueue();
  const order = [];
  let releaseFirst;
  let firstSettled = false;
  const first = queue.enqueue(async () => {
    order.push("first-start");
    await new Promise((resolve) => { releaseFirst = resolve; });
    order.push("first-finish");
    return "first";
  }).then((value) => {
    firstSettled = true;
    return value;
  });
  const second = queue.enqueue(async () => {
    order.push("second-start");
    return "second";
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["first-start"], "下一个存档必须等待正在写入的存档");
  let queueSettled = false;
  const drained = queue.wait().then((value) => {
    queueSettled = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queueSettled, false, "wait 必须等待队列中的持久化任务结束");
  releaseFirst();
  assert.equal(await first, "first");
  assert.equal(await second, "second");
  assert.equal(await drained, "second");
  assert.equal(firstSettled, true);
  assert.deepEqual(order, ["first-start", "first-finish", "second-start"]);

  const failedQueue = createSerialSaveQueue();
  await assert.rejects(
    failedQueue.enqueue(async () => { throw new Error("disk full"); }),
    /disk full/,
    "保存失败必须返回给发起退出流程的一方",
  );
  assert.equal(await failedQueue.enqueue(async () => "retry-saved"), "retry-saved",
    "单次写入失败不得毒化后续重试");
  assert.equal(await failedQueue.wait(), "retry-saved");

  const barrier = createSaveWriteBarrier();
  let releaseManual;
  const manual = barrier.track(() => new Promise(resolve => { releaseManual = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  let drainedAll = false;
  const writesFinished = barrier.wait().then(result => { drainedAll = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(drainedAll, false, "barrier includes ongoing manual saves");
  let rejectLater;
  const later = barrier.track(() => new Promise((resolve, reject) => { rejectLater = reject; }));
  const caughtLater = assert.rejects(later, /late write failure/);
  await new Promise(resolve => setImmediate(resolve));
  releaseManual();
  await manual;
  assert.equal(drainedAll, false, "new in-flight writes while draining also belong to the exit barrier");
  rejectLater(new Error("late write failure"));
  await caughtLater;
  assert.deepEqual(await writesFinished, { status: "failed", message: "late write failure" });
  assert.deepEqual(await barrier.wait(), { status: "saved" }, "completed failures must not poison a later retry");
  console.log("runtime-save-queue-test: PASS");
}

main()
  .finally(() => fs.rmSync(outputDirectory, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
