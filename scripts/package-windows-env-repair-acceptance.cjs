const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { chromium } = require(path.join(__dirname, "..", "editor", "node_modules", "playwright"));

const root = path.resolve(__dirname, "..");
const editorExe =
  process.env.AGENTVN_TEST_EDITOR_EXE ||
  path.join(root, "output", "test-editor-cdp", "agentvn-editor.exe");
const cdpPort = Number(process.env.AGENTVN_EDITOR_CDP_PORT || 9477);
const cdpUrl = `http://127.0.0.1:${cdpPort}`;

function waitForHttp(url, timeoutMs, child, childOutput) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode === 200) {
          resolve();
        } else if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${url}; status ${response.statusCode}`));
        } else {
          setTimeout(attempt, 250);
        }
      });
      request.on("error", (error) => {
        if (child.exitCode !== null) {
          reject(
            new Error(
              `Editor exited with code ${child.exitCode} before CDP became ready.\n${childOutput()}`,
            ),
          );
        } else if (Date.now() >= deadline) {
          reject(new Error(`${error.message}\n${childOutput()}`));
        } else {
          setTimeout(attempt, 250);
        }
      });
      request.setTimeout(1_000, () => request.destroy());
    };
    attempt();
  });
}

function buildFakeRustTools(testRoot) {
  const binDir = path.join(testRoot, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const sourcePath = path.join(testRoot, "fake-rust-tool.rs");
  const rustupExe = path.join(binDir, "rustup.exe");
  const cargoExe = path.join(binDir, "cargo.exe");
  fs.writeFileSync(
    sourcePath,
    String.raw`
use std::{env, fs, process};

fn main() {
    let executable = env::current_exe()
        .ok()
        .and_then(|value| value.file_name().map(|name| name.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    let args = env::args().skip(1).collect::<Vec<_>>();
    let state_path = env::var("AGENTVN_FAKE_RUST_STATE").expect("missing fake Rust state path");

    if executable == "cargo.exe" && args == ["--version"] {
        if fs::read_to_string(&state_path).unwrap_or_default().trim() == "ready" {
            println!("cargo 1.95.0 (agentvn acceptance)");
            return;
        }
        eprintln!("error: rustup could not choose a version of cargo because no default toolchain is configured");
        process::exit(1);
    }

    if executable == "rustup.exe" && args == ["--version"] {
        println!("rustup 1.29.0 (agentvn acceptance)");
        eprintln!("info: no rustc is currently active");
        return;
    }

    if executable == "rustup.exe"
        && args.starts_with(&["toolchain".to_string(), "install".to_string(), "stable-msvc".to_string()])
    {
        fs::write(&state_path, "installed").expect("write installed state");
        println!("stable-msvc installed");
        return;
    }

    if executable == "rustup.exe"
        && args.starts_with(&["default".to_string(), "stable-msvc".to_string()])
    {
        fs::write(&state_path, "ready").expect("write ready state");
        println!("stable-msvc set as default");
        return;
    }

    eprintln!("unexpected fake Rust invocation: {} {}", executable, args.join(" "));
    process::exit(2);
}
`,
    "utf8",
  );
  const compiled = spawnSync("rustc", [sourcePath, "-o", rustupExe], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.strictEqual(
    compiled.status,
    0,
    `Failed to compile fake Rust tools:\n${compiled.stdout}\n${compiled.stderr}`,
  );
  fs.copyFileSync(rustupExe, cargoExe);
  return { binDir, rustupExe, cargoExe };
}

async function waitForChildExit(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function removeTestRoot(testRoot) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

async function main() {
  assert.ok(fs.existsSync(editorExe), `Missing CDP Editor executable: ${editorExe}`);
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-windows-env-repair-"));
  const statePath = path.join(testRoot, "rust-state.txt");
  const { binDir, rustupExe, cargoExe } = buildFakeRustTools(testRoot);
  const environment = { ...process.env };
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") || "PATH";
  environment[pathKey] = `${binDir};${environment[pathKey] || ""}`;
  environment.CARGO = cargoExe;
  environment.RUSTUP = rustupExe;
  environment.AGENTVN_FAKE_RUST_STATE = statePath;
  environment.AGENTVN_WORKSPACE_ROOT = root;
  environment.AGENTVN_EDITOR_DATA_DIR = path.join(testRoot, "editor-data");
  environment.WEBVIEW2_USER_DATA_FOLDER = path.join(testRoot, "webview2");

  const child = spawn(editorExe, [], {
    cwd: path.dirname(editorExe),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const childOutput = () => `== stdout ==\n${stdout}\n== stderr ==\n${stderr}`;
  let browser;
  try {
    await waitForHttp(`${cdpUrl}/json/version`, 30_000, child, childOutput);
    browser = await chromium.connectOverCDP(cdpUrl);
    const pages = browser.contexts().flatMap((context) => context.pages());
    assert.strictEqual(pages.length, 1, `Expected one Editor page, found ${pages.length}`);
    const page = pages[0];
    await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__?.invoke), null, {
      timeout: 30_000,
    });

    const results = await page.evaluate(async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const progress = [];
      const callbackId = window.__TAURI_INTERNALS__.transformCallback((event) => {
        progress.push(event.payload ?? event);
      });
      const eventId = await invoke("plugin:event|listen", {
        event: "agentvn://package-environment-operation-progress",
        target: { kind: "Any" },
        handler: callbackId,
      });
      try {
        const before = await invoke("check_windows_build_environment", {
          runId: "windows-env-repair-acceptance-before",
          forceRecheck: true,
        });
        const repaired = await invoke("install_windows_build_environment", {
          runId: "windows-env-repair-acceptance-repair",
        });
        return { before, repaired, progress };
      } finally {
        window.__TAURI_INTERNALS__.unregisterCallback(callbackId);
        await invoke("plugin:event|unlisten", {
          event: "agentvn://package-environment-operation-progress",
          eventId,
        });
      }
    });

    assert.strictEqual(results.before.status, "BLOCKED", JSON.stringify(results.before, null, 2));
    assert.deepStrictEqual(results.before.missing, ["cargo"]);
    assert.strictEqual(results.repaired.status, "PASS", JSON.stringify(results.repaired, null, 2));
    assert.deepStrictEqual(results.repaired.missing, []);
    assert.ok(
      results.repaired.actions.includes("rustup toolchain install stable-msvc --profile minimal"),
      JSON.stringify(results.repaired.actions),
    );
    assert.ok(
      results.repaired.actions.includes("rustup default stable-msvc"),
      JSON.stringify(results.repaired.actions),
    );
    assert.ok(
      !results.repaired.actions.includes("winget install Rustlang.Rustup"),
      "Existing rustup must be configured directly instead of reinstalled through winget.",
    );
    const repairProgress = results.progress.filter(
      (event) => event.runId === "windows-env-repair-acceptance-repair",
    );
    assert.ok(repairProgress.length > 0, "Windows repair must emit operation progress events");
    assert.deepStrictEqual(
      repairProgress.map((event) => event.platform),
      repairProgress.map(() => "windows"),
      JSON.stringify(repairProgress, null, 2),
    );
    assert.deepStrictEqual(
      repairProgress.map((event) => event.operation),
      repairProgress.map(() => "install"),
      JSON.stringify(repairProgress, null, 2),
    );
    const phaseIndexes = ["preparing", "checking", "installing", "verifying", "completed"].map(
      (phase) => repairProgress.findIndex((event) => event.phase === phase),
    );
    assert.ok(
      phaseIndexes.every((index) => index >= 0) && phaseIndexes.every((index, current) => current === 0 || index >= phaseIndexes[current - 1]),
      `Windows repair progress must include preparation, checking, install, verification, and completion in order:\n${JSON.stringify(repairProgress, null, 2)}`,
    );
    assert.strictEqual(repairProgress.at(-1).percent, 100, JSON.stringify(repairProgress, null, 2));
    assert.strictEqual(fs.readFileSync(statePath, "utf8").trim(), "ready");
    console.log("PASS Windows environment one-click repair acceptance");
  } finally {
    if (browser) await browser.close();
    if (process.platform === "win32" && child.pid) {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      child.kill();
    }
    await waitForChildExit(child);
    await removeTestRoot(testRoot);
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
