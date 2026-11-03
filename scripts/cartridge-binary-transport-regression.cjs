// Exercise the real library entry points with controlled native IPC responses.
// Native large-package consumption is a separate required test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("../GameCli_framework/node_modules/typescript");

const file = path.join(__dirname, "../GameCli_framework/src/cartridge/desktopLibrary.ts");
const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const results = [];
async function check(name, body) {
  try { await body(); results.push({ name, status: "PASS" }); }
  catch (error) { results.push({ name, status: "FAILED", error: String(error.stack || error) }); }
}

function harness({ failure, invalid = false } = {}) {
  // Distinct bytes include all high-bit values; binary data must reach the ZIP
  // reader unchanged, with no number[] coercion or additional full-buffer copy.
  const buffer = Uint8Array.from({ length: 4096 }, (_, i) => i % 256).buffer;
  const calls = [], imports = [];
  const cartridge = {
    manifest: { game_id: "binary-game", title: "Binary", version: "1.0.0", author: "QA" },
    gallery: { items: [] }, script: { scenes: [] }, assetBlobUrls: {},
  };
  const record = { installId: "owned-install", gameId: "binary-game",
    sourceFileName: "中文 卡带.vncart", cartridgePath: "F:/中文/game.vncart" };
  const exports = {};
  const stubs = {
    "@tauri-apps/api/core": { invoke: async (command, args) => {
      calls.push({ command, args });
      if (failure) throw failure;
      return buffer;
    } },
    "@tauri-apps/plugin-dialog": { open: async () => undefined },
    "@tauri-apps/plugin-fs": {},
    nanoid: { nanoid: () => "controlled" },
    "../../../shared/logging/frontendErrorLogger": {},
    "./importCartridge": { importRuntimeCartridgeFromArrayBuffer: async (value, name) => {
      assert(value === buffer, "native binary buffer must reach ZIP validation without a copy");
      imports.push({ value, name });
      if (invalid) throw new Error("卡带完整性校验失败");
      return { cartridge, validation: { ok: true, errors: [], warnings: [] } };
    } },
    "../utils/platform": { isTauriRuntime: () => true },
  };
  vm.runInNewContext(code, { exports, require: id => {
    assert(Object.hasOwn(stubs, id), `Unexpected dependency: ${id}`);
    return stubs[id];
  }, ArrayBuffer, Uint8Array, Date }, { filename: file });
  return { exports, buffer, calls, imports, record };
}

(async () => {
  await check("disk path sends raw native buffer to existing ZIP validator", async () => {
    const h = harness();
    const game = await h.exports.loadGameFromPath(h.record.cartridgePath, "preview_gamecli");
    assert.equal(game.game_id, "binary-game");
    assert.equal(game.install_id, "preview_gamecli");
    assert.equal(game.cartridge_path, h.record.cartridgePath);
    assert.equal(h.calls[0].command, "read_cartridge_from_path");
    assert.equal(h.calls[0].args.sourcePath, h.record.cartridgePath);
    assert.equal(h.imports[0].name, "game.vncart");
    assert.equal(h.imports.length, 1);
  });
  await check("installed library uses the same binary transport and retains identity", async () => {
    const h = harness();
    const game = await h.exports.loadInstalledGame(h.record);
    assert.equal(game.install_id, "owned-install");
    assert.equal(game.cartridge_path, h.record.cartridgePath);
    assert.equal(h.calls[0].command, "load_installed_cartridge");
    assert.equal(h.calls[0].args.installId, "owned-install");
    assert.equal(h.imports[0].name, h.record.sourceFileName);
    assert.equal(h.imports.length, 1);
  });
  for (const entry of ["path", "library"]) {
    await check(`${entry}: read failure remains an error without attempting ZIP import`, async () => {
      const error = new Error("Access denied: controlled");
      const h = harness({ failure: error });
      await assert.rejects(entry === "path"
        ? h.exports.loadGameFromPath(h.record.cartridgePath, "preview_gamecli")
        : h.exports.loadInstalledGame(h.record), value => value === error);
      assert.equal(h.imports.length, 0);
      assert.equal(h.calls.length, 1);
    });
    await check(`${entry}: invalid cartridge still rejected by existing validation`, async () => {
      const h = harness({ invalid: true });
      await assert.rejects(entry === "path"
        ? h.exports.loadGameFromPath(h.record.cartridgePath, "preview_gamecli")
        : h.exports.loadInstalledGame(h.record), /完整性校验失败/);
      assert.equal(h.imports.length, 1);
    });
  }
  console.log(JSON.stringify({ status: results.every(x => x.status === "PASS") ? "PASS" : "FAILED",
    scope: "CONTROLLED_NATIVE_IPC_REAL_FRONTEND_ENTRY_POINTS", cases: results }, null, 2));
  if (results.some(x => x.status !== "PASS")) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
