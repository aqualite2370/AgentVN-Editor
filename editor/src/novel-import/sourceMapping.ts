import type { SceneBeat } from "../types/scene";
import type { SourceDocument, SourceMapping } from "./types";

export function splitsSurrogatePair(text: string, offset: number): boolean {
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

export function findSourceExcerpt(document: SourceDocument, start: number, end: number, limit = 600): string {
  const text = document.normalized_text;
  const stop = Math.min(end, start + limit);
  return text.slice(start, splitsSurrogatePair(text, stop) ? stop - 1 : stop);
}

export function createSourceMapping(document: SourceDocument, start: number, end: number, scene: SceneBeat): SourceMapping {
  return {
    document_id: document.document_id,
    start_offset: start,
    end_offset: end,
    source_excerpt: findSourceExcerpt(document, start, end),
    adapted_command_ids: scene.commands.map((command, index) => `${scene.scene_id}_cmd_${index}_${command.type}`),
  };
}

export function mapCommandToSourceRange(mapping: SourceMapping, commandIndex: number, commandCount: number): { start: number; end: number } {
  const span = Math.max(1, mapping.end_offset - mapping.start_offset);
  const step = Math.ceil(span / Math.max(1, commandCount));
  const start = mapping.start_offset + commandIndex * step;
  return { start, end: Math.min(mapping.end_offset, start + step) };
}

export function updateSourceMappingAfterEdit(mapping: SourceMapping, scene: SceneBeat): SourceMapping {
  return { ...mapping, adapted_command_ids: scene.commands.map((command, index) => `${scene.scene_id}_cmd_${index}_${command.type}`) };
}
