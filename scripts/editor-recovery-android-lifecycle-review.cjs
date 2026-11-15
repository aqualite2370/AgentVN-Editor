"use strict";

// One bounded offline investigation with pinned primary-source downloads.
// It neither starts a product/device nor changes any original disposition.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const cp = require("node:child_process");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { parseThreadtime } = require("./lib/android-log-relay.cjs");
const { collectDeadHandlerEvents } = require("./lib/android-dead-handler-event.cjs");
const base = "F:/testavn/Client-Presentation-Android-1975-20261116-04";
const followup = process.argv.slice(2);
assert(followup.length === 0 || (followup.length === 1 && followup[0] === "--followup-02"),
  "Only the original investigation or its explicit additive follow-up is supported");
const priorOutput = path.join(base, "lifecycle-source-review-01");
const output = path.join(base, followup.length ? "lifecycle-source-review-02" : "lifecycle-source-review-01");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size, sha256: sha(file) });
const sourceBase = "https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android-15.0.0_r1/";
const sources = [
  ["message-queue", "core/java/android/os/MessageQueue.java",
    ["boolean enqueueMessage(", "if (mQuitting)", "Log.w(TAG, e.getMessage(), e);", "msg.recycle();"]],
  ["choreographer", "core/java/android/view/Choreographer.java",
    ["class FrameDisplayEventReceiver", "void onVsync(", "mHandler.sendMessageAtTime"]],
  ["handler-thread", "core/java/android/os/HandlerThread.java",
    ["void run()", "Looper.loop();", "boolean quit()", "looper.quit();"]],
];
async function capture([name, relative, markers], prior) {
  const row = { name, url: sourceBase + relative };
  try {
    const previous = prior?.sourceCaptures.find(item => item.name === name);
    if (previous?.status === "CAPTURED_PINNED_AOSP_REFERENCE") {
      assert.equal(previous.url, row.url);
      assert.equal(path.resolve(previous.file.path), path.resolve(priorOutput, name + ".java.txt"));
      assert.equal(sha(previous.file.path), previous.file.sha256);
      const text = fs.readFileSync(previous.file.path, "utf8");
      for (const marker of markers) assert(text.includes(marker), `${name}: ${marker}`);
      return { ...previous, reusedVerifiedCapture: true };
    }
    const response = await fetch(row.url, { signal: AbortSignal.timeout(20000) });
    row.httpStatus = response.status; assert(response.ok, "Source download failed");
    const text = await response.text();
    assert(Buffer.byteLength(text) < 1024 * 1024 && text.includes("Copyright")
      && !text.includes("\uFFFD"), "Bounded UTF-8 Java source required");
    for (const marker of markers) assert(text.includes(marker), `${name}: ${marker}`);
    const file = path.join(output, name + ".java.txt");
    fs.writeFileSync(file, text, { flag: "wx" });
    return { ...row, status: "CAPTURED_PINNED_AOSP_REFERENCE", file: desc(file) };
  } catch (error) { return { ...row, status: "FAILED", error: String(error) }; }
}
function excerpt(text, marker, before, after) {
  const lines = text.split("\n"), matches = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(marker))
    matches.push({ line: i + 1, startLine: Math.max(0, i - before) + 1,
      text: lines.slice(Math.max(0, i - before), i + after + 1).join("\n") });
  assert(matches.length > 0, "Source marker not found: " + marker);
  return matches;
}
async function main() {
  assert(!fs.existsSync(output), "Never overwrite an earlier investigation");
  const priorFile = path.join(priorOutput, "report.json");
  const prior = followup.length ? read(priorFile) : null;
  const priorDescriptor = prior ? desc(priorFile) : null;
  if (prior) {
    assert.equal(prior.status, "SOURCE_CAPTURE_INCOMPLETE_ORIGINAL_DISPOSITIONS_UNCHANGED");
    assert.equal(prior.sourceCaptures.length, 3);
    assert.equal(prior.sourceCaptures.filter(row => row.status === "FAILED").length, 1);
    assert(prior.sourceCaptures.some(row => row.name === "message-queue"
      && row.status === "FAILED" && row.error.includes("Slog.w(TAG, e.getMessage(), e);")));
  }
  const index = cp.execFileSync("git", ["rev-parse", "--git-path", "index"], { encoding: "utf8" }).trim();
  const head = cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const indexBefore = sha(index);
  const originalFile = path.join(base, "current-log-review-02.json");
  const original = read(originalFile);
  assert.equal(original.records, 271); assert.equal(original.unresolved, 92);
  const startupPath = path.join(base, "startup-failure-timeline-01.json"), startup = read(startupPath);
  const reportFile = startup.inputs.find(item => item.path.endsWith("report.json")).path;
  const logFile = startup.inputs.find(item => item.path.endsWith("failure-logcat.txt")).path;
  const product = read(reportFile), raw = fs.readFileSync(logFile, "utf8");
  assert.equal(product.status, "FAILED"); assert.equal(product.touches.length, 0);
  for (const input of startup.inputs) assert.equal(sha(input.path), input.sha256);
  const groups = collectDeadHandlerEvents(raw, [startup.hostPid]);
  assert.equal(groups.length, 1); assert(groups[0].complete);
  const stackRows = original.rows.filter(row => row.key.startsWith("device-01/")
    && row.tag === "MessageQueue");
  assert.equal(stackRows.length, 12);
  assert.deepEqual(groups[0].members.map(row => row.line), stackRows.map(row => row.line));
  assert(stackRows.every(row => row.status === "UNRESOLVED_CURRENT_EVENT"));
  fs.mkdirSync(path.join(output, "checkpoint"), { recursive: true });
  const inputs = [originalFile, startupPath, reportFile, logFile].map(desc);
  const checkpoint = ["AGENTS.md", "plans/ACTIVE_TASKS.md",
    "plans/Editor-Recovery-Sprite-20261115-RESULTS.md"].map(file => {
    const target = path.join(output, "checkpoint", file.replaceAll("/", "__"));
    fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
    return { original: desc(file), snapshot: desc(target) };
  });
  const result = { at: new Date().toISOString(), status: "SOURCE_CAPTURE_PENDING",
    inputs, checkpoint, priorInvestigation: priorDescriptor,
    sourceCaptures: await Promise.all(sources.map(source => capture(source, prior))),
    productStarts: 0, deviceStarts: 0, builds: 0, modelRequests: 0, userDatabaseWrites: 0,
    originalCounts: { records: original.records, unresolved: original.unresolved },
    sourceBoundary: "Pinned AOSP Android15 reference, not independently matched Google system-image bytecode." };
  if (result.sourceCaptures.some(row => row.status === "FAILED")) {
    result.status = "SOURCE_CAPTURE_INCOMPLETE_ORIGINAL_DISPOSITIONS_UNCHANGED";
    process.exitCode = 1;
  } else {
    const texts = Object.fromEntries(result.sourceCaptures.map(row =>
      [row.name, fs.readFileSync(row.file.path, "utf8")]));
    const queue = excerpt(texts["message-queue"], "if (mQuitting)", 0, 9)
      .find(item => /IllegalStateException/.test(item.text));
    assert(queue && queue.text.includes("Log.w(TAG, e.getMessage(), e);")
      && queue.text.includes("msg.recycle();") && queue.text.includes("return false;"));
    assert(!/\bthrow\s+e\b/.test(queue.text));
    result.sourceBranches = {
      queueQuitting: queue,
      vsyncDispatch: excerpt(texts.choreographer, "mHandler.sendMessageAtTime(msg", 3, 3),
      handlerLoop: excerpt(texts["handler-thread"], "Looper.loop();", 4, 3),
      handlerQuit: excerpt(texts["handler-thread"], "looper.quit();", 4, 3),
    };
    result.warning = { ...groups[0], keys: stackRows.map(row => row.key),
      interpretation: "Twelve raw rows form one logged warning/throwable stack. The pinned queue branch constructs an exception for Log.w, recycles the message and returns false; this is not evidence of an uncaught IllegalStateException.",
      boundary: "The ended queue owner, quit initiator and exact Google bytecode were not captured; no recovery or harmlessness disposition is promoted." };
    const entries = raw.split(/\r?\n/).flatMap((line, i) => {
      const parsed = parseThreadtime(line);
      return parsed ? [{ ...parsed, line, lineNumber: i + 1 }] : [];
    });
    const warningTime = groups[0].members[0].timeMs;
    assert(startup.removal.timeMs < warningTime && warningTime < startup.replacementWindow.timeMs);
    result.windowRelation = {
      removal: startup.removal, warning: groups[0].members[0],
      replacement: startup.replacementWindow, displayed: startup.displayed,
      warningAfterRemovalMs: warningTime - startup.removal.timeMs,
      replacementAfterWarningMs: startup.replacementWindow.timeMs - warningTime,
      continuedHost: startup.continuedHost,
      interpretation: "Same-host warning occurs between old-window removal and replacement-window registration; chronology alone does not identify the destroy/quit cause or CDP target." };
    result.configurationRecords = entries.filter(row =>
      row.tag === "ActivityTaskManager" && /^Config changes=/.test(row.message)
      && Math.abs(row.timeMs - warningTime) < 3000);
    result.configurationBoundary = "The visible global configuration message is timestamped independently; it does not identify the initiating configuration of this earlier activity relaunch.";
    const commands = product.commands.filter(row => row.args[0] === "shell"
      && (row.args[1] === "wm" || row.args[1] === "settings"));
    assert(commands.every(row => row.args[1] === "wm"
      && row.args.length === 3 && ["size", "density"].includes(row.args[2])));
    result.qaDisplayCommands = commands;
    result.qaDisplayBoundary = "Recorded QA display commands before failure only read size/density; no recorded wm/settings write or input is attributable as the trigger. This is not proof that no other actor changed system configuration.";
    result.status = "WARNING_BRANCH_AND_WINDOW_ORDER_BOUND_CDP_TRIGGER_UNRESOLVED";
  }
  for (const input of inputs) assert.equal(sha(input.path), input.sha256);
  if (priorDescriptor) assert.equal(sha(priorDescriptor.path), priorDescriptor.sha256);
  assert.equal(cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), head);
  assert.equal(sha(index), indexBefore);
  result.gitProtection = { head, indexSha256: indexBefore, unchanged: true };
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, output,
    sources: result.sourceCaptures.map(row => ({ name: row.name, status: row.status, error: row.error })),
    rawRows: stackRows.length, warningEvents: groups.length, unresolved: original.unresolved }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
