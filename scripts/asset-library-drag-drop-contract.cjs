const fs = require("node:fs");
const path = require("node:path");
const ts = require(path.join(__dirname, "../editor/node_modules/typescript"));

const root = path.resolve(__dirname, "..");
const helperPath = path.join(root, "editor/src/utils/assetLibraryInteractions.ts");
const panelPath = path.join(root, "editor/src/components/advanced/AssetLibraryPanel.tsx");
const cssPath = path.join(root, "editor/src/styles/layout.css");
const helperSource = fs.readFileSync(helperPath, "utf8");
const panelSource = fs.readFileSync(panelPath, "utf8");
const cssSource = fs.readFileSync(cssPath, "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sanitizeAssetId(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "asset";
}

function loadHelperModule() {
  const output = ts.transpileModule(helperSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: helperPath,
  }).outputText;
  const moduleRecord = { exports: {} };
  const localRequire = (request) => {
    if (request === "./projectAssets") return { sanitizeAssetId };
    throw new Error(`Unexpected helper dependency: ${request}`);
  };
  new Function("require", "module", "exports", output)(localRequire, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

const {
  applyAssetLibraryDrop,
  physicalPointToCssPoint,
  putImportedAssetsInFolder,
  uniqueLibraryAssetId,
} = loadHelperModule();

const folders = [
  { folder_id: "folder_a", name: "A", parent_folder_id: null, created_at: "", updated_at: "" },
  { folder_id: "folder_b", name: "B", parent_folder_id: null, created_at: "", updated_at: "" },
];

const emptyLibrary = { folders, assetLocations: {} };
const moved = applyAssetLibraryDrop(
  emptyLibrary,
  { assetIds: ["one", "two"], sourceFolderId: null },
  "folder_a",
  "move",
);
assert(moved.changedAssetIds.length === 2, "Multi-selection drag should move every selected asset.");
assert(moved.library.assetLocations.one.primaryFolderId === "folder_a", "Move should update the primary folder.");

const linked = applyAssetLibraryDrop(
  moved.library,
  { assetIds: ["one"], sourceFolderId: "folder_a" },
  "folder_b",
  "link",
);
assert(linked.library.assetLocations.one.primaryFolderId === "folder_a", "Ctrl-copy must preserve the primary folder.");
assert(linked.library.assetLocations.one.linkedFolderIds.includes("folder_b"), "Ctrl-copy must add a linked folder.");

const duplicateLink = applyAssetLibraryDrop(
  linked.library,
  { assetIds: ["one"], sourceFolderId: "folder_a" },
  "folder_b",
  "link",
);
assert(duplicateLink.changedAssetIds.length === 0, "Dropping the same link twice should be a no-op.");
assert(duplicateLink.skippedAssetIds.includes("one"), "Duplicate links should be reported as skipped.");

const invalidRootLink = applyAssetLibraryDrop(
  linked.library,
  { assetIds: ["one"], sourceFolderId: "folder_a" },
  null,
  "link",
);
assert(invalidRootLink.changedAssetIds.length === 0, "The unfiled root cannot be a linked classification.");

const linkedSourceLibrary = {
  folders,
  assetLocations: {
    one: { primaryFolderId: null, linkedFolderIds: ["folder_a"] },
  },
};
const movedFromLink = applyAssetLibraryDrop(
  linkedSourceLibrary,
  { assetIds: ["one"], sourceFolderId: "folder_a" },
  "folder_b",
  "move",
);
assert(movedFromLink.library.assetLocations.one.primaryFolderId === "folder_b", "Move from a linked view should set the new primary folder.");
assert(!movedFromLink.library.assetLocations.one.linkedFolderIds.includes("folder_a"), "Move should remove the source linked classification.");

const returnedToRoot = applyAssetLibraryDrop(
  moved.library,
  { assetIds: ["one"], sourceFolderId: "folder_a" },
  null,
  "move",
);
assert(!returnedToRoot.library.assetLocations.one, "Moving an otherwise unlinked asset to root should remove its location record.");

const imported = putImportedAssetsInFolder(emptyLibrary, [
  { assetId: "new_one", folderId: "folder_a" },
  { assetId: "new_two", folderId: null },
]);
assert(imported.assetLocations.new_one.primaryFolderId === "folder_a", "Batch import should place files in the requested folder.");
assert(!imported.assetLocations.new_two, "Unfiled imports should not create redundant location records.");

const usedIds = new Set(["scene", "scene_2"]);
assert(uniqueLibraryAssetId("scene.png", usedIds) === "scene_3", "Batch IDs should be unique against existing assets.");
assert(uniqueLibraryAssetId("scene.png", usedIds) === "scene_4", "Batch IDs should remain unique within the same import.");

assert(
  JSON.stringify(physicalPointToCssPoint(300, 180, 1.5)) === JSON.stringify({ x: 200, y: 120 }),
  "Tauri physical drop coordinates should be converted to CSS coordinates using the window scale factor.",
);
assert(
  JSON.stringify(physicalPointToCssPoint(25, 40, 0)) === JSON.stringify({ x: 25, y: 40 }),
  "Invalid scale factors should safely fall back to CSS pixel coordinates.",
);

for (const token of [
  "onImportMany",
  "getCurrentWebview().onDragDropEvent",
  "getCurrentWindow().scaleFactor",
  "if (disposed) nextUnlisten()",
  "unlisten?.()",
  "read_project_asset_file_bytes",
  "data-asset-drop-folder",
  "event.ctrlKey ? \"link\" : \"move\"",
  "aria-multiselectable=\"true\"",
  "role=\"status\" aria-live=\"polite\"",
  "suppressClickUntilRef",
  "JSON.parse(await file.text())",
]) {
  assert(panelSource.includes(token), `Asset library panel is missing required drag/drop contract: ${token}`);
}

for (const token of [
  ".asset-library-workspace",
  ".asset-library-sidebar",
  ".asset-folder-tree-row.is-drop-target",
  ".asset-card-preview.is-contain",
  ".asset-library-drop-banner",
  ".asset-library-workspace.is-drag-active",
  ".asset-library-content.is-importing",
]) {
  assert(cssSource.includes(token), `Asset library styles are missing required presentation contract: ${token}`);
}
assert(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{[\s\S]{0,600}\.asset-library-card/.test(cssSource),
  "Asset library drag states must respect reduced-motion preference.");

console.log("Asset library drag/drop contract passed.");
