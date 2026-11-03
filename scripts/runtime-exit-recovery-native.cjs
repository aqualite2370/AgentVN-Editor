"use strict";
// Real new Windows Player and filesystem. Only native completion delivery is
// gated, after the unmodified production writer has actually settled.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const installedCandidate = process.argv.includes("--installed-candidate");
const { NarrativePlayer } = installedCandidate
  ? require("./candidate-1930-quickload-exit.cjs").narrative()
  : require("./lib/dev-narrative-player.cjs");
const { rows, ps, until } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt || "", /^\d{2}$/);
const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/exit-recovery-20261027-${attempt}`);
const bindingFile = installedCandidate ? process.env.AGENTVN_EXIT_CANDIDATE_CONFIG : undefined;
if (installedCandidate) assert(bindingFile, "Explicit current installed candidate binding required");
const binding = installedCandidate ? read(bindingFile) : undefined;
const installed = installedCandidate
  ? require("./candidate-1930-exit.cjs").validateInstallation(binding.installation.path) : undefined;
const deliveryFile = installedCandidate ? binding.installation.path
  : "F:/AgentVN/QA/Runtime-Hidden-Saves-20261026-01/delivery-verification-01.json";
const sourceFile = installedCandidate ? binding.exported.path
  : "F:/AgentVN/QA/Native-Runtime-State-20261020-01/hide-installed-1930-01/report.json";
const delivery = read(deliveryFile), source = read(sourceFile);
assert.equal(delivery.status, "PASS"); assert.equal(source.status, "PASS");
if (!installedCandidate)
  assert.equal(sha(sourceFile), "ef439dd0528cfcce2bc25a91b59816e9dfeb46bfb9b532c6c96969ec23c48d19");
const executable = installedCandidate
  ? installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe")
  : delivery.players.find(p => /binaries/.test(p.path));
assert(executable);
const cartridges = installedCandidate ? source.cartridges : source.artifacts;
for (const f of [executable, ...(installedCandidate ? [] : [delivery.dev]), ...cartridges])
  assert.equal(sha(f.path), f.sha256, f.path);
let installedExitAudit;
if (installedCandidate) {
  require("./candidate-1930-exit.cjs").prerequisite();
  const config = read(binding.candidateConfig.path);
  const file = path.join(config.qa, `exit-audit-${installed.version.split(".").at(-1)}/report.json`);
  const audit = read(file);
  assert.equal(audit.status, "PASS"); assert(audit.finishedAt && !audit.error);
  assert.equal(audit.checks.length, 3); assert(audit.checks.every(c => c.status === "PASS"));
  for (const f of [audit.source, audit.raw]) assert.equal(sha(f.path), f.sha256);
  assert.equal(audit.scope,
    `INSTALLED_${installed.version.replaceAll(".", "")}_LIBRARY_REAL_ACL_UI_EXIT_NOT_ALT_F4_ANDROID_OR_COMPLETE_INFLIGHT_COVERAGE`);
  installedExitAudit = desc(file);
}
if (process.argv.includes("--self-test")) {
  assert(installedCandidate);
  assert.equal(path.resolve(executable.path), path.join(installed.installRoot, "agentvn-player.exe"));
  assert.equal(cartridges.length, 2);
  assert.deepEqual(new Set(cartridges.map(c => c.layout)), new Set(["agentvn", "renpy"]));
  assert(!fs.existsSync(out), "Fresh output required");
  console.log(JSON.stringify({ status: "PASS", scope: "OFFLINE_INSTALLED_NATIVE_RECOVERY_BINDING",
    version: installed.version, executable, prerequisite: installedExitAudit,
    flows: 6, physicalCloseInputs: 16, productStarts: 0, profileChanges: 0, modelRequests: 0 }));
  process.exit(0);
}
assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
assert(!fs.existsSync(out)); fs.mkdirSync(out); fs.mkdirSync(path.join(out, "temporary"));
process.env.AGENTVN_WORKSPACE_OUTPUT = out;
const prep = { sessionRoot: out, executable, cartridges,
  webview: path.join(out, "webview"), temporary: path.join(out, "temporary") };
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: installedCandidate
    ? "CURRENT_INSTALLED_PLAYER_REAL_DISK_ACL_AND_CONFIRMED_WINDOW_EXIT_NOT_STANDALONE_OR_ANDROID"
    : "NEW_DEV_RESOURCE_NATIVE_PLAYER_REAL_DISK_ACL_AND_CONFIRMED_EXIT_NOT_INSTALLED_OR_ANDROID",
  ...(installedCandidate ? { candidateVersion: installed.version, installation: desc(deliveryFile),
    candidateBinding: desc(bindingFile), predecessor: installedExitAudit } : {}),
  sources: [deliveryFile, sourceFile, __filename,
    path.join(root, "scripts/runtime-exit-recovery-native-acl.ps1"),
    path.join(root, "scripts/native-dev-preview-profile.ps1"),
    path.join(root, "scripts/lib/dev-narrative-player.cjs"),
    ...(installedCandidate ? [bindingFile, installedExitAudit.path,
      path.join(root, "scripts/candidate-1930-exit.cjs"),
      path.join(root, "scripts/candidate-1930-quickload-exit.cjs"),
      path.join(root, "scripts/lib/wait-native-runtime-page.cjs"),
      ...installed.protectedFiles.map(f => f.path)] : [])].map(desc),
  prep, cases: [], launches: [], screenshots: [], pageErrors: [], commands: [], knownProcesses: [],
  modelRequests: 0, productChanges: 0, builds: 0,
  controlledBoundaries: [installedCandidate
    ? "Current actual installed Editor UI export from a historical controlled fixture; public native library insertion"
    : "Historical actual installed Editor UI export; public native library insertion",
    "Production native write executes unchanged; QA gates ONLY delivery of its actual result",
    "Physical close requests by Computer Use with separate receipts; remaining DOM actions via actual WebView CDP",
    "1920x1080 DPR1 normal native WebView simulation; prior 24-cell browser geometry not rerun",
    installedCandidate
      ? "Current installed Player library saves in protected physical roaming; not standalone EXE-adjacent saves/setup or Android"
      : "Library saves in protected physical roaming, not standalone EXE-adjacent saves or installation acceptance"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const player = new NarrativePlayer(prep, report, save, p => {
  assert.equal(sha(p.executable.path), executable.sha256);
  assert.equal(p.sessionRoot, out);
  for (const c of p.cartridges) assert.equal(sha(c.path), c.sha256);
});
let prepared = false, pendingACL = null, closeSequence = 0, active;
const profileScript = path.join(root, "scripts/native-dev-preview-profile.ps1");
async function command(file, args, label) {
  const row = { label, file, args, status: "RUNNING", log: path.join(out, label + ".log") };
  report.commands.push(row); save();
  const fd = fs.openSync(row.log, "wx");
  try {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args],
      { windowsHide: true, stdio: ["ignore", fd, fd] });
    row.code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(row.code, 0, row.log); row.status = "PASS";
  } catch (e) { row.status = "FAILED"; throw e; }
  finally { fs.closeSync(fd); save(); }
}
async function profile(action) {
  await command(profileScript, ["-Action", action, "-RunDirectory", out, "-CodexCacheView", "-Storage", "NativeRoaming"],
    "profile-" + action.toLowerCase());
}
async function acl(action) {
  const receipt = path.join(out, `acl-${player.installId}.json`);
  if (action === "Block") pendingACL = { installId: player.installId, receipt };
  await command(path.join(root, "scripts/runtime-exit-recovery-native-acl.ps1"),
    ["-Action", action, "-RunDirectory", out, "-InstallId", player.installId],
    `${player.installId}-${action.toLowerCase()}`);
  const data = read(receipt + (action === "Block" ? ".block.json" : ".restore.json"));
  if (action === "Restore") pendingACL = null;
  active.acls.push({ action, ...desc(receipt + (action === "Block" ? ".block.json" : ".restore.json")), data }); save();
}
function disk(label) {
  const directory = player.storage.targetDirectory;
  const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter(f => f.endsWith(".json")).sort()
    .map(f => ({ ...desc(path.join(directory, f)), data: read(path.join(directory, f)) })) : [];
  const evidence = path.join(out, `${active.layout}-${active.kind}-${label}.json`);
  fs.writeFileSync(evidence, JSON.stringify(files, null, 2), { flag: "wx" });
  active.disk.push(desc(evidence)); save(); return files;
}
async function position() {
  return player.page.locator(".story-player").evaluate(e => ({ scene: e.dataset.currentSceneId,
    command: Number(e.dataset.currentCommandIndex), text: document.querySelector(".dialog-box")?.textContent }));
}
async function settings(enabled, instant = false) {
  const page = player.page;
  await page.getByTestId("open-settings").click(); await player.ready("settings");
  await page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
  await page.getByRole("checkbox", { name: "自动存档", exact: true }).setChecked(enabled);
  if (instant) {
    await page.locator(".settings-tabs").getByRole("button", { name: "文字", exact: true }).click();
    await page.getByRole("slider", { name: "Text speed", exact: true }).focus();
    await page.keyboard.press("Home");
  }
  await page.getByTestId("settings-finish").click(); await player.ready("title_menu");
}
async function openSaves() {
  const page = player.page;
  if (active.layout === "renpy") await page.getByTestId("renpy-quick-save-load").click();
  else {
    await page.getByTestId("quick-menu-toggle").click();
    await page.getByRole("button", { name: "打开存档读档", exact: true }).click();
  }
  await player.ready("save_load"); await page.getByRole("button", { name: "保存", exact: true }).click();
}
async function installGate() {
  await player.page.evaluate(() => {
    // Native Tauri defines invoke as read-only. Observe the real protocol fetch
    // instead: no IPC header/key is copied into the report or altered.
    const original = window.fetch.bind(window);
    const gate = window.__nativeRecovery = { calls: [], hold: true };
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!/^https?:\/\/ipc\.localhost\/write_save(?:[?#]|$)/.test(url)) return original(input, init);
      const args = JSON.parse(init.body);
      const entry = { args: structuredClone(args), startedAt: performance.now() }; gate.calls.push(entry);
      const response = await original(input, init);
      const ok = response.headers.get("Tauri-Response") === "ok";
      Object.assign(entry, { actualSettled: true, actualOk: ok,
        actualError: ok ? null : await response.clone().text(),
        settledAt: performance.now() });
      if (gate.hold) await new Promise(resolve => { entry.release = resolve; });
      entry.deliveredAt = performance.now();
      return response;
    };
  });
}
async function gateSnapshot() {
  return player.page.evaluate(() => window.__nativeRecovery.calls.map(({ release, ...entry }) => entry));
}
async function pendingWrite(n, ok) {
  await player.page.waitForFunction(({ n, ok }) => {
    const calls = window.__nativeRecovery.calls, entry = calls[n - 1];
    return calls.length === n && entry?.actualSettled === true && entry.actualOk === ok && !entry.deliveredAt;
  }, { n, ok });
  active.writes = await gateSnapshot(); save();
}
async function release(n) {
  await player.page.evaluate(n => {
    const entry = window.__nativeRecovery.calls[n - 1];
    if (!entry?.release) throw Error("No production result pending delivery");
    entry.release(); delete entry.release;
  }, n);
}
async function physicalClose(label) {
  const n = ++closeSequence, prefix = path.join(out, `physical-close-${String(n).padStart(2, "0")}`);
  const request = { status: "AWAITING_COMPUTER_USE", number: n, label, pid: player.child.pid,
    executable: player.prep.executable, at: new Date().toISOString(), action: "Alt_L+F4",
    receipt: prefix + ".receipt.json" };
  fs.writeFileSync(prefix + ".request.json", JSON.stringify(request, null, 2), { flag: "wx" });
  report.awaitingComputerUse = { ...request, path: prefix + ".request.json" }; save();
  console.log("AWAITING_COMPUTER_USE " + JSON.stringify(report.awaitingComputerUse));
  await until(() => fs.existsSync(request.receipt), label + " physical input receipt", 180000);
  const receipt = read(request.receipt);
  assert.equal(receipt.status, "INPUT_COMPLETED"); assert.equal(receipt.number, n);
  assert.equal(receipt.pid, player.child.pid); assert.equal(receipt.key, "Alt_L+F4");
  assert(receipt.window?.id && receipt.observedModal === "退出游戏？");
  await player.page.getByRole("dialog", { name: "退出游戏？", exact: true }).waitFor();
  active.physicalClose.push({ request: desc(prefix + ".request.json"), receipt: desc(request.receipt), data: receipt });
  delete report.awaitingComputerUse; save();
}
async function assertOpenFailure(n, before) {
  await release(n); await player.page.getByTestId("return-to-save").waitFor();
  assert.equal(await player.page.getByTestId("retry-exit-save").count(), 0);
  assert.equal(player.child.exitCode, null);
  const text = await player.page.locator(".runtime-exit-status").innerText();
  assert(text.includes("保存失败") && text.includes("游戏仍保持打开"));
  const after = disk(`failure-${n}`);
  assert.deepEqual(after.map(f => f.sha256), before.map(f => f.sha256), "Failed save changed existing native files");
  assert(!fs.readdirSync(player.storage.targetDirectory).some(f => f.endsWith(".tmp")));
  active.writes = await gateSnapshot(); active.errors.push(text); save();
}
async function returnToSave() {
  await player.page.getByTestId("return-to-save").click();
  await player.page.getByRole("dialog", { name: "退出游戏？", exact: true }).waitFor({ state: "hidden" });
  await player.page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find(e => e.textContent.trim() === "保存");
    return b && b === document.activeElement && !b.disabled && !b.closest("[inert]");
  });
  assert.equal(player.child.exitCode, null);
}
async function exitAndStop() {
  const child = player.child;
  await until(() => child.exitCode !== null || child.signalCode !== null, "actual confirmed native exit", 15000);
  assert.equal(child.exitCode, 0); assert.equal(child.signalCode, null);
  active.exits.push({ pid: child.pid, code: child.exitCode, forced: false });
  await player.stop();
  assert.equal(report.launches.at(-1).cleanup.method, "PROCESS_ALREADY_EXITED_BEFORE_CLEANUP"); save();
}
async function runCase(layout, kind) {
  active = { layout, kind, status: "RUNNING", acls: [], disk: [], physicalClose: [], errors: [], exits: [] };
  report.cases.push(active); save();
  const args = { layout, installId: `qa_recovery_20261027_${attempt}_${layout}_${kind}`, cell: `${layout}-${kind}`,
    viewport: { width: 1920, height: 1080, dpr: 1, reduced: false } };
  try {
    await player.start(args); await settings(kind === "auto", true);
    await player.page.getByTestId("start-new-game").click(); await player.ready("playing");
    await player.page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
    active.before = await position(); save();
    fs.mkdirSync(player.storage.targetDirectory, { recursive: true });
    if (kind === "manual" || kind === "discard") {
      await openSaves();
      await player.page.getByTestId("save-slot-manual-2").locator(".save-card-main").click();
      await player.page.waitForFunction(() => document.querySelector(".save-operation-status")?.classList.contains("is-saved"));
      const before = disk("baseline");
      assert(before.some(f => f.data.save_kind === "manual" && f.data.slot === 2));
      await acl("Block"); await installGate();
      for (let n = 1; n <= (kind === "manual" ? 2 : 1); n++) {
        await player.page.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
        await pendingWrite(n, false);
        await player.page.getByRole("button", { name: "保存", exact: true }).focus();
        await physicalClose(`${layout}/${kind}/failed-${n}`);
        await player.page.getByTestId("confirm-exit-game").click();
        assert.equal(player.child.exitCode, null);
        assert(await player.page.getByTestId("confirm-exit-game").isDisabled());
        await assertOpenFailure(n, before);
        await player.shot(`failure-${n}`);
        if (kind === "manual") await returnToSave();
      }
      if (kind === "manual") {
        await acl("Restore");
        await player.page.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
        await pendingWrite(3, true);
        const written = disk("saved-before-completion");
        assert(written.some(f => f.data.save_kind === "manual" && f.data.slot === 1
          && f.data.scene_id === active.before.scene && f.data.command_index === active.before.command));
        assert(written.some(f => f.sha256 === before[0].sha256), "Baseline slot 2 must survive");
        assert(!written.some(f => f.data.save_kind === "auto"));
        await player.page.getByRole("button", { name: "保存", exact: true }).focus();
        await physicalClose(`${layout}/manual/successful-write-wait`);
        await player.page.getByTestId("confirm-exit-game").click();
        assert(await player.page.getByTestId("confirm-exit-game").isDisabled()); assert.equal(player.child.exitCode, null);
        active.writes = await gateSnapshot(); save();
        await release(3); await exitAndStop();
      } else {
        await player.page.getByTestId("discard-exit-save").click();
        await player.page.getByRole("dialog", { name: "确认放弃保存？", exact: true }).waitFor();
        await player.page.keyboard.press("Escape");
        await player.page.getByRole("dialog", { name: "确认放弃保存？", exact: true }).waitFor({ state: "hidden" });
        assert.equal(player.child.exitCode, null);
        active.cancelDiscardKeptOpen = true; await player.page.getByTestId("discard-exit-save").click();
        await player.page.getByTestId("confirm-discard-exit").click(); await exitAndStop();
        await acl("Restore");
      }
      await player.start({ ...args, restart: true });
      await player.page.getByTestId("continue-game").click(); await player.ready("playing");
      active.restored = await position(); assert.deepEqual(active.restored, active.before);
      const after = disk("restart");
      assert.equal(after.filter(f => f.data.save_kind === "manual").length, kind === "manual" ? 2 : 1);
      assert(!after.some(f => f.data.save_kind === "auto"));
      active.restoredHistory = after.find(f => f.data.slot === (kind === "manual" ? 1 : 2)).data.history;
      assert(active.restoredHistory.some(h => active.before.text.includes(h.text)));
      await player.shot("restart");
      await physicalClose(`${layout}/${kind}/restart-with-autosave-off`);
      await player.page.getByTestId("confirm-exit-game").click(); await exitAndStop();
    } else {
      await installGate(); await acl("Block");
      await physicalClose(`${layout}/auto/first-attempt`);
      await player.page.getByTestId("confirm-exit-game").click(); await pendingWrite(1, false);
      await release(1); await player.page.getByTestId("retry-exit-save").waitFor();
      assert.equal(player.child.exitCode, null);
      await player.shot("auto-failed");
      await acl("Restore");
      await player.page.getByTestId("retry-exit-save").click(); await pendingWrite(2, true);
      assert.equal(player.child.exitCode, null); assert(await player.page.getByTestId("confirm-exit-game").isDisabled());
      active.writes = await gateSnapshot();
      const after = disk("actual-auto-written");
      assert(after.some(f => f.data.save_kind === "auto" && f.data.scene_id === active.before.scene
        && f.data.command_index === active.before.command && f.data.history.some(h => active.before.text.includes(h.text))));
      await release(2); await exitAndStop();
      await player.start({ ...args, restart: true });
      await player.page.getByTestId("continue-game").click(); await player.ready("playing");
      active.restored = await position(); assert.deepEqual(active.restored, active.before);
      await player.shot("auto-restart");
      await physicalClose(`${layout}/auto/restart-exit`);
      await player.page.getByTestId("confirm-exit-game").click(); await exitAndStop();
    }
    active.status = "PASS";
  } catch (e) {
    active.status = "FAILED"; active.error = String(e.stack || e);
    if (player.page) {
      active.failureText = await player.page.locator("body").innerText().catch(() => "");
      active.gateDiagnostic = await gateSnapshot().catch(() => null);
      await player.shot("failure-diagnostic").catch(() => {});
    }
    throw e;
  } finally { active.finishedAt = new Date().toISOString(); save(); }
}
(async () => {
  save(); fs.copyFileSync(__filename, path.join(out, "executed-runner.cjs"), fs.constants.COPYFILE_EXCL);
  if (installedCandidate) {
    const file = path.join(root, "scripts/lib/dev-narrative-player.cjs");
    const adapted = require("./candidate-1930-quickload-exit.cjs").buildNarrative(fs.readFileSync(file, "utf8"));
    const executed = path.join(out, "executed-narrative.cjs");
    fs.writeFileSync(executed, adapted.source, { flag: "wx" });
    report.narrative = { original: desc(file), executed: desc(executed), changes: adapted.changes };
    save();
  }
  const normal = ["C:\\Users\\1\\AppData\\Roaming\\com.agentvn.player", "C:\\Users\\1\\AppData\\Local\\com.agentvn.player"];
  const aliases = ["C:\\Users\\1\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Roaming\\com.agentvn.player",
    "C:\\Users\\1\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\com.agentvn.player"];
  report.profileAliases = normal.map((file, i) => {
    const ids = [file, aliases[i]].map(p => ps(`$v=(& fsutil.exe file queryfileid '${p}'|Out-String);` +
      `if($LASTEXITCODE -ne 0 -or $v -notmatch '0x[0-9a-fA-F]+'){throw 'File ID unavailable'};$Matches[0].ToLowerInvariant()`));
    assert.equal(ids[0], ids[1], "Default and Codex view must be verified aliases before one protection action");
    return { paths: [file, aliases[i]], fileId: ids[0] };
  }); save();
  prepared = true; await profile("Prepare");
  for (const layout of ["agentvn", "renpy"]) for (const kind of ["manual", "discard", "auto"]) await runCase(layout, kind);
  assert.equal(report.cases.length, 6); assert(report.cases.every(c => c.status === "PASS"));
  assert.deepEqual(report.pageErrors, []); assert(!report.observerError);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
.finally(async () => {
  try {
    if (pendingACL && fs.existsSync(pendingACL.receipt) && !fs.existsSync(pendingACL.receipt + ".restore.json")) await acl("Restore");
    await player.stop();
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); }
  try { if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) { await profile("Restore"); report.profileRestore = "PASS"; } }
  catch (e) { report.status = "FAILED"; report.profileRestore = "FAILED"; report.profileRestoreError = String(e.stack || e); }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.map(c => ({ layout: c.layout, kind: c.kind, status: c.status })),
    profileRestore: report.profileRestore, error: report.error, cleanupError: report.cleanupError, out }, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
});
