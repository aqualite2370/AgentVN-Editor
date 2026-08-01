# Source Mapping

Source mapping records how an imported novel scene maps back to the original document.

Each imported `AdaptedScene` can carry:

- `document_id`
- `start_offset`
- `end_offset`
- `source_excerpt`
- `adapted_command_ids`

The mapping is used for side-by-side review: original prose on one side, generated visual-novel scene structure on the other.

## Validation

Novel import structure validation requires generated scenes to remain traceable before they are written into the project graph. A valid source mapping must point to the imported document or a known scene candidate. If a model returns a scene that cannot be traced, the import is blocked instead of silently writing an unverifiable node.

When deterministic repairs are made, such as renaming duplicate `scene_id` values, internal references are remapped while the original source offsets remain unchanged.

Source mapping is editor-only. It is not exported to `script.json` or `.vncart`.
