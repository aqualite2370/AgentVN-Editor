#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-msvc-command-"));
try {
  const fakeVsDevCmd = path.join(root, "Visual Studio Build Tools", "Common7", "Tools", "VsDevCmd.bat");
  fs.mkdirSync(path.dirname(fakeVsDevCmd), { recursive: true });
  fs.writeFileSync(
    fakeVsDevCmd,
    [
      "@echo off",
      "set AGENTVN_TEST_MSVC=PASS",
      "",
    ].join("\r\n"),
    "utf8",
  );

  const result = childProcess.spawnSync(
    process.env.ComSpec || "cmd.exe",
    ["/d", "/s", "/c", "call", fakeVsDevCmd, "-arch=x64", "-host_arch=x64", ">nul", "&&", "set"],
    { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, `VsDevCmd invocation failed:\n${result.stderr || result.stdout}`);
  assert.match(String(result.stdout), /AGENTVN_TEST_MSVC=PASS/i);

  const runnerSource = fs.readFileSync(path.join(__dirname, "build-runtime-standalone-windows.cjs"), "utf8");
  assert.match(
    runnerSource,
    /spawnSync\(\s*\n?\s*process\.env\.ComSpec[\s\S]{0,500}\[\s*"\/d",\s*"\/s",\s*"\/c",\s*"call",\s*vsDevCmdPath,\s*"-arch=x64",\s*"-host_arch=x64"/,
    "Windows standalone runner must pass VsDevCmd as separate cmd arguments",
  );
  assert.doesNotMatch(
    runnerSource,
    /`call\s+"\$\{vsDevCmdPath\}"/,
    "Windows standalone runner must not interpolate a quoted VsDevCmd path into cmd /c",
  );
  console.log("windows-msvc-command-invocation-test: PASS");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
