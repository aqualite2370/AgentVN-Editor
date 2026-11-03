const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start === -1 || end === -1) return "";
  return source.slice(start, end);
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(`novel-import-append-graph-contract-test failed: ${message}`);
  }
}

const nodeTypes = read("editor/src/types/nodes.ts");
const novelImportStore = read("editor/src/store/novelImportStore.ts");
const novelTypes = read("editor/src/novel-import/types.ts");
const taskWorkbench = read("editor/src/components/novel-import/NovelProcessTaskWorkbench.tsx");

const jobImportSection = section(novelImportStore, "importNovelProcessJobResults: async", "splitScenes:");
const generateBlueprintSection = section(novelImportStore, "generateBlueprintLine: async", "pauseBlueprintGeneration");

expect(
  /export type GraphImportMode = "blank_autoconnect" \| "append_isolated";/.test(nodeTypes),
  "EditorMeta must expose the two graph import modes",
);
expect(
  /sourceProcessJobId\?: string;/.test(nodeTypes) && /graphImportMode\?: GraphImportMode;/.test(nodeTypes),
  "imported graph nodes must retain sourceProcessJobId and graphImportMode metadata",
);
expect(
  /graphImportMode\?: "blank_autoconnect" \| "append_isolated";/.test(novelTypes),
  "progressive import jobs must persist their graph import mode across pause/resume",
);
expect(
  /layoutStartPosition\?: \{ x: number; y: number \};/.test(novelTypes) &&
    /layoutColumnGap\?: number;/.test(novelTypes) &&
    /layoutRowGap\?: number;/.test(novelTypes) &&
    /layoutColumns\?: number;/.test(novelTypes),
  "progressive import jobs must persist their import-line layout across pause/resume",
);

expect(
  /function resolveNovelGraphImportMode/.test(novelImportStore) &&
    /isBlankMainLine\(\) \? "blank_autoconnect" : "append_isolated"/.test(novelImportStore),
  "graph import mode must be decided by blank-vs-existing blueprint state",
);
expect(
  /mode === "blank_autoconnect" \? "start" : undefined/.test(novelImportStore),
  "append_isolated imports must not create a first edge from existing graph nodes",
);
expect(
  /function graphBaseForImportMode/.test(novelImportStore) &&
    /mode === "blank_autoconnect" \? removeDefaultOpeningLine\(nodes, edges\) : \{ nodes, edges \}/.test(novelImportStore),
  "only blank_autoconnect may remove the default opening line",
);

expect(
  /findExistingProcessJobImport\(jobId\)/.test(jobImportSection),
  "real process job import must check whether the job was already written",
);
expect(
  /importedProcessChapterIndexes\(jobId\)/.test(jobImportSection) &&
    /!importedChapterIndexes\.has\(result\.chapterIndex\)/.test(jobImportSection) &&
    jobImportSection.indexOf("!importedChapterIndexes.has(result.chapterIndex)") <
      jobImportSection.indexOf("polishProcessScenes(uniqueScenes"),
  "already imported chapters must be filtered before model processing and graph writes; reading current results is necessary to discover recovered chapters",
);
expect(
  /hasLegacyProcessJobImport\(jobId\)/.test(jobImportSection) &&
    jobImportSection.indexOf("if (scenes.length === 0)") < jobImportSection.indexOf("polishProcessScenes(uniqueScenes"),
  "legacy imports and unchanged results must return without model processing or graph mutation",
);
expect(
  /sourceProcessJobId: jobId/.test(jobImportSection) &&
    /withNovelGraphMetadata/.test(jobImportSection),
  "real process job nodes must be tagged with their source job id",
);
expect(
  /nodes: \[\.\.\.base\.nodes, \.\.\.nodes\]/.test(jobImportSection) &&
    /edges: \[\.\.\.base\.edges, \.\.\.edges\]/.test(jobImportSection),
  "real process job import must append nodes and edges instead of replacing the graph",
);

expect(
  !/getSpawnPosition\("scene"\)/.test(generateBlueprintSection),
  "progressive blueprint generation must not place appended import nodes by viewport spawn position",
);
expect(
  /withNovelGraphMetadata/.test(generateBlueprintSection) &&
    /importedNovelLineEdges\(layout, \[node\], graphImportMode, lastInsertedNodeId, index\)/.test(generateBlueprintSection),
  "progressive blueprint generation must use the shared import metadata and line-edge builder",
);
expect(
  /layoutStartPosition: layout\.startPosition/.test(generateBlueprintSection) &&
    /layoutColumnGap: layout\.columnGap/.test(generateBlueprintSection) &&
    /layoutRowGap: layout\.rowGap/.test(generateBlueprintSection) &&
    /layoutColumns: layout\.columns/.test(generateBlueprintSection),
  "progressive blueprint jobs must snapshot the import-line layout",
);
expect(
  /graphBaseForImportMode\(graphImportMode, editor\.nodes, editor\.edges\)/.test(generateBlueprintSection),
  "progressive blueprint generation must use the same append-vs-autoconnect base graph rule",
);

expect(
  /const importResult =/.test(taskWorkbench) &&
    /importResult\?\.lastInsertedNodeId/.test(taskWorkbench) &&
    /setActionMessage\(importResult\?\.notice/.test(taskWorkbench),
  "task workbench must display structured import notices and avoid treating import results as plain node ids",
);

console.log("novel-import-append-graph-contract-test: ok");
