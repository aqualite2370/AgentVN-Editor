"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
async function runNativeDirectoryFlow({ page, hostPid, output, root, readProjectSnapshot, readAssetBytes }) {
  const evidence = { status: "RUNNING", interaction: "real WebView click + owned Windows native picker via UI Automation" };
  const source = path.join(output, "中文 GUI 目录");
  fs.mkdirSync(path.join(source, "gui"), { recursive: true });
  fs.writeFileSync(path.join(source, "gui.rpy"), "define gui.navigation_xpos = 73\ndefine gui.navigation_spacing = 18\n");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Lz4AAAAASUVORK5CYII=", "base64");
  fs.writeFileSync(path.join(source, "gui/idle.png"), png);
  const dialog = page.getByTestId("renpy-gui-import-dialog");
  let alreadyOpen = await dialog.isVisible().catch(() => false);
  if (alreadyOpen && await dialog.locator(".renpy-gui-import-summary").count()) {
    if (await page.locator('[role="listbox"]:visible').count()) {
      await page.keyboard.press("Escape");
      await page.locator('[role="listbox"]:visible').waitFor({ state: "hidden" });
    }
    await dialog.getByRole("button", { name: "取消，不修改工程", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    alreadyOpen = false;
  }
  let editor;
  let trigger;
  if (!alreadyOpen) {
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
    await page.waitForFunction(() => document.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle")
      && !document.querySelector(".toolbar-popover.advanced.is-morphing"));
    editor = page.locator(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
    await editor.locator('[data-layout-type-option="renpy"]').click();
    await editor.locator(".renpy-title-editor").waitFor({ state: "visible" });
    trigger = editor.getByTestId("renpy-gui-import-open");
  } else {
    editor = page.locator(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
    trigger = editor.getByTestId("renpy-gui-import-open");
  }
  const sourceSnapshot = () => page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const state = useProjectStore.getState();
    return JSON.stringify({ settings: state.settings, assets: state.assetManifest });
  });
  const snapshot = readProjectSnapshot ?? sourceSnapshot;
  const normalizeSnapshot = value => typeof value === "string" ? JSON.parse(value) : value;
  const readSnapshot = async () => normalizeSnapshot(await snapshot());
  const before = await readSnapshot();
  async function pick(name, cancel, rescanning = false) {
    const reportPath = path.join(output, `${name}.json`);
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/gui-directory-picker-uia.ps1"),
      "-OwnerPid", String(hostPid), "-ReportPath", reportPath];
    if (cancel) args.push("-Cancel");
    else args.push("-Directory", source);
    const helper = spawn("powershell.exe", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const done = new Promise((resolve, reject) => {
      let output = "";
      helper.stdout.on("data", data => { output += data; });
      helper.stderr.on("data", data => { output += data; });
      helper.on("error", reject);
      helper.on("exit", code => code === 0 ? resolve() : reject(Error(`Owned native picker helper: ${code}: ${output}`)));
    });
    // Attach immediately so early helper failure is observed, not an unhandled rejection.
    done.catch(() => {});
    await dialog.getByRole("button", {
      name: rescanning ? "重新选择目录" : "选择资源目录", exact: true,
    }).click();
    await done;
    const result = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.equal(result.status, "PASS");
    return result;
  }
  if (!alreadyOpen) await trigger.click();
  evidence.cancel = await pick("native-picker-cancel", true);
  assert.equal(await dialog.locator(".renpy-gui-import-summary").count(), 0);
  assert.equal(await dialog.getByRole("button", { name: "确认应用已选项目", exact: true }).isDisabled(), true);
  assert.deepEqual(await readSnapshot(), before, "Native picker cancel must leave project unchanged");
  evidence.selection = await pick("native-picker-selected", false);
  await dialog.locator(".renpy-gui-import-summary").waitFor();
  assert.equal(await dialog.locator(".renpy-gui-import-asset-row").count(), 1);
  assert.match(await dialog.locator(".renpy-gui-import-row").filter({ hasText: "shared.x" }).innerText(), /73/);
  assert.deepEqual(await readSnapshot(), before, "Native directory scanning must not apply before confirmation");
  await page.screenshot({ path: path.join(output, "native-directory-scanned.png") });
  const assetAction = dialog.getByRole("combobox", { name: "gui/idle.png 导入操作", exact: true });
  await assetAction.click();
  await page.getByRole("listbox", { name: "gui/idle.png 导入操作", exact: true })
    .getByRole("option", { name: "添加到素材库", exact: true }).click();
  assert.equal(await dialog.getByRole("button", { name: "确认应用已选项目", exact: true }).isDisabled(), true,
    "Native resource selection still requires the source/license confirmation");
  const license = dialog.locator(".renpy-gui-import-license input");
  if (await license.count()) await license.check();
  assert.equal(await dialog.getByRole("button", { name: "确认应用已选项目", exact: true }).isDisabled(), false,
    "Selecting a native resource and confirming its source must enable apply");
  await dialog.getByRole("button", { name: "确认应用已选项目", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await editor.locator('[data-save-state]').filter({ hasText: /保存布局|已保存/ }).first().click();
  await page.waitForFunction(() => document.querySelector('[data-save-state="saved"]'));
  evidence.applied = await readSnapshot();
  const imported = evidence.applied.assets.find(asset => asset.metadata.tags?.includes("renpy_gui_import"));
  assert(imported);
  assert.equal(evidence.applied.settings.runtimeUILayout.renpy.shared.x, 73);
  evidence.bytes = readAssetBytes
    ? await readAssetBytes(imported.asset_id)
    : await page.evaluate(async id => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const { backendClient } = await import("/src/api/backendClient.ts");
    const asset = useProjectStore.getState().assetManifest.find(asset => asset.asset_id === id);
    const response = await fetch(backendClient.resolveProjectAssetUrl(asset.metadata.data_url ?? asset.metadata.url));
    if (!response.ok) throw Error(`Native imported bytes: ${response.status}`);
    return [...new Uint8Array(await response.arrayBuffer())];
  }, imported.asset_id);
  assert.deepEqual(evidence.bytes, [...png], "Real native directory resource bytes must reach project");
  evidence.status = "PASS";
  return evidence;
}
module.exports = { runNativeDirectoryFlow };
