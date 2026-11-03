"use strict";
// Continue the verified installed export; occupied slots are borrowed only by explicit opt-in.
// Uses the actual native game and filesystem; never mocks IPC or accesses Runtime stores.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const A = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const baselineFile = path.resolve(process.argv[2] || "");
const out = path.resolve(process.argv[3] || "");
assert(process.argv[2] && process.argv[3], "Explicit baseline report and new evidence directory required");
const baselineRoot = path.dirname(baselineFile);
assert(A.inside(path.join(root, "output"), baselineRoot));
assert(A.inside(baselineRoot, out) && !fs.existsSync(out), "Fresh continuation evidence inside the owned run required");
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || ""), out);
const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
assert.equal(baseline.status, "BLOCKED");
assert.equal(baseline.ownedLegacy.length, 0);
assert(baseline.cases.some(row => row.name === "actual-native-exe-side-location-and-new-save-bytes" && row.status === "PASS"));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT || ""), path.resolve(baseline.fixture.path));
const sha = file => A.sha256(fs.readFileSync(file));
const exe = baseline.windowsExport.exe;
assert.equal(sha(exe), baseline.windowsExport.exeSha256);
assert.equal(sha(baseline.fixture.path), baseline.fixture.sha256);
const priorSave = baseline.cases.find(row => row.name === "actual-native-exe-side-location-and-new-save-bytes").result;
const targetDir = path.resolve(priorSave.targetDir), sourceDir = path.resolve(priorSave.sourceDir);
assert(A.inside(baselineRoot, exe) && A.inside(baselineRoot, targetDir));
assert(!A.inside(baselineRoot, sourceDir));
assert.equal(sha(priorSave.path), priorSave.sha256, "Do not reuse changed baseline saves");
const originalSave = fs.readFileSync(priorSave.path);
const manualSlot = JSON.parse(originalSave).slot;
const authorizedQuickBackup = process.argv[6] === "--authorized-quick-backup";
assert(!process.argv[6] || authorizedQuickBackup, "Unknown continuation option");
let resumeFile, resume;
if (process.argv[4]) {
  assert.equal(process.argv[4], "--resume");
  resumeFile = path.resolve(process.argv[5] || "");
  assert(A.inside(baselineRoot, resumeFile) && resumeFile !== baselineFile);
  resume = JSON.parse(fs.readFileSync(resumeFile, "utf8"));
  assert.equal(resume.exeSha256, baseline.windowsExport.exeSha256);
  assert.equal(resume.baselineReportSha256, sha(baselineFile));
  assert.equal(resume.legacyBytePreservation, "PASS");
}
const profile = path.join(out, "player-webview");
const report = {
  status: "RUNNING", startedAt: new Date().toISOString(), baselineReport: baselineFile,
  baselineReportSha256: sha(baselineFile), exe, exeSha256: sha(exe),
  testProject: process.env.AGENTVN_TEST_PROJECT, workspaceOutput: out, sourceDir, targetDir,
  cases: [], launches: [], ownedLegacy: [], cleanup: [], pageErrors: [],
  scope: "Actual installed-editor export, native WebView; CDP viewport emulation is not physical 4K",
};
fs.mkdirSync(out, { recursive: true });
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let player, browser, page, aclReceipt, aclActive = false, borrowedQuick;
function inventory(directory) {
  if (!fs.existsSync(directory)) return {};
  return Object.fromEntries(fs.readdirSync(directory).filter(n => n.endsWith(".json")).sort().map(n => {
    const file = path.join(directory, n);
    assert(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), "Never follow a save link");
    return [n, sha(file)];
  }));
}
const legacyBefore = inventory(sourceDir);
report.legacyBefore = legacyBefore;
save();
async function step(name, action) {
  const row = { name, status: "RUNNING" }; report.cases.push(row); save(); console.log(`START ${name}`);
  try { row.result = await action(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
  finally { save(); }
}
function nativeCommand(name, args) {
  assert.equal(args[0], "-File");
  const literal = value => `'${String(value).replaceAll("'", "''")}'`;
  const parameters = args.slice(2).map((value, index) => {
    if (index % 2 === 0) { assert(/^-[A-Za-z]+$/.test(value)); return value; }
    return literal(value);
  }).join(" ");
  const command = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n& ${literal(args[1])} ${parameters}\nif (-not $?) { exit 1 }`;
  const psModulePath = [path.join(process.env.USERPROFILE, "Documents/WindowsPowerShell/Modules"),
    path.join(process.env.ProgramFiles, "WindowsPowerShell/Modules"),
    path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/Modules")].join(path.delimiter);
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand",
    Buffer.from(command, "utf16le").toString("base64")],
    { cwd: root, windowsHide: true, encoding: "utf8", timeout: 30000, env: { ...process.env, PSModulePath: psModulePath } });
  fs.writeFileSync(path.join(out, `${name}.log`), `${result.stdout || ""}\n${result.stderr || ""}`, { flag: "wx" });
  assert.ifError(result.error); assert.equal(result.status, 0, `Inspect ${name}.log`);
}
async function startPlayer() {
  assert(!player);
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const value = probe.address().port; probe.close(e => e ? reject(e) : resolve(value)); });
  });
  const cwd = path.join(out, "unrelated-cwd"); fs.mkdirSync(cwd, { recursive: true });
  assert.equal(sha(exe), report.exeSha256);
  player = spawn(exe, [], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`,
  } });
  const log = fs.createWriteStream(path.join(out, `player-${player.pid}.log`), { flags: "wx" });
  player.stdout.pipe(log, { end: false }); player.stderr.pipe(log, { end: false });
  player.once("close", () => log.end());
  const launch = { pid: player.pid, port, exe, cwd, profile };
  report.launches.push(launch); save();
  const owner = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\nGet-CimInstance Win32_Process -Filter "ProcessId = ${player.pid}" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress`],
  { windowsHide: true, encoding: "utf8" }));
  assert.equal(owner.ProcessId, player.pid);
  assert.equal(owner.ExecutablePath.toLowerCase(), exe.toLowerCase());
  const until = Date.now() + 90000;
  let ready = false;
  while (Date.now() < until) {
    assert.equal(player.exitCode, null, "Owned native game exited before CDP readiness");
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } }
    catch {}
    await pause(150);
  }
  assert(ready, "Owned native CDP readiness timed out");
  const endpoints = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n@{listeners=@(Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess);processes=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)} | ConvertTo-Json -Depth 4 -Compress`],
  { windowsHide: true, encoding: "utf8" }));
  assert(endpoints.listeners.length > 0, "Owned CDP listener missing");
  launch.listenerOwners = endpoints.listeners.map(pid => {
    const ancestry = [];
    for (let current = pid, depth = 0; current && depth < 32; depth++) {
      ancestry.push(current);
      if (current === player.pid) return { pid, ancestry };
      current = endpoints.processes.find(row => row.ProcessId === current)?.ParentProcessId;
    }
    assert.fail("CDP port belongs to a process outside this owned game tree");
  });
  save();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages()[0]; page.setDefaultTimeout(30000);
  page.on("pageerror", e => report.pageErrors.push(String(e)));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByTestId("game-state-title").waitFor(); await A.settleRuntime(page);
}
async function exitPlayer() {
  const exit = page.getByRole("button", { name: "退出", exact: true });
  if (!(await exit.isVisible().catch(() => false))) {
    await page.keyboard.press("Escape"); await exit.waitFor(); await A.settleRuntime(page);
  }
  const child = player;
  const exited = new Promise(resolve => child.once("close", resolve));
  await exit.click();
  await page.getByRole("dialog", { name: "退出游戏？", exact: true }).waitFor();
  await page.getByTestId("confirm-exit-game").click();
  let timer;
  try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Native exit timed out")), 20000); })]); }
  finally { clearTimeout(timer); }
  assert.equal(child.exitCode, 0); await browser.close();
  report.cleanup.push({ pid: child.pid, normalExit: true, exitCode: child.exitCode });
  player = browser = page = undefined; save();
}
const migrationDialog = () => page.getByRole("dialog", { name: "复制旧存档到游戏目录？", exact: true });
async function openMigration() {
  await page.getByTestId("save-storage-open").click();
  await migrationDialog().waitFor();
  // The panel first shows the last scan while native IO is pending. Assert only its settled result.
  await migrationDialog().getByRole("status").waitFor({ state: "detached" });
}
async function openSaves() {
  if (await page.getByTestId("renpy-quick-save-load").isVisible().catch(() => false))
    await page.getByTestId("renpy-quick-save-load").click();
  else await page.getByTestId("open-save-load").click();
  await page.getByTestId("save-storage-open").waitFor(); await A.settleRuntime(page);
}
async function restoreAcl(name) {
  if (aclActive && fs.existsSync(aclReceipt)) {
    nativeCommand(name, ["-File", path.join(root, "scripts/portable-save-test-acl.ps1"),
      "-Mode", "Restore", "-Target", targetDir, "-RunRoot", baselineRoot, "-ReportPath", aclReceipt]);
    const receipt = JSON.parse(fs.readFileSync(`${aclReceipt}.restore.json`, "utf8").replace(/^\uFEFF/, ""));
    assert.equal(receipt.actualSddl, receipt.originalSddl, "Actual ACL must match the original exactly");
    aclActive = false; report.aclRestored = true; save();
  }
}
async function runAuthorizedQuickMigration() {
  const quickName = "quick-06.json", quickSource = path.join(sourceDir, quickName), quickTarget = path.join(targetDir, quickName);
  const fixtureData = { ...JSON.parse(originalSave), save_kind: "quick", slot: 6,
    save_id: `${baseline.runId}-authorized-quick-06`, created_at: new Date().toISOString() };
  const fixtureBytes = Buffer.from(JSON.stringify(fixtureData, null, 2)), fixtureSha256 = A.sha256(fixtureBytes);
  await step("authorized-single-slot-backup-and-recovery-preflight", async () => {
    assert(resume, "Explicit completed safe continuation evidence required");
    assert.equal(resume.status, "BLOCKED");
    assert.equal(resume.cases.length, 5); assert(resume.cases.every(row => row.status === "PASS"));
    assert.deepEqual(legacyBefore, resume.legacyAfter, "Legacy files changed since the previous safety check");
    for (const row of resume.cases.filter(row => row.result?.evidence)) {
      assert.equal(sha(row.result.evidence), row.result.evidenceSha256);
    }
    assert(!fs.existsSync(quickTarget), "Do not replace a preexisting target quick-save");
    const safetyTestsFile = path.resolve(process.env.AGENTVN_BORROWED_SLOT_TEST_REPORT || "");
    assert(A.inside(path.join(root, "output/borrowed-save-slot-tests"), safetyTestsFile));
    const safetyTests = JSON.parse(fs.readFileSync(safetyTestsFile, "utf8"));
    assert.equal(safetyTests.status, "PASS");
    assert.equal(safetyTests.cases.length, 8); assert(safetyTests.cases.every(row => row.status === "PASS"));
    report.priorPassedEvidence = { path: resumeFile, sha256: sha(resumeFile), cases: resume.cases };
    report.backupSafetyTests = { path: safetyTestsFile, sha256: sha(safetyTestsFile) };
    report.userApproval = { message: "允许", scope: "Back up only quick-06, temporarily use it, restore original bytes and retain backup" };
    const { borrowQuickSave } = require("./lib/borrowed-save-slot.cjs");
    borrowedQuick = await borrowQuickSave({ confirmed: true, sourceDirectory: sourceDir, source: quickSource,
      backupDirectory: path.join(out, "user-save-backup"), expectedSha256: legacyBefore[quickName] });
    report.quickBackup = { source: quickSource, backup: borrowedQuick.backup, receipt: borrowedQuick.receiptFile,
      originalSha256: legacyBefore[quickName], watcherPid: borrowedQuick.watcherPid, status: "BACKUP_VERIFIED" };
    return { ...report.quickBackup };
  });
  await step("native-quick-migration-cancel-confirm-and-real-bytes", async () => {
    await startPlayer(); await openSaves(); await openMigration();
    assert.deepEqual((await migrationDialog().locator("dd").allTextContents()).map(value => path.resolve(value)), [targetDir, sourceDir]);
    assert.match(await migrationDialog().innerText(), /没有待复制的旧存档/);
    await migrationDialog().getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByTestId("renpy-menu-settings").click(); await A.settleRuntime(page);
    await page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
    const auto = page.getByRole("checkbox", { name: "自动存档", exact: true });
    if (await auto.isChecked()) await auto.uncheck();
    await page.getByTestId("settings-finish").click(); await A.settleRuntime(page); await openSaves();
    borrowedQuick.activate(fixtureBytes);
    report.quickBackup.status = "BORROWED"; report.quickBackup.fixtureSha256 = fixtureSha256; save();
    assert.deepEqual(inventory(sourceDir), { ...legacyBefore, [quickName]: fixtureSha256 }, "Only the approved slot can change");
    await openMigration();
    assert.match(await migrationDialog().innerText(), /可复制 1 个旧存档/);
    assert.match(await migrationDialog().innerText(), /待复制：quick-06\.json/);
    await migrationDialog().getByRole("button", { name: "暂不迁移", exact: true }).click();
    assert(!fs.existsSync(quickTarget), "Cancelling quick migration cannot write the target");
    assert.equal(sha(quickSource), fixtureSha256);
    await openMigration();
    await migrationDialog().getByRole("button", { name: "确认复制", exact: true }).click();
    await migrationDialog().waitFor({ state: "detached" });
    assert.equal(sha(quickTarget), fixtureSha256, "Native quick migration must copy actual bytes");
    assert.equal(sha(quickSource), fixtureSha256, "Migration must preserve its source");
    await page.getByRole("tab", { name: "快存", exact: true }).click();
    await page.getByTestId("save-slot-quick-6").getByRole("button", { name: "读取快存存档 6", exact: true }).click();
    await page.getByTestId("game-state-playing").waitFor(); await A.settleRuntime(page);
    assert.match(await page.locator(".dialog-box").innerText(), /本轮独立 UI 验收/);
    await page.screenshot({ path: path.join(out, "native-migrated-quick-read.png") });
    return { cancelNoWrites: true, copied: quickTarget, sha256: fixtureSha256, sourceRetained: true, actualNativeSlotLoad: true };
  });
  await step("native-latest-quick-load-cancel-and-confirm", async () => {
    const before = await page.locator(".dialog-box").innerText();
    const dialog = page.getByRole("dialog", { name: "读取最新快存？", exact: true });
    await page.getByTestId("renpy-quick-load").click(); await dialog.waitFor();
    const date = await page.evaluate(value => new Date(value).toLocaleString(), fixtureData.created_at);
    assert((await dialog.innerText()).includes(date), "Latest candidate must be the migrated quick-save");
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); await dialog.waitFor({ state: "detached" });
    assert.equal(await page.locator(".dialog-box").innerText(), before);
    await page.getByTestId("renpy-quick-load").click(); await dialog.waitFor();
    await dialog.getByTestId("confirm-quick-load").click(); await dialog.waitFor({ state: "detached" });
    await A.settleRuntime(page);
    assert.match(await page.locator(".dialog-box").innerText(), /本轮独立 UI 验收/);
    assert.equal(sha(quickTarget), fixtureSha256);
    await exitPlayer();
    return { migratedCandidateDate: fixtureData.created_at, cancelPreservedState: true, nativeConfirmedLoad: true };
  });
  await step("restore-user-original-and-retain-backup-byte-for-byte", async () => {
    const receipt = await borrowedQuick.restore(); borrowedQuick = undefined;
    report.quickBackup.status = "RESTORED"; report.quickBackup.restoredSha256 = receipt.restoredSha256; save();
    assert.equal(sha(quickSource), legacyBefore[quickName]);
    assert.equal(sha(report.quickBackup.backup), legacyBefore[quickName]);
    assert.deepEqual(inventory(sourceDir), legacyBefore);
    assert(!fs.existsSync(receipt.holding));
    return { source: quickSource, restoredSha256: receipt.restoredSha256, backup: receipt.backup,
      backupRetained: true, allOtherLegacyFilesUnchanged: true };
  });
  await step("migrated-quick-survives-native-restart-after-original-restored", async () => {
    await startPlayer(); await openSaves();
    await page.getByRole("tab", { name: "快存", exact: true }).click();
    await page.getByTestId("save-slot-quick-6").getByRole("button", { name: "读取快存存档 6", exact: true }).click();
    await page.getByTestId("game-state-playing").waitFor(); await A.settleRuntime(page);
    assert.match(await page.locator(".dialog-box").innerText(), /本轮独立 UI 验收/);
    assert.equal(sha(quickTarget), fixtureSha256); assert.equal(sha(quickSource), legacyBefore[quickName]);
    await page.screenshot({ path: path.join(out, "native-migrated-quick-after-restart.png") }); await exitPlayer();
    return { nativeRestartLoad: true, targetSha256: fixtureSha256, originalRestoredSha256: sha(quickSource) };
  });
  assert.deepEqual(report.pageErrors, []);
  report.status = "INSTALLED_PORTABLE_SAVE_FLOW_PASS";
  report.quickMigration = { status: "PASS", sourceRestored: true, backupRetained: true };
}
(async () => {
  if (authorizedQuickBackup) { await runAuthorizedQuickMigration(); return; }
  await step("verified-installed-export-and-read-only-legacy-preflight", async () => {
    await startPlayer(); await openSaves();
    await openMigration();
    const paths = await migrationDialog().locator("dd").allTextContents();
    assert.deepEqual(paths.map(p => path.resolve(p)), [targetDir, sourceDir]);
    assert.match(await migrationDialog().innerText(), /没有待复制的旧存档/);
    await migrationDialog().getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByTestId("renpy-menu-settings").click(); await A.settleRuntime(page);
    await page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
    const auto = page.getByRole("checkbox", { name: "自动存档", exact: true });
    if (await auto.isChecked()) await auto.uncheck();
    await page.getByTestId("settings-finish").click(); await A.settleRuntime(page);
    await openSaves();
    const quick = Array.from({ length: 6 }, (_, i) => `quick-${String(i + 1).padStart(2, "0")}.json`);
    report.quickMigration = { status: "BLOCKED", reason: "All six supported legacy quick slots are occupied; no user files altered",
      files: quick.map(name => ({ name, sha256: legacyBefore[name] })) };
    assert(quick.every(name => legacyBefore[name]), "Environment changed: reevaluate safe quick migration rather than reporting stale blocker");
    return { exeSha256: report.exeSha256, quickMigration: report.quickMigration, legacyUntouched: true };
  });
  await step("native-manual-auto-consent-cancel-copy-and-conflict-preservation", async () => {
    if (resume) {
      const passed = resume.cases.find(row => row.name === "native-manual-auto-consent-cancel-copy-and-conflict-preservation");
      assert.equal(passed?.status, "PASS");
      assert.deepEqual(legacyBefore, resume.legacyAfter);
      assert(resume.ownedLegacy.length === 3 && resume.ownedLegacy.every(item => item.cleanup === "REMOVED_OWNED_FILE"));
      for (const item of resume.ownedLegacy)
        assert.equal(sha(item.target), item.conflict ? A.sha256(originalSave) : item.sha256);
      return { ...passed.result, execution: "REUSED_VERIFIED_IDENTICAL_BINARY_EVIDENCE", evidence: resumeFile, evidenceSha256: sha(resumeFile) };
    }
    const freeManual = Array.from({ length: 12 }, (_, i) => i + 1).find(slot => {
      const name = `slot-${String(slot).padStart(2, "0")}.json`;
      return !fs.existsSync(path.join(sourceDir, name)) && !fs.existsSync(path.join(targetDir, name));
    });
    const freeAuto = Array.from({ length: 8 }, (_, i) => i + 1).find(slot => {
      const name = `auto-${String(slot).padStart(2, "0")}.json`;
      return !fs.existsSync(path.join(sourceDir, name)) && !fs.existsSync(path.join(targetDir, name));
    });
    assert(freeManual && freeAuto, "No safe manual/auto fixture slot; never replace preexisting files");
    const files = [
      [path.basename(priorSave.path), "manual", manualSlot, true],
      [`slot-${String(freeManual).padStart(2, "0")}.json`, "manual", freeManual, false],
      [`auto-${String(freeAuto).padStart(2, "0")}.json`, "auto", freeAuto, false],
    ];
    for (const [name, kind, slot, conflict] of files) {
      const bytes = Buffer.from(JSON.stringify({ ...JSON.parse(originalSave), save_kind: kind, slot,
        save_id: `${baseline.runId}-continuation-${name}`, created_at: "2025-01-01T00:00:00.000Z" }, null, 2));
      const file = path.join(sourceDir, name);
      fs.writeFileSync(file, bytes, { flag: "wx" });
      report.ownedLegacy.push({ path: file, target: path.join(targetDir, name), sha256: A.sha256(bytes), conflict }); save();
      const evidence = path.join(out, "legacy-byte-evidence", name);
      fs.mkdirSync(path.dirname(evidence), { recursive: true }); fs.writeFileSync(evidence, bytes, { flag: "wx" });
    }
    await openMigration();
    assert.match(await migrationDialog().innerText(), /可复制 2 个旧存档/);
    assert.match(await migrationDialog().innerText(), new RegExp(`冲突未覆盖：${path.basename(priorSave.path)}`));
    await migrationDialog().getByRole("button", { name: "暂不迁移", exact: true }).click();
    for (const item of report.ownedLegacy.filter(item => !item.conflict)) assert(!fs.existsSync(item.target), "Cancel cannot write");
    await openMigration();
    await migrationDialog().getByRole("button", { name: "确认复制", exact: true }).click();
    await migrationDialog().waitFor({ state: "detached" });
    for (const item of report.ownedLegacy) {
      assert.equal(sha(item.path), item.sha256, "Copy must preserve source bytes");
      assert.equal(sha(item.target), item.conflict ? A.sha256(originalSave) : item.sha256, "Conflict must remain unchanged");
    }
    await page.screenshot({ path: path.join(out, "native-manual-auto-migration.png") });
    return { manualCopied: 1, autoCopied: 1, conflictsPreserved: 1, sourcesPreserved: 3,
      quick: "BLOCKED_NOT_SUBSTITUTED_BY_OTHER_CATEGORIES" };
  });
  await step("native-location-dialog-12-landscape-dpr-motion-cases", async () => {
    if (resume) {
      const passed = resume.cases.find(row => row.name === "native-location-dialog-12-landscape-dpr-motion-cases");
      assert.equal(passed?.status, "PASS");
      assert.equal(resume.nativeMatrix.length, 12);
      assert(resume.nativeMatrix.every(row => row.status === "PASS"));
      report.nativeMatrix = resume.nativeMatrix;
      report.nativeMatrixEvidence = resumeFile;
      return { ...passed.result, execution: "REUSED_VERIFIED_IDENTICAL_BINARY_EVIDENCE", evidence: resumeFile, evidenceSha256: sha(resumeFile) };
    }
    const cdp = await page.context().newCDPSession(page); report.nativeMatrix = [];
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
        await cdp.send("Emulation.clearDeviceMetricsOverride");
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
        await page.waitForFunction(({ width, height, dpr, reduced }) => innerWidth === width && innerHeight === height
          && devicePixelRatio === dpr && matchMedia("(prefers-reduced-motion: reduce)").matches === reduced,
        { width, height, dpr, reduced });
        await openMigration();
        const close = migrationDialog().getByRole("button", { name: "关闭", exact: true });
        await close.click({ trial: true });
        const geometry = await migrationDialog().evaluate(node => {
          const r = node.getBoundingClientRect(), buttons = [...node.querySelectorAll("button:not([disabled])")].map(button => {
            const b = button.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
            return { rect: b.toJSON(), hit: hit === button || button.contains(hit) };
          });
          return { rect: r.toJSON(), buttons, focused: node.contains(document.activeElement), viewport: { width: innerWidth, height: innerHeight },
            dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert.deepEqual(geometry.viewport, { width, height }); assert.equal(geometry.dpr, dpr);
        assert.equal(geometry.reduced, reduced); assert(geometry.focused);
        assert(geometry.overflow <= 1 && geometry.buttons.length > 0 && geometry.buttons.every(b => b.hit));
        assert(geometry.rect.x >= 0 && geometry.rect.y >= 0 && geometry.rect.right <= width && geometry.rect.bottom <= height);
        await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
        assert(await migrationDialog().evaluate(node => node.contains(document.activeElement)));
        // Playwright screenshot viewport restoration can reset WebView DPR. Capture via the owned CDP session.
        const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(path.join(out, `native-location-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}.png`), Buffer.from(shot.data, "base64"));
        assert.equal(await page.evaluate(() => devicePixelRatio), dpr, "Evidence capture must preserve the test DPR");
        await close.click(); await migrationDialog().waitFor({ state: "detached" });
        assert(await page.getByTestId("save-storage-open").evaluate(node => node === document.activeElement));
        report.nativeMatrix.push({ width, height, dpr, reduced, geometry, status: "PASS" }); save();
      }
    assert.equal(report.nativeMatrix.length, 12);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    return { cases: 12, scope: report.scope };
  });
  await step("normal-exit-new-process-real-native-load", async () => {
    await exitPlayer(); await startPlayer(); await openSaves();
    if (manualSlot > 6) await page.getByTestId("save-page-next").click();
    await page.getByTestId(`save-slot-manual-${manualSlot}`).getByRole("button", { name: `读取手动存档 ${manualSlot}`, exact: true }).click();
    await page.getByTestId("game-state-playing").waitFor(); await A.settleRuntime(page);
    assert.match(await page.locator(".dialog-box").innerText(), /本轮独立 UI 验收/);
    await page.screenshot({ path: path.join(out, "native-restarted-load.png") });
    await exitPlayer(); return { normalRestart: true, realNativeLoad: true, saveSha256: sha(priorSave.path) };
  });
  await step("real-acl-write-denial-no-fallback-restore-and-retry", async () => {
    const before = inventory(targetDir); aclReceipt = path.join(out, "readonly-acl.json");
    // Set recovery ownership before the command; a failed command may already have changed the ACL.
    aclActive = true;
    try {
      nativeCommand("deny-save-write", ["-File", path.join(root, "scripts/portable-save-test-acl.ps1"),
        "-Mode", "Block", "-Target", targetDir, "-RunRoot", baselineRoot, "-ReportPath", aclReceipt]);
      await startPlayer(); await page.getByTestId("start-new-game").click();
      await page.getByTestId("game-state-playing").waitFor(); await A.settleRuntime(page);
      await page.getByTestId("renpy-quick-save").click();
      const error = page.getByRole("status").filter({ hasText: /快存失败/ }); await error.waitFor();
      report.writeDeniedMessage = await error.innerText(); save();
      assert(report.writeDeniedMessage.includes(targetDir)); assert.match(report.writeDeniedMessage, /不会回退/);
      assert.deepEqual(inventory(targetDir), before, "Write denial cannot change existing save bytes");
      await page.screenshot({ path: path.join(out, "native-write-denied.png") });
    } finally { await restoreAcl("restore-save-write"); }
    await page.getByTestId("renpy-quick-save").click();
    await page.getByRole("status").filter({ hasText: "快存已保存" }).waitFor();
    const after = inventory(targetDir), newQuick = Object.keys(after).filter(name => name.startsWith("quick-") && after[name] !== before[name]);
    assert.equal(newQuick.length, 1, "Successful retry must write real quick-save bytes");
    assert.equal(JSON.parse(fs.readFileSync(path.join(targetDir, newQuick[0]), "utf8")).game_id, baseline.runId);
    await exitPlayer(); return { actualAclDenial: true, noFallback: true, actualAclRestored: true, realRetry: newQuick[0] };
  });
  assert.deepEqual(report.pageErrors, []);
  report.status = "BLOCKED";
  report.remaining = ["Actual installed legacy quick-save migration: occupied source slots; isolated-user environment or explicit backup/restore decision required"];
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
  console.error(report.error);
}).finally(async () => {
  try { await restoreAcl("finally-restore-save-write"); }
  catch (error) { report.status = "FAILED"; report.aclCleanupError = String(error); process.exitCode = 1; }
  if (player && player.exitCode === null) {
    await browser?.close().catch(() => {});
    const result = spawnSync("taskkill.exe", ["/PID", String(player.pid), "/T", "/F"], { windowsHide: true });
    report.cleanup.push({ pid: player.pid, forced: true, exitCode: result.status });
    if (result.status !== 0) { report.status = "FAILED"; process.exitCode = 1; }
  }
  if (borrowedQuick) try {
    const receipt = await borrowedQuick.restore(); borrowedQuick = undefined;
    report.quickBackup.status = "RESTORED"; report.quickBackup.restoredSha256 = receipt.restoredSha256;
  } catch (error) { report.status = "FAILED"; report.originalRestoreError = String(error); process.exitCode = 1; }
  for (const item of report.ownedLegacy) {
    try {
      assert.equal(sha(item.path), item.sha256, "Changed fixture must be preserved");
      fs.unlinkSync(item.path); item.cleanup = "REMOVED_OWNED_FILE";
    } catch (error) { report.status = "FAILED"; item.cleanupError = String(error); process.exitCode = 1; }
  }
  try {
    report.legacyAfter = inventory(sourceDir);
    assert.deepEqual(report.legacyAfter, legacyBefore, "All preexisting legacy files must survive byte-for-byte; no fallback writes");
    report.legacyBytePreservation = "PASS";
  } catch (error) { report.status = "FAILED"; report.legacyPreservationError = String(error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(); console.log(`Evidence: ${out}`);
});
