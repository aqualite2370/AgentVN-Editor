const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const projectAssets = fs.readFileSync(path.join(root, "editor/src/utils/projectAssets.ts"), "utf8");
const assetLibraryPanel = fs.readFileSync(path.join(root, "editor/src/components/advanced/AssetLibraryPanel.tsx"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /export function isImagePreviewSource/.test(projectAssets),
  "Project asset utilities must expose a shared image preview source detector.",
);

for (const requiredPattern of [
  /startsWith\("data:image\/"\)/,
  /mimeType\.startsWith\("image\/"\)/,
  /imageFileExtensionPattern\.test\(value\)/,
  /value\.startsWith\("blob:"\)/,
]) {
  assert(requiredPattern.test(projectAssets), `Image preview detector is missing coverage for ${requiredPattern}.`);
}

assert(
  /isImagePreviewSource\(pendingImport\.dataUrl/.test(assetLibraryPanel),
  "Pending imported assets should use the shared image preview source detector.",
);

assert(
  /isImagePreviewSource\(asset\.preview_url/.test(assetLibraryPanel),
  "Persisted asset library cards should use the shared image preview source detector.",
);

assert(
  !/function isImageDataUrl/.test(assetLibraryPanel),
  "Asset library cards must not use a data-url-only image detector.",
);

console.log("Asset library preview source contract passed.");
