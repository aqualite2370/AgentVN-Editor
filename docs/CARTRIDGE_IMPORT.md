# Cartridge Import

Runtime import reads `.vncart` with JSZip, validates safe paths, rejects executable files, checks package size limits, reads JSON files, verifies checksum, checks version compatibility, validates script targets and asset references, then creates a game library install record.

If `game_id` already exists, version comparison decides install, update, reinstall, or downgrade warning.
