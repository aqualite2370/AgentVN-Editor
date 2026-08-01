# AgentVN Editor

React/Vite frontend for the AgentVN visual novel editor.

## Development

Start the backend on `http://127.0.0.1:8278`, then:

```powershell
npm install
npm run dev
```

The editor builds the player preview first and starts Vite on
`http://127.0.0.1:6767`.

## Build

```powershell
npm run build
```

For Tauri development, install the platform prerequisites and run:

```powershell
npm run tauri dev
```

Generated sidecar binaries, installer resources, release automation, and
local test artifacts are intentionally not included in the public repository.
