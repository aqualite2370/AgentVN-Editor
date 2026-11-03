"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "installed-editor-android-export-playwright.cjs"), "utf8");
assert(source.includes("INSTALLED_ACCEPTANCE_PROJECT_TITLE")
  && !source.includes('inputValue(), "隐忍的成长"'), "Android export must require the explicit isolated fixture title");
assert(source.includes('data-help-key="package.platform"') && source.includes('name: /^Android'),
  "Android export must select the actual platform control");
assert(source.includes("gui-directory-picker-uia.ps1") && source.includes("state.editorPid"),
  "Actual installed output directory must use its owned native picker");
assert(source.includes("acceptance-permission.json") && source.includes("processToken.isElevated"),
  "Require both the real runner token and fresh symlink evidence");
assert(source.includes("readInstalledSession(runRoot)"), "Verify the actual installed binary and process");
assert(source.includes("data-environment-phase") && source.includes("completed"),
  "Wait for the real environment-check terminal state before starting a build");
assert(source.includes("本次继续导出"), "Warnings must use the current actual UI confirmation");
assert(source.indexOf("await completeInitialEnvironment();") > 0
  && source.indexOf("await completeInitialEnvironment();") < source.indexOf('name: /发布设置/'),
  "Initial platform detection must finish and dismiss its blocking dialog before navigating");
console.log("installed-editor-android-export-contract-test: PASS");
