"use strict";
// Continue the already exported current cards. Keep the prior adapter and its
// failed preflight frozen; map the real receipt schema without re-exporting.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const assert = require("node:assert/strict"), vm = require("node:vm");
const closure = require("./current-runtime-story-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Runtime-Story-1.9.35-20261101-01";
const runtimeRoot = "F:/AgentVN/QA/Native-Runtime-State-20261101-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
const files = { session: "installed-runtime-story-1922.cjs",
  player: "installed-runtime-abilities-playwright.cjs", audit: "installed-runtime-story-audit.cjs" };
// The failed 02 adapter and executed sources remain frozen in their evidence
// folders. 03 changes only the QA oracle: presentation copies aren't save slots.
const attempt = "03";
const gridOwnership = `async function activeSaveGrid(kind, index = 0) {
  await page.waitForFunction(({ kind, index }) =>
    document.querySelector('[data-testid="save-slot-grid"]')
      ?.closest("[data-save-page-layer]")?.getAttribute("data-save-page-layer") === kind + ":" + index,
    { kind, index });
  const state = await page.evaluate(() => {
    const grids = [...document.querySelectorAll('[data-testid="save-slot-grid"]')];
    const grid = grids[0], owner = grid?.closest("[data-save-page-layer]");
    return { grids: grids.length, owner: owner?.getAttribute("data-save-page-layer"),
      activeInert: !!grid?.closest("[inert]"),
      activeSlots: grid?.querySelectorAll(".save-slot").length,
      activeOccupied: grid?.querySelectorAll(".save-slot.has-save").length,
      allOccupied: document.querySelectorAll(".save-slot.has-save").length,
      retained: [...document.querySelectorAll('[data-save-page-layer="retained"]')].map(node => ({
        inert: node.inert, hidden: node.getAttribute("aria-hidden"),
        pointerEvents: getComputedStyle(node).pointerEvents,
        functionalMarkers: node.querySelectorAll("[data-testid], [id], [autofocus]").length,
        focusable: [...node.querySelectorAll("button,input,select,textarea,a,[tabindex]")]
          .filter(child => child.tabIndex >= 0).length,
        occupied: node.querySelectorAll(".save-slot.has-save").length,
      })) };
  });
  assert.equal(state.grids, 1); assert.equal(state.owner, kind + ":" + index);
  assert.equal(state.activeInert, false); assert.equal(state.activeSlots, 6);
  for (const copy of state.retained) {
    assert.equal(copy.inert, true); assert.equal(copy.hidden, "true");
    assert.equal(copy.pointerEvents, "none"); assert.equal(copy.functionalMarkers, 0);
    assert.equal(copy.focusable, 0);
  }
  (report.saveGridOwnership ??= []).push(state); save(); return state;
}
`;
function adapt(mode, original) {
  const adapted = closure.adapt(mode, original), edits = [...adapted.edits];
  let source = adapted.source;
  if (mode === "session") {
    for (const [before, after, count] of [
      ["installation.originalAudit, installation.originalInstallation", "installation.actualInstallation", 1],
      [JSON.stringify(path.join(__dirname, "current-runtime-story-closure.cjs")), JSON.stringify(__filename), 2],
    ]) {
      assert.equal(source.split(before).length - 1, count);
      source = source.replaceAll(before, () => after); edits.push({ before, after, count });
    }
  }
  if (mode === "player") {
    const updates = [
      ["async function quickFlow() {", gridOwnership + "async function quickFlow() {", 1],
      ['page.locator(".save-slot.has-save")',
        'page.locator(\'[data-testid="save-slot-grid"] .save-slot.has-save\')', 2],
      ['page.locator(".save-slot")',
        'page.locator(\'[data-testid="save-slot-grid"] .save-slot\')', 1],
      ['await page.getByRole("tab", { name: "快存", exact: true }).click();',
        'await page.getByRole("tab", { name: "快存", exact: true }).click(); await activeSaveGrid("quick");', 3],
      ['await page.getByRole("tab", { name: "手动", exact: true }).click();',
        'await page.getByRole("tab", { name: "手动", exact: true }).click(); await activeSaveGrid("manual");', 4],
      ['await page.getByTestId("save-slot-manual-7").waitFor();',
        'await page.getByTestId("save-slot-manual-7").waitFor(); await activeSaveGrid("manual", 1);', 1],
      ['await page.getByTestId("save-slot-manual-1").waitFor();',
        'await page.getByTestId("save-slot-manual-1").waitFor(); await activeSaveGrid("manual");', 1],
    ];
    for (const [before, after, count] of updates) {
      assert.equal(source.split(before).length - 1, count, before);
      source = source.replaceAll(before, () => after); edits.push({ before, after, count });
    }
  }
  new vm.Script(Module.wrap(source));
  return { source, edits };
}
function main(mode, args) {
  const installed = closure.descriptor();
  assert.deepEqual(read(qa + "/derived-actual-installation.json"), installed);
  if (mode === "self-test") {
    for (const [kind, file] of Object.entries(files)) {
      const original = fs.readFileSync(path.join(__dirname, file), "utf8"), result = adapt(kind, original);
      let reversed = result.source;
      for (const e of [...result.edits].reverse()) reversed = reversed.replaceAll(e.after, () => e.before);
      assert.equal(reversed, original);
    }
    console.log(JSON.stringify({ status: "PASS", candidate: installed.executable.sha256,
      mappedReceipt: installed.actualInstallation, checkedWorkflows: 3, productChanges: 0 }));
    return;
  }
  assert(Object.hasOwn(files, mode));
  if (mode === "session") assert.deepEqual(args, [attempt, "05", "--physical-roaming"]);
  if (mode === "audit") assert.deepEqual(args, [attempt, "01"]);
  if (mode === "player") {
    const index = args.indexOf("--current-native-preparation"); assert(index >= 0);
    const prep = read(args[index + 1]);
    assert.equal(path.resolve(prep.sessionRoot), path.resolve(runtimeRoot, "installed-story-1935-" + attempt));
    assert.deepEqual(prep.executable, describe(path.join(installed.installRoot, "agentvn-player.exe")));
    const relative = path.relative(prep.sessionRoot, path.resolve(args[0]));
    assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    const exported = read(prep.originalExport.path);
    assert.equal(exported.installation.sha256, sha(qa + "/derived-actual-installation.json"));
    assert.deepEqual(prep.cartridges, exported.cartridges);
    for (const file of prep.cartridges) assert.equal(sha(file.path), file.sha256);
  }
  const original = path.join(__dirname, files[mode]), result = adapt(mode, fs.readFileSync(original, "utf8"));
  const folder = path.join(qa, mode === "player" ? "continued-player-" + attempt + "-" + path.basename(args[0])
    : "continued-" + mode + "-" + args[0]);
  fs.mkdirSync(folder, { recursive: false });
  const executed = path.join(folder, "executed.cjs");
  fs.writeFileSync(executed, result.source, { flag: "wx" });
  fs.copyFileSync(__filename, path.join(folder, "frozen-adapter.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(folder, "binding.json"), JSON.stringify({
    mode, args, original: describe(original), executed: describe(executed),
    adapter: describe(__filename), baseAdapter: describe(path.join(__dirname, "current-runtime-story-closure.cjs")),
    edits: result.edits, actual: installed.actualInstallation, productChanges: 0, modelRequests: 0, builds: 0,
  }, null, 2), { flag: "wx" });
  process.argv = [process.execPath, original, ...args];
  const worker = new Module(original, module);
  worker.filename = original; worker.paths = Module._nodeModulePaths(path.dirname(original));
  require.main = worker; process.mainModule = worker; worker._compile(result.source, original);
}
if (require.main === module) main(process.argv[2], process.argv.slice(3));
module.exports = { adapt };
