"use strict";
// Snapshot each completed package before the next package rewrites codegen.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence } = require("../android-acceptance-evidence.cjs");
function captureCompilerSnapshot(generated, packageName, out) {
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), packageName,
    scope: "ACTUAL_COMPILER_INPUT_BYTES_NOT_DEVICE_ACCEPTANCE", files: [] };
  const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
  function copy(file, name) {
    const original = fileEvidence(file), destination = path.join(out, name);
    fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL);
    const snapshot = fileEvidence(destination);
    assert.equal(snapshot.sha256, original.sha256);
    r.files.push({ original, snapshot }); return snapshot;
  }
  try {
    const proofs = Object.fromEntries(["plugin-manager-source.json", "compiler-compileReleaseKotlin.json",
      "tauri-codegen-source.json", "app-compiler-compileUniversalReleaseKotlin.json"]
      .map(name => [name, read(copy(path.join(generated, name), name).path)]));
    const source = proofs["tauri-codegen-source.json"];
    assert.equal(source.packageName, packageName, "Reject mixed-package compiler inputs");
    assert.equal(source.sourceSha256, "7c14c42554e4bb4e9bab576307c85c2998e6b3f82397979c547294b26a9e7423");
    const template = copy(source.source, "TauriActivity-template.kt"), activity = copy(source.generated, "TauriActivity.kt");
    assert.equal(template.sha256, source.sourceSha256);
    assert.equal(activity.sha256, source.generatedSha256);
    assert.equal(fs.readFileSync(activity.path, "utf8"),
      fs.readFileSync(template.path, "utf8").replaceAll("{{package}}", packageName));
    const plugin = proofs["compiler-compileReleaseKotlin.json"];
    const app = proofs["app-compiler-compileUniversalReleaseKotlin.json"];
    assert.equal(plugin.task, ":tauri-android:compileReleaseKotlin");
    assert.equal(app.task, ":app:compileUniversalReleaseKotlin");
    assert.deepEqual(app.declared, [source.generated]);
    assert.equal(app.generatedSha256, activity.sha256);
    assert.equal(plugin.declared.length, 1);
    assert.equal(copy(plugin.declared[0], "AgentVNPluginManager.kt").sha256, plugin.generatedSha256);
    copy(path.join(path.dirname(path.dirname(source.generated)), "MainActivity.kt"), "MainActivity.kt");
    for (const file of r.files)
      assert.equal(fileEvidence(file.original.path).sha256, file.original.sha256, "Compiler input changed during snapshot");
    r.status = "PASS";
  } catch (error) { r.status = "FAILED"; r.error = String(error.stack || error); throw error; }
  finally {
    r.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
  }
  return fileEvidence(path.join(out, "report.json"));
}
module.exports = { captureCompilerSnapshot };
