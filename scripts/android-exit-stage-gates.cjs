"use strict";
// Source/controlled-IO gates only. Android acceptance is a separate elevated run.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { spawn } = require("node:child_process");
const [phase, attempt, prerequisiteAttempt = attempt, checkpointAttempt = attempt,
  matrixAttempt = prerequisiteAttempt] = process.argv.slice(2), root = path.resolve(__dirname, "..");
assert(["red", "support", "matrix", "build"].includes(phase)); assert.match(attempt || "", /^\d{2}$/);
assert.match(prerequisiteAttempt, /^\d{2}$/); assert.match(checkpointAttempt, /^\d{2}$/);
assert.match(matrixAttempt, /^\d{2}$/);
const base = "F:/AgentVN/QA/Android-Exit-20261024-01", out = path.join(base, `${phase}-${attempt}`);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  modifiedUtc: fs.statSync(f).mtime.toISOString() });
const checkpointFile = `F:/AgentVN/Checkpoints/Android-Exit-20261024-${checkpointAttempt}/manifest.json`;
const cp = read(checkpointFile);
const input = read("F:/AgentVN/Checkpoints/Editor-Sibling-Time-20261024-01/manifest.json").input;
assert(fs.existsSync(input.path)); assert.equal(sha(input.path), input.sha256);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sources = ["GameCli_framework/src/utils/runtimeWindowClose.ts", "GameCli_framework/src/utils/runtimeExitFlow.ts",
  "GameCli_framework/src/utils/runtimeSaveQueue.ts", "GameCli_framework/src/components/shell/ExitGameDialog.tsx",
  "GameCli_framework/src-tauri/src/lib.rs", "GameCli_framework/src-tauri/Cargo.lock",
  "scripts/runtime-window-close-test.cjs", "scripts/runtime-exit-flow-test.cjs", "scripts/runtime-save-queue-test.cjs",
  "scripts/runtime-exit-behavior-playwright.cjs", "scripts/android-exit-observer-test.cjs",
  "scripts/lib/android-exit-observer.cjs", "scripts/android-current-navigation-test.cjs", "scripts/android-exit-stage-gates.cjs",
  "scripts/lib/android-activity-exit.cjs", "scripts/android-activity-exit-test.cjs",
  "scripts/build-runtime-standalone-android.ps1", "scripts/android-managed-exit-test.cjs",
  "scripts/android-runtime-policy-manifest-test.cjs", "scripts/android-managed-exit-r8-test.cjs",
  "GameCli_framework/src-tauri/Cargo.toml", "GameCli_framework/src-tauri/src/android_activity.rs",
  "GameCli_framework/src-tauri/src/android_activity_state.rs", "scripts/android-runtime-activity.gradle",
  "scripts/android-activity-state-test.cjs", "scripts/android-plugin-rebind-test.cjs",
  "scripts/android-runtime-restoration-policy-test.cjs", "scripts/android-runtime-gradle-integration-test.cjs",
  "scripts/android-runtime-agp-integration-test.cjs", "scripts/android-plugin-manager-release-test.cjs",
  "scripts/android-plugin-manager-dex-test.cjs", "scripts/android-runtime-lifecycle-dex-audit.cjs",
  "GameCli_framework/src-tauri/capabilities/default.json",
  "GameCli_framework/src-tauri/capabilities/android-restored.json",
  "scripts/android-restored-webview-test.cjs", "scripts/lib/android-exit-failure-evidence.cjs",
  "scripts/android-exit-failure-evidence-test.cjs", "scripts/android-immediate-reopen-test.cjs",
  "scripts/android-exit-lifecycle-request-test.cjs"];
const frozen = cp.artifacts.slice(2);
const r = { status: "RUNNING", phase, startedAt: new Date().toISOString(), commands: [], input,
  scope: "SOURCE_CONTROLLED_NATIVE_IO_NOT_INSTALLED_OR_DEVICE_ACCEPTANCE", modelRequests: 0,
  sources: sources.map(f => desc(path.join(root, f))), frozen, checkpoint: desc(checkpointFile), prerequisiteAttempt, matrixAttempt };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
async function command(label, exe, args, extra = {}, expectedExit = 0) {
  const env = { AGENTVN_TEST_PROJECT: input.path, AGENTVN_WORKSPACE_OUTPUT: path.join(out, label),
    AGENTVN_RUNTIME_EXIT_OUTPUT: path.join(out, label), TEMP: path.join(out, "temporary"),
    TMP: path.join(out, "temporary"), ...extra };
  fs.mkdirSync(env.TEMP, { recursive: true });
  const c = { label, command: [exe, ...args], env, status: "RUNNING",
    startedAt: new Date().toISOString(), log: path.join(out, label + ".log") };
  r.commands.push(c); save();
  const fd = fs.openSync(c.log, "wx");
  try {
    const child = spawn(exe, args, { cwd: root, env: { ...process.env, ...env },
      windowsHide: true, stdio: ["ignore", fd, fd] });
    c.pid = child.pid; save();
    c.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(c.exitCode, expectedExit, `${label}: ${c.log}`);
    c.status = expectedExit ? "EXPECTED_RED" : "PASS";
  } catch (e) { c.status = "FAILED"; throw e; }
  finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(c)); }
}
(async () => {
  save();
  if (phase === "red") {
    await command("native-close-red", process.execPath, ["scripts/runtime-window-close-test.cjs"], {}, 1);
    assert(fs.readFileSync(r.commands[0].log, "utf8").includes("confirmed exit must use the platform-aware native command"));
    r.status = "EXPECTED_RED";
  } else if (phase === "support") {
    for (const [label, file] of [
      ["native-close", "runtime-window-close-test"], ["exit-flow", "runtime-exit-flow-test"],
      ["save-queue", "runtime-save-queue-test"], ["observer", "android-exit-observer-test"],
      ["request-guard", "android-current-navigation-test"],
      ["activity-evidence", "android-activity-exit-test"],
      ["android-policy", "android-runtime-policy-manifest-test"],
    ]) await command(label, process.execPath, [`scripts/${file}.cjs`]);
    await command("managed-exit", process.execPath, ["scripts/android-managed-exit-test.cjs"], {
      AGENTVN_MANAGED_EXIT_OUTPUT: path.join(out, "managed-exit"),
    });
    await command("managed-exit-r8", process.execPath, ["scripts/android-managed-exit-r8-test.cjs"], {
      AGENTVN_MANAGED_R8_OUTPUT: path.join(out, "managed-exit-r8"),
    });
    await command("plugin-release-r8", process.execPath, ["scripts/android-plugin-manager-release-test.cjs"], {
      AGENTVN_PLUGIN_RELEASE_OUTPUT: path.join(out, "plugin-release-r8"),
    });
    await command("plugin-release-dex", process.execPath, ["scripts/android-plugin-manager-dex-test.cjs"]);
    await command("activity-state", process.execPath, ["scripts/android-activity-state-test.cjs"], {
      AGENTVN_ACTIVITY_STATE_OUTPUT: path.join(out, "activity-state"),
    });
    await command("plugin-rebind", process.execPath, ["scripts/android-plugin-rebind-test.cjs"], {
      AGENTVN_PLUGIN_REBIND_OUTPUT: path.join(out, "plugin-rebind"),
    });
    await command("restoration-policy", process.execPath, ["scripts/android-runtime-restoration-policy-test.cjs"], {
      AGENTVN_RESTORATION_POLICY_OUTPUT: path.join(out, "restoration-policy"),
    });
    await command("gradle-integration", process.execPath, ["scripts/android-runtime-gradle-integration-test.cjs"], {
      AGENTVN_GRADLE_INTEGRATION_OUTPUT: path.join(out, "gradle-integration"),
    });
    await command("agp-integration", process.execPath, ["scripts/android-runtime-agp-integration-test.cjs"], {
      AGENTVN_AGP_INTEGRATION_OUTPUT: path.join(out, "agp-integration"),
    });
    await command("app-codegen", process.execPath, ["scripts/android-runtime-agp-integration-test.cjs", "--app"], {
      AGENTVN_AGP_INTEGRATION_OUTPUT: path.join(out, "app-codegen"),
    });
    await command("restored-webview", process.execPath, ["scripts/android-restored-webview-test.cjs"], {
      AGENTVN_RESTORED_WEBVIEW_OUTPUT: path.join(out, "restored-webview"),
    });
    await command("failure-evidence", process.execPath, ["scripts/android-exit-failure-evidence-test.cjs"], {
      AGENTVN_EXIT_FAILURE_TEST_OUTPUT: path.join(out, "failure-evidence"),
    });
    await command("immediate-reopen", process.execPath, ["scripts/android-immediate-reopen-test.cjs"]);
    await command("lifecycle-request", process.execPath, ["scripts/android-exit-lifecycle-request-test.cjs"]);
    for (const [name, count] of [["managed-exit", 11], ["activity-state", 8], ["plugin-rebind", 8],
      ["restored-webview", 3],
      ["restoration-policy", 3], ["gradle-integration", 2], ["agp-integration", 1], ["app-codegen", 4]]) {
      const tested = read(path.join(out, name, "report.json"));
      assert.equal(tested.status, "PASS");
      assert.equal(Array.isArray(tested.cases) ? tested.cases.length : tested.cases, count);
    }
    const bridge = read(path.join(out, "plugin-release-r8/report.json"));
    assert.equal(bridge.status, "PASS"); assert.equal(bridge.cases.length, 2);
    assert(bridge.cases.every(c => c.status === "PASS"));
    assert.equal(r.commands.length, 21); r.status = "PASS";
  } else if (phase === "matrix") {
    const support = read(path.join(base, `support-${prerequisiteAttempt}/report.json`));
    assert.equal(support.status, "PASS"); assert.equal(support.commands.length, 21);
    r.totalCases = 0;
    for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const label = `exit-dpr${dpr}-${reduced ? "reduced" : "normal"}`;
      await command(label, process.execPath, ["scripts/runtime-exit-behavior-playwright.cjs"], {
        PROFILE_DPR: String(dpr), EXIT_REDUCED: reduced ? "1" : "0",
        EXIT_VIEWPORTS: "1920x1080,2560x1440,3840x2160",
      });
      const file = path.join(out, label, "report.json"), report = read(file);
      assert.equal(report.status, "PASS"); assert.equal(report.cases.length, 6);
      for (const c of report.cases) {
        assert.equal(c.status, "PASS"); assert.equal(c.display.dpr, dpr); assert.equal(c.display.reduced, reduced);
        for (const k of ["nativeCloseWiring", "delayedAutoSave", "retry", "discard", "disabledWaitsManual", "disabledDoesNotSave"])
          assert.equal(c[k], "PASS", k);
        assert.equal(sha(c.screenshot.path), c.screenshot.sha256);
        const png = fs.readFileSync(c.screenshot.path);
        assert.equal(png.readUInt32BE(16), c.display.width * dpr);
        assert.equal(png.readUInt32BE(20), c.display.height * dpr);
      }
      r.commands.at(-1).behavior = desc(file); r.totalCases += report.cases.length; save();
    }
    assert.equal(r.totalCases, 24); r.status = "PASS";
  } else {
    for (const p of ["support", "matrix"]) {
      const selectedAttempt = p === "matrix" ? matrixAttempt : prerequisiteAttempt;
      const f = path.join(base, `${p}-${selectedAttempt}/report.json`), v = read(f);
      assert.equal(v.status, "PASS"); assert(v.commands.length > 0);
      if (p === "matrix") {
        assert.equal(v.totalCases, 24); assert.equal(v.commands.length, 4);
        assert(v.commands.every(c => c.status === "PASS" && c.exitCode === 0));
      } else {
        assert.equal(v.commands.length, 21);
        const optimizer = read(path.join(base, `support-${selectedAttempt}/managed-exit-r8/report.json`));
        assert.equal(optimizer.status, "PASS"); assert.equal(optimizer.cases.length, 2);
        assert.deepEqual(optimizer.cases.map(c => c.methodRetained), [false, true]);
        const bridge = read(path.join(base, `support-${selectedAttempt}/plugin-release-r8/report.json`));
        assert.equal(bridge.status, "PASS"); assert.equal(bridge.cases.length, 2);
        assert(bridge.cases.every(c => c.status === "PASS"));
      }
      for (const s of v.sources) {
        const current = desc(s.path);
        if (current.sha256 === s.sha256) continue;
        assert(p === "matrix" && matrixAttempt !== prerequisiteAttempt,
          `Changed source requires a new applicable regression: ${s.path}`);
        if (path.resolve(s.path) === __filename) {
          // The orchestration tool changed to add the real R8 gate; the actual
          // browser behavior test and all its recorded product sources did not.
          r.matrixGateToolRevision = { original: s, current };
          continue;
        }
        if (path.resolve(s.path) === path.join(root, "scripts/android-runtime-activity.gradle")) {
          const baseline = read("F:/AgentVN/Checkpoints/Android-Exit-20261024-10/manifest.json");
          const before = [...cp.entries, ...baseline.entries].find(e =>
            e.file === "scripts/android-runtime-activity.gradle" && e.sha256 === s.sha256);
          assert(before); assert.equal(sha(before.copy), s.sha256);
          const old = fs.readFileSync(before.copy, "utf8"), now = fs.readFileSync(s.path, "utf8");
          const oldBoundary = old.indexOf('if (binding.hasVariable("gradle"))');
          const newBoundary = now.indexOf("// Gradle delegates this property to Settings;");
          assert(oldBoundary > 0 && newBoundary > 0);
          assert.equal(now.slice(0, newBoundary), old.slice(0, oldBoundary),
            "Browser matrix reuse requires byte-identical Kotlin transformation; only Gradle configuration may differ");
          const focusedGates = [];
          for (const [label, count] of [["gradle-integration", 2], ["agp-integration", 1], ["app-codegen", 4]]) {
            const gateFile = path.join(base, `support-${prerequisiteAttempt}/${label}/report.json`);
            const gate = read(gateFile);
            assert.equal(gate.status, "PASS");
            assert.equal(Array.isArray(gate.cases) ? gate.cases.length : gate.cases, count);
            assert.equal(gate.sources.find(f => path.resolve(f.path) === path.resolve(s.path))?.sha256,
              current.sha256, "Focused configuration tests must exercise these exact helper bytes");
            focusedGates.push(desc(gateFile));
          }
          r.gradleConfigurationOnlyMatrixReuse = { original: s, current, baseline: desc(before.copy),
            basis: "Byte-identical Kotlin transformer/browser/Rust; Gradle configuration independently tested with pinned real AGP/Kotlin compilation and fail-closed negative",
            focusedGates };
          continue;
        }
        assert.equal(path.resolve(s.path), path.join(root, "scripts/build-runtime-standalone-android.ps1"));
        const baseline = read("F:/AgentVN/Checkpoints/Android-Exit-20261024-10/manifest.json");
        const before = [...cp.entries, ...baseline.entries].find(e =>
          e.file === "scripts/build-runtime-standalone-android.ps1" && e.sha256 === s.sha256);
        assert(before); assert.equal(sha(before.copy), s.sha256);
        const old = fs.readFileSync(before.copy, "utf8"), now = fs.readFileSync(s.path, "utf8");
        const addedBlock = /^  # AgentVN managed exit JNI keep rules begin\r?\n[\s\S]*?^  # AgentVN managed exit JNI keep rules end\r?\n/gm;
        assert.equal([...now.matchAll(addedBlock)].length, 1);
        assert.equal(now.replace(addedBlock, ""), old.replace(addedBlock, ""),
          "Matrix reuse permits only the independently R8-tested JNI keep-rule block");
        const bridgeFile = path.join(base, `support-${prerequisiteAttempt}/plugin-release-r8/report.json`);
        const bridge = read(bridgeFile);
        assert.equal(bridge.status, "PASS");
        assert.equal(bridge.sources.find(f => path.resolve(f.path) === path.resolve(s.path))?.sha256, current.sha256);
        r.nativeKeepOnlyMatrixReuse = { original: s, current,
          basis: "Exact original script bytes after normalizing both JNI keep-rule blocks; unchanged Kotlin/frontend/Rust and browser behavior test",
          optimizerGate: desc(path.join(base, `support-${prerequisiteAttempt}/managed-exit-r8/report.json`)),
          inheritedPluginGate: desc(bridgeFile) };
      }
      r[p] = desc(f);
    }
    r.backups = [];
    for (const p of cp.artifacts.slice(0, 2)) {
      assert.equal(sha(p.path), p.sha256);
      const file = path.join(out, "prior-products", path.basename(p.path));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.copyFileSync(p.path, file, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(file), p.sha256); r.backups.push(desc(file));
    }
    await command("editor-typecheck", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run typecheck"]);
    await command("editor-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run build"]);
    await command("gamecli-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
    await command("full-dev", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
    r.dev = desc(path.join(root, "AgentVN Dev.exe"));
    assert.equal(r.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    assert(new Date(r.dev.modifiedUtc) >= new Date(r.commands.at(-1).startedAt));
    r.player = desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    assert.equal(r.player.sha256, sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
    r.bundled = ["GameCli_framework/src/utils/runtimeWindowClose.ts", "GameCli_framework/src-tauri/src/lib.rs",
      "GameCli_framework/src-tauri/src/android_activity.rs", "GameCli_framework/src-tauri/src/android_activity_state.rs",
      "GameCli_framework/src-tauri/Cargo.toml", "GameCli_framework/src-tauri/Cargo.lock",
      "GameCli_framework/src-tauri/capabilities/android-restored.json",
      "scripts/build-runtime-standalone-android.ps1", "scripts/android-runtime-activity.gradle"].map(f => {
      const actual = path.join(root, "editor/src-tauri/bundle-workspace", f);
      assert.equal(sha(actual), sha(path.join(root, f))); return desc(actual);
    });
    r.status = "PASS";
  }
  for (const f of [...r.sources, ...frozen]) assert.equal(sha(f.path), f.sha256);
})().catch(e => { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, phase, out, error: r.error })); });
