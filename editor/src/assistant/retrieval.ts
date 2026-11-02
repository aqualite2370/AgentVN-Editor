import { agentvnDocIndex } from "./agentvnDocIndex.generated";
import type { AssistantDocChunk } from "./types";

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/ren['’‘]?py/g, "renpy");
}
const stop = new Set(["如何", "怎么", "什么", "哪里", "应该", "一个", "这个", "我的", "我想", "可以",
  "需要", "是否", "能够", "设置", "修改", "进行", "时候", "操作", "还有", "里面", "并且", "the", "how", "to", "and"]);
const aliases: Array<[RegExp, string[]]> = [
  [/背景图|背景图片|底图|贴图|background\s+image/, ["背景图"]],
  [/进阶|高级|html|css|代码覆盖|code\s+override/, ["进阶", "代码覆盖"]],
  [/资源包|界面包|模板|gui|package\s+library/, ["资源包", "gui"]],
  [/组件|component/, ["组件"]],
  [/vnproj|保存.*目录|保存.*路径/, ["vnproj", "保存目录"]],
  [/导出|发布|apk|windows|安卓/, ["导出"]],
  [/问询|创造|写入工具|agent/, ["问询", "创造"]],
];
function tokenize(text: string): string[] {
  const query = normalize(text), terms = new Set<string>();
  for (const word of query.match(/[a-z0-9_.-]{2,}|[\u3400-\u9fff]+/g) ?? []) {
    if (/[\u3400-\u9fff]/.test(word)) {
      if (word.length <= 8 && !stop.has(word)) terms.add(word);
      for (const size of [2, 3]) for (let i = 0; i + size <= word.length; i++) {
        const token = word.slice(i, i + size);
        if (!stop.has(token)) terms.add(token);
      }
    } else if (!stop.has(word)) terms.add(word);
  }
  for (const [pattern, words] of aliases) if (pattern.test(query)) words.forEach(word => terms.add(word));
  return [...terms];
}
const documents = agentvnDocIndex.map(chunk => ({
  chunk, title: normalize(chunk.title), tags: normalize(chunk.tags.join(" ")), body: normalize(chunk.text),
}));
const documentFrequency = new Map<string, number>();
function termWeight(term: string): number {
  let frequency = documentFrequency.get(term);
  if (frequency === undefined) {
    frequency = documents.filter(doc =>
      doc.title.includes(term) || doc.tags.includes(term) || doc.body.includes(term)).length;
    documentFrequency.set(term, frequency);
  }
  return Math.log(1 + documents.length / (1 + frequency));
}
export function retrieveAssistantDocs(question: string, limit = 6): AssistantDocChunk[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const terms = tokenize(question);
  if (!terms.length) return [];
  const query = normalize(question);
  const editorCanvas = /编辑器.{0,4}(?:画布|背景)|(?:editor|canvas)\s+(?:background|背景)/.test(query);
  const runtimeLayout = /renpy|游戏.{0,6}(?:界面|布局|按钮|控件)|(?:控件|容器).{0,6}(?:背景|底图)/.test(query);
  const asksAnimation = /动画|animation|关键帧/.test(query);
  const weights = new Map(terms.map(term => [term, termWeight(term)]));
  const ranked = documents.filter(doc => {
    // The editor canvas and animation preview have their own background
    // controls. Shared words must not send a game-layout question there.
    if (!editorCanvas && runtimeLayout && doc.chunk.id.startsWith("help-settings.editorAppearance.")) return false;
    if (!asksAnimation && runtimeLayout && doc.chunk.id.startsWith("help-animation.")) return false;
    return true;
  }).map(doc => {
    let score = terms.reduce((sum, term) => sum + (weights.get(term) ?? 0) *
      (doc.title.includes(term) ? 5 : doc.tags.includes(term) ? 4 : doc.body.includes(term) ? 1 : 0), 0);
    if (editorCanvas) {
      score *= doc.chunk.id.startsWith("help-settings.editorAppearance.") ? 4 : 0.5;
    } else if (doc.chunk.tags.includes("current-operation-guide")) score *= 2;
    return { chunk: doc.chunk, score };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  // A requested limit is only an upper bound. Padding weak matches to twelve
  // citations made unrelated workflows look like evidence for the answer.
  const minimum = (ranked[0]?.score ?? 0) * 0.45;
  return ranked.filter(item => item.score >= minimum)
    .slice(0, Math.min(12, Math.floor(limit)))
    .map((item) => item.chunk);
}
