"use strict";

// Zero-cost diagnostic for the frozen 1.9.35 installed Editor.
// This script only reads the real publish-check UI. It does not export,
// submit model work, alter product source, or bypass a disabled export action.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");

const root = path.resolve(__dirname, "..");
const sourceReportPath = "F:/AgentVN/QA/Novel-Real-1935-20261031-04/run/session-01/report.json";
const installationPath = "F:/AgentVN/QA/Editor-1.9.35-20261030-01/installation.json";
const out = "F:/AgentVN/QA/Novel-Real-1935-20261031-09";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const shaFile = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size, sha256: shaFile(file) });

assert(!fs.existsSync(out), `Refusing to reuse diagnostic directory: ${out}`);
fs.mkdirSync(out, { recursive: true });

const source = read(sourceReportPath);
const installation = read(installationPath);
assert.equal(source.status, "PASS");
assert.equal(source.version, "1.9.35");
assert.equal(installation.status, "PASS");
assert.equal(installation.executable.version, "1.9.35");

const report = {
  status: "RUNNING",
  scope: "ZERO_COST_INSTALLED_1935_REAL_PUBLISH_PREFLIGHT_DIAGNOSTIC",
  startedAt: new Date().toISOString(),
  sourceReport: desc(sourceReportPath),
  installation: desc(installationPath),
  editorExecutable: desc(installation.executable.path),
  inputProject: desc(source.bundles[0].path),
  modelRequests: 0,
  realModelRequests: 0,
  productChanges: 0,
  environmentDialog: null,
  launches: [],
  checks: [],
  screenshots: [],
  errors: [],
  cleanups: [],
  boundaries: [
    "Frozen installed 1.9.35 Editor, not source or Dev",
    "Real publish-check page and detail dialogs, no export click",
    "Reuses the already completed paid novel result; no model request",
    "CDP/WebView input, not physical mouse or physical 4K display",
    "Temporary isolated project/data/WebView directory on F",
  ],
};
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
save();

const project = source.restored.project;
const host = installedReleaseSession({
  installationFile: installationPath,
  out,
  report,
  save,
  input: source.bundles[0].path,
});
let page;

async function importAndOpen() {
  const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(source.bundles[0].path)),
    },
    body: fs.readFileSync(source.bundles[0].path),
    signal: AbortSignal.timeout(30000),
  });
  const imported = await response.json();
  assert(response.ok && imported.ok, JSON.stringify(imported));
  assert.equal(imported.data.project_id, project.project_id);
  await page.reload();
  await page.locator(".recent-project-open:not(:disabled):visible")
    .filter({ hasText: project.title })
    .click();
  await page.locator(".editor-toolbar").waitFor();
  await settleEditor(page);
}

async function finishEnvironmentDialogIfPresent() {
  const backdrop = page.locator(".android-env-import-backdrop").first();
  const appeared = await backdrop.waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  const dialog = page.locator(".android-env-import-dialog").first();
  await dialog.waitFor({ state: "visible" });
  await until(async () => ["completed", "failed"].includes(
    await dialog.getAttribute("data-environment-phase"),
  ), "publish environment dialog terminal", 60000);
  report.environmentDialog = {
    phase: await dialog.getAttribute("data-environment-phase"),
    text: await dialog.innerText(),
  };
  const phase = await dialog.getAttribute("data-environment-phase");
  const button = dialog.getByRole("button", {
    name: phase === "completed" ? "完成" : "关闭",
    exact: true,
  });
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    await dialog.waitFor({ state: "detached" });
  }
  save();
}

async function collectChecks() {
  await page.locator('[data-package-stage="checks"]').click();
  await page.locator('[data-package-stage="checks"][aria-current="page"]').waitFor();
  const rows = page.locator("[data-preflight-check-id]");
  await rows.first().waitFor();
  const summaries = await rows.evaluateAll(items => items.map(item => ({
    id: item.getAttribute("data-preflight-check-id"),
    classes: item.closest(".preflight-check")?.className ?? "",
    text: item.textContent?.trim() ?? "",
  })));

  for (const summary of summaries) {
    const row = page.locator(`[data-preflight-check-id="${summary.id}"]`).first();
    await row.click();
    const dialog = page.getByTestId("package-preflight-detail-dialog");
    await dialog.waitFor();
    const detail = await dialog.innerText();
    report.checks.push({
      id: summary.id,
      status: /\bis-blocked\b/.test(summary.classes)
        ? "blocked"
        : /\bis-warning\b/.test(summary.classes)
          ? "warning"
          : "pass",
      summary: summary.text,
      detail,
    });
    await dialog.getByRole("button", { name: "返回检查", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
  }
}

async function run() {
  try {
    page = await host.start();
    await importAndOpen();
    await page.locator('[data-workspace-surface="publish"]:visible').click();
    await settleEditor(page);
    await finishEnvironmentDialogIfPresent();
    await page.locator('[data-package-stage="settings"]').click();
    await page.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    for (const [key, value] of [
      ["gameId", project.project_id],
      ["title", project.title],
      ["author", "AgentVN QA"],
      ["description", "1.9.35 安装版发布检查诊断"],
    ]) {
      await page.locator(`[data-help-key="package.${key}"]`).fill(value);
    }
    await collectChecks();
    report.exportGate = {
      buttonEnabled: await page.locator('[data-help-key="package.export"]').isEnabled(),
      statusOverview: await page.locator(".package-stage-overview").innerText(),
      warningsConfirmationVisible: await page.getByRole("button", { name: "查看并确认警告", exact: true }).isVisible(),
      blockerCount: await page.locator(".package-check-callout.is-blocked").count(),
    };
    report.status = report.checks.some(item => item.status === "blocked") ? "BLOCKED_BY_PRODUCT_PREFLIGHT" : "NO_BLOCKER";
    report.finishedAt = new Date().toISOString();
    save();
    console.log(JSON.stringify({
      status: report.status,
      out,
      checks: report.checks.map(item => [item.id, item.status]),
      modelRequests: report.modelRequests,
    }));
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    report.finishedAt = new Date().toISOString();
    save();
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    try {
      await host.stop("diagnostic complete; exact owned cleanup, not native normal close");
      report.cleanups.push({ status: "PASS", normalCloseClaimed: false });
    } catch (error) {
      report.cleanups.push({ status: "FAILED", error: String(error.stack || error) });
      report.status = "FAILED";
      process.exitCode = 1;
    }
    report.finishedAt = new Date().toISOString();
    save();
  }
}

run();
