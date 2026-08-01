import { normalizeText, chunkText } from "./textChunker";
import { splitChapters } from "./chapterSplitter";
import { splitScenes } from "./sceneSplitter";
import { mergeCharacters } from "./speakerDetector";
import { createSourceMapping } from "./sourceMapping";
import { validateAdaptSceneResponse, validateNoRawTextInRuntimeExport } from "./validation";
import { adaptSceneMock } from "./adaptationClient";
import { runChapterSplitterFixtureSuite } from "./chapterSplitter.samples";
import type { SourceDocument } from "./types";

export async function runNovelImportVerification(): Promise<string[]> {
  const text = normalizeText("# 第一章\n\nAlice说：“你好。”\n\n第二天，Bob说：“走吧。”");
  const doc: SourceDocument = { document_id: "doc", title: "t", file_name: "t.md", file_type: "md", language: "zh-CN", raw_text: text, normalized_text: text, imported_at: new Date().toISOString(), total_chars: text.length, metadata: {} };
  const chunks = chunkText("doc", text, 40, 0);
  const chapters = splitChapters(text);
  const scenes = splitScenes(text, chapters, 40);
  const merged = mergeCharacters({ character_id: "alice", name: "Alice", aliases: [], first_seen_offset: 0, description: "", confidence: 0.5 }, { character_id: "a", name: "A", aliases: [], first_seen_offset: 10, description: "", confidence: 0.7 });
  const adapted = await adaptSceneMock({ scene_candidate: scenes[0], known_characters: [], import_options: { language: "zh-CN", target_style: "vn", preserve_original_dialogue: true, narration_density: "medium", split_scene_aggressiveness: "medium", generate_background_hints: true, generate_sprite_hints: true, generate_bgm_hints: false, generate_animation_hints: false, memory_mode: "none", max_chunk_chars: 1000, max_scene_chars: 500, allow_branch_suggestions: false }, memory_mode: "none" }, doc);
  const mapping = createSourceMapping(doc, 0, 10, adapted.adapted_scene.scene_beat);
  const chapterSplitterFixtures = await runChapterSplitterFixtureSuite();
  return [
    `chunk:${chunks.length > 0}`,
    `chapters:${chapters.length > 0}`,
    `scenes:${scenes.length > 0}`,
    `merge:${merged.aliases.length > 0}`,
    `mapping:${mapping.start_offset === 0}`,
    `adapt:${validateAdaptSceneResponse(adapted).length === 0}`,
    `no_raw_export:${validateNoRawTextInRuntimeExport(adapted.adapted_scene.scene_beat)}`,
    ...chapterSplitterFixtures,
  ];
}
