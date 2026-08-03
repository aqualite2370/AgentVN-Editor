import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureUniqueSceneBeatId,
  nextUniqueSceneId,
  remapSceneSelfTargets,
} from "./sceneIdUniqueness.ts";

test("allocates stable scene ids against existing graph and current import batch", () => {
  const usedSceneIds = new Set(["scene_001"]);

  assert.equal(nextUniqueSceneId("scene_001", usedSceneIds, "fallback"), "scene_001_2");
  assert.equal(nextUniqueSceneId("scene_001", usedSceneIds, "fallback"), "scene_001_3");
  assert.equal(nextUniqueSceneId("scene_002", usedSceneIds, "fallback"), "scene_002");
});

test("remaps every self-referencing command when a duplicate scene id is renamed", () => {
  const commands = [
    { type: "jump", target_scene_id: "scene_001" },
    {
      type: "conditional_jump",
      target_scene_id: "scene_001",
      else_target_scene_id: "other_scene",
    },
    {
      type: "choice",
      choices: [
        { choice_id: "stay", text: "留下", target_scene_id: "scene_001" },
        { choice_id: "leave", text: "离开", target_scene_id: "other_scene" },
      ],
    },
  ];

  assert.deepEqual(remapSceneSelfTargets(commands, "scene_001", "scene_001_2"), [
    { type: "jump", target_scene_id: "scene_001_2" },
    {
      type: "conditional_jump",
      target_scene_id: "scene_001_2",
      else_target_scene_id: "other_scene",
    },
    {
      type: "choice",
      choices: [
        { choice_id: "stay", text: "留下", target_scene_id: "scene_001_2" },
        { choice_id: "leave", text: "离开", target_scene_id: "other_scene" },
      ],
    },
  ]);
});

test("repairs a duplicate imported scene before graph conversion", () => {
  const usedSceneIds = new Set(["scene_001"]);
  const result = ensureUniqueSceneBeatId(
    {
      scene_id: "scene_001",
      title: "诊疗室",
      summary: "重复模型编号",
      chapter: 1,
      tags: [],
      commands: [{ type: "jump", target_scene_id: "scene_001" }],
    },
    usedSceneIds,
    "process_chunk_1",
  );

  assert.equal(result.renamedFrom, "scene_001");
  assert.equal(result.scene.scene_id, "scene_001_2");
  assert.equal(result.scene.commands[0].target_scene_id, "scene_001_2");
});
