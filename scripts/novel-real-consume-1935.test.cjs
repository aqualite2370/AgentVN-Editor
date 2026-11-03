"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { inspectCartridge } = require("./novel-real-consume-1935.cjs");

test("cartridge inspection includes a reviewed mainline terminal and its runtime target", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-novel-consume-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "reviewed.vncart");

  const scene = (scene_id, commands = []) => ({
    scene_id, commands, next_scene_id: undefined,
  });
  const dialogue = Array.from({ length: 10 }, (_, index) => ({
    type: "narration",
    text: `对白 ${index + 1}`,
  }));
  const endingNode = {
    id: "ending_test",
    data: {
      nodeKind: "end",
      ending: { ending_id: "ending_reviewed", ending_title: "隔离验收终点" },
    },
  };
  const branchNode = {
    id: "branch_test",
    data: { nodeKind: "scene", scene: { scene_id: "branch_scene", commands: [] } },
  };
  const choiceNode = {
    id: "choice_test",
    data: {
      nodeKind: "choice",
      choice: {
        choices: [
          { choice_id: "mainline", text: "继续原文主线", target_scene_id: "end_ending_test" },
          { choice_id: "branch", text: "进入支线", target_scene_id: "branch_scene" },
        ],
      },
    },
  };
  const project = {
    project_id: "qa_novel_test",
    nodes: [
      { id: "scene", data: { nodeKind: "scene", scene: { scene_id: "ui_acceptance", commands: [] } } },
      { id: "novel", data: { nodeKind: "scene", editorMeta: { importSessionId: "import_test" },
        scene: { scene_id: "novel_scene", commands: dialogue } } },
      choiceNode,
      branchNode,
      endingNode,
    ],
    edges: [
      { source: "scene", target: "novel" },
      { source: "novel", target: choiceNode.id },
      { source: choiceNode.id, sourceHandle: "mainline", target: endingNode.id },
      { source: choiceNode.id, sourceHandle: "branch", target: branchNode.id },
    ],
  };
  const script = {
    entry_scene_id: "ui_acceptance",
    scenes: [
      { ...scene("ui_acceptance"), next_scene_id: "novel_scene" },
      { ...scene("novel_scene", dialogue), next_scene_id: "choice_choice_test" },
      {
        ...scene("choice_choice_test"),
        commands: [{
          type: "choice",
          choices: [
            { choice_id: "mainline", text: "继续原文主线", target_scene_id: "end_ending_test" },
            { choice_id: "branch", text: "进入支线", target_scene_id: "branch_scene" },
          ],
        }],
      },
      scene("branch_scene"),
      {
        ...scene("end_ending_test", [{ type: "narration", text: "隔离验收终点" }]),
        is_ending: true,
        ending_id: "ending_reviewed",
        ending_title: "隔离验收终点",
      },
    ],
  };
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({
    game_id: project.project_id,
    entry_script: "script.json",
    assets: [{ asset_id: "agentvn_placeholder_background", path: "assets/background.png" }],
  }));
  zip.file("script.json", JSON.stringify(script));
  zip.file("assets/background.png", Buffer.from("fixture-image-bytes"));
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

  const result = await inspectCartridge(file, project);
  assert.equal(result.mainline.sceneId, "end_ending_test");
  assert.equal(result.mainline.isEnding, true);
  assert.equal(result.mainline.commands[0].text, "隔离验收终点");
  assert.equal(result.branches.length, 2);
  assert.equal(result.playback.length, 10);
});
