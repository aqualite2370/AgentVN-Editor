import { stableSerialize } from "../utils/stableSerialize";
import type { AdaptSceneRequest, AdaptSceneResponse, NovelAdaptationCheckpoint } from "./types";

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
