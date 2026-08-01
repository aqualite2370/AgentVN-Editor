# Runtime Design

GameCLI is a pure frontend visual novel player. It loads a cartridge manifest and runtime script, validates the player-facing data, then drives playback through `StoryEngine`.

It contains no AI, Python, FastAPI, SQLite, React Flow, editor graph, ChronicleGraph, EmotionTrace, novel import raw text, source mapping, or provider configuration.

## Layers

1. Loading screen / boot animation
2. BackgroundLayer
3. SpriteLayer
4. Camera effect class
5. DialogBox
6. ChoicePanel
7. PlaybackControls
8. Modal-like shell screens

## Loading Screen

The loading screen uses `script.loading_animation`:

- `default`: built-in circular boot animation.
- `video`: plays a packed video asset.
- `image_sequence`: cycles packed UI image assets, defaulting to 1000 ms per frame.

If a custom loading animation is invalid, cartridge validation should report the missing or mismatched asset instead of silently switching to another authored configuration.

## Story State

`StoryEngine` owns current scene, command index, background, sprites, dialog, focused image overlay, choices, variables, history, typing state, auto/skip state, pause state, BGM state, and runtime animation state. Zustand mirrors this state for React rendering. A `show_image` command blocks normal advancement until `dismissFocusedImage()` clears the overlay and advances exactly once.

State variables are JSON values. `state_update.value_type` lets the runtime coerce boolean, number, text, and list values before applying `set`, `add`, `subtract`, `toggle`, `append`, or `remove`. Older scripts without `value_type` are inferred from the existing value and operation.

`choice.conditions` are evaluated with `every(condition)`. Only passing choices are shown. If all choices are hidden, the engine automatically advances to the next command so playback does not stop on an empty choice panel.

`conditional_jump` is an automatic branch command. A true condition jumps to `target_scene_id`; a false condition jumps to `else_target_scene_id` when present or continues to the next command. Jumps are scheduled asynchronously to avoid synchronous recursion. The engine pauses with a debug hint after more than 100 consecutive automatic advances without hitting dialog, a visible choice, wait, or a blocking event.

## Sprite Animation

Sprite commands can carry `animation_config` for character standee animation. `StoryEngine` compiles that config into a runtime animation effect targeting `sprite:<character_id>`.

Runtime behavior:

- `visible: true` can play enter or emphasis animation.
- `visible: false` with an exit animation keeps the standee mounted until animation completion, then removes it.
- `blocking: true` waits for the animation before continuing the story.
- legacy `animation` strings are still mapped to runtime effects.
- `SpriteLayer` disables its default CSS entry/exit animation while a runtime sprite effect is active, preventing double animation.
- under `prefers-reduced-motion`, the state transition still completes even when visual motion is reduced.

## Validation Boundary

GameCLI expects player-facing data to be validated before playback:

- no duplicate scene IDs;
- valid entry, next-scene, choice, and conditional jump targets;
- valid command asset references;
- valid loading animation references;
- valid sprite animation config;
- valid `sprite:selected`, `sprite:all`, or traceable `sprite:<character_id>` animation targets.

Validation errors should be shown clearly. Runtime code should not hide data errors with silent story fallbacks.
## Video And Launch Transitions

- Title screens may use `manifest.shell.background_video`; failed unmuted autoplay falls back to the title image.
- Blocking scene video commands hide normal playback controls and expose a double-click, five-second hold skip gesture.
- Starting a new game covers the title screen with black before starting the engine, then reveals the first scene. Reduced-motion mode keeps the cover but shortens both phases.
