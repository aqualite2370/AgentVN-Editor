const fs = require("node:fs");
const path = require("node:path");
const { loadProjectContainerSync } = require("./project-container.cjs");
const cp = require("node:child_process");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, ".tmp", "loop-jump-runtime-check");
process.env.NODE_PATH = [
  path.join(root, "editor", "node_modules"),
  path.join(root, "GameCli_framework", "node_modules"),
  process.env.NODE_PATH || "",
].filter(Boolean).join(path.delimiter);
require("node:module").Module._initPaths();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, options = {}) {
  const executable = process.platform === "win32" && command[0] === "npx" ? "npx.cmd" : command[0];
  cp.execFileSync(executable, command.slice(1), {
    cwd: options.cwd || root,
    stdio: options.stdio || "pipe",
  });
}

function clean() {
  fs.rmSync(outDir, { recursive: true, force: true });
}

function compileRuntimeModules() {
  clean();
  run([
    process.execPath,
    path.join(root, "editor", "node_modules", "typescript", "bin", "tsc"),
    "--module", "commonjs",
    "--target", "ES2022",
    "--moduleResolution", "node",
    "--esModuleInterop",
    "--skipLibCheck",
    "--jsx", "react-jsx",
    "--outDir", "..\\.tmp\\loop-jump-runtime-check",
    "--rootDir", "..",
    "src/utils/exportScript.ts",
    "src/cartridge/preflight.ts",
    "..\\GameCli_framework\\src\\engine\\StoryEngine.ts",
    "..\\shared\\cartridge\\validators.ts",
  ], { cwd: path.join(root, "editor") });
}

const commonData = {
  aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
  previewState: { currentCommandIndex: 0, isPlaying: false },
  editorMeta: { collapsedInspectorSections: [] },
};

function sceneNode(id, sceneId, commands, title) {
  return {
    id,
    type: "scene",
    position: { x: 0, y: 0 },
    data: {
      ...commonData,
      nodeKind: "scene",
      label: title || sceneId,
      description: "",
      scene: {
        scene_id: sceneId,
        title: title || sceneId,
        summary: "",
        chapter: 0,
        tags: [],
        commands: commands || [],
      },
    },
  };
}

function startNode() {
  return {
    id: "start",
    type: "start",
    position: { x: 0, y: 0 },
    data: {
      ...commonData,
      nodeKind: "start",
      label: "Start",
      description: "",
    },
  };
}

function loopNode(id, continueCondition) {
  return {
    id,
    type: "loop",
    position: { x: 0, y: 0 },
    data: {
      ...commonData,
      nodeKind: "loop",
      label: "Loop",
      description: "",
      loop: {
        variableKey: "turn",
        initialValue: 0,
        step: 1,
        continueCondition: continueCondition || { key: "turn", operator: "less_than", value: 3 },
        loopLabel: "继续",
        exitLabel: "退出",
      },
    },
  };
}

function endNode(id, title) {
  return {
    id,
    type: "end",
    position: { x: 0, y: 0 },
    data: {
      ...commonData,
      nodeKind: "end",
      label: title,
      description: "",
      ending: { ending_id: id, ending_title: title },
    },
  };
}

function edge(id, source, target, sourceHandle) {
  return { id, source, target, sourceHandle };
}

function loadCompiled() {
  return {
    exportScript: require(path.join(outDir, "editor", "src", "utils", "exportScript.js")).exportScript,
    runExportPreflight: require(path.join(outDir, "editor", "src", "cartridge", "preflight.js")).runExportPreflight,
    StoryEngine: require(path.join(outDir, "GameCli_framework", "src", "engine", "StoryEngine.js")).StoryEngine,
    validateRuntimeScript: require(path.join(outDir, "shared", "cartridge", "validators.js")).validateRuntimeScript,
  };
}

function runPreflight(input, runExportPreflight) {
  return runExportPreflight({
    ...input,
    assets: [],
    metadata: {
      gameId: "loop_jump_check",
      title: "Loop Jump Check",
      author: "AgentVN",
      description: "Loop and jump preflight acceptance.",
    },
  });
}

function assertBlocker(report, code) {
  const codes = report.blockers.map((item) => item.code);
  assert(codes.includes(code), "expected blocker " + code + ", got " + codes.join(", "));
}

async function flushTimers(times) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function clickThrough(engine, maxClicks) {
  for (let i = 0; i < maxClicks; i += 1) {
    if (engine.state.isEnded || engine.state.isPaused || engine.state.isWaitingChoice) return;
    if (engine.state.focusedImage) {
      engine.dismissFocusedImage();
      await flushTimers(4);
      continue;
    }
    if (engine.state.isTyping) {
      engine.completeTyping();
      await flushTimers(4);
      continue;
    }
    engine.next();
    await flushTimers(4);
  }
}

async function exerciseStoryEngine(script, StoryEngine) {
  global.window = {
    setTimeout,
    dispatchEvent() {},
  };
  global.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    }
  };

  const manifest = {
    manifest_version: "1.0.0",
    cartridge_version: "1.0.0",
    runtime_version: "1.0.0",
    game_id: "loop_jump_check",
    title: "Loop Jump Check",
    author: "AgentVN",
    version: "1.0.0",
    description: "",
    entry_script: "script.json",
    entry_scene_id: script.entry_scene_id,
    assets: [],
  };

  const engine = new StoryEngine();
  engine.onChange = () => {};
  engine.loadScript(script, manifest);
  engine.start();
  await clickThrough(engine, 20);
  assert(engine.state.currentSceneId === "end_victoryNode", "expected loop to exit at victory, got " + engine.state.currentSceneId);
  assert(engine.state.variables.turn === 3, "expected loop counter 3, got " + engine.state.variables.turn);

  const jumpScript = {
    schema_version: "1.1.0",
    entry_scene_id: "jump_start",
    scenes: [
      { scene_id: "jump_start", title: "Jump", summary: "", tags: [], chapter: 0, commands: [{ type: "jump", target_scene_id: "jump_end" }] },
      { scene_id: "jump_end", title: "Jump End", summary: "", tags: [], chapter: 0, is_ending: true, commands: [{ type: "narration", text: "done" }] },
    ],
  };
  engine.loadScript(jumpScript, { ...manifest, game_id: "jump", title: "Jump", entry_scene_id: "jump_start" });
  engine.start();
  await flushTimers(5);
  assert(engine.state.currentSceneId === "jump_end", "expected direct jump to jump_end, got " + engine.state.currentSceneId);
}

async function playExampleRoute(script, StoryEngine, choiceId, expectedSceneId) {
  const manifest = {
    manifest_version: "1.0.0",
    cartridge_version: "1.0.0",
    runtime_version: "1.0.0",
    game_id: "loop_jump_example",
    title: "Loop Jump Example",
    author: "AgentVN",
    version: "1.0.0",
    description: "",
    entry_script: "script.json",
    entry_scene_id: script.entry_scene_id,
    assets: [],
  };
  const engine = new StoryEngine();
  engine.onChange = () => {};
  engine.loadScript(script, manifest);
  engine.start();
  await clickThrough(engine, 6);
  assert(engine.state.isWaitingChoice, "example route " + choiceId + " should wait for intro choice");
  engine.choose(choiceId);
  await flushTimers(4);
  await clickThrough(engine, 40);
  assert(engine.state.currentSceneId === expectedSceneId, "example route " + choiceId + " expected " + expectedSceneId + ", got " + engine.state.currentSceneId);
}

async function exerciseExampleProject(exportScript, runExportPreflight, StoryEngine) {
  const projectPath = path.join(root, "data", "examples", "loop-jump-example.vnproj");
  const project = loadProjectContainerSync(projectPath).project;
  const script = exportScript(project.nodes, project.edges);
  const report = runPreflight({ script, nodes: project.nodes, edges: project.edges }, runExportPreflight);
  assert(report.blockers.length === 0, "loop-jump-example preflight blockers: " + report.blockers.map((item) => item.code).join(", "));
  assert(script.scenes.some((scene) => scene.commands.some((command) => command.type === "jump")), "example exports jump commands");
  assert(script.scenes.some((scene) => scene.tags && scene.tags.includes("loop")), "example exports loop scenes");
  await playExampleRoute(script, StoryEngine, "battle", "scene_battle_win");
  await playExampleRoute(script, StoryEngine, "battle_lose", "scene_battle_lose");
  await playExampleRoute(script, StoryEngine, "search", "scene_found_key");
}

async function main() {
  compileRuntimeModules();
  const { exportScript, runExportPreflight, StoryEngine, validateRuntimeScript } = loadCompiled();

  const nodes = [
    startNode(),
    sceneNode("intro", "intro", [{ type: "narration", text: "准备循环" }], "Intro"),
    loopNode("loop"),
    sceneNode("body", "body", [{ type: "narration", text: "循环体" }], "Body"),
    endNode("victoryNode", "Victory"),
  ];
  const edges = [
    edge("e-start", "start", "intro"),
    edge("e-intro-loop", "intro", "loop"),
    edge("e-loop-body", "loop", "body", "loop"),
    edge("e-body-loop", "body", "loop"),
    edge("e-loop-exit", "loop", "victoryNode", "exit"),
  ];

  const script = exportScript(nodes, edges);
  const manifest = {
    manifest_version: "1.0.0",
    cartridge_version: "1.0.0",
    runtime_version: "1.0.0",
    game_id: "loop_jump_check",
    title: "Loop Jump Check",
    author: "AgentVN",
    version: "1.0.0",
    description: "",
    entry_script: "script.json",
    entry_scene_id: script.entry_scene_id,
    assets: [],
  };
  const loopScene = script.scenes.find((scene) => scene.tags && scene.tags.includes("loop"));
  assert(loopScene, "loop node exported as runtime scene");
  assert(loopScene.commands.some((command) => command.type === "state_update" && command.operation === "set_if_unset"), "loop initializes with set_if_unset");
  assert(loopScene.commands.some((command) => command.type === "conditional_jump" && command.target_scene_id === "body" && command.else_target_scene_id === "end_victoryNode"), "loop exports loop/exit handles");
  assert(!JSON.stringify(script).includes("loopLabel") && !JSON.stringify(script).includes("exitLabel"), "script does not leak editor-only loop fields");

  const validation = validateRuntimeScript({ ...script, game_id: manifest.game_id }, manifest);
  assert(validation.errors.length === 0, "runtime validation errors: " + validation.errors.map((item) => item.message).join("\n"));

  const passReport = runPreflight({ script, nodes, edges }, runExportPreflight);
  assert(!passReport.blockers.some((item) => item.code.startsWith("loop_") || item.code.startsWith("jump_")), "valid loop/jump graph should not have loop/jump blockers: " + passReport.blockers.map((item) => item.code).join(", "));

  const noLoopEdge = edges.filter((item) => item.id !== "e-loop-body");
  const missingLoopReport = runPreflight({ script: exportScript(nodes, noLoopEdge), nodes, edges: noLoopEdge }, runExportPreflight);
  assertBlocker(missingLoopReport, "loop_continue_target_missing");

  const noExitEdge = edges.filter((item) => item.id !== "e-loop-exit");
  const missingExitReport = runPreflight({ script: exportScript(nodes, noExitEdge), nodes, edges: noExitEdge }, runExportPreflight);
  assertBlocker(missingExitReport, "loop_exit_target_missing");

  const jumpNodes = [
    startNode(),
    sceneNode("jumpSource", "jump_source", [{ type: "jump", target_scene_id: "" }], "Jump Source"),
    sceneNode("jumpTarget", "jump_target", [{ type: "narration", text: "target" }], "Jump Target"),
  ];
  const jumpEdges = [edge("e-start-jump", "start", "jumpSource")];
  const missingJumpReport = runPreflight({ script: exportScript(jumpNodes, jumpEdges), nodes: jumpNodes, edges: jumpEdges }, runExportPreflight);
  assertBlocker(missingJumpReport, "jump_target_missing");

  const invalidJumpNodes = [
    startNode(),
    sceneNode("jumpSource", "jump_source", [{ type: "jump", target_scene_id: "missing_scene" }], "Jump Source"),
    sceneNode("jumpTarget", "jump_target", [{ type: "narration", text: "target" }], "Jump Target"),
  ];
  const invalidJumpReport = runPreflight({ script: exportScript(invalidJumpNodes, jumpEdges), nodes: invalidJumpNodes, edges: jumpEdges }, runExportPreflight);
  assertBlocker(invalidJumpReport, "jump_target_invalid");

  await exerciseStoryEngine(script, StoryEngine);
  await exerciseExampleProject(exportScript, runExportPreflight, StoryEngine);

  console.log("PASS loop/jump export-runtime acceptance");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => {
  clean();
});
