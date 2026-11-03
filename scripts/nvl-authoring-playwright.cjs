#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { root, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");

const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const output = path.join(root, "output/playwright/nvl-authoring", runId);
const viewports = [
  { name: "1080p", width: 1920, height: 1080 },
  { name: "1440p", width: 2560, height: 1440 },
  { name: "4k", width: 3840, height: 2160 },
  { name: "narrow", width: 390, height: 844 },
];
const report = { runId, scope: "nvl-clear-page-authoring", status: "RUNNING", cases: [] };

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let env;
  let browser;
  let page;
  try {
    env = await startEditorAcceptance(output);
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: viewports[0] });
    report.owner = { pid: env.server.pid, runId: env.server.runId, url: env.url };
    await env.server.run(async () => {
      await env.open(page);
      const sceneId = await page.evaluate(async () => {
        const { useEditorStore } = await import("/src/store/editorStore.ts");
        const state = useEditorStore.getState();
        const scene = state.nodes.find(node => node.data.nodeKind === "scene");
        if (!scene) throw new Error("Acceptance project has no scene node");
        const nodes = state.nodes.map(node => node.id === scene.id
          ? { ...node, data: { ...node.data, scene: { ...node.data.scene, commands: [
            { type: "dialog", character_id: "alice", text: "新段落", presentation_mode: "dialog" },
          ] } } }
          : node);
        useEditorStore.setState({ nodes, selectedNodeId: scene.id });
        return scene.id;
      });
      const commandCard = page.locator(".command-card").filter({ hasText: "新段落" }).first();
      await commandCard.waitFor({ state: "visible" });
      await commandCard.locator(".command-card-summary").click();
      const mode = page.getByRole("combobox", { name: "对白呈现方式" });
      await mode.waitFor({ state: "visible" });
      await mode.click();
      await page.getByRole("option", { name: "NVL 累积阅读" }).click();

      const clearPage = page.getByRole("checkbox", { name: /显示本句前清空 NVL 页面/ });
      await clearPage.waitFor({ state: "visible" });

      for (const viewport of viewports) {
        const expectedChecked = viewport.name === "1440p" || viewport.name === "narrow";
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, viewport);
        if (expectedChecked) await clearPage.check();
        else await clearPage.uncheck();
        await page.locator(".nvl-clear-page-toggle").scrollIntoViewIfNeeded();
        const state = await page.evaluate(async () => {
          const { useEditorStore } = await import("/src/store/editorStore.ts");
          const { exportScript } = await import("/src/utils/exportScript.ts");
          const current = useEditorStore.getState();
          const sceneNode = current.nodes.find(node => node.id === current.selectedNodeId);
          const authored = sceneNode?.data.scene?.commands?.[0];
          const exported = exportScript(current.nodes, current.edges);
          const runtimeCommand = exported.scenes.flatMap(scene => scene.commands)
            .find(command => command.type === "dialog");
          const checkbox = document.querySelector(".nvl-clear-page-toggle input");
          const label = checkbox?.closest("label");
          const rect = label?.getBoundingClientRect();
          return {
            authored,
            runtimeCommand,
            schemaVersion: exported.schema_version,
            presentationHelp: document.querySelector('[data-field="presentation_mode"]')?.getAttribute("aria-label"),
            clearPageHelp: document.querySelector('[data-field="clear_nvl_page_before"]')?.getAttribute("aria-label"),
            geometry: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
              right: rect.right, bottom: rect.bottom } : null,
            viewport: { width: innerWidth, height: innerHeight },
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          };
        });
        assert.equal(state.authored.presentation_mode, "nvl", "the mode selection must persist in the project command");
        assert.equal(Boolean(state.authored.clear_nvl_page_before), expectedChecked,
          "the authoring checkbox must update the command state without changing presentation mode");
        assert.equal(state.runtimeCommand.presentation_mode, "nvl", "export must preserve NVL presentation mode");
        assert.equal(Boolean(state.runtimeCommand.clear_nvl_page_before), expectedChecked,
          "cartridge script export must preserve the authored clear-page marker");
        assert.equal(state.schemaVersion, expectedChecked ? "1.8.0" : "1.7.0",
          "the exported script schema must declare the feature only when it is enabled");
        assert.equal(state.presentationHelp, "对白呈现方式", "presentation mode help must have a localized accessible name");
        assert.equal(state.clearPageHelp, "显示本句前清空 NVL 页面", "clear-page help must have a localized accessible name");
        assert(state.geometry && state.geometry.x >= 0 && state.geometry.y >= 0
          && state.geometry.right <= viewport.width + 1 && state.geometry.bottom <= viewport.height + 1,
        `Clear-page control must remain within the viewport: ${JSON.stringify(state)}`);
        assert.equal(state.horizontalOverflow, false, "NVL authoring controls must not create page-level horizontal overflow");
        report.cases.push({ name: "nvl-mode-and-clear-page-authoring-roundtrip", ...state, viewport });
        await page.screenshot({ path: path.join(output, `${viewport.name}.png`) });
      }

      await page.evaluate(async () => {
        const { useEditorStore } = await import("/src/store/editorStore.ts");
        const state = useEditorStore.getState();
        const scene = state.nodes.find(node => node.id === state.selectedNodeId);
        if (!scene) throw new Error("Selected scene disappeared before narration acceptance");
        useEditorStore.setState({
          nodes: state.nodes.map(node => node.id === scene.id
            ? { ...node, data: { ...node.data, scene: { ...node.data.scene, commands: [
              { type: "narration", text: "旁白新段落", presentation_mode: "dialog" },
            ] } } }
            : node),
        });
      });
      const narrationCard = page.locator(".command-card").filter({ hasText: "旁白新段落" }).first();
      await narrationCard.waitFor({ state: "visible" });
      await narrationCard.locator(".command-card-summary").click();
      const narrationMode = page.getByRole("combobox", { name: "旁白呈现方式" });
      await narrationMode.click();
      await page.getByRole("option", { name: "NVL 累积阅读" }).click();
      const narrationClearPage = page.getByRole("checkbox", { name: /显示本句前清空 NVL 页面/ });
      await narrationClearPage.check();
      const narrationExport = await page.evaluate(async () => {
        const { useEditorStore } = await import("/src/store/editorStore.ts");
        const { exportScript } = await import("/src/utils/exportScript.ts");
        const state = useEditorStore.getState();
        const authored = state.nodes.find(node => node.id === state.selectedNodeId)?.data.scene?.commands?.[0];
        const exported = exportScript(state.nodes, state.edges);
        return {
          authored,
          exported: exported.scenes.flatMap(scene => scene.commands).find(command => command.type === "narration"),
          schemaVersion: exported.schema_version,
        };
      });
      assert.equal(narrationExport.authored.presentation_mode, "nvl");
      assert.equal(narrationExport.authored.clear_nvl_page_before, true);
      assert.equal(narrationExport.exported.presentation_mode, "nvl");
      assert.equal(narrationExport.exported.clear_nvl_page_before, true);
      assert.equal(narrationExport.schemaVersion, "1.8.0");
      report.cases.push({ name: "nvl-narration-clear-page-authoring-roundtrip", viewport: viewports[0], ...narrationExport });
    });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await env?.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${path.join(output, "report.json")}`);
  }
}

main();
