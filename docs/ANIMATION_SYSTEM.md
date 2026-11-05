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

## 原生动画素材 JSON（Runtime 0.28）

当前源码支持把原生关键帧预设保存成 UTF-8 JSON，经过“选项→素材库→导入素材→保存到素材库”导入，再在场景的“演出动画素材”或事件工作台选择。动画是独立素材类型，不再归入“其他素材”。本节描述新源码能力；安装版与设备验收结论以对应版本报告为准。

完整文件示例：

```json
{
  "schema_version": "1.0.0",
  "preset_id": "gentle_emphasis",
  "name": "轻微强调",
  "target_type": "screen",
  "duration_ms": 720,
  "easing": "ease-out",
  "loop": false,
  "direction": "normal",
  "keyframes": [
    { "offset": 0, "x": 0 },
    { "offset": 0.5, "x": 24 },
    { "offset": 1, "x": 0 }
  ]
}
```

必要字段是 `duration_ms`（80～10000 毫秒）和 `keyframes`（2～512 帧）。帧的 `offset` 按 0～1 升序排列；可播放属性为 `opacity`、`x`、`y`、`scale`、`rotate`、`blur`、`brightness`，也可设置单帧 `easing`。`x/y` 使用逻辑像素，旋转单位为度。透明度为 0～1，缩放、模糊和亮度不能为负数。可选 `preset_id/name/description/target_type` 是描述信息，实际播放目标由指令的“演出目标”决定。

文件最多 1 MiB；不接受任意字段、非空 `custom_css`、JavaScript、Python、Lottie 或 Spine。缓动支持标准名称、合法 `cubic-bezier` 与 `steps`，播放方向支持 `normal/reverse/alternate/alternate-reverse`。循环动画必须取消阻塞，否则校验报错。

选中素材后，指令写入 `animation_asset_id`，`params: {}` 表示沿用文件。作者可显式覆盖 `duration/keyframes/easing/loop/direction/delay/delay_ms/transform_origin`；这些覆盖按指令生效。重新选择素材会清除旧覆盖。`duration` 是指令参数名，`duration_ms` 是素材文件字段，不能混用。编辑器内置角色动画与旧的命令内嵌关键帧继续独立工作。

卡带保留素材原始字节、引用和作者覆盖；运行时先读取并校验文件，再创建剧情引擎状态。缺文件、占位文件、格式或覆盖参数无效都会明确报错，不能回退默认淡入。替换文件后，未显式覆盖的属性使用新内容。旧工程只有 `animation_id` 且与真实动画素材 ID 对应、没有内嵌关键帧时，按旧素材选择识别；带内嵌关键帧的旧命令保持原语义。新引用卡带声明最低 Runtime 0.28，由现有版本检查拒绝旧 Runtime。

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
