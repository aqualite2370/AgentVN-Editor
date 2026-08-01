import { nanoid } from "nanoid";
import type { CharacterCandidate } from "./types";

export function detectCharacters(text: string): CharacterCandidate[] {
  const names = new Map<string, number>();
  const speechRegex = /([A-Za-z\u4e00-\u9fff]{1,12})(?:说|问|喊|低声道|笑道|答道)[：“"]/g;
  for (const match of text.matchAll(speechRegex)) {
    const name = match[1];
    if (!names.has(name)) names.set(name, match.index ?? 0);
  }
  return [...names.entries()].slice(0, 60).map(([name, offset]) => ({
    character_id: name.toLowerCase().replace(/\s+/g, "_") || `char_${nanoid(5)}`,
    name,
    aliases: [],
    first_seen_offset: offset,
    description: "从对白提示中自动识别，需人工确认。",
    speaking_style_hint: "",
    confidence: 0.58,
  }));
}

export function mergeCharacters(left: CharacterCandidate, right: CharacterCandidate): CharacterCandidate {
  return {
    ...left,
    aliases: [...new Set([...left.aliases, right.name, ...right.aliases])],
    first_seen_offset: Math.min(left.first_seen_offset, right.first_seen_offset),
    confidence: Math.max(left.confidence, right.confidence),
  };
}
