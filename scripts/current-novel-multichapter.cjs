"use strict";
// Reuse complete real-backend UI workflow; adapt only declared two-chapter
// fixture expectations, provider, output and historical QA path bindings.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { receipt } = require("./current-novel-task-closure.cjs");
const { build: baseBuild } = require("./current-novel-backend-closure.cjs");
const { text, chapters, answer } = require("./lib/controlled-novel-multichapter-provider.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Novel-Multichapter-1.9.35-20261102-01";
const checkpoint = "F:/AgentVN/Checkpoints/Current-Novel-Multichapter-20261102-01";
const originalFile = path.join(__dirname, "installed-novel-default-current.cjs");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function build(original) {
  const base = baseBuild(original); let source = base.source; const edits = [...base.edits];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  change('const { controlledDefaultNovelProvider } = require("./lib/controlled-novel-default-provider.cjs");',
    'const { controlledMultichapterProvider: controlledDefaultNovelProvider } = require("./lib/controlled-novel-multichapter-provider.cjs");');
  change('"scripts/lib/controlled-novel-default-provider.cjs",', '"scripts/lib/controlled-novel-multichapter-provider.cjs",');
  change('fs.writeFileSync(novel, "第一章 雨后窗边\\n雨停了，窗外的树叶轻轻摇动。\\n远处的灯光逐渐明亮，屋内的时钟缓缓走动。", { flag: "wx" });',
    'fs.writeFileSync(novel, ' + JSON.stringify(text) + ', { flag: "wx" });');
  change('modelBudget: 13,', 'modelBudget: 20,');
  change('assert.equal(s.session.chapters.length, 1);', 'assert.equal(s.session.chapters.length, 2);');
  change('assert.equal(s.session.adapted_scenes.length, 1); assert.equal(s.session.scenes.length, 1);',
    'assert.equal(s.session.adapted_scenes.length, 2); assert.equal(s.session.scenes.length, 2);');
  change('assert.equal(added.length, 1);', 'assert.equal(added.length, 2);');
  // Preserve all original stage names/steps; only the two chapter expectation
  // expands. Each new chapter must execute seven actual packaged stages.
  change('assert.equal(provider.requests.length, 13);', 'assert.equal(provider.requests.length, 20);', 2);
  change('assert.deepEqual(provider.requests.map(r => r.stage).sort(), [...modelStages].sort());',
    'assert.deepEqual(provider.requests.map(r => r.stage).sort(), [...modelStages.slice(0, 6), ...modelStages.slice(6), ...modelStages.slice(6)].sort());');
  change('await w.locator(\'[data-help-key="novel.aiStart"]\').click();',
    'await w.locator(\'[data-help-key="novel.branchSuggestions"]\').check();\n' +
    '      assert.equal((await state()).session.import_options.allow_branch_suggestions, true);\n' +
    '      await w.locator(\'[data-help-key="novel.aiStart"]\').click();');
  change('report.completed = s; await host.shot("real-default-import-report");',
    `const choices = s.project.nodes.filter(n => n.type === "choiceNode" && n.data.editorMeta?.source === "imported");
      const stubs = s.project.nodes.filter(n => n.data.scene?.tags?.includes("ai_branch_stub"));
      assert.equal(choices.length, 1); assert.equal(stubs.length, 1);
      assert.equal(s.session.branch_suggestions.length, 1);
      assert(s.session.branch_suggestions.every(b => b.enabled_by_default === false));
      const handles = choices[0].data.choice.choices.map(c => c.choice_id);
      assert.equal(handles.length, 2); assert(handles.includes("mainline"));
      for (const handle of handles) assert.equal(s.project.edges.filter(e => e.source === choices[0].id && e.sourceHandle === handle).length, 1);
      const first = added.find(n => n.data.scene.scene_id === "qa_multi_scene_1");
      const second = added.find(n => n.data.scene.scene_id === "qa_multi_scene_2");
      assert(first && second);
      assert(s.project.edges.some(e => e.source === first.id && e.target === choices[0].id));
      assert(s.project.edges.some(e => e.source === choices[0].id && e.sourceHandle === "mainline" && e.target === second.id));
      assert(s.project.edges.some(e => e.source === choices[0].id && e.target === stubs[0].id));
      report.materialized = { choices, stubs, graphConnected: true, suggestionsDisabledByDefault: true,
        note: "Choice target_scene_id is resolved from graph handles at export; blank author node targets are not runtime evidence." };
      report.completed = s; await host.shot("real-default-import-report");`);
  change('modelBudget: 20, displayScope:', 'modelBudget: 20, controlledSample: "TWO_CHAPTERS_OPTIONAL_BRANCH", displayScope:');
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function selfTest() {
  const result = build(fs.readFileSync(originalFile, "utf8")); assert.throws(() => build(""));
  assert.equal(chapters.length, 2); assert.equal(text.slice(0, chapters[0].end_offset) + text.slice(chapters[1].start_offset), text);
  const payload = (system, user) => ({ stream: true, response_format: { type: "json_object" },
    messages: [{ role: "system", content: system }, { role: "user", content: user }] });
  const outline = answer(payload("整理成章节结构", "分块分析数据:\n" + JSON.stringify({ total_chars: text.length })));
  assert.equal(outline.result.chapters.length, 2);
  for (const chapter of chapters) {
    const plan = answer(payload("SceneCandidate objects", "章节:\n" + JSON.stringify(chapter) +
      "\n章节原文:\n" + text.slice(chapter.start_offset, chapter.end_offset))).result;
    assert.equal(plan.scenes.length, 1);
    const beat = answer(payload("into one playable AgentVN SceneBeat", "Scene candidate:\n" + JSON.stringify(plan.scenes[0])));
    assert.equal(beat.result.commands[0].text, text.slice(chapter.start_offset, chapter.end_offset).trim());
    const branches = answer(payload("branch suggestions for a planned imported", "Scene plan:\n" + JSON.stringify(plan)));
    assert.equal(branches.result.branch_suggestions.length, chapter.index ? 0 : 1);
  }
  assert.throws(() => answer(payload("整理成章节结构", "分块分析数据:\n" + JSON.stringify({ total_chars: 999 }))));
  descriptor(); console.log(JSON.stringify({ status: "PASS", adapterChanges: result.edits.length,
    fixtureChapters: 2, plannedLocalRequests: 20, productStarts: 0, paidRequests: 0 }));
}
function main(mode, attempt) {
  if (mode === "self-test") return selfTest();
  assert.equal(mode, "run"); assert.match(attempt, /^\d{2}$/); const installed = descriptor();
  const result = build(fs.readFileSync(originalFile, "utf8"));
  fs.mkdirSync(qa, { recursive: true }); fs.mkdirSync(checkpoint, { recursive: true });
  const binding = path.join(qa, "binding-" + attempt); assert(!fs.existsSync(binding)); fs.mkdirSync(binding);
  fs.writeFileSync(path.join(binding, "executed.cjs"), result.source, { flag: "wx" });
  for (const file of [__filename, path.join(__dirname, "lib/controlled-novel-multichapter-provider.cjs")])
    fs.copyFileSync(file, path.join(binding, path.basename(file)), fs.constants.COPYFILE_EXCL);
  const bindingFile = path.join(binding, "binding.json");
  fs.writeFileSync(bindingFile, JSON.stringify({ original: desc(originalFile), adapter: desc(__filename),
    executed: desc(path.join(binding, "executed.cjs")), provider: desc(path.join(__dirname, "lib/controlled-novel-multichapter-provider.cjs")),
    installation: desc(receipt), products: [installed.executable, ...installed.resources], edits: result.edits,
    productChanges: 0, builds: 0, paidRequests: 0 }, null, 2), { flag: "wx" });
  process.argv = [process.execPath, originalFile, attempt, "--candidate=1.9.35", "--qa-root=" + qa,
    "--checkpoint-root=" + checkpoint, "--installation-file=" + receipt];
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname), qaBinding: desc(bindingFile) });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(process.argv[2], process.argv[3]);
module.exports = { qa, checkpoint, build };
