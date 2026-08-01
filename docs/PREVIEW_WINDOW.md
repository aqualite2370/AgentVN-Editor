# Preview Window

AgentVN has two preview paths with different responsibilities.

## Embedded live scene preview

The preview in the upper half of the right scene editor pane is an embedded GameCLI web build. It is served from the editor origin at `/gamecli-preview/` and communicates with the editor through the shared live-preview `postMessage` protocol.

The embedded preview has these architectural invariants:

- It must reuse one iframe and update scenes through `agentvn.live-preview.*` messages.
- It must resolve from the editor origin. It must not depend on a separately started localhost service or port `6868`.
- The editor development and production builds must build and bundle `GameCli_framework/dist`.
- GameCLI web assets must use relative paths so the build works below `/gamecli-preview/`.
- A missing or late standalone GameCLI process must not affect embedded preview initialization.

Port `6868` is reserved for standalone GameCLI development and complete preview workflows. It is not an embedded-preview dependency.

The static architecture contract is:

```text
npm run test:embedded-live-preview-architecture
```

The real-project Playwright acceptance uses the local `角鸮与夜之王` project, explicitly blocks requests to port `6868`, and verifies the rendered background, sprites, and dialogue:

```text
npm run acceptance:night-king-live-preview
```

## Full cartridge preview

Full preview uses the GameCLI cartridge container. The editor does not maintain a separate legacy browser preview shell for complete playback.

When the author clicks preview or sync to GameCLI, the editor:

1. Exports the current project to a temporary `.vncart`.
2. Runs the same export validation used by package export.
3. Writes the temporary cartridge to the preview cache.
4. Starts or notifies `GameCli_framework` with preview mode and the cartridge path.
5. GameCLI loads the cartridge and plays the runtime script.

Preview export includes current runtime UI skin, loading animation, character list, sprite animation config, and all referenced assets.

The temporary preview cartridge can be overwritten by the next preview sync. It does not replace a formal exported `.vncart` or release package.

In browser-only Vite development mode, the editor cannot launch the local GameCLI desktop process. It should show a clear message instructing the author to use the AgentVN desktop build for full GameCLI preview.
