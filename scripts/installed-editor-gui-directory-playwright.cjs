"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const root = path.resolve(__dirname, "..");
const runRoot = path.resolve(process.argv[2] || "");
assert(process.argv[2], "explicit Release acceptance root required");
const state = JSON.parse(fs.readFileSync(path.join(runRoot, "installed-processes.json"), "utf8"));
const output = path.resolve(process.argv[3] || path.join(runRoot, "installed-gui-directory-retry"));
assert(!fs.existsSync(output), `refusing to overwrite ${output}`);
fs.mkdirSync(output);
const report = { status: "RUNNING", scope: "actual MSI-installed Release Editor native GUI import",
  state, output, cases: [], errors: [] };
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
let browser;
async function main() {
  try {
    const processRows = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(state.editorPid)}" | Select-Object ProcessId,Name,ExecutablePath | ConvertTo-Json -Compress`],
  { windowsHide: true, encoding: "utf8" }));
  assert.equal(processRows.ProcessId, state.editorPid);
  assert.equal(processRows.ExecutablePath.toLowerCase(), path.join(state.installRoot, "agentvn-editor.exe").toLowerCase());
  assert.equal(path.resolve(state.databasePath).startsWith(`${runRoot}${path.sep}`), true, "Release database must be isolated");
    report.releaseProcess = processRows;
    report.exeSha256 = hash(processRows.ExecutablePath);
    const versionsPath = path.join(state.installRoot, "build-versions.json");
    report.versionResource = JSON.parse(fs.readFileSync(versionsPath, "utf8"));
    report.versionResourceSha256 = hash(versionsPath);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
    const page = browser.contexts()[0].pages().find(candidate => /tauri\.localhost|tauri:/.test(candidate.url()));
    assert(page, "must test the installed Release WebView, not browser source server");
    assert.equal(new URL(page.url()).origin, "http://tauri.localhost");
    page.setDefaultTimeout(30000);
    page.on("pageerror", error => report.errors.push(String(error)));
    await page.locator(".editor-toolbar").waitFor({ state: "visible" });
    const readState = async () => {
      const response = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/state`);
      if (!response.ok) throw Error(`Release state HTTP ${response.status}`);
      const body = await response.json();
      const metadata = body.data.project_metadata;
      return {
        settings: metadata.settings,
        assets: metadata.assetManifest ?? [],
      };
    };
    const readAssetBytes = async assetId => {
      const response = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/state`);
      const body = await response.json();
      const asset = body.data.project_metadata.assetManifest.find(item => item.asset_id === assetId);
      assert(asset, `Release asset ${assetId} missing from backend state`);
      const source = asset.metadata?.data_url;
      if (source?.startsWith("data:")) {
        return [...Buffer.from(source.slice(source.indexOf(",") + 1), "base64")];
      }
      // Release externalizes assets under the backend-owned asset root. The
      // project_path is the cartridge path and is intentionally different
      // from the backend route path used by this evidence reader.
      const assetPath = asset.metadata?.backend_asset_path
        || (() => {
          const sourceUrl = asset.metadata?.url;
          if (typeof sourceUrl !== "string") return null;
          try {
            const parsed = new URL(sourceUrl);
            return decodeURIComponent(parsed.pathname.replace(/^\/api\/project\/assets\//, ""));
          } catch {
            return null;
          }
        })();
      assert(assetPath, `Release asset ${assetId} has no backend-owned stored path`);
      const assetResponse = await fetch(
        `http://127.0.0.1:${state.backendPort}/api/project/assets/${assetPath.split("/").map(encodeURIComponent).join("/")}`,
      );
      if (!assetResponse.ok) throw Error(`Release asset HTTP ${assetResponse.status}`);
      return [...new Uint8Array(await assetResponse.arrayBuffer())];
    };
    await require("./lib/renpy-native-directory-flow.cjs").runNativeDirectoryFlow({
      page, hostPid: state.editorPid, output, root,
      readProjectSnapshot: readState, readAssetBytes,
    }).then(result => { report.nativeGuiDirectory = result; });
    assert.deepEqual(report.errors, []);
    report.cases.push({ name: "release-native-directory-picker-cancel-scan-apply-bytes", status: "PASS" });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = error.stack; process.exitCode = 1;
  }
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error, output }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
