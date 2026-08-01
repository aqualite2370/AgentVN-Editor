# Adaptation Workflow

AI adaptation is not continuation writing. It should preserve the source plot, major dialog, and traceability while converting prose into AgentVN commands.

Recommended mapping:

- Clear spoken lines -> `DialogCommand`.
- Environment, action, and inner monologue -> `NarrationCommand`.
- Explicit location or time-of-day change -> `BackgroundCommand` plus an `AssetSuggestion`.
- Key item, clue, photo, letter, or prop inspection -> `ShowImageCommand`; provide an image-like asset and accessible `alt` text.
- Character entrance or exit -> `SpriteCommand` plus an `AssetSuggestion`.
- Character standee motion -> `SpriteCommand.animation_config` when tied to show/hide, or `AnimationCommand` targeting `sprite:<character_id>` for standalone emphasis.
- Uncertain music -> leave BGM empty or create a low-confidence suggestion instead of forcing a track.
- Key camera/screen emphasis -> `AnimationCommand` or `CameraCommand`.
- Branch ideas -> `branch_suggestions`; they are validated before graph write and are not trusted blindly.

## Validation Contract

Before adapted scenes are written into the project graph, the structure validator checks scene IDs, choice targets, source mappings, branch source IDs, and command references.

Safe repairs such as deterministic `scene_id` deduplication may be applied with reference remapping. Unsafe issues block the import and are shown in the UI. The raw model response remains available for review.
