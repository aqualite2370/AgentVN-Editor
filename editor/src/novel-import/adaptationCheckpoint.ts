import { stableSerialize } from "../utils/stableSerialize";
import type { AdaptSceneRequest, AdaptSceneResponse, NovelAdaptationCheckpoint, NovelImportSession } from "./types";

export function mergeCachedAdaptationCheckpoints(current: NovelImportSession, cached?: NovelImportSession): NovelImportSession {
  if (!current.document || !cached?.document || current.session_id !== cached.session_id
      || current.document.document_id !== cached.document.document_id) return current;
  const completed = new Set(current.adapted_scenes.map(scene => scene.source_scene_candidate_id));
  const planned = new Set(current.scenes.map(scene => scene.scene_candidate_id));
  const existing = current.adaptation_checkpoints ?? {};
  const missing = Object.entries(cached.adaptation_checkpoints ?? {}).filter(([id, checkpoint]) =>
    planned.has(id) && !completed.has(id)
    && (!existing[id] || (!existing[id].response && checkpoint?.response && existing[id].inputFingerprint === checkpoint.inputFingerprint))
    && typeof checkpoint?.inputFingerprint === "string"
    && (checkpoint.response?.adapted_scene?.source_scene_candidate_id === id
      || (checkpoint.partial?.candidateId === id && checkpoint.partial.documentId === current.document?.document_id)),
  );
  return missing.length ? { ...current, adaptation_checkpoints: { ...existing, ...Object.fromEntries(missing) } } : current;
}

export async function adaptationInputFingerprint(request: AdaptSceneRequest & { outline_summary?: string }, modelName: string): Promise<string> {
  // Credentials and transport parameters never enter the saved receipt.
  const text = stableSerialize({ modelName, scene: request.scene_candidate, characters: request.known_characters,
    previous: request.previous_scene_summary, outline: request.outline_summary,
    options: request.import_options, memory: request.memory_mode });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function verifiedAdaptationCheckpoint(checkpoint: NovelAdaptationCheckpoint | undefined,
  fingerprint: string, request: AdaptSceneRequest, documentId: string): AdaptSceneResponse | undefined {
  if (!checkpoint) return undefined;
  if (!checkpoint.response && checkpoint.partial) {
    if (checkpoint.inputFingerprint !== fingerprint || checkpoint.partial.candidateId !== request.scene_candidate.scene_candidate_id
      || checkpoint.partial.documentId !== documentId) {
      throw new Error("已保存的场景主结果与当前原文或上下文不匹配，已停止续接；原结果保留，未重新请求模型。");
    }
    return undefined;
  }
  const scene = request.scene_candidate, adapted = checkpoint.response?.adapted_scene, mapping = adapted?.source_mapping;
  // The existing backend raw protocol uses the chapter ID here; the normal
  // blueprint validator replaces it with the authoritative document ID.
  const sourceIdentityMatches = mapping?.document_id === documentId || mapping?.document_id === scene.chapter_id;
  if (checkpoint.inputFingerprint !== fingerprint || adapted?.source_scene_candidate_id !== scene.scene_candidate_id
    || !sourceIdentityMatches || mapping?.start_offset !== scene.start_offset
    || mapping.end_offset !== scene.end_offset || mapping.source_excerpt !== scene.source_excerpt) {
    throw new Error("已保存的场景返回与当前原文或上下文不匹配，已停止续接；原结果保留，未重新请求模型。");
  }
  return checkpoint.response;
}
