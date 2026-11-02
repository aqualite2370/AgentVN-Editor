# Save System

`SaveData` schema 3 captures scene id, command index, variables, history, background, sprites, current BGM state, dialog, the active focused image overlay, unlocked gallery, real playtime, save kind, and an optional fixed WebP preview. NVL and other paginated dialogue saves may also include `dialog_page_index` and `dialog_page_count`; older saves without these optional fields resume at the first fragment. Fragment rollback and roll-forward stay within the current line before moving to another story checkpoint. Loading a save on `show_image` restores the overlay at the same command instead of skipping it.

New saves persist `bgm_state` so loading resumes the authored track at the saved story position. Legacy saves without this field restore an immediate BGM stop state, because their cross-scene or branch history cannot reliably identify the correct track.

Save kinds:

- `manual`: 12 player-controlled slots. Legacy saves without `save_kind` are normalized as manual saves.
- `auto`: 8 rotating slots. Auto saves are load-only in the save screen.

Auto saving is enabled by default and can be disabled under System settings. A save is scheduled at a choice checkpoint or after 12 new stable dialog, narration, or focused-image checkpoints. Writes are serialized, separated by at least 30 seconds, and replace the oldest auto slot after all eight slots are occupied.

Preview capture prefers the real 16:9 story frame at the save checkpoint and excludes quick controls, save notices, and animation hints. The result is scaled to 480x270 and encoded as a WebP capped at 120 KiB. `preview_version: 2` marks this pipeline. Captures are checked against scene id and command index before they can be attached to a save; a changed frame falls back to a stable state reconstruction. Existing saves without preview version 2 are upgraded serially in the background when the save screen opens. A preview failure never blocks the save itself.

The web adapter stores saves in `localStorage`. If browser storage is full, it retries after removing `preview_image`, `preview_version`, and preview-only choice metadata so gameplay progress still persists. Tauri stores manual slots as `slot-NN.json` and automatic slots as `auto-NN.json`. Both adapters expose the same `{ kind, slot }` API.

The editor's live preview uses the same browser save adapter, with keys isolated by `live_preview_<game_id>`, so saving and loading can be verified without mixing data between projects.
