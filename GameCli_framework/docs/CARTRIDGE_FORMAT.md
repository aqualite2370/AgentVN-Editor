# Cartridge Format

GameCLI treats `.vncart` as a constrained ZIP archive that contains the player-facing runtime files:

```text
game.vncart
|- manifest.json
|- script.json
|- checksum.json
|- gallery.json
|- assets/
`- ui/layout.json
```

Required files are `manifest.json`, `script.json`, and `checksum.json`. `gallery.json`, runtime UI skin files, release metadata, and assets are optional but validated when present.

`manifest.shell` may provide player shell visuals:

- `background`: home splash / main menu background asset ID.
- `background_fit`: home splash / main menu background display mode, one of `stretch`, `contain`, or `cover`.
- `icon`: title or cartridge icon asset ID.
- `settings_panel_background`: settings screen panel background asset ID.
- `settings_panel_background_fit`: settings screen panel background display mode, one of `stretch`, `contain`, or `cover`.
- `settings_entry_image`: settings button entry image asset ID.

GameCLI uses these values only when the referenced assets are packed. Missing or invalid fit values are rendered as `stretch`, which maps to `background-size: 100% 100%`. Runtime UI layout can still override more specific screen styling.

## Runtime Script

`script.json` must include `schema_version`, `game_id`, `title`, `entry_scene_id`, and `scenes`. It may also include:

- `loading_animation`: built-in boot animation, video, or image sequence.
- `characters`: character IDs, names, aliases, optional `dialog_style`, and sprite animation target validation data.

GameCLI rejects script references that point to missing scenes and rejects sprite animation targets that cannot be traced to a known character unless the target is `sprite:selected` or `sprite:all`.

Dialog style priority is per-line manual `DialogCommand.dialog_style`, then `characters[].dialog_style`, then the runtime UI skin dialog panel. Narration commands can also carry a per-line `dialog_style`. `dialog_style.background_fit` accepts `stretch`, `contain`, or `cover`; omitted values keep the legacy `cover` behavior. A manual dialog line is not overwritten by character default updates in the editor.

## Loading Animation Assets

Loading animation asset rules:

- `{ "kind": "default" }` uses the built-in circular boot animation.
- `{ "kind": "video", "video_asset_id": "..." }` must reference a packed asset with `asset_type: "video"`.
- `{ "kind": "image_sequence", "image_asset_ids": [...] }` must reference packed assets with `asset_type: "ui"`.
- Image sequences default to 1000 ms per image when `frame_duration_ms` is omitted.

## Validation

During import, GameCLI validates:

- required files and safe ZIP paths;
- manifest/script version compatibility;
- checksums, package size, and single-file size;
- entry scene, next scene, choice targets, and conditional jump targets;
- command asset references;
- shell visual and dialog style asset references;
- loading animation asset references;
- sprite `animation_config` values and tween keyframes;
- forbidden editor or AI metadata.

Errors block launch or install. Warnings can be shown when the cartridge remains safe to play.
## Speaker Focus And Video Extensions

The optional `RuntimeScript.speaker_focus` object enables automatic scale emphasis for the visible dialog speaker. Missing values use enabled, `1.05` scale, and `220ms`.

Scene commands may use a blocking `video` event with `video_id`, `video_fit`, `fade_in_ms`, and `fade_out_ms`. The referenced asset must use `asset_type: "video"`.

`manifest.shell.background_video` may reference a looping, unmuted title-screen video. If autoplay or decoding fails, GameCLI falls back to `manifest.shell.background`.
