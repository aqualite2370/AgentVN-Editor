# Novel Import Design

The novel import module is an editor-only conversion workflow. It is not an AI continuation feature and it is not part of GameCLI runtime playback.

Its job is to turn an existing long-form novel into reviewable AgentVN scene nodes while preserving the model's raw response for audit.

## Workflow

1. Read `txt`, `md`, or `docx`.
2. Normalize the source text and estimate token cost.
3. Split the document into chunks, chapters, and scene candidates.
4. Ask the configured text model for a whole-book outline and generation plan.
5. Let the author review or edit the outline before writing nodes.
6. Generate blueprint scenes progressively.
7. Run structure validation before each generated outline or blueprint batch is written into the project graph.
8. Write valid scenes and edges to the editor graph with source mapping metadata.

Import data remains editor-only. The raw document, AI inspection data, validation reports, and source mappings are not exported to player-facing `script.json`.

## Structure Validation Before Graph Write

`validateNovelBlueprintWrite()` validates model output before it enters the project graph. This prevents late failures during `.vncart` export.

The validator checks:

- `scene_id` uniqueness.
- choice `target_scene_id` exists in the current batch, existing graph, or can be safely created from a branch suggestion.
- every imported scene has traceable source mapping back to the source document or scene candidate.
- branch suggestion `source_scene_id` points to an imported or existing scene.
- command references are structurally valid, including legal character and asset reference types.

Safe structural repairs are allowed. For example, duplicate `scene_id` values can be renamed deterministically and internal references can be remapped to the repaired IDs.

Unsafe repairs are blocked. Missing choice targets, untraceable source mappings, invalid branch sources, and command references that cannot be proven valid stop the import flow and show a clear UI error. AgentVN does not silently drop branches or replace model content with rule-generated fallback scenes.

## Validation Reports

Each validation run produces a `NovelImportValidationReport` and stores it in `validation_reports`.

Report statuses:

- `passed`: model output was structurally safe as returned.
- `fixed`: model output was accepted after deterministic structural repair.
- `blocked`: output could not be safely written to the project graph.

The novel import page displays the validation summary so authors can see whether the import passed, was auto-fixed, or was blocked. The report includes issue codes, messages, paths, and repair details where available.

## Source Mapping

Imported scenes keep a `source_mapping` record:

- `document_id`
- `start_offset`
- `end_offset`
- `source_excerpt`
- `adapted_command_ids`

This lets the editor show how each generated scene relates to the original prose. Editing command content can update command ID mapping, but it should not rewrite the original source offsets.

## Quality Report

After blueprint generation the import workflow may produce a `quality_report` that summarizes coverage, risk, skipped scenes, unresolved source ranges, and recommendations. Quality risk is shown separately from hard structure validation:

- structure errors block graph writes;
- quality warnings can be reviewed, retried, or explicitly accepted by the author.

## Raw Model Response

The model's original structured response remains available for review. Validation and repair produce additional metadata; they do not replace the raw model result. This makes it possible to compare:

- original model output;
- normalized/adapted scene data;
- validation report;
- repair/remapping details;
- final nodes written to the project graph.
