"use strict";
// Targeted observation after the frozen full run and its independent audit.
// It never upgrades that run's FAILED result.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { NarrativePlayer } = require("./lib/installed-narrative-player.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateNarrativePreparation } = require("./lib/installed-narrative-1922-policy.cjs");
const { installChoiceFrameProbe, analyzeChoiceFrames, analyzeDialogFrames } = require("./lib/nvl-choice-frame-probe.cjs");
const { validateInterruptedNarrativeFacts } = require("./lib/interrupted-narrative-evidence.cjs");
const root = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });

async function worker(prepFile) {
  const prep = read(prepFile); validateNarrativePreparation(prep);
  assert.equal(process.env.AGENTVN_TEST_PROJECT, prep.fixture.input);
  assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), prep.sessionRoot);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), cells: [], launches: [],
    screenshots: [], knownProcesses: [], pageErrors: [], modelRequests: 0, productChanges: 0,
    scope: "NVL_CHOICE_FRAME_DIAGNOSTIC_NOT_FULL_REGRESSION", normalCloseClaimed: false };
  const save = () => fs.writeFileSync(path.join(prep.sessionRoot, "diagnostic.json"), JSON.stringify(report, null, 2));
  const player = new NarrativePlayer(prep, report, save);
  const page = () => player.page;
  async function done(scene, index) {
    await page().waitForFunction(({ scene, index }) => {
      const state = document.querySelector('[data-testid="game-state-playing"]');
      return state?.getAttribute("data-current-scene-id") === scene &&
        Number(state.getAttribute("data-current-command-index")) === index;
    }, { scene, index });
    await page().evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page().waitForFunction(() => document.querySelector(".dialog-box")
      ?.getAttribute("data-dialog-page-done") === "true");
  }
  async function initialize() {
    await page().getByTestId("start-new-game").click(); await player.ready("playing"); await done("narrative_entry", 0);
    await page().keyboard.press("Escape"); await player.ready("main_menu");
    await page().getByTestId("open-settings").click(); await player.ready("settings");
    await page().locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
    await page().locator('[data-settings-tab-current="system"]').waitFor();
    await page().getByRole("checkbox", { name: "自动存档", exact: true }).uncheck();
    await page().locator(".settings-tabs").getByRole("button", { name: "文字", exact: true }).click();
    await page().locator('[data-settings-tab-current="text"]').waitFor();
    await page().getByRole("slider", { name: "Text speed", exact: true }).focus();
    await page().keyboard.press("Home");
    assert.equal(await page().getByRole("slider", { name: "Text speed", exact: true }).inputValue(), "0");
    await page().getByTestId("settings-finish").click(); await player.ready("main_menu");
    await page().getByTestId("continue-game").click(); await player.ready("playing"); await done("narrative_entry", 0);
    await page().locator(".dialog-box").click();
    await page().getByRole("button", { name: "选择：capacity", exact: true }).click(); await done("capacity", 0);
  }
  try {
    const cases = [true, false].flatMap(reduced => ["agentvn", "renpy"].map(layout => ({
      width: 1920, height: 1080, reduced, layout, kind: "nvl-choice",
    }))).concat([{ width: 3840, height: 2160, reduced: false, layout: "renpy", kind: "dialog" }]);
    for (const { width, height, reduced, layout, kind } of cases) {
      const name = `${width}x${height}-dpr1-${reduced ? "reduced" : "normal"}-${layout}${kind === "dialog" ? "-dialog" : ""}`;
      const cell = { name, width, height, reduced, layout, kind, status: "RUNNING", startedAt: new Date().toISOString() };
      report.cells.push(cell); save();
      let paintListener, paintStarted = false;
      const viewport = () => page().evaluate(() => ({ width: innerWidth, height: innerHeight,
        dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
      async function stopPaint() {
        if (paintStarted && player.cdp) {
          try { await player.cdp.send("Page.stopScreencast"); }
          catch (e) { cell.paintStopError = String(e); }
        }
        if (paintListener && player.cdp) player.cdp.off("Page.screencastFrame", paintListener);
        paintStarted = false; paintListener = null;
        if (player.page) cell.paintViewportAfter = await viewport();
        cell.paintTraceStatus = !cell.paintError && !cell.paintStopError && cell.paintFrames?.length >= 2
          ? "CAPTURED" : "UNPROVEN";
      }
      async function startPaint() {
        cell.paintFrames = []; cell.paintViewportBefore = await viewport();
        let firstFrameReceived;
        const firstFrame = new Promise(resolve => { firstFrameReceived = resolve; });
        paintListener = event => {
          void player.cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId })
            .catch(e => { cell.paintError = String(e); });
          if (cell.paintFrames.length >= 120) { cell.paintTruncated = true; return; }
          try {
            const bytes = Buffer.from(event.data, "base64");
            assert.equal(bytes.subarray(1, 4).toString(), "PNG");
            const file = path.join(prep.sessionRoot, `${name}-paint-${String(cell.paintFrames.length).padStart(3, "0")}.png`);
            fs.writeFileSync(file, bytes, { flag: "wx" });
            cell.paintFrames.push({ path: file, sha256: sha(file), bytes: bytes.length,
              width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
              receivedAt: new Date().toISOString(), metadata: event.metadata });
            firstFrameReceived(true);
          } catch (e) { cell.paintError = String(e.stack || e); }
        };
        player.cdp.on("Page.screencastFrame", paintListener);
        try {
          await player.cdp.send("Page.startScreencast", { format: "png", maxWidth: width, maxHeight: height, everyNthFrame: 1 });
          paintStarted = true;
          let firstFrameTimer;
          try {
            const received = await Promise.race([firstFrame,
              new Promise(resolve => { firstFrameTimer = setTimeout(() => resolve(false), 3000); })]);
            assert(received, "No initial output frame before triggering the choice");
          } finally { clearTimeout(firstFrameTimer); }
        } catch (e) { cell.paintError = String(e.stack || e); }
      }
      try {
        await player.start({ layout, cell: name, installId: `qa_nvl_choice_${path.basename(prep.sessionRoot).slice(-2)}_${name.replace(/\W/g, "_")}`,
          viewport: { width, height, dpr: 1, reduced } });
        await initialize();
        for (let index = 0; index < 24; index++) {
          await done("capacity", index);
          const pieces = [];
          for (let turns = 0; ; turns++) {
            assert(turns < 1000, "Pagination must converge");
            const current = await page().locator(".dialog-box").evaluate(n => ({
              page: Number(n.dataset.dialogPage), pages: Number(n.dataset.dialogPages),
              text: n.querySelector('[data-nvl-current="true"] .nvl-page-text')?.textContent,
            }));
            assert(current.text); pieces.push(current.text);
            if (current.page === current.pages) break;
            await page().locator(".dialog-box").click();
            await page().waitForFunction(p => Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-page")) > p,
              current.page); await done("capacity", index);
          }
          assert.equal(pieces.join(""), prep.fixture.capacityTexts[index]);
          if (index === 23 && kind === "nvl-choice") {
            await page().evaluate(installChoiceFrameProbe);
            await page().evaluate(() => window.__QA_NVL_CHOICE_PROBE__.start());
            await startPaint();
          }
          await page().locator(".dialog-box").click();
        }
        await page().getByRole("button", { name: "选择：离开NVL容量页", exact: true }).waitFor();
        if (kind === "dialog") {
          // Preserve the original capacity -> leave NVL -> new branch route.
          await page().getByRole("button", { name: "选择：离开NVL容量页", exact: true }).click();
          await done("capacity_end", 0);
          await page().keyboard.press("Escape"); await player.ready("main_menu");
          await page().getByTestId("start-new-game").click(); await player.ready("playing"); await done("narrative_entry", 0);
          await page().locator(".dialog-box").click();
          await page().getByRole("button", { name: "选择：voice_dialog", exact: true }).waitFor();
          await page().evaluate(installChoiceFrameProbe, { kind: "dialog" });
          await page().evaluate(() => window.__QA_NVL_CHOICE_PROBE__.start());
          await startPaint();
          await page().getByRole("button", { name: "选择：voice_dialog", exact: true }).click();
          await done("voice_dialog", 0);
        }
        // Mirrors the original sampling point. This is preserved even if
        // subsequent rAF/ResizeObserver work makes the screenshot look correct.
        cell.immediate = await page().evaluate(() => window.__QA_NVL_CHOICE_PROBE__.capture());
        await page().waitForFunction(() => window.__QA_NVL_CHOICE_PROBE__.read().active === false, null, { timeout: 15000 });
        const trace = await page().evaluate(() => window.__QA_NVL_CHOICE_PROBE__.finish());
        cell.trace = path.join(prep.sessionRoot, `${name}-frames.json`);
        fs.writeFileSync(cell.trace, JSON.stringify(trace, null, 2), { flag: "wx" });
        cell.traceSha256 = sha(cell.trace);
        cell.observation = kind === "dialog" ? analyzeDialogFrames(trace) : analyzeChoiceFrames(trace);
        await stopPaint();
        await player.shot("choice-diagnostic");
        cell.status = "OBSERVED";
      } catch (e) {
        cell.status = "FAILED"; cell.error = String(e.stack || e);
        if (player.page) {
          const trace = await page().evaluate(() => window.__QA_NVL_CHOICE_PROBE__?.finish()).catch(() => null);
          if (trace) {
            const partial = path.join(prep.sessionRoot, `${name}-partial-frames.json`);
            fs.writeFileSync(partial, JSON.stringify(trace, null, 2), { flag: "wx" }); cell.partialTrace = desc(partial);
          }
          await player.shot("diagnostic-failure").catch(() => {});
        }
      } finally {
        if (paintListener || paintStarted) await stopPaint();
        await player.stop(); cell.finishedAt = new Date().toISOString(); save();
        console.log(`${name}: ${cell.status} ${cell.observation?.classification || cell.error || ""}`);
      }
    }
    assert.equal(report.cells.length, 5);
    assert(report.cells.every(c => c.status === "OBSERVED"));
    assert(!report.observerError); assert.deepEqual(report.pageErrors, []);
    report.status = "OBSERVATION_COMPLETE";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try { await player.stop(); }
    catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
  }
}

async function session(attempt, sourceAttempt, exportAttempt, validateOnly, interruptionAuditAttempt) {
  for (const a of [attempt, sourceAttempt, exportAttempt]) assert.match(a, /^\d{2}$/);
  const source = path.join(root, `installed-narrative-1922-${sourceAttempt}`), prior = read(path.join(source, "session.json"));
  let auditFile, protectedProducts;
  if (interruptionAuditAttempt) {
    assert.match(interruptionAuditAttempt, /^\d{2}$/);
    auditFile = `${source}-interruption-audit-${interruptionAuditAttempt}/report.json`;
    const audit = read(auditFile);
    assert.equal(audit.status, "INTERRUPTED_EVIDENCE_AUDITED");
    assert.equal(audit.scope, "INTERRUPTED_NARRATIVE_EVIDENCE_AND_RECOVERY_ONLY");
    assert.equal(audit.sourceConclusion, "INTERRUPTED_NOT_ACCEPTED");
    validateInterruptedNarrativeFacts(audit.facts);
    assert(audit.finishedAt && audit.groups.length === 4 && audit.groups.every(g => g.status === "PASS"));
    for (const f of [...audit.originals, audit.restoration, audit.laterOpeningBuild]) assert.equal(sha(f.path), f.sha256);
    assert.equal(audit.originals[0].sha256, sha(path.join(source, "session.json")));
    assert.equal(audit.originals[1].sha256, sha(path.join(source, "player.json")));
    assert.equal(read(audit.restoration.path).status, "PASS");
    protectedProducts = audit.currentProtectedProducts;
    assert.equal(protectedProducts.length, 4);
  } else {
    assert(prior.finishedAt && !prior.cleanupError && ["PASS", "FAILED"].includes(prior.status),
      "Do not touch a live full matrix or an unrestored profile");
    const raw = read(prior.raw.path);
    assert(raw.finishedAt && raw.cells.length === 24 && raw.launches.every(l => l.cleanup?.status === "PASS"));
    auditFile = `${source}-audit-01/report.json`;
    const audit = read(auditFile);
    assert.equal(audit.status, "PASS"); assert.equal(audit.sourceConclusion, raw.status);
    assert.equal(audit.session.sha256, sha(path.join(source, "session.json")));
    assert.equal(audit.raw.sha256, sha(prior.raw.path));
    assert.equal(read(prior.restoration.path).status, "PASS");
    protectedProducts = prior.protectedProducts;
  }
  for (const f of [...protectedProducts, ...prior.tools]) assert.equal(sha(f.path), f.sha256);
  assert(!rows().some(p => /^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  const exported = desc(`F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${exportAttempt}/report.json`);
  const e = read(exported.path), out = path.resolve(root, `installed-narrative-1922-${attempt}`);
  assert(!fs.existsSync(out)); assert.equal(e.fixture.capacityVariant, "mixed-history-v2");
  const prep = { status: "PASS", sessionRoot: out, defaultStorage: prior.defaultStorage || "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION",
    exported, installation: e.installation, fixture: e.fixture, cartridges: e.cartridges,
    executable: prior.executable, temporary: path.join(out, "temporary"), webview: path.join(out, "webview") };
  validateNarrativePreparation(prep);
  if (validateOnly) { console.log("PASS_DIAGNOSTIC_PRECONDITIONS_NO_PROFILE_OR_PRODUCT_CHANGE"); return; }
  fs.mkdirSync(out); fs.mkdirSync(prep.temporary);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), out, commands: [],
    source: desc(path.join(source, "session.json")), sourceAudit: desc(auditFile),
    interruptedSource: Boolean(interruptionAuditAttempt),
    scope: "NVL_CHOICE_DIAGNOSTIC_SESSION_NOT_FULL_ACCEPTANCE", builds: 0, modelRequests: 0, productChanges: 0 };
  const save = () => fs.writeFileSync(path.join(out, "diagnostic-session.json"), JSON.stringify(report, null, 2));
  let prepared = false;
  async function command(exe, args, label, env = process.env) {
    const c = { label, command: [exe, ...args], startedAt: new Date().toISOString(), log: path.join(out, `${label}.log`) };
    report.commands.push(c); save(); const fd = fs.openSync(c.log, "wx");
    try {
      const child = spawn(exe, args, { cwd: path.resolve(__dirname, ".."), env, windowsHide: true, stdio: ["ignore", fd, fd] });
      c.pid = child.pid; save();
      c.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      assert.equal(c.exitCode, 0, c.log);
    } finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); }
  }
  async function profile(action) {
    await command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/native-dev-preview-profile.ps1",
      "-Action", action, "-RunDirectory", out, "-CodexCacheView", "-Storage", "NativeRoaming"], `profile-${action.toLowerCase()}`);
  }
  try {
    report.protectedProducts = protectedProducts;
    for (const f of report.protectedProducts) assert.equal(sha(f.path), f.sha256);
    report.tools = [__filename, "scripts/lib/nvl-choice-frame-probe.cjs", "scripts/lib/interrupted-narrative-evidence.cjs",
      ...prior.tools.map(f => f.path)].filter((v, i, a) => a.indexOf(v) === i).map(file => {
      const f = desc(file), copy = path.join(out, "tools", path.basename(file));
      fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(f.path, copy, fs.constants.COPYFILE_EXCL);
      return { ...f, copy };
    });
    prepared = true; await profile("Prepare");
    const prepFile = path.join(out, "preparation.json");
    fs.writeFileSync(prepFile, JSON.stringify(prep, null, 2), { flag: "wx" }); report.preparation = desc(prepFile);
    report.environment = { AGENTVN_TEST_PROJECT: prep.fixture.input, AGENTVN_WORKSPACE_OUTPUT: out };
    await command(process.execPath, [__filename, "--worker", prepFile], "diagnostic",
      { ...process.env, ...report.environment, TEMP: prep.temporary, TMP: prep.temporary });
    report.raw = desc(path.join(out, "diagnostic.json"));
    assert.equal(read(report.raw.path).status, "OBSERVATION_COMPLETE"); report.status = "OBSERVATION_COMPLETE";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try {
      const rawFile = path.join(out, "diagnostic.json");
      if (fs.existsSync(rawFile)) {
        report.raw = desc(rawFile); const r = read(rawFile);
        assert(r.finishedAt && !r.cleanupError && r.launches.every(l => l.cleanup?.status === "PASS"));
        const all = rows();
        assert(!all.some(p => r.knownProcesses.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
        report.absentPorts = r.launches.map(l => l.port); assert.deepEqual(listeners(report.absentPorts), []);
      }
      assert(!rows().some(p => p.Name === "agentvn-player.exe"));
      if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
        await profile("Restore"); report.restoration = desc(path.join(out, "profile-restoration.json"));
        assert.equal(read(report.restoration.path).status, "PASS");
      }
      for (const f of [...report.protectedProducts || [], ...report.tools || []]) assert.equal(sha(f.path), f.sha256);
    } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
  }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const interrupted = args.find(a => a.startsWith("--after-interruption="))?.split("=")[1];
  (args[0] === "--worker" ? worker(args[1]) : session(...args.slice(0, 3), args.includes("--validate-only"), interrupted))
    .catch(e => { console.error(e); process.exitCode = 1; });
}
