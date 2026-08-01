# AgentVN Cartridge Format

`.vncart` is AgentVN's single-file game cartridge format. It is a constrained ZIP archive that contains everything the player runtime needs to launch a visual novel: metadata, runtime script, assets, optional gallery data, optional runtime UI skin, optional release metadata, and checksums.

It is not an editor project, app installer, save file, AI memory database, or backend data bundle.

## Extension and MIME

```text
Extension: .vncart
MIME: application/vnd.agentvn.cartridge+zip
Container: ZIP / DEFLATE
```

## Required Files

```text
manifest.json
script.json
checksum.json
```

## Optional Files

```text
gallery.json
assets/
ui/layout.json
ui/assets/
metadata/credits.json
metadata/changelog.json
metadata/license.json
```

## Recommended Layout

```text
game.vncart
|- manifest.json
|- script.json
|- checksum.json
|- gallery.json
|- assets/
|  |- backgrounds/
|  |- sprites/
|  |- portraits/
|  |- audio/
|  |  |- bgm/
|  |  |- sfx/
|  |  `- voice/
|  `- ui/
|- ui/
|  |- layout.json
|  `- assets/
`- metadata/
   |- credits.json
   |- changelog.json
   `- license.json
```

## Manifest

`manifest.json` identifies the game and indexes every packaged asset.

Important fields:

```json
{
  "manifest_version": "1.0.0",
  "cartridge_version": "1.0.0",
  "runtime_version": "0.2.0",
  "game_id": "rain_station",
  "title": "Rain Station",
  "author": "Author",
  "version": "0.1.0",
  "language": "zh-CN",
  "cover": "cover_art",
  "shell": {
    "background": "title_bg",
    "background_video": "title_loop_video",
    "background_fit": "stretch",
    "icon": "title_icon",
    "settings_panel_background": "settings_panel_bg",
    "settings_panel_background_fit": "contain",
    "settings_entry_image": "settings_entry_icon"
  },
  "entry_script": "script.json",
  "entry_scene_id": "scene_opening",
  "assets": [
    {
      "asset_id": "station_rain",
      "asset_type": "background",
      "path": "assets/backgrounds/station_rain.png",
      "filename": "station_rain.png",
      "mime_type": "image/png",
      "size_bytes": 123456,
      "hash_sha256": "..."
    }
  ],
  "ui_skin": {
    "path": "ui/layout.json",
    "version": "1.0.0",
    "name": "AgentVN Default Runtime Skin"
  },
  "created_at": "2026-05-25T13:50:43.200Z",
  "updated_at": "2026-05-25T13:50:43.200Z"
}
```

Allowed `asset_type` values are `background`, `sprite`, `portrait`, `bgm`, `sfx`, `voice`, `video`, `animation`, `ui`, `font`, and `other`.

`manifest.shell` is player shell metadata. `background` is the home splash / main menu background, `icon` is the cartridge or title icon, `settings_panel_background` is the settings screen panel image, and `settings_entry_image` is the image shown beside the settings entry button. These image fields are asset IDs and are optional for backward compatibility. `background_fit` and `settings_panel_background_fit` control background display mode: `stretch` maps to `background-size: 100% 100%`, `contain` keeps the full image visible, and `cover` fills while cropping. Missing or invalid fit values are treated as `stretch`. Advanced `ui/layout.json` styling can still override more specific runtime layout details.

`shell.background_video` optionally references a `video` asset for the title screen. GameCLI attempts unmuted looping autoplay. If playback is rejected or decoding fails, the video is hidden and `shell.background` remains the fallback image.

## Runtime Script

`script.json` is the clean player-facing story graph. It must not contain editor-only graph coordinates, AI/provider state, memory stores, or source document data.

Required top-level fields:

```json
{
  "schema_version": "1.1.0",
  "game_id": "rain_station",
  "title": "Rain Station",
  "entry_scene_id": "scene_opening",
  "scenes": []
}
```

Optional top-level fields:

```json
{
  "loading_animation": { "kind": "default" },
  "characters": [
    {
      "character_id": "alice",
      "name": "Alice",
      "aliases": ["A"],
      "dialog_style": {
        "background_asset_id": "alice_dialog_panel",
        "background_fit": "cover",
        "theme_color": "#d58a72"
      }
    }
  ]
}
```

`speaker_focus` configures automatic sprite emphasis for the current dialog speaker:

```json
{
  "speaker_focus": {
    "enabled": true,
    "scale": 1.05,
    "duration_ms": 220
  }
}
```

Missing configuration uses the same defaults. Narration and dialog from characters without a visible sprite do not focus a sprite.

Scenes use `next_scene_id` for default continuation and `choice.target_scene_id` for branches.

## Dialog Visual Style

Dialog commands may carry per-line visual overrides:

```json
{
  "type": "dialog",
  "character_id": "alice",
  "text": "I knew you would come back.",
  "dialog_style_mode": "manual",
  "dialog_style": {
    "background_asset_id": "alice_dialog_panel",
    "background_fit": "contain",
    "theme_color": "#d58a72"
  }
}
```

`dialog_style.background_asset_id` should reference a UI image asset. `background_fit` accepts `stretch`, `contain`, or `cover`; omitted values preserve the legacy `cover` behavior. The same per-line style is available to narration commands. `theme_color` must be a safe hex color such as `#d58a72`. Runtime priority is: manual dialog override, then `characters[].dialog_style`, then the runtime UI skin `dialog_panel` defaults. A character default is exported from project settings and applies only to inherited dialog lines; manually overridden lines are not batch-overwritten.

## Loading Animation

`loading_animation` controls the GameCLI loading screen before the story starts.

Supported shapes:

```json
{ "kind": "default" }
```

```json
{ "kind": "video", "video_asset_id": "boot_video" }
```

```json
{
  "kind": "image_sequence",
  "image_asset_ids": ["boot_frame_001", "boot_frame_002"],
  "frame_duration_ms": 1000
}
```

`default` uses the built-in circular boot animation. Video loading animations must reference a `video` asset. Image sequence frames are packed as `ui` assets; when `frame_duration_ms` is omitted, the editor defaults to 1000 ms per frame.

## Character Sprite Animation

Sprite commands may include both the legacy `animation` string and the structured `animation_config`.

```json
{
  "type": "sprite",
  "character_id": "alice",
  "sprite_id": "alice_default",
  "position": "center",
  "layer": 4,
  "visible": true,
  "animation": "fade_in",
  "animation_config": {
    "kind": "fade",
    "phase": "enter",
    "duration_ms": 520,
    "easing": "ease-out",
    "direction": "center",
    "blocking": false,
    "display_name": "淡入"
  }
}
```

`layer` is optional and must be an integer from `-1000` to `1000`. Larger values render in front. Missing values preserve legacy appearance ordering and inherit the current layer when the same character changes outfit or expression.

`kind` can be `none`, `fade`, `move`, `tween`, or `preset`. `phase` can be `enter`, `exit`, or `emphasis`. Tween keyframes can animate `opacity`, `x`, `y`, `scale`, `rotate`, `blur`, and `brightness` with offsets from `0` to `1`.

The old `animation` field remains compatible with projects that use values such as `fade_in`, `slide_in_left`, or `shake`.

## Focused Image Event

`show_image` temporarily places an image above the entire story player. The backdrop dims and blurs the stage, dialog, choices, and playback controls until the player dismisses the image.

```json
{
  "type": "show_image",
  "image_id": "clue_photo",
  "image_fit": "contain",
  "image_display_name": "沾血的钥匙",
  "caption": "钥匙背面刻着旧宿舍编号。",
  "alt": "一把带编号的旧钥匙",
  "backdrop_opacity": 0.62,
  "backdrop_blur_px": 12
}
```

`image_id` is required and must reference an image-like `background`, `sprite`, `portrait`, or `ui` asset, or an asset whose MIME type starts with `image/`. `image_fit` accepts `contain`, `cover`, or `stretch` and defaults to `contain`. Backdrop opacity is limited to `0..0.9`; blur is limited to `0..24` pixels.

The event is blocking. Auto play, skip, and ordinary stage clicks cannot pass it. Clicking the overlay or pressing Enter, Space, or Escape fades it out, then advances to the next command. If the image cannot be resolved, GameCLI shows a dismissible error placeholder instead of trapping playback.

## Cutscene Video Event

`video` is a blocking full-screen cutscene command:

```json
{
  "type": "video",
  "video_id": "chapter_1_cutscene",
  "video_fit": "contain",
  "fade_in_ms": 500,
  "fade_out_ms": 500
}
```

The asset must use `asset_type: "video"`. The video plays with sound, hides normal story controls, and advances automatically after ending. A double click reveals the skip prompt; holding the video for five seconds completes the progress ring and skips after the configured fade-out. Playback failures show a continue action rather than trapping the story.

Recommended media is MP4 with H.264 video and AAC audio at 1920x1080 and 24 or 30 FPS. Home loops should normally stay under 20 MB; cutscenes should normally stay under 150 MB and remain below the 512 MB cartridge single-file limit.

## Runtime UI Skin

`ui/layout.json` is an optional declarative runtime UI skin. It lets a cartridge carry player-facing layout and style choices without shipping arbitrary code.

Allowed `ui/layout.json` top-level fields:

```json
{
  "ui_layout_version": "1.0.0",
  "name": "AgentVN Default Runtime Skin",
  "target_runtime": "0.2.0",
  "tokens": {
    "colorBackground": "#060812",
    "colorSurface": "#0d121f",
    "colorInk": "#f6f8ff",
    "colorAccent": "#82b6ff",
    "colorSliderTrack": "#344154",
    "colorSliderActive": "#82b6ff",
    "colorSliderThumb": "#192234",
    "radius": 10,
    "motionScale": 1
  },
  "screens": [],
  "assets": []
}
```

Runtime UI skins are constrained:

- They may position and style known runtime components such as `dialog_panel`, `choice_list`, `quick_menu`, independent title menu buttons, `save_slot_grid`, and `settings_group`.
- They may define desktop and mobile rectangles using percentages.
- Slider colors are authored in the editor at Tools/Settings (Client Layout) > Client Theme > Scope > Slider Colors. GameCLI reads `colorSliderTrack`, `colorSliderActive`, and `colorSliderThumb` from the exported skin, but the player settings screen does not expose color editing.
- They may reference bundled UI images under `ui/assets/` or normal game assets under `assets/`.
- They may not include JavaScript, HTML, external URLs, event handlers, arbitrary CSS text, or local file paths.
- If the skin is missing, invalid, or unsupported, GameCLI falls back to its built-in default layout.

## Checksum

`checksum.json` contains SHA-256 entries for files that must be verified before launch. AgentVN validates listed file size and hash during import.

## Import and Validation Rules

The runtime importer must:

1. Read the cartridge through `File.stream()` when available.
2. Enforce package and single-file size limits while reading.
3. Reject unsafe paths such as `../`, absolute paths, backslashes, NUL bytes, or Windows drive paths.
4. Reject executable extensions.
5. Validate required files.
6. Parse and validate manifest, script, gallery, UI skin, and checksum.
7. Verify checksum entries.
8. Verify script references: `entry_scene_id`, `next_scene_id`, and choice targets.
9. Verify loading animation asset references and asset types.
10. Verify command asset references, shell visual asset references, dialog style assets, and sprite animation configs.
11. Verify `sprite:<character_id>` animation targets can be traced to `script.characters`, dialog commands, or sprite commands.
12. Create runtime asset URLs or install assets into a platform store.

Errors block import/export. Warnings may be shown without blocking when playback can continue safely.

## Forbidden Content

Forbidden content includes:

```text
project.vnproj
React Flow nodes
editor coordinates
Inspector state
AI API keys
provider secrets
source novel text
source mapping records
validation reports
quality reports
embeddings
SQLite files
Python cache
player saves
executable files
```

Forbidden executable extensions include `.exe`, `.dll`, `.bat`, `.cmd`, `.sh`, `.ps1`, `.msi`, `.app`, `.apk`, and `.jar`.
