#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const entry = path.join(__dirname, "..", "editor", "src", "store", "editorPreferencesStore.ts");
const bundled = esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text;
const values = new Map();
const localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};

function loadStore() {
  const module = { exports: {} };
  new Function("module", "exports", "window", bundled)(module, module.exports, { localStorage });
  return module.exports.useEditorPreferencesStore;
}

const first = loadStore();
first.getState().setProjectExportDirectory("project_a", "C:\\中文 工程\\导出");
first.getState().setProjectExportDirectory("project_b", "D:\\另一个工程");
assert.equal(first.getState().projectExportDirectories.project_a, "C:\\中文 工程\\导出");
assert.equal(first.getState().projectExportDirectories.project_b, "D:\\另一个工程");

const restarted = loadStore();
assert.equal(restarted.getState().projectExportDirectories.project_a, "C:\\中文 工程\\导出");
assert.equal(restarted.getState().projectExportDirectories.project_b, "D:\\另一个工程");
restarted.getState().setProjectExportDirectory("project_a", null);
assert.equal(restarted.getState().projectExportDirectories.project_a, undefined);
assert.equal(restarted.getState().projectExportDirectories.project_b, "D:\\另一个工程");

values.set("agentvn.projectExportDirectories.v1", "{invalid");
assert.deepEqual(loadStore().getState().projectExportDirectories, {});
console.log("project-export-directory-preferences-test: PASS");
