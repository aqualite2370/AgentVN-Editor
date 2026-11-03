"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const [launchFile, output] = process.argv.slice(2);
assert(launchFile && output && !fs.existsSync(output), "Fresh export report required");
const launch = JSON.parse(fs.readFileSync(launchFile, "utf8"));
const baseline = JSON.parse(fs.readFileSync(path.join(path.dirname(launchFile), "old-ui-data-created.json"), "utf8"));
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "REAL_INSTALLED_SAVE_SUCCESS_AND_EXPORTED_BYTES", checks: [] };
let browser;
(async () => {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  const page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost"));
  assert(page, "Installed page not found");
  const dialog = page.getByRole("dialog", { name: "工程已导出", exact: true });
  await dialog.waitFor();
  report.successDialog = await dialog.innerText();
  const file = report.successDialog.match(/C:\\Users\\1\\Downloads\\[^\r\n]+\.vnproj/)?.[0];
  assert(file && path.dirname(file) === "C:\\Users\\1\\Downloads");
  const bytes = fs.readFileSync(file);
  const zip = await JSZip.loadAsync(bytes);
  const project = JSON.parse(await zip.file("project.json").async("string"));
  assert.equal(project.project_id, baseline.project.metadata.projectId);
  assert.equal(project.title, baseline.project.metadata.title);
  assert.equal(project.author, baseline.project.metadata.author);
  assert.deepEqual(project.nodes.map(n => n.id).sort(), baseline.project.graph.nodes.map(n => n.id).sort());
  assert.deepEqual(project.edges, baseline.project.graph.edges);
  assert.equal(project.nodes.find(n => n.id === "node_scene_opening").data.scene.summary,
    "覆盖升级后实际编辑保存_1.9.9_20261018");
  report.checks = ["Real success dialog", "Real ZIP project.json", "Project identity preserved",
    "Node/edge IDs preserved", "Edited summary present in package"].map(name => ({ name, status: "PASS" }));
  report.package = { path: file, bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    generatedAt: fs.statSync(file).mtime.toISOString() };
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(async () => {
    await browser?.close().catch(() => {});
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
  });
