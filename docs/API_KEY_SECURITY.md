# API Key Security

Current storage modes:

- `none`: no key.
- `session`: key lives only in memory.
- `local_encrypted`: reserved, not implemented.
- `os_keychain`: reserved for Tauri native integration.
- `relay_account`: reserved for platform relay.

The editor must not export API keys to `project.vnproj`, `script.json`, or `.vncart`.
