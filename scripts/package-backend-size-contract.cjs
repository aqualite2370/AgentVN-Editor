const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "scripts", "build-backend-sidecar.ps1"), "utf8");

if (/--collect-submodules\s+app/.test(source) || /--collect-submodules\s+sqlite_vec/.test(source)) {
  throw new Error("Backend packaging must not collect every app/sqlite_vec submodule; this creates an oversized one-file executable.");
}
for (const token of ["--hidden-import sqlite_vec", "--collect-binaries sqlite_vec"]) {
  if (!source.includes(token)) throw new Error(`Backend packaging is missing ${token}`);
}
for (const moduleName of [
  "torch",
  "torchvision",
  "torchaudio",
  "pandas",
  "scipy",
  "sklearn",
  "numba",
  "matplotlib",
  "pygame",
  "playwright",
  "onnxruntime",
]) {
  const token = `--exclude-module ${moduleName}`;
  if (!source.includes(token)) throw new Error(`Backend packaging is missing ${token}`);
}

console.log("PASS backend packaging uses bounded PyInstaller collection");
