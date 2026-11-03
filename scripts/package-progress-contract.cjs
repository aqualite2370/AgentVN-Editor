const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "editor/src/cartridge/ExportCartridgePanel.tsx"), "utf8");
const sessionSource = fs.readFileSync(path.join(root, "editor/src/packaging/packageTaskSession.ts"), "utf8");
const css = fs.readFileSync(path.join(root, "editor/src/styles/layout.css"), "utf8");
for (const token of [
  "percent: number",
  "exportProgressStepRef",
  "<progress value={exportProgress.percent}",
  "export-progress-card",
  '"传输卡带"',
  "formatUploadMiB(progress.uploadedBytes)",
  "formatUploadMiB(progress.totalBytes)",
  "onUploadProgress:",
]) {
  if (!(source + sessionSource + css).includes(token)) throw new Error(`打包进度缺少 ${token}`);
}
console.log("package progress contract: PASS");
