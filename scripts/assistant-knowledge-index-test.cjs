"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const { build, listMarkdownDocuments, splitMarkdownText } = require("./build-agent-doc-index.cjs");
const root = path.resolve(__dirname, ".."), out = process.argv[2];
assert(out && !fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const cases = [];
function check(name, fn) { fn(); cases.push({ name, status: "PASS" }); }
check("long-chapters-are-lossless-including-tail-and-surrogate-boundaries", () => {
  const text = "# 标题\r\n\r\n## 长章节\r\n" + "中文😃".repeat(2200) + "\r\nTAIL_SENTINEL\r\n## 结尾\r\nEND_SENTINEL";
  const chunks = splitMarkdownText(text, "docs/test.md");
  assert(chunks.length > 3);
  assert.equal(chunks.map(chunk => chunk.text).join(""), text.replace(/\r\n/g, "\n"));
  for (const chunk of chunks) assert(!/[\uD800-\uDBFF]$/.test(chunk.text));
  assert(chunks.at(-1).text.includes("END_SENTINEL"));
});
check("all-real-document-characters-retained-and-index-deterministic", () => {
  const first = build(), second = build();
  assert.equal(first.output, second.output);
  for (const source of first.metadata.sources.filter(source => source.path.endsWith(".md"))) {
    const chunks = first.chunks.filter(chunk => chunk.source === source.path);
    assert.equal(chunks.map(chunk => chunk.text).join(""),
      fs.readFileSync(path.join(root, source.path), "utf8").replace(/\r\n/g, "\n"), source.path);
  }
  assert.notEqual(first.output, first.output.replace(/"schemaVersion": 2/, '"schemaVersion": 1'));
});
check("index-sources-match-explicit-public-manifest-not-local-git-state", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "docs/assistant-knowledge-sources.json"), "utf8"));
  const expected = manifest.markdown.slice().sort();
  assert.deepEqual(listMarkdownDocuments().map(file => path.relative(root, file).replace(/\\/g, "/")).sort(), expected);
  const actual = build().metadata.sources.filter(source => source.path.endsWith(".md"))
    .map(source => source.path).sort();
  assert.deepEqual(actual, expected);
  assert(actual.includes("docs/ASSISTANT_USER_GUIDE.md"));
  assert(!actual.includes("GameCli_framework/docs/BUILD_ANDROID.md"));
  assert(!actual.includes("GameCli_framework/docs/BUILD_WINDOWS.md"));
});
check("manifest-refuses-missing-duplicate-or-escaping-inputs-and-ignores-unlisted-local-docs", () => {
  const sandbox = path.join(out, "manifest-fixture");
  fs.mkdirSync(path.join(sandbox, "docs"), { recursive: true });
  fs.writeFileSync(path.join(sandbox, "docs/public.md"), "# Public");
  fs.writeFileSync(path.join(sandbox, "docs/local-private.md"), "NOT_SHIPPED");
  const save = markdown => fs.writeFileSync(path.join(sandbox, "docs/assistant-knowledge-sources.json"),
    JSON.stringify({ schemaVersion: 1, markdown }));
  save(["docs/public.md"]);
  assert.deepEqual(listMarkdownDocuments(sandbox), [path.join(sandbox, "docs/public.md")]);
  save(["docs/missing.md"]); assert.throws(() => listMarkdownDocuments(sandbox));
  save(["docs/public.md", "docs/public.md"]); assert.throws(() => listMarkdownDocuments(sandbox), /MANIFEST_INVALID/);
  save(["docs/../public.md"]); assert.throws(() => listMarkdownDocuments(sandbox), /PATH_INVALID/);
});
check("real-check-command-confirms-current-artifact-without-rewriting", () => {
  const target = path.join(root, "editor/src/assistant/agentvnDocIndex.generated.ts");
  const before = fs.readFileSync(target), mtime = fs.statSync(target).mtimeMs;
  execFileSync(process.execPath, ["scripts/build-agent-doc-index.cjs", "--check"], { cwd: root });
  assert.deepEqual(fs.readFileSync(target), before); assert.equal(fs.statSync(target).mtimeMs, mtime);
  assert.equal(build().output, before.toString().replace(/\r\n/g, "\n"));
});
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ status: "PASS", cases,
  scope: "SOURCE_GENERATOR_FULL_REAL_DOC_COVERAGE_NO_MODEL" }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", cases: cases.length, out }));
