# Novel Import Limitations

Current limitations:

- AI adaptation results must be reviewed by an author.
- The importer preserves source traceability and may block unsafe model output before graph write.
- It can generate linear scene lines and branch suggestions, but branch suggestions are validated and remain author-reviewable.
- Character recognition can propose IDs, names, and aliases, but authors should review merged or ambiguous characters.
- OCR is not handled.
- Complex PDF extraction is not handled.
- `docx` is supported through the current document parser boundary, but layout-heavy documents may still need manual cleanup.
- Asset suggestions are prompts and references, not guaranteed final production assets.

Blocked structure errors are intentional. AgentVN should stop on unsafe scene IDs, missing choice targets, invalid branch sources, missing source mapping, or invalid command references instead of silently inventing fallback content.
