import { nanoid } from "nanoid";
import { detectCharacters } from "./speakerDetector";
import type { ChapterCandidate, SceneCandidate } from "./types";

const transitionPattern = /(第二天|当晚|与此同时|片刻后|不久后|清晨|黄昏|夜里|车站|教室|房间|街道|门外)/;

export function splitScenes(text: string, chapters: ChapterCandidate[], maxSceneChars = 2200): SceneCandidate[] {
  const scenes: SceneCandidate[] = [];
  for (const chapter of chapters) {
    const chapterText = text.slice(chapter.start_offset, chapter.end_offset);
    const paragraphs = chapterText.split(/\n{2,}/).filter(Boolean);
    let buffer = "";
    let sceneStart = chapter.start_offset;
    for (const paragraph of paragraphs) {
      const absoluteStart = text.indexOf(paragraph, sceneStart);
      const shouldSplit = buffer && (buffer.length + paragraph.length > maxSceneChars || transitionPattern.test(paragraph));
      if (shouldSplit) {
        scenes.push(createSceneCandidate(text, chapter, scenes.length, sceneStart, absoluteStart, buffer));
        buffer = paragraph;
        sceneStart = absoluteStart;
      } else {
        buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      }
    }
    if (buffer) scenes.push(createSceneCandidate(text, chapter, scenes.length, sceneStart, chapter.end_offset, buffer));
  }
  return scenes;
}

function createSceneCandidate(fullText: string, chapter: ChapterCandidate, index: number, start: number, end: number, text: string): SceneCandidate {
  const chars = detectCharacters(text).map((item) => item.name);
  return {
    scene_candidate_id: `scene_candidate_${nanoid(8)}`,
    chapter_id: chapter.chapter_id,
    title: `${chapter.title} - 场景 ${index + 1}`,
    index,
    start_offset: start,
    end_offset: Math.max(start, end),
    location_hint: inferLocation(text),
    time_hint: inferTime(text),
    characters: chars,
    source_span: { start_offset: start, end_offset: Math.max(start, end) },
    source_excerpt: text,
    summary: text.slice(0, 120),
    commands: [{ type: "narration", text: text.slice(0, 180) || "待改编场景" }],
    confidence: 0.62,
  };
}

function inferLocation(text: string): string | undefined {
  return ["车站", "教室", "房间", "街道", "门外", "仓库"].find((word) => text.includes(word));
}

function inferTime(text: string): string | undefined {
  return ["清晨", "黄昏", "夜里", "当晚", "第二天"].find((word) => text.includes(word));
}
