import type { SharedEditorState } from "../api/types";
import type { NovelPersistenceState } from "../novel-import/types";
import { useEditorStore } from "../store/editorStore";
import { useNovelImportStore } from "../store/novelImportStore";
import { useProjectStore } from "../store/projectStore";
import type { EditorProjectFile } from "../types/nodes";

export function buildDraftFromSharedState(
  state: Pick<SharedEditorState, "project_graph" | "project_metadata">
): EditorProjectFile | undefined {
  const graph = state.project_graph;
  const metadata = state.project_metadata ?? {};
  if (!Array.isArray(graph?.nodes) || graph.nodes.length === 0) return undefined;
  return {
    schema_version: metadata.schemaVersion ?? "1.0.0",
    project_id: metadata.projectId ?? "project_local",
    title: metadata.title ?? "未命名视觉小说",
    author: metadata.author ?? "",
    nodes: graph.nodes,
    edges: graph.edges,
    viewport: graph.viewport,
    memory_mode: graph.memoryMode,
    asset_manifest: Array.isArray(metadata.assetManifest) ? metadata.assetManifest : [],
    editor_settings: metadata.settings ?? {},
    created_at: metadata.createdAt ?? new Date().toISOString(),
    updated_at: metadata.updatedAt ?? new Date().toISOString(),
  };
}

export function hydrateNovelImportFromProject(projectFile?: EditorProjectFile): void {
  useNovelImportStore.getState().hydratePersistence(
    projectFile?.editor_settings?.novelPersistence as NovelPersistenceState | undefined
  );
}

export function hydrateEditorFromProject(projectFile: EditorProjectFile): void {
  useEditorStore.getState().importProject(projectFile);
  useProjectStore.getState().loadProjectMetadata(projectFile);
  hydrateNovelImportFromProject(projectFile);
  useEditorStore.setState({ dirty: false });
}

export function hydrateEditorFromSharedState(
  state: Pick<SharedEditorState, "project_graph" | "project_metadata">
): EditorProjectFile | undefined {
  const draft = buildDraftFromSharedState(state);
  if (!draft) return undefined;
  hydrateEditorFromProject(draft);
  return draft;
}
