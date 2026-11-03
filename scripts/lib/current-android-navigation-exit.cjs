"use strict";
// Real ADB operations only. A cached PID is not an Activity, nor a fresh WebView.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence } = require("../android-acceptance-evidence.cjs");
const { activityState } = require("./android-activity-exit.cjs");
const { runningPackagePid } = require("../android-native-upgrade-device.cjs");
const { scopedRuntimeLog } = require("../android-runtime-log-analysis.cjs");
const { validateImmediateActivityReopen } = require("../android-exit-device.cjs");
async function verifyCurrentNavigationExit(c) {
  const { q, r, cmd, text, wait, tap, evalWait, idle, shot, position, first, out, Client, save } = c;
  const pkg = q.package;
  function evidence(name, value) {
    const file = path.join(out, name);
    fs.writeFileSync(file, typeof value === "string" || Buffer.isBuffer(value)
      ? value : JSON.stringify(value, null, 2), { flag: "wx" });
    return fileEvidence(file);
  }
  function saves(label) {
    const prefix = `/data/user/0/${pkg}/saves/`;
    const files = text(["shell", "find", prefix, "-type", "f"]).split(/\r?\n/)
      .filter(file => /\/(?:slot|auto|quick)-\d\d\.json$/.test(file));
    return files.map((remote, index) => {
      assert(remote.startsWith(prefix) && !remote.includes(".."));
      const bytes = cmd(["exec-out", "cat", remote], true).stdout;
      return { remote, ...evidence(`${label}-save-${index}.json`, bytes), value: JSON.parse(bytes.toString("utf8")) };
    });
  }
  async function finish(label) {
    const pid = runningPackagePid(cmd(["shell", "pidof", pkg], false, true));
    const beforeDump = text(["shell", "dumpsys", "activity", "activities"]);
    const before = activityState(beforeDump, pkg); assert(before.live.length > 0);
    const beforeEvidence = evidence(label + "-activity-before.txt", beforeDump);
    const start = Date.now();
    await tap('[data-testid="confirm-exit-game"]', label + " confirm once");
    let after, afterDump;
    await wait(() => {
      afterDump = text(["shell", "dumpsys", "activity", "activities"]);
      after = activityState(afterDump, pkg); return after.closed;
    }, "actual Activity finish without force-stop", 15000);
    const record = { label, pid, basis: "ACTIVITY_FINISH", before, after, beforeEvidence,
      elapsedMs: Date.now() - start, afterEvidence: evidence(label + "-activity-after.txt", afterDump),
      closedCommandIndex: r.commands.length - 1, confirmationClicks: 1, forcedBeforeExit: false,
      cachedPid: runningPackagePid(cmd(["shell", "pidof", pkg], false, true)),
      fatalBeforeReclaim: scopedRuntimeLog(text(["logcat", "-d", "-v", "threadtime"]), pkg, r.pids).fatal };
    assert(record.elapsedMs < 15000); assert.deepEqual(record.fatalBeforeReclaim, []);
    (r.activityExits ??= []).push(record); save();
    c.getClient().close(); c.setClient(null);
    return record;
  }
  const firstExit = await finish("current-first-exit");
  firstExit.nextLaunchPolicy = "IMMEDIATE_ACTIVITY_REOPEN";
  firstExit.activityRestoration = "CACHED_RUNTIME_RECREATION";
  const saved = saves("after-first-exit");
  assert(saved.some(row => row.value.save_kind === "auto" && row.value.scene_id === first.scene
    && row.value.command_index === Number(first.command)), "Exit must finish the actual autosave");
  text(["forward", "--remove", `tcp:${q.cdpPort}`]);
  const commandIndex = r.commands.length;
  text(["shell", "monkey", "-p", pkg, "1"]);
  const pid = await wait(() => runningPackagePid(cmd(["shell", "pidof", pkg], false, true)), "reopened native process");
  assert.equal(pid, firstExit.pid, "This case must exercise the retained process");
  r.pids.push(pid);
  text(["forward", "--no-rebind", `tcp:${q.cdpPort}`, `localabstract:webview_devtools_remote_${pid}`]);
  const fetchTargets = async () => (await fetch(`http://127.0.0.1:${q.cdpPort}/json/list`,
    { signal: AbortSignal.timeout(1500) })).json();
  const tab = await wait(async () => {
    try { return (await fetchTargets()).find(p => p.type === "page" && p.url && p.url !== "about:blank" && p.id !== c.priorTabId); }
    catch (e) { if (!/fetch|abort|timeout|JSON/i.test(String(e))) throw e; }
  }, "new Runtime WebView target");
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("New WebView websocket timeout")), 15000);
    socket.onopen = () => { clearTimeout(timer); resolve(); };
    socket.onerror = e => { clearTimeout(timer); reject(e); };
  });
  c.setClient(new Client(socket));
  await evalWait(`Boolean(document.querySelector('[data-testid="start-new-game"]'))`, "new Runtime title ready");
  await idle();
  const targets = await fetchTargets();
  const nativePaths = text(["shell", "find", `/data/user/0/${pkg}`, "-type", "f", "-name", "player-desktop.log"])
    .split(/\r?\n/).filter(Boolean);
  assert.equal(nativePaths.length, 1);
  assert(nativePaths[0].startsWith(`/data/user/0/${pkg}/`) && !nativePaths[0].includes(".."));
  const nativeBytes = cmd(["exec-out", "cat", nativePaths[0]], true).stdout;
  const restored = nativeBytes.toString("utf8").split(/\r?\n/)
    .filter(line => /Android Runtime window restored for Activity -?\d+\./.test(line));
  const reopenedDump = text(["shell", "dumpsys", "activity", "activities"]);
  firstExit.reopened = { pid, processRetained: pid === firstExit.pid, commandIndex, titleReady: true,
    activity: activityState(reopenedDump, pkg), evidence: evidence("reopened-activity.txt", reopenedDump),
    targetId: tab.id, priorTargetId: c.priorTabId, liveTargetIds: targets.filter(p => p.type === "page").map(p => p.id),
    targetSnapshot: evidence("reopened-targets.json", targets), nativeRestoreCount: restored.length,
    nativeRestoreLine: restored.at(-1), nativeLog: evidence("reopened-native.log", nativeBytes) };
  validateImmediateActivityReopen(firstExit); save();
  await shot("immediately-reopened-title");
  await tap('[data-testid="continue-game"]', "continue actually saved progress");
  await idle(); const continued = await position(); assert.deepEqual(continued, first);
  await tap(".dialog-box", "advance in the restored Runtime");
  await evalWait(`Number(document.querySelector('.story-player')?.dataset.currentCommandIndex)===1`, "restored Runtime can advance");
  const advanced = await position(); assert(advanced.text.startsWith("QA_ANDROID_UPGRADE_NEW_1："));
  await shot("reopened-continue-and-advance");
  await c.back("restored player to game menu");
  await evalWait(`Boolean(document.querySelector('[data-testid="continue-game"]'))`, "restored menu");
  await tap('[data-testid="open-settings"]', "restored settings");
  await evalWait(`Boolean(document.querySelector('.settings-screen'))`, "restored settings mounted");
  await tap('[data-testid="open-exit-confirmation"]', "restored Runtime exit request");
  await evalWait(`Boolean(document.querySelector('[data-testid="confirm-exit-game"]'))`, "restored confirmation");
  await shot("restored-exit-confirmation");
  const secondExit = await finish("current-second-exit"), savedAfterSecond = saves("after-second-exit");
  assert(savedAfterSecond.some(row => row.value.save_kind === "auto" && row.value.scene_id === advanced.scene
    && row.value.command_index === Number(advanced.command)));
  return { exitedWithoutForceStop: true, confirmationClicks: 2, firstExit, secondExit,
    saved, continued, advanced, savedAfterSecond, restoredRuntimeOperable: true };
}
module.exports = { verifyCurrentNavigationExit };
