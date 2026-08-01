# AgentVN Backend

AgentVN Backend is a local-first Python backend for AI-assisted visual novel authoring. It receives editor context, retrieves optional long-term memory, calls an OpenAI-compatible model, and returns validated visual novel data built from `GameCommand` objects.

This stage intentionally contains no frontend, React, Tauri shell, runtime player, cartridge importer, cloud service, or user system.

## Install

Use Python 3.10+.

```bash
cd backend
uv sync --extra dev
```

If you do not use `uv`:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
```

## Environment

Copy `.env.example` to `.env` and configure:

```env
LLM_API_KEY=your_deepseek_api_key
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat

EMBEDDING_API_KEY=your_embedding_api_key
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
DATABASE_PATH=./data/vn_engine.db
DEFAULT_MEMORY_MODE=hybrid
```

DeepSeek is the default OpenAI-compatible chat provider. Other compatible providers can be used by changing `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY`.

## sqlite-vec

The project depends on `sqlite-vec` and attempts to load it at connection time. EmotionTrace stores embeddings in SQLite and performs a Python fallback ranking path, so development remains usable even if the native extension is not present. Packaged builds should include the sqlite-vec dynamic library as described in `docs/PACKAGING.md`.

## Run

```bash
cd backend
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Health check:

```bash
curl http://127.0.0.1:8000/api/health
```

## AgentVN MCP Tools

Scene generation and memory extraction prefer MCP-style tool calls instead of asking the model to write JSON as normal text. The backend exposes the same tool registry through the editor API and a stdio launcher:

```bash
cd backend
python agentvn_mcp_server.py
```

Available tools:

- `create_scene_beat`: validates one `SceneBeat` for the editor.
- `extract_memory_update`: validates one `MemoryUpdate`.

The HTTP JSON-RPC endpoint is available at `POST /api/mcp` for local integrations.

## API Examples

Generate a scene:

```bash
curl -X POST http://127.0.0.1:8000/api/generate_scene ^
  -H "Content-Type: application/json" ^
  -d "{\"current_scene\":\"Alice confronts Bob in the rain.\",\"author_goal\":\"Reveal tension without resolving it.\",\"memory_mode\":\"hybrid\",\"chapter\":3}"
```

Extract memory:

```bash
curl -X POST http://127.0.0.1:8000/api/extract_memory ^
  -H "Content-Type: application/json" ^
  -d "{\"memory_mode\":\"hybrid\",\"chapter\":3,\"scene\":{\"scene_id\":\"s1\",\"title\":\"Rain\",\"summary\":\"Alice confronts Bob.\",\"chapter\":3,\"tags\":[],\"commands\":[{\"type\":\"narration\",\"text\":\"Rain fell.\"}]}}"
```

Set memory mode:

```bash
curl -X POST http://127.0.0.1:8000/api/memory/mode ^
  -H "Content-Type: application/json" ^
  -d "{\"memory_mode\":\"chronicle_graph_only\"}"
```

## Memory Modes

- `none`: no long-term memory; generation uses only the current request context.
- `chronicle_graph_only`: uses objective temporal relations and world facts.
- `emotion_trace_only`: uses subjective character memories and emotional recall.
- `hybrid`: uses both objective facts and subjective emotional memory.

## ChronicleGraph

ChronicleGraph is the objective temporal graph. It stores relations, world state, faction links, event causality, and chapter-based changes. Invalidating a relation marks the old edge inactive and preserves history; new state is represented by a new edge.

## EmotionTrace

EmotionTrace is character-specific subjective episodic memory. It stores memory summaries, embeddings, memory strength, emotional dimensions, decay, drift, and recall scores. Retrieval combines semantic similarity, memory strength, recency, and emotional relevance.

## Runtime Compatibility

Runtime script data must remain separate from editor and AI metadata. `SceneBeat`, `GameCommand`, `AssetRef`, and `RuntimeScript` are safe for future `script.json` export. Runtime payloads must not include embeddings, API keys, provider metadata, editor coordinates, database IDs, or internal memory records.

## Tests

```bash
cd backend
uv run pytest
```
