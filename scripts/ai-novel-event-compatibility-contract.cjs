#!/usr/bin/env node
"use strict";

const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const source = `
  import { validateNovelBlueprintWrite } from "./editor/src/novel-import/structureValidator";

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  const sourceText = "Alice reaches the station and chooses what to do next.";
  const document = {
    document_id: "doc_runtime_06",
    title: "Runtime 0.6 fixture",
    normalized_text: sourceText,
    raw_text: sourceText,
    chapters: [],
    metadata: {},
  };
  const sceneCandidate = {
    scene_candidate_id: "candidate_runtime_06",
    chapter_id: document.document_id,
    title: "Runtime 0.6",
    display_name: "Runtime 0.6",
    summary: "Runtime 0.6 command fixture.",
    start_offset: 0,
    end_offset: sourceText.length,
    source_excerpt: sourceText,
    characters: ["Alice"],
    locations: [],
    command_draft: [],
  };

  function adapted(commands: unknown[], sceneId = "scene_runtime_06") {
    return {
      adapted_scene_id: "adapted_runtime_06",
      source_scene_candidate_id: sceneCandidate.scene_candidate_id,
      scene_beat: {
        scene_id: sceneId,
        title: "Runtime 0.6",
        summary: "Runtime 0.6 command fixture.",
        commands,
        tags: [],
        chapter: 1,
      },
      source_mapping: {
        document_id: document.document_id,
        start_offset: 0,
        end_offset: sourceText.length,
        source_excerpt: sourceText,
        adapted_command_ids: [],
      },
      warnings: [],
      needs_review: false,
    };
  }

  function validate(commands: unknown[], options: { sceneId?: string; used?: string[] } = {}) {
    return validateNovelBlueprintWrite({
      reportId: "report_runtime_06",
      document,
      sceneCandidate,
      adaptedScene: adapted(commands, options.sceneId),
      branchSuggestions: [],
      conflictPoints: [],
      knownCharacters: [],
      usedSceneIds: new Set(options.used ?? []),
      projectAssets: [],
      allowBranchSuggestions: false,
      creatableSceneIds: ["scene_next"],
    } as never);
  }

  const valid = validate([
    { type: "narration", text: "The stage darkens.", narration_style: "centered" },
    {
      type: "sprite",
      character_id: "Alice",
      sprite_id: "alice_calm",
      position: "left",
      offset_x: 12,
      offset_y: -6,
      visible: true,
    },
    {
      type: "choice",
      button_style: { backgroundColor: "#112233", textAlign: "center" },
      choices: [{
        choice_id: "continue",
        text: "Continue",
        target_scene_id: "scene_next",
        conditions: [],
        button_style: { borderRadius: 14 },
      }],
    },
    { type: "bgm", bgm_id: "theme", action: "stop", fade_ms: 500 },
    { type: "rollback", action: "checkpoint", hard: false },
  ]);
  assert(!valid.blocked, "valid Runtime 0.6 commands must pass novel blueprint validation");
  const validCommands = valid.adaptedScene.scene_beat.commands as Array<Record<string, unknown>>;
  assert(validCommands.some((command) => command.type === "rollback"), "valid rollback command must be preserved");
  assert((validCommands[2].button_style as Record<string, unknown>).textAlign === "center", "choice button_style must be preserved");

  for (const [label, command, expectedCode] of [
    ["rollback hard", { type: "rollback", action: "block", hard: true }, "rollback_hard_field"],
    ["sprite offset", { type: "sprite", character_id: "Alice", sprite_id: "alice", offset_x: 41, visible: true }, "sprite_offset_x_range"],
    ["narration style", { type: "narration", text: "Bad", narration_style: "banner" }, "narration_style"],
    ["legacy BGM action", { type: "bgm", bgm_id: "theme", action: "fade", fade_ms: 500 }, "bgm_action"],
  ] as const) {
    const result = validate([command]);
    assert(result.blocked, \`\${label} must block novel blueprint validation\`);
    assert(result.report.errors.some((error) => error.includes(expectedCode)), \`\${label} must report \${expectedCode}\`);
  }

  const remapped = validate(
    [{ type: "jump", target_scene_id: "scene_duplicate" }],
    { sceneId: "scene_duplicate", used: ["scene_duplicate"] },
  );
  assert(!remapped.blocked, "duplicate scene id repair must keep a valid self jump");
  assert(remapped.adaptedScene.scene_beat.scene_id === "scene_duplicate_2", "duplicate scene id must be repaired");
  const jump = remapped.adaptedScene.scene_beat.commands[0] as { target_scene_id?: string };
  assert(jump.target_scene_id === "scene_duplicate_2", "self jump target must follow repaired scene id");

  console.log("ai/novel Runtime 0.6 behavior contract passed");
`;

const result = esbuild.buildSync({
  stdin: {
    contents: source,
    resolveDir: root,
    sourcefile: "ai-novel-event-compatibility-contract.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  target: "node20",
});

const moduleUnderTest = { exports: {} };
new Function("require", "module", "exports", result.outputFiles[0].text)(
  require,
  moduleUnderTest,
  moduleUnderTest.exports,
);
