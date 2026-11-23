import { backendClient } from "../api/backendClient";
import { useEditorStore } from "../store/editorStore";
import { useProjectStore } from "../store/projectStore";
import { hydrateNovelImportFromProject } from "../app/projectHydration";
import type { EditorProjectFile } from "../types/nodes";
import { writeProjectBackup } from "./projectTimeline";
import { countEmbeddedAssetPayloads } from "./embeddedAssetPayloads";
import { stableSerialize } from "./stableSerialize";

export class EditorSaveSupersededError extends Error {
  constructor() {
    super("工程已重新载入或内容发生变化，本次操作未应用。");
    this.name = "EditorSaveSupersededError";
  }
}

export function editorProjectOwner() {
  return {
    projectId: useProjectStore.getState().projectId,
    generation: useEditorStore.getState().projectLoadGeneration,
  };
}

export function ownsEditorProject(owner: ReturnType<typeof editorProjectOwner>): boolean {
  const current = editorProjectOwner();
  return owner.projectId === current.projectId && owner.generation === current.generation;
}

export function captureEditorProject(): EditorProjectFile {
  const project = useProjectStore.getState();
  return useEditorStore.getState().exportProject({
    projectId: project.projectId, title: project.title, author: project.author,
    assetManifest: project.assetManifest, editorSettings: { ...project.settings }, createdAt: project.createdAt,
  });
}

function graphMatches(snapshot: ReturnType<typeof useEditorStore.getState>): boolean {
  const current = useEditorStore.getState();
  return current.nodes === snapshot.nodes && current.edges === snapshot.edges
    && current.viewport === snapshot.viewport && current.memoryMode === snapshot.memoryMode
    && current.projectLoadGeneration === snapshot.projectLoadGeneration;
}

function metadataMatches(snapshot: ReturnType<typeof useProjectStore.getState>): boolean {
  const current = useProjectStore.getState();
  return current.projectId === snapshot.projectId && current.title === snapshot.title
    && current.author === snapshot.author && current.createdAt === snapshot.createdAt
    && current.settings === snapshot.settings && current.assetManifest === snapshot.assetManifest;
}

/** A restore belongs to the content present when the user confirmed it. */
export function captureEditorProjectRevision() {
  return {
    owner: editorProjectOwner(),
    graph: useEditorStore.getState(),
    metadata: useProjectStore.getState(),
  };
}

export function assertEditorProjectRevision(revision: ReturnType<typeof captureEditorProjectRevision>): void {
  const metadata = useProjectStore.getState();
  const samePersistedValue = (a: unknown, b: unknown) => a === b
    || stableSerialize(JSON.parse(JSON.stringify(a))) === stableSerialize(JSON.parse(JSON.stringify(b)));
  // Controllers may normalize an unchanged settings object. Compare its
  // persisted content rather than treating a new object reference as an edit.
  const metadataUnchanged = metadataMatches(revision.metadata) || (
    metadata.projectId === revision.metadata.projectId && metadata.title === revision.metadata.title
    && metadata.author === revision.metadata.author && metadata.createdAt === revision.metadata.createdAt
    && samePersistedValue(metadata.settings, revision.metadata.settings)
    && samePersistedValue(metadata.assetManifest, revision.metadata.assetManifest));
  if (!ownsEditorProject(revision.owner) || !graphMatches(revision.graph)
    || !metadataUnchanged) throw new EditorSaveSupersededError();
}

/** Read at the head of the shared write queue, and acknowledge only that exact revision. */
export async function persistEditorProject(expectedRevision?: ReturnType<typeof captureEditorProjectRevision>) {
  const owner = editorProjectOwner();
  let submitted: ReturnType<typeof useEditorStore.getState> | undefined;
  let metadata: ReturnType<typeof useProjectStore.getState> | undefined;
  let snapshot: EditorProjectFile | undefined;
  let acknowledgedRevision: ReturnType<typeof captureEditorProjectRevision> | undefined;
  const state = await backendClient.saveProjectState(() => {
    if (!ownsEditorProject(owner)) throw new EditorSaveSupersededError();
    if (expectedRevision) assertEditorProjectRevision(expectedRevision);
    submitted = useEditorStore.getState();
    metadata = useProjectStore.getState();
    snapshot = captureEditorProject();
    return {
      project_graph: { nodes: snapshot.nodes, edges: snapshot.edges, viewport: snapshot.viewport, memoryMode: snapshot.memory_mode },
      project_metadata: {
        projectId: snapshot.project_id, title: snapshot.title, author: snapshot.author,
        createdAt: snapshot.created_at, updatedAt: snapshot.updated_at,
        assetManifest: snapshot.asset_manifest, settings: snapshot.editor_settings,
      },
    };
  }, { onPersisted: persisted => {
    if (!ownsEditorProject(owner) || !submitted || !metadata) return;
    if (expectedRevision) assertEditorProjectRevision(expectedRevision);
    const current = useProjectStore.getState();
    const incoming = persisted.project_metadata;
    if (incoming.projectId !== owner.projectId) throw new Error("保存响应的工程归属不匹配。");
    // Materialized URLs may replace embedded bytes, but never restore older author edits.
    const incomingAssets = incoming.assetManifest as typeof current.assetManifest | undefined;
    const assetsChanged = Array.isArray(incomingAssets) && (
      current.assetManifest.length !== incomingAssets.length
      || current.assetManifest.some(asset => Boolean(asset.metadata.data_url || asset.metadata.blob_url))
      || incomingAssets.some((asset, index) => asset.metadata.url !== current.assetManifest[index]?.metadata.url));
    const acceptAssets = current.assetManifest === metadata.assetManifest && assetsChanged;
    const acceptSettings = current.settings === metadata.settings && Boolean(incoming.settings)
      && countEmbeddedAssetPayloads(current.settings).count > 0;
    if (acceptAssets || acceptSettings) {
      current.loadProjectMetadata({
        project_id: current.projectId, title: current.title, author: current.author,
        created_at: current.createdAt, updated_at: current.updatedAt,
        asset_manifest: acceptAssets ? incoming.assetManifest : current.assetManifest,
        editor_settings: acceptSettings ? incoming.settings : { ...current.settings },
      });
    }
    if (snapshot) {
      snapshot = {
        ...snapshot,
        asset_manifest: incomingAssets ?? snapshot.asset_manifest,
        editor_settings: incoming.settings ?? snapshot.editor_settings,
      };
    }
    if (graphMatches(submitted) && (metadataMatches(metadata)
      || ((acceptAssets || acceptSettings) && current.title === metadata.title && current.author === metadata.author
        && (acceptAssets || current.assetManifest === metadata.assetManifest)
        && (acceptSettings || current.settings === metadata.settings)))) useEditorStore.setState({ dirty: false });
    // Keep the exact acknowledged revision, including our own materialized URLs.
    // A later author edit must not become the baseline of a pending restore.
    acknowledgedRevision = captureEditorProjectRevision();
  } });
  if (!ownsEditorProject(owner) || !submitted || !snapshot || !acknowledgedRevision) throw new EditorSaveSupersededError();
  if (expectedRevision) assertEditorProjectRevision(acknowledgedRevision);
  return { state, snapshot, wasDirty: submitted.dirty, owner, revision: acknowledgedRevision };
}

/** Backup is a prerequisite; apply inside the write queue before any queued autosave snapshots. */
export async function restoreEditorTimelineProject(project: EditorProjectFile): Promise<void> {
  const confirmed = captureEditorProjectRevision();
  const owner = confirmed.owner;
  if (project.project_id !== owner.projectId) throw new Error("该时间线记录不属于当前工程。");
  let saved: Awaited<ReturnType<typeof persistEditorProject>>;
  try {
    saved = await persistEditorProject(confirmed);
    assertEditorProjectRevision(saved.revision);
  } catch (error) {
    // The first save may already have written its older snapshot. Preserve the
    // newer local content through the same queue, without applying the restore.
    if (ownsEditorProject(owner) && error instanceof EditorSaveSupersededError) await persistEditorProject();
    throw error;
  }
  await writeProjectBackup(captureEditorProject(), "before_restore");
  const assertBaseline = () => assertEditorProjectRevision(saved.revision);
  assertBaseline();
  try {
    await backendClient.saveProjectState(() => {
      assertBaseline();
      return {
        project_graph: { nodes: project.nodes, edges: project.edges, viewport: project.viewport, memoryMode: project.memory_mode },
        project_metadata: {
          projectId: project.project_id, title: project.title, author: project.author,
          createdAt: project.created_at, updatedAt: new Date().toISOString(),
          assetManifest: project.asset_manifest, settings: project.editor_settings,
        },
      };
    }, { onPersisted: persisted => {
      assertBaseline();
      const saved: EditorProjectFile = {
        ...project,
        asset_manifest: persisted.project_metadata.assetManifest ?? project.asset_manifest,
        editor_settings: persisted.project_metadata.settings ?? project.editor_settings,
      };
      useEditorStore.getState().importProject(saved);
      useProjectStore.getState().loadProjectMetadata(saved);
      hydrateNovelImportFromProject(saved);
    } });
  } catch (error) {
    // A local edit made while the restore request was in flight wins. Re-persist
    // it through the same queue instead of leaving disk at a rejected snapshot.
    if (ownsEditorProject(owner) && error instanceof EditorSaveSupersededError) {
      await persistEditorProject();
    }
    throw error;
  }
}
