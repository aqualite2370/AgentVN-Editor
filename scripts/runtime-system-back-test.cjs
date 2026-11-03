const assert = require("node:assert/strict");
const path = require("node:path");
const { buildSync } = require("../GameCli_framework/node_modules/esbuild");
const fs = require("node:fs");
const os = require("node:os");

const repoRoot = path.resolve(__dirname, "..");
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-system-back-"));
const outputFile = path.join(outputDirectory, "runtimeSystemBack.cjs");

buildSync({
  entryPoints: [path.join(repoRoot, "GameCli_framework", "src", "utils", "runtimeSystemBack.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: outputFile,
  logLevel: "silent",
});

const { routeRuntimeSystemBack } = require(outputFile);

function route(screen, returnScreen, pendingTarget, isUiHidden = false) {
  const calls = [];
  routeRuntimeSystemBack(
    { screen, returnScreen, isUiHidden, pendingScreenNavigation: pendingTarget ? { toScreen: pendingTarget } : undefined },
    {
      openMenu: () => calls.push("openMenu"),
      closeMenu: () => calls.push("closeMenu"),
      openExitConfirmation: () => calls.push("openExitConfirmation"),
      restoreUi: () => calls.push("restoreUi"),
    },
  );
  return calls;
}

try {
  assert.deepEqual(route("playing"), ["openMenu"], "system back while playing opens the game menu");
  assert.deepEqual(route("playing", undefined, undefined, true), ["restoreUi"],
    "system back first restores hidden UI without opening a menu");
  assert.deepEqual(route("main_menu", "playing"), ["closeMenu"], "system back in the game menu resumes the story");
  for (const screen of ["save_load", "history", "settings", "gallery", "about", "help"]) {
    assert.deepEqual(route(screen, "playing"), ["closeMenu"], `${screen} returns to its parent`);
  }
  assert.deepEqual(route("title_menu"), ["openExitConfirmation"], "title root asks before exit");
  assert.deepEqual(route("library"), ["openExitConfirmation"], "library root asks before exit");
  assert.deepEqual(route("playing", undefined, "main_menu"), ["closeMenu"],
    "back during menu cover reverses the latest request rather than opening it again");
  assert.deepEqual(route("title_menu", undefined, "settings"), ["closeMenu"],
    "back during child-page load returns instead of requesting root exit");
  assert.deepEqual(route("settings", "main_menu", "playing"), ["openMenu"],
    "back follows the pending gameplay destination");
  console.log("runtime-system-back-test: PASS");
} finally {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
}
