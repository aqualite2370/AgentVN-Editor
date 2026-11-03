"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-native-command-"));
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
try {
  const log = path.join(directory, "native.log");
  const helper = path.join(__dirname, "invoke-acceptance-command.ps1");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
    $ErrorActionPreference = 'Stop'
    . ${quote(helper)}
    $result = Invoke-AcceptanceNativeCommand -FilePath ${quote(process.execPath)} -Arguments @('-e', 'console.error(123);process.exit(7)') -LogPath ${quote(log)}
    if ($result -ne 7) { throw "Expected exit 7, got $result" }
    if ($ErrorActionPreference -ne 'Stop') { throw 'Error policy was not restored' }
    $success = Invoke-AcceptanceNativeCommand -FilePath ${quote(process.execPath)} -Arguments @('-e', 'console.log(456)') -LogPath ${quote(log)}
    if ($success -ne 0) { throw 'Successful child failed' }
    Write-Output 'REPORT_READ_REACHED'
  `], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /REPORT_READ_REACHED/);
  const buffer = fs.readFileSync(log);
  const contents = buffer.toString(buffer[0] === 0xff ? "utf16le" : "utf8");
  assert.match(contents, /123/);
  assert.match(contents, /456/);
  console.log("PASS native acceptance command: stderr, exit status, report continuation, error policy");
} finally {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert(path.basename(directory).startsWith("agentvn-native-command-"));
  fs.rmSync(directory, { recursive: true, force: true });
}
