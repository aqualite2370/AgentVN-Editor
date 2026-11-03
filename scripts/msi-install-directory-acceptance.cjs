"use strict";
// Actual /i -> installed UI -> /famus -> new installed process -> /x.
// Quiet installation and WebView input are not wizard/physical-input evidence.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { until, rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/MSI-Location-Repair-20261021-01";
const language = process.argv[2]; assert(["en-US", "zh-CN"].includes(language));
const attempt = process.argv[3] || "01"; assert(["01", "02", "03"].includes(attempt));
const suffix = attempt === "01" ? "" : "-" + attempt;
const out = path.join(qa, "editor-" + String((Number(attempt) - 1) * 2 + (language === "en-US" ? 1 : 2)).padStart(2, "0"));
assert(!fs.existsSync(out), "Fresh UI evidence required"); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const phaseFile = phase => path.join(qa, "msi-" + language + suffix, phase + ".json");
const report = { status: "RUNNING", scope: "ACTUAL_MSI_DIRECTORY_INSTALL_REPAIR_UI_UNINSTALL",
  version: "1.9.18", language, attempt, startedAt: new Date().toISOString(), commands: [],
  launches: [], cleanups: [], screenshots: [], observations: [], checks: [], errors: [], modelRequests: 0,
  limitations: ["Actual quiet /i, not interactive installation wizard", "1080p DPR1 ordinary WebView viewport simulation",
    "Both DB and WebView isolated; not default-profile acceptance", "Attributed termination, not physical window close",
    "Not a clean machine or version-upgrade test"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, cachePrepared = false, installed = false, page, expected;
async function command(label, args) {
  const log = path.join(out, "command-" + (report.commands.length + 1) + ".log"), fd = fs.openSync(log, "wx");
  const row = { label, args, startedAt: new Date().toISOString(), status: "RUNNING", log };
  report.commands.push(row); save(); console.log("START " + label);
  try {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ...args],
      { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd], env: { ...process.env, TEMP: out, TMP: out } });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => {
      child.once("exit", resolve); child.once("error", reject);
    });
    row.status = row.exitCode === 0 ? "PASS" : "FAILED";
    assert.equal(row.exitCode, 0, log);
  } catch (e) {
    row.status = "FAILED"; row.error = String(e.stack || e); throw e;
  } finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); row.sha256 = sha(log); save(); }
  console.log("PASS " + label);
}
const operation = action => command("Actual elevated MSI " + action,
  ["scripts/msi-install-directory-session.ps1", "-Action", action, "-Language", language, "-Attempt", String(Number(attempt))]);
const cache = action => command("Native cache " + action,
  ["scripts/installed-layout-cache-session.ps1", "-Action", action, "-RunDirectory", out]);
async function ready() {
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "detached" });
  await page.waitForFunction(() => !document.querySelector(
    ".app-transition-stage.is-switching, .app-transition-stage.is-home-hydrating"));
  await settleEditor(page);
}
async function geometry(name, target) {
  const observation = await target.evaluate(button => {
    const r = button.getBoundingClientRect();
    return { text: button.textContent.trim(), disabled: button.disabled,
      hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert(observation.hit && !observation.disabled, name + ": actual button must own its hit point");
  assert.deepEqual(observation.viewport, { width: 1920, height: 1080, dpr: 1 });
  const r = observation.rect; assert(r.x >= 0 && r.y >= 0 && r.x + r.width <= 1921 && r.y + r.height <= 1081);
  assert(observation.overflow <= 1); report.observations.push({ name, ...observation }); save();
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const baseline = read("F:/AgentVN/Checkpoints/MSI-Location-Repair-20261021-01/installation/checkpoint.json");
  assert.equal(baseline.status, "PASS"); report.protectedFiles = baseline.protectedFiles;
  await operation("Install"); installed = true;
  assert.equal(read(phaseFile("Install")).originalInstallationUnchanged, "PASS");
  await cache("SelfTest"); await cache("Prepare"); cachePrepared = true;
  const input = path.join(root, "scripts/fixtures/editor-isolated-small.vnproj"); assert(fs.existsSync(input));
  report.testProject = input; report.workspaceOutput = out;
  host = installedReleaseSession({ installationFile: phaseFile("Install"), out, report, save, input });
  page = await host.start(); await ready();
  const create = page.getByRole("region", { name: "创建或打开项目", exact: true })
    .getByRole("button", { name: "新建项目", exact: true });
  await geometry("fresh installed new-project button", create); await create.click();
  const options = page.getByRole("button", { name: "选项", exact: true });
  await options.waitFor(); await ready(); await geometry("installed options button", options);
  await options.click();
  const title = "MSI目录修复_" + language + "_20261021";
  await page.getByRole("textbox", { name: "项目名称", exact: true }).fill(title);
  await page.getByRole("textbox", { name: "项目作者", exact: true }).fill("独立安装验收");
  await page.getByRole("button", { name: "编辑", exact: true }).click(); await ready();
  await page.getByRole("textbox", { name: /^场景摘要(?: 场景摘要)?$/ })
    .fill("真实MSI安装与修复后恢复的隔离工程");
  expected = await until(async () => {
    const state = await host.api("/api/project/state");
    return state.project_metadata?.title === title
      && state.project_graph?.nodes?.some(n => n.data?.scene?.summary === "真实MSI安装与修复后恢复的隔离工程")
      ? state : false;
  }, "installed backend real project persistence");
  report.project = { metadata: expected.project_metadata, graph: expected.project_graph };
  await host.shot("installed-created");
  await host.stop("Before actual MSI repair; exact owned termination, not native close");
  report.checks.push("Actual /i in requested directory, packaged backend and real UI edit persisted");
  await operation("Repair");
  assert.equal(read(phaseFile("Repair")).originalInstallationUnchanged, "PASS");
  page = await host.start(); await ready();
  const resume = page.getByRole("button", { name: "继续上次编辑", exact: true });
  await geometry("repaired installed resume button", resume); await resume.click();
  await page.locator(".editor-toolbar").waitFor(); await ready();
  const actual = await host.api("/api/project/state");
  for (const key of ["projectId", "title", "author"])
    assert.equal(actual.project_metadata[key], expected.project_metadata[key]);
  assert.deepEqual(actual.project_graph, expected.project_graph);
  await host.shot("repaired-resumed");
  report.checks.push("Actual /famus, new installed process restores same project identity/full graph");
  await host.stop("Repaired process complete; exact owned termination, not native close");
  assert.equal(report.launches.length, 2); assert.equal(report.observations.length, 3);
  assert.equal(report.screenshots.length, 2); assert.equal(report.errors.length, 0);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
  .finally(async () => {
    const cleanupErrors = [];
    async function cleanup(label, action) {
      try { await action(); }
      catch (e) { cleanupErrors.push(label + ": " + String(e.stack || e)); report.status = "FAILED"; }
    }
    await cleanup("owned-process stop", () => host?.stop("MSI acceptance finally"));
    if (cachePrepared) await cleanup("cache restoration", async () => {
      await cache("Restore"); report.cacheRestored = true;
    });
    // Always attempt this even if process/cache cleanup reported another error.
    await cleanup("owned MSI uninstall", async () => {
      if (installed || fs.existsSync(phaseFile("Install")) && read(phaseFile("Install")).productCode) {
        await operation("Uninstall");
        assert.equal(read(phaseFile("Uninstall")).metadataRestoration, "PASS");
        report.uninstallStatus = "PASS";
      }
    });
    try {
      for (const f of report.protectedFiles || []) assert.equal(sha(f.path), f.sha256, f.path);
      assert.equal(report.modelRequests, 0);
      const live = rows();
      assert(!(report.knownProcesses || []).some(p => live.some(n => p.ProcessId === n.ProcessId && p.Created === n.Created)));
      assert.equal(listeners(report.launches.flatMap(l => l.ports)).length, 0);
      report.protectedUnchanged = true;
      if (report.status === "PASS") {
        assert.equal(report.uninstallStatus, "PASS"); assert.equal(report.cacheRestored, true);
        assert.equal(report.checks.length, 2); assert.equal(report.cleanups.length, 2);
      }
    } catch (e) { report.status = "FAILED"; cleanupErrors.push("terminal checks: " + String(e.stack || e)); }
    if (cleanupErrors.length) report.cleanupError = cleanupErrors.join("\n");
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, language, out, checks: report.checks,
      uninstallStatus: report.uninstallStatus, error: report.error, cleanupError: report.cleanupError }, null, 2));
    if (report.status !== "PASS") process.exitCode = 1;
  });
