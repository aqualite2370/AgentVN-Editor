import { nanoid } from "nanoid";
import type { TextChunk } from "./types";
import { estimateTextTokens } from "../utils/contextBudget";

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function splitIntoParagraphs(text: string): Array<{ text: string; start: number; end: number }> {
  const result: Array<{ text: string; start: number; end: number }> = [];
  const regex = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;
  for (const match of text.matchAll(regex)) {
    const paragraph = match[0].trim();
    if (!paragraph) continue;
    result.push({ text: paragraph, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return result;
}

export function estimateTokens(text: string): number {
  return estimateTextTokens(text);
}

export function preserveDialogueBlocks(paragraphs: Array<{ text: string; start: number; end: number }>) {
  return paragraphs.map((paragraph) => ({ ...paragraph, isDialogue: /[“"『「].+[”"』」]/.test(paragraph.text) }));
}

function splitOversizedParagraph(paragraph: { text: string; start: number; end: number }, maxChunkChars: number): Array<{ text: string; start: number; end: number }> {
  if (paragraph.text.length <= maxChunkChars) return [paragraph];

  const result: Array<{ text: string; start: number; end: number }> = [];
  const sentencePattern = /[^。！？!?；;]+[。！？!?；;]?/g;
  let buffer = "";
  let bufferStart = paragraph.start;

  const flush = (end: number) => {
    const value = buffer.trim();
    if (!value) return;
    result.push({ text: value, start: bufferStart, end });
    buffer = "";
  };

  for (const match of paragraph.text.matchAll(sentencePattern)) {
    const sentence = match[0];
    const sentenceStart = paragraph.start + (match.index ?? 0);
    const sentenceEnd = sentenceStart + sentence.length;

    if (sentence.length > maxChunkChars) {
      flush(sentenceStart);
      for (let offset = 0; offset < sentence.length; offset += maxChunkChars) {
        const piece = sentence.slice(offset, offset + maxChunkChars);
        result.push({ text: piece, start: sentenceStart + offset, end: sentenceStart + offset + piece.length });
      }
      bufferStart = sentenceEnd;
      continue;
    }

    const next = buffer ? `${buffer}${sentence}` : sentence;
    if (next.length > maxChunkChars && buffer) {
      flush(sentenceStart);
      buffer = sentence;
      bufferStart = sentenceStart;
    } else {
      if (!buffer) bufferStart = sentenceStart;
      buffer = next;
    }
  }

  flush(paragraph.end);
  if (result.length) return result;

  for (let offset = 0; offset < paragraph.text.length; offset += maxChunkChars) {
    const piece = paragraph.text.slice(offset, offset + maxChunkChars);
    result.push({ text: piece, start: paragraph.start + offset, end: paragraph.start + offset + piece.length });
  }
  return result;
}

export function chunkText(documentId: string, text: string, maxChunkChars = 6000, overlapChars = 200): TextChunk[] {
  const paragraphs = preserveDialogueBlocks(splitIntoParagraphs(text).flatMap((paragraph) => splitOversizedParagraph(paragraph, maxChunkChars)));
  const chunks: TextChunk[] = [];
  let buffer = "";
  let start = 0;
  let index = 0;
  for (const paragraph of paragraphs) {
    if (!buffer) start = paragraph.start;
    const next = buffer ? `${buffer}\n\n${paragraph.text}` : paragraph.text;
    if (next.length > maxChunkChars && buffer) {
      chunks.push({
        chunk_id: `chunk_${nanoid(8)}`,
        document_id: documentId,
        index,
        text: buffer,
        start_offset: start,
        end_offset: paragraph.start,
        estimated_tokens: estimateTokens(buffer),
      });
      index += 1;
      const overlap = buffer.slice(Math.max(0, buffer.length - overlapChars));
      buffer = overlap ? `${overlap}\n\n${paragraph.text}` : paragraph.text;
      start = Math.max(0, paragraph.start - overlap.length);
    } else {
      buffer = next;
    }
  }
  if (buffer) {
    chunks.push({ chunk_id: `chunk_${nanoid(8)}`, document_id: documentId, index, text: buffer, start_offset: start, end_offset: text.length, estimated_tokens: estimateTokens(buffer) });
  }
  return mergeSmallChunks(chunks, Math.floor(maxChunkChars * 0.25), maxChunkChars);
}

export function mergeSmallChunks(chunks: TextChunk[], minChars = 1200, maxChars = 6000): TextChunk[] {
  const merged: TextChunk[] = [];
  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (previous && chunk.text.length < minChars && previous.text.length + chunk.text.length < maxChars) {
      previous.text = `${previous.text}\n\n${chunk.text}`;
      previous.end_offset = chunk.end_offset;
      previous.estimated_tokens = estimateTokens(previous.text);
    } else {
      merged.push({ ...chunk, index: merged.length });
    }
  }
  return merged;
}
