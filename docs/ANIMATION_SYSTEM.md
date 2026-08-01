# Animation System

AgentVN has two animation paths:

- `AnimationCommand` for scene-level performance effects such as screen flash, camera emphasis, dialog/UI effects, or an explicit sprite target.
- `SpriteCommand.animation_config` for character standee animation attached directly to show/hide/emphasis commands.

Both paths are exported into `script.json` and played by GameCLI with the Web Animations API. The editor keeps the original model result and author input; validation reports problems before export instead of silently replacing animation data.

## AnimationCommand

An `animation` command is still available for reusable performance beats.

```json
{
  "type": "animation",
  "animation_id": "flash_cut",
  "target": "screen",
  "params": { "duration": 450, "intensity": 0.85 },
  "blocking": true
}
```

Common targets:

- `screen`
- `background`
- `dialog`
- `ui`
- `camera`
- `sprite:selected`
- `sprite:all`
- `sprite:<character_id>`

The animation editor exposes a character target picker for sprite targets so authors no longer need to hand-type `sprite:<id>` for normal character standee effects. The advanced text entry remains available for custom runtime targets.

## Character Sprite Animation

`SpriteCommand` can carry a structured `animation_config`:

```json
{
  "type": "sprite",
  "character_id": "alice",
  "sprite_id": "alice_default",
  "position": "center",
  "visible": true,
  "animation": "fade_in",
  "animation_config": {
    "kind": "move",
    "phase": "enter",
    "duration_ms": 520,
    "easing": "ease-out",
    "direction": "left",
    "blocking": false,
    "display_name": "从左滑入"
  }
}
```

Supported `kind` values:

- `none`: no character animation.
- `fade`: fade in, fade out, or emphasis fade pulse.
- `move`: directional entrance, exit, or emphasis movement.
- `tween`: explicit keyframe interpolation.
- `preset`: named runtime preset such as `sprite_shake` or `sprite_heartbeat`.

Supported `phase` values:

- `enter`: used when a visible standee appears.
- `exit`: used before a hidden standee is removed.
- `emphasis`: used while the standee remains visible.

`direction` accepts `left`, `right`, `up`, `down`, `center`, and `none`. `duration_ms` is clamped to 80-10000 ms. `blocking` defaults to `false` so old sprite commands keep their pacing unless the author explicitly waits for the animation.

## Character Sprite Layers

`SpriteCommand.layer` controls overlap in multi-character compositions. It is an integer from `-1000` to `1000`; larger values render in front. Missing or `null` values inherit the same character's current layer, and characters without an existing layer use effective layer `0`. Equal layers keep the existing appearance order.

Layer changes do not reorder horizontal placement and do not change animation targets. `layer` controls depth, `animation_config` controls entry/exit/emphasis, and `switch_transition` controls same-character sprite replacement.

## Tween Keyframes

Tween keyframes use offsets from `0` to `1` and may animate:

- `opacity`
- `x`
- `y`
- `scale`
- `rotate`
- `blur`
- `brightness`

Example:

```json
{
  "kind": "tween",
  "phase": "enter",
  "duration_ms": 680,
  "easing": "cubic-bezier(0.18, 0.9, 0.18, 1)",
  "keyframes": [
    { "offset": 0, "opacity": 0, "x": -80, "scale": 0.98 },
    { "offset": 1, "opacity": 1, "x": 0, "scale": 1 }
  ]
}
```

GameCLI compiles these values into WAAPI keyframes. Under `prefers-reduced-motion`, the runtime keeps story state correct while reducing or skipping visual motion.

## Legacy Compatibility

The old `SpriteCommand.animation` string remains supported. Known values are mapped to structured configs at runtime:

- `fade_in` / `fade_out`
- `slide_in_left` / `slide_in_right`
- `slide_out_left` / `slide_out_right`
- `shake`
- `heartbeat`

Export keeps the legacy `animation` field when it already exists. New UI writes `animation_config` so validation and runtime playback can reason about direction, phase, keyframes, and blocking behavior.

## Validation

Editor export and cartridge import validate animation structure:

- `animation_config.kind`, `phase`, and `direction` must use supported values.
- `duration_ms` must be finite and within 80-10000 ms.
- keyframe `offset` must be in the `0..1` range.
- numeric tween fields must be finite numbers.
- `AnimationCommand.target` values of `sprite:<character_id>` must reference `selected`, `all`, or a character that can be traced from `script.characters`, dialog commands, or sprite commands.

Validation errors block export/import and are shown to the user; AgentVN does not silently fall back to a different animation.
