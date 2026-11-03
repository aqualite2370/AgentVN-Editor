const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require(path.join(__dirname, "..", "editor", "node_modules", "esbuild"));

const root = path.resolve(__dirname, "..");
const entry = path.join(root, "editor", "src", "packaging", "standalonePackage.ts");
const CHUNK_BYTES = 256 * 1024;

async function loadStandalonePackageModule() {
  const build = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    write: false,
    plugins: [{
      name: "mock-tauri-core",
      setup(builder) {
        builder.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({
          path: "tauri-core",
          namespace: "mock-tauri",
        }));
        builder.onLoad({ filter: /.*/, namespace: "mock-tauri" }, () => ({
          contents: "exports.invoke = (command, args) => globalThis.__agentvnInvoke(command, args);",
          loader: "js",
        }));
      },
    }],
  });
  const module = { exports: {} };
  const source = build.outputFiles[0].text;
  new Function("require", "module", "exports", "__filename", "__dirname", source)(
    require,
    module,
    module.exports,
    entry,
    path.dirname(entry),
  );
  return module.exports;
}

async function testLargeCartridgeUsesBoundedChunks() {
  globalThis.window = { __TAURI_INTERNALS__: {} };
  const calls = [];
  const written = { cartridge: 0, icon: 0 };
  const progress = [];
  globalThis.__agentvnInvoke = async (command, args = {}) => {
    calls.push({ command, args });
    if (command === "begin_standalone_package_upload") {
      assert.equal(args.fileName, "large.vncart");
      assert.equal(args.expectedSize, 9 * 1024 * 1024 + 17);
      return { uploadId: "standalone-upload-1" };
    }
    if (command === "append_standalone_package_upload_chunk") {
      assert.equal(args.uploadId, "standalone-upload-1");
      assert.ok(args.fileKind === "cartridge" || args.fileKind === "icon");
      assert.equal(args.offsetBytes, written[args.fileKind]);
      assert.ok(args.chunkBytes.length > 0);
      assert.ok(args.chunkBytes.length <= CHUNK_BYTES);
      written[args.fileKind] += args.chunkBytes.length;
      return { writtenBytes: written[args.fileKind] };
    }
    if (command === "build_standalone_package_from_upload") {
      assert.equal(args.uploadId, "standalone-upload-1");
      assert.equal(written.cartridge, 9 * 1024 * 1024 + 17);
      return {
        ok: true,
        status: "PASS",
        message: "done",
        artifacts: [],
        warnings: [],
        verifyReportPath: "",
        buildLogPath: "",
        manifestPath: "",
      };
    }
    if (command === "abort_standalone_package_upload") return undefined;
    throw new Error(`Unexpected Tauri command: ${command}`);
  };

  const { buildStandalonePackage } = await loadStandalonePackageModule();
  const result = await buildStandalonePackage({
    targetPlatform: "android",
    outputDir: "D:\\AgentVN_test_installer",
    cartridge: new Blob([new Uint8Array(9 * 1024 * 1024 + 17)]),
    fileName: "large.vncart",
    runId: "test-run",
    onUploadProgress(event) {
      progress.push(event);
    },
  });

  assert.equal(result.status, "PASS");
  assert.equal(written.cartridge, 9 * 1024 * 1024 + 17);
  assert.ok(calls.filter((call) => call.command === "append_standalone_package_upload_chunk").length > 1);
  assert.ok(progress.length > 1);
  assert.equal(progress.at(-1).uploadedBytes, 9 * 1024 * 1024 + 17);
  assert.equal(progress.at(-1).percent, 100);
}

async function testOptionalIconUsesTheSameBoundedProtocol() {
  globalThis.window = { __TAURI_INTERNALS__: {} };
  const written = { cartridge: 0, icon: 0 };
  globalThis.__agentvnInvoke = async (command, args = {}) => {
    if (command === "begin_standalone_package_upload") {
      assert.equal(args.expectedSize, 512 * 1024 + 7);
      assert.equal(args.expectedIconSize, 1024 * 1024 + 3);
      assert.equal(args.iconFileName, "cover.png");
      return { uploadId: "standalone-upload-icon" };
    }
    if (command === "append_standalone_package_upload_chunk") {
      assert.ok(args.chunkBytes.length <= CHUNK_BYTES);
      assert.equal(args.offsetBytes, written[args.fileKind]);
      written[args.fileKind] += args.chunkBytes.length;
      return { writtenBytes: written[args.fileKind] };
    }
    if (command === "build_standalone_package_from_upload") {
      return {
        ok: true,
        status: "PASS",
        message: "done",
        artifacts: [],
        warnings: [],
        verifyReportPath: "",
        buildLogPath: "",
        manifestPath: "",
      };
    }
    if (command === "abort_standalone_package_upload") return undefined;
    throw new Error(`Unexpected Tauri command: ${command}`);
  };
  const { buildStandalonePackage } = await loadStandalonePackageModule();
  const progress = [];
  await buildStandalonePackage({
    targetPlatform: "windows",
    outputDir: "D:\\AgentVN_test_installer",
    cartridge: new Blob([new Uint8Array(512 * 1024 + 7)]),
    fileName: "icon.vncart",
    standaloneIcon: new Blob([new Uint8Array(1024 * 1024 + 3)]),
    standaloneIconFileName: "cover.png",
    onUploadProgress(event) {
      progress.push(event);
    },
  });
  assert.equal(written.cartridge, 512 * 1024 + 7);
  assert.equal(written.icon, 1024 * 1024 + 3);
  assert.equal(progress.at(-1).fileKind, "icon");
  assert.equal(progress.at(-1).percent, 100);
}

async function testFailedChunkAbortsTheUpload() {
  globalThis.window = { __TAURI_INTERNALS__: {} };
  const calls = [];
  globalThis.__agentvnInvoke = async (command) => {
    calls.push(command);
    if (command === "begin_standalone_package_upload") return { uploadId: "standalone-upload-fail" };
    if (command === "append_standalone_package_upload_chunk") throw new Error("disk full");
    if (command === "abort_standalone_package_upload") return undefined;
    throw new Error(`Unexpected Tauri command: ${command}`);
  };
  const { buildStandalonePackage } = await loadStandalonePackageModule();
  await assert.rejects(
    buildStandalonePackage({
      targetPlatform: "android",
      outputDir: "D:\\AgentVN_test_installer",
      cartridge: new Blob([new Uint8Array(1024)]),
      fileName: "failure.vncart",
    }),
    /disk full/,
  );
  assert.equal(calls.filter((command) => command === "abort_standalone_package_upload").length, 1);
}

async function testOldDesktopHostGetsAnExplicitRestartError() {
  globalThis.window = { __TAURI_INTERNALS__: {} };
  globalThis.__agentvnInvoke = async (command) => {
    if (command === "begin_standalone_package_upload") {
      throw new Error("Command begin_standalone_package_upload not found");
    }
    throw new Error(`Unexpected Tauri command: ${command}`);
  };
  const { buildStandalonePackage } = await loadStandalonePackageModule();
  await assert.rejects(
    buildStandalonePackage({
      targetPlatform: "windows",
      outputDir: "D:\\AgentVN_test_installer",
      cartridge: new Blob([new Uint8Array(1024)]),
      fileName: "old-host.vncart",
    }),
    /重新构建并重启 AgentVN 桌面端/,
  );
}

async function testFileBackedCartridgeUsesNativeDiskPath() {
  globalThis.window = { __TAURI_INTERNALS__: {} };
  const calls = [];
  globalThis.__agentvnInvoke = async (command, args = {}) => {
    calls.push({ command, args });
    if (command !== "build_standalone_package_from_files") {
      throw new Error(`Unexpected in-memory cartridge upload: ${command}`);
    }
    return { ok: true, status: "PASS", artifacts: [], warnings: [] };
  };
  const {
    buildStandalonePackageFromFiles,
    canBuildStandaloneFromFileBackedAssets,
  } = await loadStandalonePackageModule();
  const directory = {
    fileName: "隐忍的成长.vncart",
    textFiles: [
      { path: "manifest.json", contents: '{"assets":[{"path":"assets/测试.png"}]}' },
      { path: "script.json", contents: "{}" },
    ],
    assets: [{
      cartridgePath: "assets/测试.png",
      assetId: "background",
      sourceFilePath: "D:\\项目 素材\\测试.png",
      expectedSize: 513 * 1024 * 1024,
    }],
  };
  assert.equal(canBuildStandaloneFromFileBackedAssets(directory), true);
  const result = await buildStandalonePackageFromFiles({
    targetPlatform: "android",
    outputDir: "D:\\验收 输出",
    directory,
    releaseIdentity: { schemaVersion: 1, title: "隐忍的成长", gameId: "growth", versionName: "0.1.0", versionCode: 1, androidApplicationId: "com.agentvn.growth" },
  });
  assert.equal(result.status, "PASS");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.assets, [{
    path: "assets/测试.png",
    sourceFilePath: "D:\\项目 素材\\测试.png",
  }]);
  assert.equal(calls[0].args.outputDir, "D:\\验收 输出");
  assert.equal(calls[0].args.iconBytes, undefined);
  assert.equal(canBuildStandaloneFromFileBackedAssets({
    ...directory,
    assets: [...directory.assets, { cartridgePath: "assets/local.png", data: new Uint8Array([1]) }],
  }), false);
  globalThis.window = {};
  assert.equal(canBuildStandaloneFromFileBackedAssets(directory), false);
}

Promise.resolve()
  .then(testLargeCartridgeUsesBoundedChunks)
  .then(testOptionalIconUsesTheSameBoundedProtocol)
  .then(testFailedChunkAbortsTheUpload)
  .then(testOldDesktopHostGetsAnExplicitRestartError)
  .then(testFileBackedCartridgeUsesNativeDiskPath)
  .then(() => console.log("package standalone upload contract: PASS"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
