"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const { sha256 } = require("./installed-acceptance.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
function readCurrentInstalledRealModelSession(runRoot) {
  assert.equal(path.resolve(runRoot), path.resolve(__dirname, "../../output/installed-real-model-20261019-01"));
  const prep = read(path.join(runRoot, "preparation.json")), handoff = read(path.join(runRoot, "credential-handoff.json"));
  const launch = read(path.join(runRoot, "launch.json")), ready = read(path.join(runRoot, "backend-ready.json"));
  assert.equal(prep.status, "PASS"); assert(prep.blankDefaultProfiles && prep.profiles.length === 4);
  assert.equal(launch.status, "PASS");
  assert(!launch.dataDirectoryOverride && !launch.webviewDirectoryOverride && !launch.manualBackendSpawn);
  for (const p of prep.profiles) for (const f of p.files) {
    assert.equal(sha256(fs.readFileSync(path.join(p.held, f.relative))), f.sha256);
    assert.equal(sha256(fs.readFileSync(f.backup)), f.sha256);
  }
  const exe = path.join(launch.installRoot, "agentvn-editor.exe");
  assert.equal(sha256(fs.readFileSync(exe)), handoff.installed.executableSha256);
  const live = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${Number(launch.editorPid)}"|ForEach-Object {@{ProcessId=$_.ProcessId;ExecutablePath=$_.ExecutablePath;createdUtc=$_.CreationDate.ToUniversalTime().ToString('o')}}|ConvertTo-Json`],
  { windowsHide: true, encoding: "utf8", timeout: 15000 }));
  const expected = launch.processes.find(p => p.ProcessId === launch.editorPid);
  assert.equal(live.ProcessId, expected.ProcessId); assert.equal(live.ExecutablePath, expected.ExecutablePath);
  assert.equal(live.createdUtc, expected.createdUtc);
  const backend = ready.processes.find(p => p.Name === "creator-backend.exe" && p.ParentProcessId === launch.editorPid);
  assert(backend);
  return { state: { ...launch, backendPid: backend.ProcessId,
    databasePath: "C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db",
    webviewRoot: "C:/Users/1/AppData/Local/com.agentvn.editor" },
    exeSha256: handoff.installed.executableSha256, fixture: handoff.project,
    scope: "ACTUAL_INSTALLED_RELEASE_DEFAULT_PATHS_WITH_WHOLE_ORIGINAL_PROFILES_HELD" };
}
module.exports = { readCurrentInstalledRealModelSession };
