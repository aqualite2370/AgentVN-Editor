# AgentVN Editor

AgentVN is a local-first, AI-assisted visual novel authoring system. It
combines a React visual editor, a FastAPI backend, a Tauri desktop shell, a
portable `.vncart` cartridge format, and a standalone player runtime.

## Core components

- `editor/` — visual authoring, project management, novel import, provider
  configuration, assets, animation, preview, and export.
- `backend/` — local FastAPI service for OpenAI-compatible providers,
  structured generation, novel processing, memory, and persistence.
- `GameCli_framework/` — standalone player and runtime for `.vncart` games.
- `shared/` — cartridge schemas, validation, packing, compatibility, runtime
  capabilities, animation, camera, preview, and shared UI behavior.
- `docs/` — public format and feature documentation.

Editor projects use `.vnproj`. Published games use `.vncart`, which packages
the runtime script, manifest, assets, gallery metadata, checksums, credits,
and applicable license metadata.

## Requirements

- Node.js 20 or newer
- Python 3.10 or newer
- Rust and the Tauri prerequisites for desktop builds

## Development

Install JavaScript dependencies:

```powershell
npm install
npm --prefix GameCli_framework install
npm --prefix editor install
```

Start the backend:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8278
```

In another terminal, start the editor:

```powershell
cd editor
npm run dev
```

The editor is served at `http://127.0.0.1:6767` and uses
`http://127.0.0.1:8278` as its default backend.

Run the player independently:

```powershell
cd GameCli_framework
npm run dev
```

## Build

Build the web editor and player:

```powershell
npm run build
```

The public source repository intentionally excludes local release automation,
installer packaging scripts, generated sidecar binaries, test recordings,
private projects, databases, logs, and AI-agent work files.

## API keys and generated content

Copy `backend/.env.example` to `backend/.env` for local backend configuration.
Never commit API keys. Provider terms, input rights, model policies, font
licenses, and asset licenses remain the creator's responsibility.

Runtime exports do not intentionally include API keys, billing tokens, editor
coordinates, embeddings, or internal memory records.

## License

AgentVN is independently developed and copyrighted by AquaLite, an individual
developer publishing under that pseudonym. AgentVN is a project and brand, not
a company.

AgentVN is **source-available**, not Open Source under the OSI definition.
The default [Chinese license text](LICENSE) and the legally controlling
[English license text](LICENSE.en.md) define AgentVN Editor Source-Available
License v1.0. The license allows source
inspection, learning, research, private modification, contributions, and use
of the editor by individuals or studios to create commercial games. It does
not allow unauthorized commercial exploitation of the AgentVN editor itself,
including resale, proprietary commercial integration, hosted SaaS/API access,
or competing commercial authoring services.

Games and other works created with AgentVN are treated separately from the
editor. Subject to rights in your inputs, provider terms, and third-party
material, you may commercially use and sell generated games, text, images,
audio, video, cartridges, and data results. Runtime components may accompany
playable works under the conditions in the License.

See [Commercial Licensing](COMMERCIAL-LICENSING.md),
[Contributing](CONTRIBUTING.md), and
[Third-Party Notices](THIRD_PARTY_NOTICES.md).
