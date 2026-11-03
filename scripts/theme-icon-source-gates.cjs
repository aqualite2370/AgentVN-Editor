"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const { root, qa, checkpoint, out, input, sources, sha, info } = require("./theme-icon-source-playwright.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const phase = process.argv[2]; assert(["check", "dev", "closeout"].includes(phase));
const greenFile = process.env.AGENTVN_THEME_GREEN; assert(greenFile, "Explicit fixed-candidate browser report required");
const full = read(greenFile), prep = read(path.join(out, "preparation.json"));
function validateBehavior() {
  assert.equal(full.status, "PASS"); assert.equal(full.cleanup.status, "PASS"); assert.equal(full.modelRequests, 0);
  assert.equal(full.cases.length, 12); assert.equal(new Set(full.cases.map(c => c.key)).size, 12);
  for (const c of full.cases) {
    assert.equal(c.status, "PASS"); assert.equal(c.checks.length, 11); assert(c.checks.every(t => t.status === "PASS"));
    assert.deepEqual(c.pageErrors, []); assert.equal(c.states.length, 6); assert.equal(c.transitions.length, 3);
    const shot = c.screenshot, bytes = fs.readFileSync(shot.path);
    assert.equal(sha(bytes), shot.sha256);
    assert.deepEqual(shot.before, { width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced });
    assert.deepEqual(shot.after, shot.before);
    assert.equal(bytes.readUInt32BE(16), c.width * c.dpr); assert.equal(bytes.readUInt32BE(20), c.height * c.dpr);
    for (const state of c.states) {
      const icon = state.geometry.icons.filter(i => i.opacity > .99); assert.equal(icon.length, 1);
      assert(Math.abs(icon[0].deltaX) <= .75 && Math.abs(icon[0].deltaY) <= .75 && !icon[0].outsideThumb);
    }
  }
  assert.equal(sha(fs.readFileSync(path.join(path.dirname(greenFile), "executed-test.cjs"))), full.testSha256);
  assert.equal(sha(fs.readFileSync(path.join(root, "scripts/theme-icon-source-playwright.cjs"))), full.testSha256);
  for (const file of sources) assert.equal(info(file).sha256, full.sources.find(s => s.file === file).sha256);
  // Whole-file comparison prevents accidental motion changes hidden next to the icon fix.
  const before = fs.readFileSync(path.join(checkpoint, "editor/src/styles/layout.css"), "utf8");
  const oldRule = ".theme-icon{position:absolute;top:3px;right:3px;bottom:3px;left:3px;";
  const newRule = "/* Keep this small control continuous in both tones without changing page motion. */\n"
    + "@media (prefers-reduced-motion: reduce){.theme-tone-switch{--motion-scale:.5}}\n"
    + ".theme-icon{position:absolute;inset:0;margin:auto;";
  assert.equal(before.split(oldRule).length, 2);
  assert.equal(fs.readFileSync(path.join(root, "editor/src/styles/layout.css"), "utf8"), before.replace(oldRule, newRule));
  for (const saved of prep.saved.filter(s => !["editor/src/styles/layout.css", "plans/ACTIVE_TASKS.md", "AgentVN Dev.exe"].includes(s.file)))
    assert.equal(info(saved.file).sha256, saved.sha256, `Unexpected change: ${saved.file}`);
}
validateBehavior();
const attempt = process.env.AGENTVN_THEME_GATE_ATTEMPT || "01"; assert(/^\d{2}$/.test(attempt));
const output = path.join(out, `${phase}-${attempt}`);
assert(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
const report = { status: "RUNNING", phase, at: new Date().toISOString(), commands: [], modelRequests: 0,
  scope: "SOURCE toolbar geometry and full Dev compile only; native new Dev UI/Release/Windows/Android NOT_RUN",
  behavior: { path: greenFile, sha256: sha(fs.readFileSync(greenFile)) }, sources: full.sources,
  scriptSha256: sha(fs.readFileSync(__filename)) };
fs.copyFileSync(__filename, path.join(output, "executed-gates.cjs"), fs.constants.COPYFILE_EXCL);
let watcher;
if (phase === "dev") {
  const prior = read(path.join(out, "check-01/report.json"));
  assert.equal(prior.status, "PASS"); assert.equal(prior.commands.length, 10);
  assert(prior.commands.every(c => c.exitCode === 0)); assert.deepEqual(prior.sources, full.sources);
  report.devReplacement = { path: path.join(root, "AgentVN Dev.exe"), beforeSha256: info("AgentVN Dev.exe").sha256, events: [] };
  watcher = fs.watch(root, (event, file) => {
    if (String(file).toLowerCase() === "agentvn dev.exe") report.devReplacement.events.push({ event, at: new Date().toISOString() });
  });
  watcher.on("error", error => { report.devReplacement.observerError = String(error); });
}
const commands = phase === "dev"
  ? ["powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]
  : phase === "check" ? [
    "node scripts/editor-theme-palette-contract.cjs",
    "node scripts/editor-ui-acceptance-isolation-contract-test.cjs",
    "node scripts/current-acceptance-viewports-test.cjs",
    "node scripts/editor-workspace-contract.cjs",
    "node scripts/editor-workspace-playwright.cjs",
    "node scripts/runtime-save-queue-test.cjs",
    "node scripts/runtime-exit-flow-test.cjs",
    "npm --prefix D:\\AgentVN\\editor run typecheck",
    "npm --prefix D:\\AgentVN\\editor run build",
    "npm --prefix D:\\AgentVN\\GameCli_framework run build",
  ] : [];
(async () => {
  for (const [i, command] of commands.entries()) {
    const logfile = path.join(output, `${String(i + 1).padStart(2, "0")}.log`), fd = fs.openSync(logfile, "wx");
    console.log(`START ${command}`);
    const child = spawn("powershell.exe", ["-NoProfile", "-Command",
      `$ErrorActionPreference='Stop'; ${command}; exit $LASTEXITCODE`], {
      cwd: root, windowsHide: true, stdio: ["ignore", fd, fd],
      env: { ...process.env, AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: path.join(qa, `gates-${phase}-${i + 1}`) },
    });
    const item = { command, logfile, pid: child.pid, startedAt: new Date().toISOString() }; report.commands.push(item);
    item.exitCode = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); })
      .finally(() => fs.closeSync(fd));
    item.finishedAt = new Date().toISOString(); item.status = item.exitCode === 0 ? "PASS" : "FAILED";
    fs.writeFileSync(path.join(output, "progress.json"), JSON.stringify(report, null, 2));
    console.log(`${item.status} ${command}`); assert.equal(item.exitCode, 0, `Required gate failed: ${logfile}`);
  }
  validateBehavior();
  if (phase === "dev") {
    report.devReplacement.afterSha256 = info("AgentVN Dev.exe").sha256;
    assert.equal(report.devReplacement.afterSha256, info("editor/src-tauri/target/debug/agentvn-editor.exe").sha256);
    assert(report.devReplacement.events.length && !report.devReplacement.observerError);
  }
  if (phase === "closeout") {
    const devFile = process.env.AGENTVN_THEME_DEV || path.join(out, "dev-01/report.json");
    const check = read(path.join(out, "check-01/report.json")), dev = read(devFile);
    for (const r of [check, dev]) { assert.equal(r.status, "PASS"); assert(r.commands.length); assert(r.commands.every(c => c.exitCode === 0)); }
    assert.equal(check.commands.length, 10); assert.equal(dev.commands.length, 1);
    assert.equal(dev.devReplacement.afterSha256, info("AgentVN Dev.exe").sha256);
    assert.equal(info("AgentVN Dev.exe").sha256, info("editor/src-tauri/target/debug/agentvn-editor.exe").sha256);
    assert(dev.devReplacement.events.some(e => Date.parse(e.at) >= Date.parse(dev.commands[0].startedAt)
      && Date.parse(e.at) <= Date.parse(dev.commands[0].finishedAt)));
    report.dev = info("AgentVN Dev.exe"); report.devReplacement = dev.devReplacement;
    report.successfulDevReport = { path: devFile, sha256: sha(fs.readFileSync(devFile)) };
    const firstDevFile = path.join(out, "dev-01/report.json"), firstDev = read(firstDevFile);
    assert.equal(firstDev.status, "FAILED"); assert.equal(firstDev.devReplacement.events.length, 0);
    const diagnosticFile = path.join(qa, "runtime-mode-map-diagnostic-01.json"), diagnostic = read(diagnosticFile);
    assert.equal(diagnostic.exclusiveNontruncatingOpen, "PASS");
    assert.equal(diagnostic.beforeSha256, diagnostic.afterSha256);
    assert.equal(diagnostic.listCode, 0); assert.equal(diagnostic.owners.length, 0);
    report.failedDevPreserved = { path: firstDevFile, sha256: sha(fs.readFileSync(firstDevFile)),
      diagnosticFile, diagnosticSha256: sha(fs.readFileSync(diagnosticFile)),
      cause: "Windows mapped-section write failure; specific owner was NOT established; no product/script workaround" };
    report.player = info("editor/src-tauri/binaries/agentvn-player.exe");
    assert.equal(report.player.sha256, info("GameCli_framework/src-tauri/target/release/agentvn-player.exe").sha256);
    report.compiledStyle = fs.readdirSync(path.join(root, "editor/dist/assets")).filter(n => n.endsWith(".css")).map(n => info(`editor/dist/assets/${n}`));
    assert(report.compiledStyle.length);
    const isCenteredRule = body => {
      const declarations = new Map(body.split(";").filter(Boolean).map(decl => {
        const colon = decl.indexOf(":"); return [decl.slice(0, colon).trim(), decl.slice(colon + 1).trim()];
      }));
      return declarations.get("position") === "absolute" && declarations.get("margin") === "auto"
        && (declarations.get("inset") === "0" || ["top", "right", "bottom", "left"].every(k => declarations.get(k) === "0"));
    };
    assert(isCenteredRule("position:absolute;inset:0;margin:auto"));
    assert(isCenteredRule("position:absolute;top:0;right:0;bottom:0;left:0;margin:auto"));
    assert(!isCenteredRule("position:absolute;top:3px;right:3px;bottom:3px;left:3px;margin:0px"));
    report.compiledIconRules = report.compiledStyle.flatMap(s => [...fs.readFileSync(path.join(root, s.file), "utf8")
      .matchAll(/\.theme-icon\{([^}]+)\}/g)].map(match => ({ file: s.file, body: match[1] })));
    assert(report.compiledIconRules.some(r => isCenteredRule(r.body)),
      "Built Editor does not contain centered icon CSS");
    const install = "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor";
    assert.equal(sha(fs.readFileSync(path.join(install, "agentvn-editor.exe"))),
      "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(fs.readFileSync(path.join(install, "agentvn-player.exe"))),
      "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    report.originalInstalledStatus = "HOST-01 FAILED; frozen 1.9.9 untouched, not retested";
    report.history = ["red-smoke-01", "red-smoke-02", "diagnostic-01", "green-smoke-01", "green-full-01",
      "green-reduced-smoke-01", "green-full-02"].map(name => {
      const file = path.join(qa, name, "report.json"), r = read(file);
      assert.equal(r.cleanup.status, "PASS"); assert.equal(r.modelRequests, 0);
      return { name, file, sha256: sha(fs.readFileSync(file)), status: r.status, service: r.service, finishedAt: r.finishedAt };
    });
    assert.equal(report.history.find(r => r.name === "red-smoke-02").status, "FAILED");
    assert.equal(report.history.find(r => r.name === "diagnostic-01").status, "FAILED");
    assert.equal(report.history.find(r => r.name === "green-full-01").status, "FAILED");
    assert.equal(report.history.find(r => r.name === "green-full-02").status, "PASS");
    const workspaceFile = path.join(qa, "gates-check-5/report.json"), workspace = read(workspaceFile);
    assert.equal(workspace.ok, true); assert.deepEqual(workspace.pageErrors, []);
    assert(workspace.owner.pid && workspace.owner.backendUrl);
    report.workspaceRegression = { path: workspaceFile, sha256: sha(fs.readFileSync(workspaceFile)), owner: workspace.owner };
    const ids = [...new Set([...report.history.flatMap(r => [r.service.frontendPid, r.service.backendPid]), workspace.owner.pid])];
    const filter = ids.map(id => `ProcessId = ${id}`).join(" OR ");
    const text = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `@(Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { [PSCustomObject]@{pid=$_.ProcessId;created=$_.CreationDate.ToString('o');path=$_.ExecutablePath} }) | ConvertTo-Json -Compress`],
    { windowsHide: true, encoding: "utf8" }).trim();
    const live = text ? [].concat(JSON.parse(text) || []) : [];
    const workspaceLive = live.find(p => p.pid === workspace.owner.pid);
    if (workspaceLive) assert(Date.parse(workspaceLive.created) > Date.parse(check.finishedAt), "Workspace Vite PID remained");
    let workspaceResponds = false;
    try { workspaceResponds = (await fetch(`${workspace.owner.backendUrl}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    assert(!workspaceResponds, "Workspace test backend still responds");
    for (const h of report.history) {
      for (const pid of [h.service.frontendPid, h.service.backendPid]) {
        const p = live.find(r => r.pid === pid); if (p) assert(Date.parse(p.created) > Date.parse(h.finishedAt), "Owned PID remained");
      }
      for (const url of [h.service.url, `${h.service.backendUrl}/api/health`]) {
        let responds = false; try { responds = (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
        assert(!responds, `Owned service still responds: ${url}`);
      }
    }
    report.processAudit = { requested: ids, live };
    report.commands = [...check.commands, ...dev.commands];
    report.combinations = full.cases.length; report.behaviorChecks = full.cases.reduce((sum, c) => sum + c.checks.length, 0);
    report.geometryFrames = full.cases.reduce((sum, c) => sum + c.transitions.reduce((n, t) => n + t.frames.length, 0), 0);
  }
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  watcher?.close(); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  if (phase === "closeout" && report.status === "PASS")
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, phase, output, error: report.error }));
});
