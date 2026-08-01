import { agentvnDocIndex } from "./agentvnDocIndex.generated";
import type { AssistantDocChunk } from "./types";

function tokenize(text: string): string[] {
  return Array.from(new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/u)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
  ));
}

function scoreChunk(chunk: AssistantDocChunk, terms: string[]): number {
  const haystack = `${chunk.title}\n${chunk.tags.join(" ")}\n${chunk.text}`.toLowerCase();
  return terms.reduce((score, term) => {
    if (!haystack.includes(term)) return score;
    const titleBoost = chunk.title.toLowerCase().includes(term) ? 4 : 0;
    const tagBoost = chunk.tags.some((tag) => tag.toLowerCase().includes(term)) ? 3 : 0;
    return score + 1 + titleBoost + tagBoost;
  }, 0);
}

export function retrieveAssistantDocs(question: string, limit = 6): AssistantDocChunk[] {
  const terms = tokenize(question);
  if (terms.length === 0) return agentvnDocIndex.slice(0, limit);
  return [...agentvnDocIndex]
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.chunk);
}
