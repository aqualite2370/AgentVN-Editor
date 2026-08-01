import type { AdaptSceneResponse, NovelImportSession, SourceDocument } from "./types";

export function validateSourceDocument(document: SourceDocument): string[] {
  const errors: string[] = [];
  if (!document.normalized_text.trim()) errors.push("normalized_text is empty");
  if (document.total_chars !== document.normalized_text.length) errors.push("total_chars mismatch");
  return errors;
}

export function validateAdaptSceneResponse(response: AdaptSceneResponse): string[] {
  const errors: string[] = [];
  if (!response.adapted_scene.scene_beat.scene_id) errors.push("scene_id missing");
  if (response.branch_suggestions.some((item) => item.enabled_by_default)) errors.push("branch suggestions must not be enabled by default");
  return errors;
}

export function validateNoRawTextInRuntimeExport(value: unknown): boolean {
  const text = JSON.stringify(value);
  return !text.includes("raw_text") && !text.includes("normalized_text") && !text.includes("source_excerpt");
}

export function validateSession(session: NovelImportSession): string[] {
  if (!session.document) return ["document missing"];
  return validateSourceDocument(session.document);
}
