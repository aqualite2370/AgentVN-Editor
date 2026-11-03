"use strict";
const assert = require("node:assert/strict"), path = require("node:path");
const { previewProfileDirectory } = require("./lib/installed-runtime-preview-1922-session.cjs");
const root = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-settings-1922-01";
assert.equal(previewProfileDirectory(root, "agentvn"), path.join(root, "webview-agentvn"));
assert.equal(previewProfileDirectory(root, "renpy"), path.join(root, "webview-renpy"));
assert.equal(previewProfileDirectory(root, "agentvn", "settings-main"),
  previewProfileDirectory(root, "renpy", "settings-main"));
assert.notEqual(previewProfileDirectory(root, "renpy", "settings-main"),
  previewProfileDirectory(root, "renpy", "settings-control"));
for (const key of ["", "../escape", "..\\escape", "/tmp", "C:\\tmp", "a/b", "a\\b", "A", null, 123])
  assert.throws(() => previewProfileDirectory(root, "renpy", key));
assert.throws(() => previewProfileDirectory(root, "unknown"));
console.log("PASS preview profile default compatibility, shared identity and 11 invalid requests");
