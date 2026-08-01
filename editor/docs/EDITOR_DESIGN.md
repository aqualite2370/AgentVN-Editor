# Editor Design

The editor is a dense dark-theme blueprint workspace for visual novel authors.
It now supports two token-driven tones: Blue Gray and White Gray.

## Architecture

- React + TypeScript + Vite render the SPA.
- Tauri v2 wraps the web app for desktop use.
- React Flow owns the node canvas.
- Zustand owns editor and project state.
- `backendClient.ts` calls the local FastAPI backend through `fetch`.
- `themeStore.ts` persists the selected visual tone and applies it through `data-theme`.

## Visual Direction

The UI uses a production-desk layout: compact controls, stable panels, clear node borders, and semantic node color accents. Blue Gray is optimized for long dark-mode editing. White Gray keeps the same structure while shifting surfaces, lines, and text contrast for a lighter desktop feel.

## Node Types

The node palette creates these active node types:

- `SceneNode`: visual novel scene with `SceneBeat` and `GameCommand[]`.
- `ModifierNode`: runtime state mutation through `StateUpdateCommand`.
- `ConditionNode`: runtime condition branch with `true` and `false` handles.
- `StartNode`: unique project entry.
- `EndNode`: terminal ending marker.

Animation and camera work are authored as ordered scene commands. The scene command list keeps the animation editor and animation preview studio, and inserts structured camera commands through the Camera Studio. There is no camera node.

One structured camera command may contain a two-to-four-shot continuous sequence. The inherited pose remains the read-only entry point, while each authored shot stores its destination, incoming duration, and easing. The sequence is still one ordered scene event rather than a synthesized camera timeline or group of commands.

### Legacy Animation Node Compatibility

Projects created before independent animation nodes were retired can still load, display, edit, and export `AnimationNode`. The editor labels these nodes as legacy and offers an explicit topology-aware conversion. It never rewrites them merely because a project was opened.

- A safe conversion absorbs the animation command into the unique successor or predecessor scene and reconnects the graph.
- Ambiguous topology shows the number of affected routes and asks the author where to place the command.
- The lossless fallback converts the container into a normal scene while preserving the node id, position, edges, animation command, and exported synthetic scene id.
- Converting a legacy node and converting a legacy camera animation into structured camera motion are separate author-confirmed actions.

## Zustand Stores

`editorStore` owns nodes, edges, viewport, selection, memory mode, dirty state, project import/export, script export, and generated scene application.

`projectStore` owns metadata, asset manifest placeholder, recent files placeholder, and project settings.

## React Flow

Custom nodes are registered in `VisualNovelEditor.tsx`. Handles are stable: SceneNode uses `choice_id` handles when a `ChoiceCommand` exists and `default` otherwise. ConditionNode uses `true` and `false`.

## AI Generate Next Flow

1. Read current scene.
2. Build previous summary from parent chain.
3. Resolve node memory mode or global memory mode.
4. Send `GenerateSceneRequest`.
5. Create a new SceneNode from returned `SceneBeat`.
6. Connect source node to generated node.
7. Optionally extract and apply memory updates.

## MemoryMode UI

The toolbar controls global MemoryMode. Inspector controls per-node MemoryMode. Node-local settings win for AI generation.

## project.vnproj vs script.json

`project.vnproj` preserves editor state, node positions, viewport, AI settings, preview state, UI metadata, and legacy compatibility nodes. New saves use editor project format `1.1.0`; loading an older `1.0.0` project does not rewrite it until the author saves.

`script.json` is runtime-only and contains schema version, entry scene id, scenes, commands, choices, state updates, camera motions, and endings.
