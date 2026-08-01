# Field Translation

This document explains the runtime fields GameCLI reads from `script.json`, `manifest.json`, saves, and gallery data.

## RuntimeScript

- `schema_version`: script schema version.
- `game_id`: stable game ID.
- `title`: game title.
- `entry_scene_id`: first playable scene ID.
- `loading_animation`: optional loading screen config.
- `characters`: optional character list used for names, aliases, and animation target validation.
- `scenes`: scene list.

## LoadingAnimationConfig

- `kind`: `default`, `video`, or `image_sequence`.
- `video_asset_id`: packed `video` asset used by video loading animation.
- `image_asset_ids`: ordered packed `ui` assets used by image sequence loading animation.
- `frame_duration_ms`: image frame duration; default is 1000 ms.

## Scene

- `scene_id`: stable scene ID.
- `title`: scene title.
- `summary`: scene summary.
- `chapter`: chapter number.
- `tags`: scene tags.
- `commands`: ordered command list.
- `next_scene_id`: default next scene.
- `is_ending`: whether this scene is an ending.
- `ending_id`: ending ID.

## GameCommand

- `dialog.character_id`: speaking character ID.
- `dialog.text`: dialog text.
- `dialog.emotion`: emotion/expression label.
- `dialog.portrait`: portrait asset ID.
- `dialog.voice`: voice asset ID.
- `background.background_id`: background asset ID.
- `background.background_fit`: background display mode, one of `stretch`, `contain`, or `cover`; default is `stretch`.
- `background.transition`: background transition code.
- `show_image.image_id`: image-like asset ID shown in the focused overlay.
- `show_image.image_fit`: `contain`, `cover`, or `stretch`; default is `contain`.
- `show_image.image_display_name`: readable image name.
- `show_image.caption`: optional caption below the focused image.
- `show_image.alt`: accessible image description.
- `show_image.backdrop_opacity`: dim amount from `0` to `0.9`.
- `show_image.backdrop_blur_px`: backdrop blur from `0` to `24` pixels.
- `sprite.character_id`: character controlled by a standee command.
- `sprite.sprite_id`: standee asset ID.
- `sprite.position`: standee position.
- `sprite.animation`: legacy standee animation string.
- `sprite.animation_config`: structured standee animation config.
- `sprite.visible`: whether the standee remains visible.
- `choice.choices`: player choices.
- `choice.target_scene_id`: scene reached by a choice.
- `state_update.key`: runtime variable name.
- `state_update.operation`: variable operation.
- `state_update.value`: variable value.
- `animation.animation_id`: animation/effect ID.
- `animation.target`: target such as `screen`, `dialog`, `sprite:selected`, `sprite:all`, or `sprite:<character_id>`.
- `animation.params`: runtime animation parameters.
- `animation.blocking`: whether story playback waits.
- `bgm.bgm_id`: BGM asset ID.
- `bgm.action`: `play`, `stop`, or `fade`.
- `sfx.sfx_id`: sound effect asset ID.
- `wait.duration_ms`: wait duration.

## CharacterSpriteAnimationConfig

- `kind`: `none`, `fade`, `move`, `tween`, or `preset`.
- `phase`: `enter`, `exit`, or `emphasis`.
- `duration_ms`: duration from 80 to 10000 ms.
- `easing`: CSS/WAAPI easing string.
- `direction`: `left`, `right`, `up`, `down`, `center`, or `none`.
- `keyframes`: tween keyframes.
- `blocking`: whether the command waits for animation completion.
- `display_name`: editor-facing label.
- `preset_id`: runtime preset ID.

## Manifest

- `manifest_version`: manifest schema version.
- `cartridge_version`: cartridge format version.
- `runtime_version`: required GameCLI version.
- `game_id`: stable game ID.
- `title`: game title.
- `author`: author name.
- `version`: game version.
- `cover`: cover asset ID or path.
- `description`: game description.
- `entry_script`: script file path.
- `entry_scene_id`: first playable scene ID.
- `assets`: asset manifest.
- `ui_skin`: optional runtime UI skin pointer.
- `tags`: tags.
- `language`: language tag.

## AssetManifestItem

- `asset_id`: stable asset ID.
- `asset_type`: `background`, `sprite`, `portrait`, `bgm`, `sfx`, `voice`, `video`, `animation`, `ui`, `font`, or `other`.
- `path`: asset path inside the cartridge.
- `mime_type`: media type.
- `preload`: whether runtime should preload it.

## SaveData

- `save_id`: save ID.
- `game_id`: game ID.
- `slot`: save slot.
- `created_at`: creation time.
- `scene_id`: current scene ID.
- `command_index`: command index.
- `variables`: runtime variables.
- `history`: dialog history.
- `background`: current background.
- `sprites`: current standee state.
- `dialog`: current dialog state.
- `unlocked_gallery`: unlocked gallery item IDs.
- `playtime_seconds`: play time.

## GalleryItem

- `item_id`: gallery item ID.
- `title`: item title.
- `asset_id`: asset ID.
- `unlock_condition`: unlock rule.
- `hidden_until_unlocked`: whether to hide before unlock.

## ValidationIssue

- `code`: issue code.
- `message`: user-facing message.
- `path`: field path.
- `severity`: `error` or `warning`.
