#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require(path.join(__dirname, "..", "editor", "node_modules", "playwright"));

const ROOT = path.resolve(__dirname, "..");
const GAME_ROOT = path.join(ROOT, "GameCli_framework");
const EDITOR_ROOT = path.join(ROOT, "editor");
const GAME_VITE = path.join(
  GAME_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vite.cmd" : "vite",
);
const EDITOR_VITE = path.join(
  EDITOR_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vite.cmd" : "vite",
);
const GAME_PORT = Number(process.env.AGENTVN_NATIVE_INTERACTION_GAME_PORT || 6994);
const EDITOR_PORT = Number(process.env.AGENTVN_NATIVE_INTERACTION_EDITOR_PORT || 6995);
const GAME_URL = `http://127.0.0.1:${GAME_PORT}/`;
const EDITOR_URL = `http://127.0.0.1:${EDITOR_PORT}/`;

let server;
let editorServer;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {
      // The dev server is still starting.
    }
    await wait(300);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function stopPort(port) {
  if (process.platform !== "win32") return;
  try {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`,
      ],
      { stdio: "ignore", windowsHide: true },
    );
  } catch {
    // Nothing is listening on the acceptance port.
  }
}

function startGameServer() {
  stopPort(GAME_PORT);
  if (process.platform === "win32") {
    server = spawn(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", GAME_VITE, "--host", "127.0.0.1", "--port", String(GAME_PORT)],
      { cwd: GAME_ROOT, stdio: "ignore", windowsHide: true },
    );
    return;
  }
  server = spawn(GAME_VITE, ["--host", "127.0.0.1", "--port", String(GAME_PORT)], {
    cwd: GAME_ROOT,
    stdio: "ignore",
  });
}

function startEditorServer() {
  stopPort(EDITOR_PORT);
  if (process.platform === "win32") {
    editorServer = spawn(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", EDITOR_VITE, "--host", "127.0.0.1", "--port", String(EDITOR_PORT)],
      { cwd: EDITOR_ROOT, stdio: "ignore", windowsHide: true },
    );
    return;
  }
  editorServer = spawn(EDITOR_VITE, ["--host", "127.0.0.1", "--port", String(EDITOR_PORT)], {
    cwd: EDITOR_ROOT,
    stdio: "ignore",
  });
}

function assert(condition, message, details) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    return;
  }
  throw new Error(`${message}${details === undefined ? "" : `: ${JSON.stringify(details)}`}`);
}

function buildGamePreview() {
  if (process.platform === "win32") {
    execFileSync(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", "npm", "run", "build"],
      { cwd: GAME_ROOT, stdio: "pipe", windowsHide: true },
    );
    return;
  }
  execFileSync("npm", ["run", "build"], { cwd: GAME_ROOT, stdio: "pipe" });
}

async function probeInteractions(scope, page, label) {
  const probeId = `agentvn-native-interaction-probe-${label}`;
  await scope.evaluate(({ id, probeLabel }) => {
    const host = document.createElement("section");
    host.id = id;
    host.style.cssText = [
      "position:fixed",
      "left:16px",
      "top:16px",
      "z-index:2147483647",
      "width:520px",
      "padding:16px",
      "background:white",
      "color:black",
      "font:16px/1.5 monospace",
    ].join(";");

    const ordinary = document.createElement("div");
    ordinary.dataset.probe = "ordinary";
    ordinary.textContent = `${probeLabel} ordinary display text must not be selectable`;

    const input = document.createElement("input");
    input.dataset.probe = "input";
    input.value = `${probeLabel} editable input`;

    const textarea = document.createElement("textarea");
    textarea.dataset.probe = "textarea";
    textarea.value = `${probeLabel} editable textarea`;

    const richText = document.createElement("div");
    richText.dataset.probe = "rich-text";
    richText.contentEditable = "true";
    richText.textContent = `${probeLabel} editable rich text`;

    host.append(ordinary, input, textarea, richText);
    document.body.appendChild(host);
  }, { id: probeId, probeLabel: label });

  const ordinary = scope.locator(`#${probeId} [data-probe="ordinary"]`);
  const ordinaryBox = await ordinary.boundingBox();
  if (!ordinaryBox) throw new Error(`${label}: ordinary text probe has no bounding box`);
  await scope.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(ordinaryBox.x + 4, ordinaryBox.y + ordinaryBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(ordinaryBox.x + Math.min(ordinaryBox.width - 4, 360), ordinaryBox.y + ordinaryBox.height / 2, { steps: 8 });
  await page.mouse.up();
  const ordinaryMouseSelection = await scope.evaluate(() => window.getSelection()?.toString() ?? "");

  const input = scope.locator(`#${probeId} [data-probe="input"]`);
  await input.click();
  await input.press("Control+A");

  return scope.evaluate((id) => {
    const host = document.getElementById(id);
    const ordinary = host?.querySelector('[data-probe="ordinary"]');
    const input = host?.querySelector('[data-probe="input"]');
    const textarea = host?.querySelector('[data-probe="textarea"]');
    const richText = host?.querySelector('[data-probe="rich-text"]');
    if (!(ordinary instanceof HTMLElement)
      || !(input instanceof HTMLInputElement)
      || !(textarea instanceof HTMLTextAreaElement)
      || !(richText instanceof HTMLElement)) {
      throw new Error("Native interaction probe elements are missing");
    }

    function dispatch(target, type, mouse = false) {
      const event = mouse
        ? new MouseEvent(type, { bubbles: true, cancelable: true, button: 2 })
        : new Event(type, { bubbles: true, cancelable: true });
      const dispatchResult = target.dispatchEvent(event);
      return { defaultPrevented: event.defaultPrevented, dispatchResult };
    }

    const result = {
      ordinaryMouseSelection: window.getSelection()?.toString() ?? "",
      ordinaryUserSelect: getComputedStyle(ordinary).userSelect,
      ordinarySelectStart: dispatch(ordinary, "selectstart"),
      ordinaryContextMenu: dispatch(ordinary, "contextmenu", true),
      inputUserSelect: getComputedStyle(input).userSelect,
      inputSelectStart: dispatch(input, "selectstart"),
      inputContextMenu: dispatch(input, "contextmenu", true),
      inputSelectionStart: input.selectionStart,
      inputSelectionEnd: input.selectionEnd,
      inputValueLength: input.value.length,
      textareaUserSelect: getComputedStyle(textarea).userSelect,
      textareaSelectStart: dispatch(textarea, "selectstart"),
      richTextUserSelect: getComputedStyle(richText).userSelect,
      richTextSelectStart: dispatch(richText, "selectstart"),
    };
    host.remove();
    return result;
  }, probeId).then((result) => ({ ...result, ordinaryMouseSelection }));
}

function assertInteractionGuards(label, result) {
  assert(
    result.ordinaryContextMenu.defaultPrevented
      && !result.ordinaryContextMenu.dispatchResult
      && result.inputContextMenu.defaultPrevented
      && !result.inputContextMenu.dispatchResult,
    `${label} suppresses context menus everywhere`,
    result,
  );
  assert(
    result.ordinarySelectStart.defaultPrevented
      && !result.ordinarySelectStart.dispatchResult
      && result.ordinaryUserSelect === "none"
      && result.ordinaryMouseSelection === "",
    `${label} prevents ordinary text selection`,
    result,
  );
  assert(
    !result.inputSelectStart.defaultPrevented
      && result.inputSelectStart.dispatchResult
      && result.inputUserSelect === "text"
      && result.inputSelectionStart === 0
      && result.inputSelectionEnd === result.inputValueLength
      && result.textareaUserSelect === "text"
      && !result.textareaSelectStart.defaultPrevented
      && result.textareaSelectStart.dispatchResult
      && result.richTextUserSelect === "text"
      && !result.richTextSelectStart.defaultPrevented
      && result.richTextSelectStart.dispatchResult,
    `${label} preserves editable text selection`,
    result,
  );
}

async function main() {
  buildGamePreview();
  startGameServer();
  await waitForServer(GAME_URL);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(GAME_URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(document.querySelector("#root")?.firstElementChild));
    assertInteractionGuards("GameCLI", await probeInteractions(page, page, "gamecli"));

    startEditorServer();
    await waitForServer(EDITOR_URL);
    const editorPage = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    await editorPage.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
    await editorPage.waitForFunction(() => Boolean(document.querySelector("#root")?.firstElementChild));
    assertInteractionGuards("Editor", await probeInteractions(editorPage, editorPage, "editor"));

    await editorPage.evaluate(() => {
      const iframe = document.createElement("iframe");
      iframe.dataset.probe = "embedded-gamecli";
      iframe.src = "/gamecli-preview/?preview=1&embedded=1";
      iframe.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483646";
      document.body.appendChild(iframe);
    });
    const embeddedFrameElement = editorPage.locator('iframe[data-probe="embedded-gamecli"]');
    await embeddedFrameElement.waitFor();
    const embeddedFrame = await embeddedFrameElement.elementHandle().then((handle) => handle?.contentFrame());
    if (!embeddedFrame) throw new Error("Embedded GameCLI frame was not created");
    await embeddedFrame.waitForFunction(() => Boolean(document.querySelector("#root")?.firstElementChild));
    assertInteractionGuards(
      "Embedded GameCLI",
      await probeInteractions(embeddedFrame, editorPage, "embedded-gamecli"),
    );
  } finally {
    await browser.close();
    if (server) server.kill();
    if (editorServer) editorServer.kill();
    stopPort(GAME_PORT);
    stopPort(EDITOR_PORT);
  }
}

main().catch((error) => {
  if (server) server.kill();
  if (editorServer) editorServer.kill();
  stopPort(GAME_PORT);
  stopPort(EDITOR_PORT);
  console.error(error);
  process.exit(1);
});
