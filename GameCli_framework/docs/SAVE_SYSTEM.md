# Save System

`SaveData` schema 2 captures scene id, command index, variables, history, background, sprites, dialog, the active focused image overlay, unlocked gallery, real playtime, save kind, and an optional fixed WebP preview. Loading a save on `show_image` restores the overlay at the same command instead of skipping it.

Save kinds:

- `manual`: 12 player-controlled slots. Legacy saves without `save_kind` are normalized as manual saves.
- `auto`: 8 rotating slots. Auto saves are load-only in the save screen.

Auto saving is enabled by default and can be disabled under System settings. A save is scheduled at a choice checkpoint or after 12 new stable dialog, narration, or focused-image checkpoints. Writes are serialized, separated by at least 30 seconds, and replace the oldest auto slot after all eight slots are occupied.

Preview capture renders a deterministic 480x270 scene without runtime animation, audio, or quick controls, then encodes it as WebP. A preview failure never blocks the save itself.

The web adapter stores saves in `localStorage`. Tauri stores manual slots as `slot-NN.json` and automatic slots as `auto-NN.json`. Both adapters expose the same `{ kind, slot }` API.
