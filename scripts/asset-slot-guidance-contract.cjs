const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const picker = fs.readFileSync(path.join(root, "editor/src/components/common/AssetPicker.tsx"), "utf8");
const guidance = fs.readFileSync(path.join(root, "editor/src/utils/assetSlotGuidance.ts"), "utf8");
const css = fs.readFileSync(path.join(root, "editor/src/styles/layout.css"), "utf8");
for (const token of ["resolveAssetSlotGuidance", "assetSlotWarning", "asset-slot-guidance", "asset-picker-guidance-warning"]) {
  if (!(picker + guidance + css).includes(token)) throw new Error(`素材规格提示缺少 ${token}`);
}
for (const size of ["1920×1080", "1200×1800", "512×512", "1200×1600", "1024×1024"]) {
  if (!guidance.includes(size)) throw new Error(`缺少推荐尺寸 ${size}`);
}
console.log("asset slot guidance contract: PASS");
