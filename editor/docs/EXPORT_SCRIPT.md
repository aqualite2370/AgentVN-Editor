# Export Script

`exportScript.ts` converts the editor graph into a clean runtime `script.json`.

## Preserved Fields

- `schema_version`
- `entry_scene_id`
- `scenes`
- `scene_id`
- `title`
- `summary`
- `commands`
- background command `background_fit`
- structured camera command `motion`
- `choices`
- `chapter`
- `tags`
- runtime state updates
- ending markers

## Stripped Fields

- node position
- node style
- selected state
- viewport
- editor metadata
- preview state
- AI settings
- React Flow internals
- Inspector UI state
- temporary drafts
- API keys
- embeddings
- ChronicleGraph internal data
- EmotionTrace internal data

## Conversion Rules

1. Find the single StartNode.
2. Traverse reachable nodes from StartNode.
3. Collect SceneNode as runtime scenes.
4. Convert ModifierNode into a scene containing `StateUpdateCommand`.
5. For legacy compatibility only, convert a reachable `AnimationNode` into a synthetic scene containing its `AnimationCommand`. New projects cannot create this node type.
6. Convert ConditionNode into an automatic `conditional_jump` command.
7. Convert EndNode into an ending scene.
8. Patch `ChoiceCommand.target_scene_id` and `conditional_jump` true/else targets from graph edges when handles match.
9. Validate the result with `validateExportScript`.

## Versioning

Export versions are selected by script capability:

- Without structured camera `motion`, export `schema_version: "1.1.0"` and `manifest.runtime_version: "0.2.0"`.
- With structured single-motion camera commands, export `schema_version: "1.2.0"` and `manifest.runtime_version: "0.3.0"`.
- When any scene contains a structured camera `sequence`, export `schema_version: "1.3.0"` and `manifest.runtime_version: "0.4.0"`.
- Legacy camera commands and `AnimationCommand(target: "camera")` do not raise the capability version. They keep their 0.2 whole-screen behavior.
- Existing `1.0.0` scripts remain readable through the compatibility path.

`manifest_version` and `cartridge_version` remain unchanged.

## Camera Semantics

- Structured camera commands use the mutually exclusive `motion` shape. They must not mix it with legacy `action` and `params`.
- The exporter preserves explicit duration, easing, blocking, and advanced overscan author intent.
- A camera `sequence` contains two to four ordered target shots. Each shot owns the duration and easing used to reach it from the inherited pose or previous shot.
- Camera sequences always block until the whole path finishes, persist the final shot, and may use a zero-duration shot as an instantaneous cut.
- Camera motion is a scene event. No camera node or camera timeline is synthesized during export.
- The camera pose persists across scenes and background changes until a structured reset command explicitly returns it to the default pose.
- Legacy camera commands without `motion` always export unchanged and are never upgraded by action-name guessing.

## Branching Semantics

- `ChoiceNode` and scene-level `choice` commands remain visible player branches.
- Each choice may carry `conditions`; the runtime hides choices whose conditions fail.
- `ConditionNode` is no longer exported as a visible two-choice command. It becomes `conditional_jump`, with the `true` handle patched to `target_scene_id` and the `false` handle patched to `else_target_scene_id`.
- `conditional_jump` targets are included in reachability scanning, target patching, and export validation, so loops and back-jumps are retained in exported scripts.
