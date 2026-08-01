# API Usage

Base URL:

```text
http://127.0.0.1:8000/api
```

## Health

```http
GET /api/health
```

## Generate Scene

```http
POST /api/generate_scene
```

Body:

```json
{
  "current_scene": "Alice confronts Bob in the rain.",
  "previous_summary": "Bob disappeared after the chapel incident.",
  "author_goal": "Build tension and end on a choice.",
  "memory_mode": "hybrid",
  "chapter": 3,
  "character_id": "alice"
}
```

Returns `SceneBeat`.

## Extract Memory

```http
POST /api/extract_memory
```

Body contains a `SceneBeat`, `memory_mode`, and `chapter`. Returns `MemoryUpdate`.

## Apply Memory Update

```http
POST /api/memory/apply_update?chapter=3
```

Applies relation invalidations, new relations, and emotion snapshots to SQLite.
The request body is a `MemoryUpdate` object.

## Relations

```http
GET /api/relations
GET /api/relations/history
```

Optional query parameters: `source`, `target`.

## Memories

```http
GET /api/memories
```

Optional query parameter: `character_id`.

## Memory Mode

```http
GET /api/memory/mode
POST /api/memory/mode
```

POST body:

```json
{ "memory_mode": "hybrid" }
```
