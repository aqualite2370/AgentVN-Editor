# AgentVN Player

Standalone Windows player shell for AgentVN `.vncart` cartridges.

## Features

- Imports `.vncart` files through the desktop file picker.
- Validates and copies cartridges into the app data library.
- Keeps installed cartridges in a reusable game list.
- Launches each cartridge by reparsing the copied package, so large assets are not persisted in localStorage.
- Stores saves under the installed cartridge id, isolating data between different game versions.

## Development

```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 5188
```

## Build

```powershell
npm run build
npm run tauri build
```

The raw executable is written to:

```text
src-tauri\target\release\agentvn-player.exe
```

Installers are written under:

```text
src-tauri\target\release\bundle\
```
