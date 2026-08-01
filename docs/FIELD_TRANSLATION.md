# Cartridge Field Translation

This document explains player-facing cartridge and editor-adjacent fields that the assistant may need to reference.

## GameManifest

- `manifest_version`: manifest schema version.
- `cartridge_version`: `.vncart` format version.
- `runtime_version`: minimum compatible GameCLI runtime version.
- `game_id`: stable game ID.
- `title`: game title.
- `subtitle`: optional subtitle.
- `author`: author or team name.
- `description`: game description.
- `version`: game content version.
- `language`: language tag such as `zh-CN`.
- `tags`: release/search tags.
- `cover`: cover asset ID or path.
- `shell`: optional player shell visual metadata.
  - `shell.background`: home splash / main menu background asset ID.
  - `shell.background_fit`: home splash / main menu background display mode, one of `stretch`, `contain`, or `cover`; default is `stretch`.
  - `shell.icon`: title or cartridge icon asset ID.
  - `shell.settings_panel_background`: settings screen panel background asset ID.
  - `shell.settings_panel_background_fit`: settings screen panel background display mode, one of `stretch`, `contain`, or `cover`; default is `stretch`.
  - `shell.settings_entry_image`: settings button entry image asset ID.
- `entry_script`: runtime script file, normally `script.json`.
- `entry_scene_id`: first playable scene ID.
- `assets`: packaged asset manifest.
- `ui_skin`: optional pointer to `ui/layout.json`.
- `created_at` / `updated_at`: ISO timestamps.
- `save_compatibility_version`: save compatibility marker.
- `breaking_save_compatibility`: whether old saves may break.

## RuntimeScript

- `schema_version`: script schema version.
- `game_id`: same stable game ID as manifest.
- `title`: game title.
- `entry_scene_id`: first playable scene ID.
- `loading_animation`: optional loading screen config.
- `characters`: optional character list used for names, aliases, sprite animation target validation, and default dialog visual styles.
- `scenes`: runtime scene list.

## LoadingAnimationConfig

- `kind`: `default`, `video`, or `image_sequence`.
- `video_asset_id`: video asset used when `kind` is `video`.
- `image_asset_ids`: ordered UI image assets used when `kind` is `image_sequence`.
- `frame_duration_ms`: image sequence frame duration; editor default is 1000 ms.

## Scene

- `scene_id`: stable scene ID used by links and saves.
- `title`: scene title.
- `summary`: author-facing scene summary.
- `chapter`: chapter number.
- `tags`: scene tags.
- `commands`: ordered runtime command list.
- `commands[].background_fit`: background command display mode, one of `stretch`, `contain`, or `cover`; default is `stretch`.
- `next_scene_id`: default next scene.
- `is_ending`: marks a terminal scene.
- `ending_id`: ending identifier.

## GameCommand

- `dialog.character_id`: speaking character ID.
- `dialog.text`: spoken text.
- `dialog.emotion`: optional emotion/expression label.
- `dialog.portrait`: portrait asset ID.
- `dialog.voice`: voice asset ID.
- `dialog.side`: speaker side, such as `left`, `right`, or `center`.
- `dialog.dialog_style`: optional per-line `DialogVisualStyle`.
- `dialog.dialog_style_mode`: `inherit` or `manual`; manual overrides are not batch-overwritten by character defaults.
- `background.background_id`: background asset ID.
- `background.transition`: background transition code.
- `show_image.image_id`: image-like asset ID shown in the focused overlay.
- `show_image.image_fit`: `contain`, `cover`, or `stretch`; default is `contain`.
- `show_image.image_display_name`: readable author-side image name.
- `show_image.caption`: optional caption below the focused image.
- `show_image.alt`: accessible image description.
- `show_image.backdrop_opacity`: backdrop dim amount from `0` to `0.9`.
- `show_image.backdrop_blur_px`: backdrop blur from `0` to `24` pixels.
- `sprite.character_id`: character controlled by the standee command.
- `sprite.sprite_id`: standee asset ID.
- `sprite.position`: standee position.
- `sprite.animation`: legacy standee transition string.
- `sprite.animation_config`: structured character standee animation config.
- `sprite.visible`: whether the standee should be visible after the command.
- `choice.choices`: player choice list.
- `choice.choice_id`: stable choice ID.
- `choice.target_scene_id`: scene reached by the choice.
- `state_update.key`: runtime variable name.
- `state_update.operation`: `set`, `add`, `subtract`, `toggle`, `append`, or `remove`.
- `state_update.value`: runtime variable value.
- `animation.animation_id`: reusable animation/effect asset ID.
- `animation.target`: target such as `screen`, `dialog`, `sprite:selected`, `sprite:all`, or `sprite:<character_id>`.
- `animation.params`: runtime animation parameters.
- `animation.blocking`: whether story playback waits for the animation.
- `bgm.bgm_id`: BGM asset ID.
- `bgm.action`: `play`, `stop`, or `fade`.
- `bgm.volume`: BGM volume.
- `bgm.fade_ms`: fade duration.
- `sfx.sfx_id`: sound effect asset ID.
- `wait.duration_ms`: wait duration.

## CharacterSpriteAnimationConfig

- `kind`: `none`, `fade`, `move`, `tween`, or `preset`.
- `phase`: `enter`, `exit`, or `emphasis`.
- `duration_ms`: duration from 80 to 10000 ms.
- `easing`: CSS/WAAPI easing string.
- `direction`: `left`, `right`, `up`, `down`, `center`, or `none`.
- `keyframes`: tween keyframes with offsets from `0` to `1`.
- `blocking`: whether story playback waits for this sprite animation.
- `display_name`: editor-facing label.
- `preset_id`: runtime preset ID for `kind: "preset"`.

## DialogVisualStyle

- `background_asset_id`: UI asset ID for the dialog box background image.
- `background_fit`: dialog box background display mode: `stretch`, `contain`, or `cover`; omitted values use `cover`.
- `theme_color`: optional hex color such as `#d58a72` used by the runtime for dialog emphasis.

Runtime priority is manual dialog style, then `characters[].dialog_style`, then the runtime UI skin dialog panel defaults.

## CharacterAnimationKeyframe

- `offset`: keyframe progress from `0` to `1`.
- `opacity`: opacity from `0` to `1`.
- `x` / `y`: translation in pixels.
- `scale`: scale multiplier.
- `rotate`: rotation in degrees.
- `blur`: blur amount.
- `brightness`: brightness multiplier or amount used by the runtime compiler.

## AssetManifestItem

- `asset_id`: stable asset ID.
- `asset_type`: `background`, `sprite`, `portrait`, `bgm`, `sfx`, `voice`, `video`, `animation`, `ui`, `font`, or `other`.
- `path`: path inside the cartridge.
- `filename`: original file name.
- `mime_type`: media type.
- `size_bytes`: file size.
- `hash_sha256`: asset checksum.
- `preload`: whether runtime should preload it.
- `width` / `height`: image or video dimensions.
- `duration_ms`: audio/video duration.
- `tags`: asset tags.
- `placeholder`: whether this is a placeholder asset.
- `ai_generated`: whether the asset was AI generated.
- `license_note`: license note for release review.

## Novel Import

- `validation_reports`: structure validation history for passed, fixed, and blocked writes.
- `quality_report`: model conversion quality summary and risk report.
- `source_mapping`: trace from adapted scenes back to source document offsets.
- `branch_suggestions`: model-proposed branches, validated before graph write.
- `source_scene_id`: source scene used by a branch suggestion.
- `adapted_command_ids`: generated command IDs covered by a source mapping.

Novel import fields are editor-only and are not exported to `script.json`.

## CartridgeValidationResult

- `ok`: whether validation passed.
- `errors`: blocking issues.
- `warnings`: non-blocking issues.
- `code`: issue code.
- `message`: user-facing issue message.
- `path`: path to the problematic field.
- `severity`: `error` or `warning`.
