"use strict";
const fs = require("node:fs"), crypto = require("node:crypto");
function inspect(file) {
  const bytes = fs.readFileSync(file);
  return { bytes: bytes.length, zipMagic: bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}
function captureWebViewBinary({ packageName, outputFile, sourceApk }, { execute, exists = fs.existsSync, inspect: inspectFile = inspect }) {
  if (!/^com\.google\.android\.trichromelibrary_\d+$/.test(packageName)) throw Error("PACKAGE_INVALID");
  if (exists(outputFile)) throw Error("PRESERVE_EVIDENCE");
  const run = args => {
    const result = execute(args);
    if (result.status !== 0 || result.error) throw Error(`WEBVIEW_READ_FAILED:exit=${result.status}:${JSON.stringify(args)}:${result.error || result.stderr || result.stdout}`);
    return result;
  };
  const source = sourceApk ? { stdout: `package:${sourceApk}` } : run(["shell", "pm", "path", packageName]);
  const lines = String(source.stdout || "").trim().split(/\r?\n/);
  const remote = lines[0]?.replace(/^package:/, "");
  if (lines.length !== 1 || !lines[0].startsWith("package:")
      || !/^\/(?:data\/app|product\/app|system\/app|system_ext\/app)\/[a-zA-Z0-9_~+=./-]+\/(?:TrichromeLibrary|base)\.apk$/.test(remote)
      || remote.split("/").includes("..")) throw Error("WEBVIEW_PATH_INVALID");
  const metadata = run(["shell", "dumpsys", "package", packageName]);
  const provider = run(["shell", "dumpsys", "webviewupdate"]);
  const pulled = run(["pull", remote, outputFile]);
  const binary = inspectFile(outputFile);
  if (!binary.zipMagic) throw Error("INVALID_APK_HEADER");
  return { status: "CAPTURED_REQUIRES_REVIEW", packageName, remote, path: outputFile,
    ...binary, packageMetadata: String(metadata.stdout || ""), provider: String(provider.stdout || ""),
    sourceSelection: sourceApk ? "prior-observed-exact-mapped-apk" : "package-manager",
    pullStdout: String(pulled.stdout || ""), pullStderr: String(pulled.stderr || ""),
    limitation: "Read-only installed provider binary; function attribution requires exact ELF and address review" };
}
module.exports = { captureWebViewBinary };
