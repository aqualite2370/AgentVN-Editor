# Version Compatibility

Fields:

- `runtime_version`: minimum Runtime required by the cartridge.
- `cartridge_version`: cartridge format version.
- `manifest_version`: manifest schema version.
- `script_schema_version`: script schema version via `script.schema_version`.
- `save_compatibility_version`: optional save compatibility marker.
- `breaking_save_compatibility`: warns players old saves may not be compatible.

Runtime lower than required blocks startup/import. Newer cartridge format than supported blocks import.
