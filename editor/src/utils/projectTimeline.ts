import type { EditorProjectFile } from "../types/nodes";
import { stripEmbeddedAssetPayloadsFromProject } from "./embeddedAssetPayloads";

export const projectTimelineRecentLimit = 10;

export interface ProjectBackupEntry {
  file_name: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  timestamp_ms: number;
  node_count: number | null;
  edge_count: number | null;
  trigger: string;
  content_hash?: string | null;
}

export class TimelineUnavailableError extends Error {
  constructor() {
    super("文件式时间线需要在 AgentVN 桌面版中使用。");
    this.name = "TimelineUnavailableError";
  }
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) throw new TimelineUnavailableError();
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<T>(command, args);
}

export function serializeProjectForTimeline(project: EditorProjectFile): string {
  return JSON.stringify(stripEmbeddedAssetPayloadsFromProject(project), null, 2);
}

async function sha256Hex(value: string): Promise<string | undefined> {
  if (!window.crypto?.subtle) return undefined;
  const bytes = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function listProjectBackups(projectId: string): Promise<ProjectBackupEntry[]> {
  const entries = await invokeTauri<ProjectBackupEntry[]>("list_project_backups", { projectId });
  return entries.slice(0, projectTimelineRecentLimit);
}

export async function readProjectBackup(fileName: string): Promise<string> {
  return await invokeTauri<string>("read_project_backup", { fileName });
}

export async function writeProjectBackup(project: EditorProjectFile, trigger: string): Promise<ProjectBackupEntry> {
  return await invokeTauri<ProjectBackupEntry>("write_project_backup", {
    projectJson: serializeProjectForTimeline(project),
    trigger,
  });
}

export async function writeProjectBackupIfChanged(project: EditorProjectFile, trigger: string): Promise<ProjectBackupEntry | undefined> {
  const currentJson = serializeProjectForTimeline(project);
  const backups = await listProjectBackups(project.project_id);
  const latest = backups[0];
  if (latest?.content_hash) {
    const currentHash = await sha256Hex(currentJson);
    if (currentHash && latest.content_hash === currentHash) return undefined;
  }
  return await invokeTauri<ProjectBackupEntry>("write_project_backup", {
    projectJson: currentJson,
    trigger,
  });
}
