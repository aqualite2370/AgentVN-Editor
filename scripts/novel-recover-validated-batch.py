"""Recover an actually generated batch rejected by the nested-range validator.

No provider call, invented chapter, or modification to the original project.
Only a new private project copy is written after raw JSON/hash/range validation.
"""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.models.novel_import import NovelAiChunkAnalysis, NovelAiOutlineRequest, NovelAiOutlineStructure
from app.services.novel_import_service import NovelImportService
from app.services.novel_outline_pipeline import OutlinePipeline, VERSION, digest

private = Path(sys.argv[1])
events_path = private / "websocket.ndjson"
events = [json.loads(line) for line in events_path.read_text(encoding="utf8").splitlines()]
current_key = None
chunks = []
recovered = {}
for event in events:
    payload = event.get("payload") or {}
    if event["type"] == "tool_event" and payload.get("phase") == "outline_structure":
        details = payload.get("details") or {}
        if payload.get("title") == "大纲批次":
            current_key = details["batchKey"]
            chunks = []
    if event["type"] == "message_delta" and current_key:
        chunks.append(payload["delta"])
    if event["type"] == "tool_event" and payload.get("phase") == "outline_ranges":
        details = payload["details"]
        assert details["batchKey"] == current_key
        value = NovelAiOutlineStructure.model_validate_json("".join(chunks))
        assert [[c.start_offset, c.end_offset] for c in value.chapters] == details["returned"]
        recovered[current_key] = value

session = json.loads((private / "terminal-session.json").read_text(encoding="utf8"))
assert len(session["outline_partials"]["batches"]) == 7
request = NovelAiOutlineRequest(
    document_id=session["document"]["document_id"], title=session["document"]["title"],
    total_chars=session["document"]["total_chars"],
    analyses=[NovelAiChunkAnalysis(**{k: v for k, v in a.items()
                if k in NovelAiChunkAnalysis.model_fields}) for a in session["ai_chunk_analyses"]],
    partial_mainline=session["outline_partials"]["mainline"],
    partial_batches=session["outline_partials"]["batches"],
)
pipeline = OutlinePipeline(NovelImportService(), request)
groups = pipeline.groups("structure", pipeline.stage_rows("structure"), request.partial_mainline)
rows = groups[7]
system, user = pipeline.prompts("structure", rows, request.partial_mainline)
key = digest({"version": VERSION, "stage": "structure", "system": system, "user": user})
assert key in recovered, "Only exact prompt fingerprint may be recovered"
value = recovered[key]
pipeline.validate("structure", rows, value)
session["outline_partials"]["batches"].append(
    {"key": key, "stage": "structure", "payload": value.model_dump(mode="json")})
project = json.loads(Path(sys.argv[2]).read_text(encoding="utf8"))
original_hash = digest(project["editor_settings"]["novelPersistence"]["sessionSnapshot"]["ai_chunk_analyses"])
assert digest(session["ai_chunk_analyses"]) == original_hash
project["editor_settings"]["novelPersistence"]["sessionSnapshot"] = session
for filename, data in [("recovered-session.json", session), ("recovered-copy.vnproj", project)]:
    with (private / filename).open("x", encoding="utf8") as handle:
        json.dump(data, handle, ensure_ascii=False)
print(json.dumps({"status": "PASS_OFFLINE_RAW_MODEL_BATCH_RECOVERY", "providerCalls": 0,
    "sourceEventsSha256": hashlib.sha256(events_path.read_bytes()).hexdigest(),
    "batch": 8, "key": key, "chapters": len(value.chapters), "savedBatches": 8,
    "scanHash": original_hash, "originalProjectModified": False}, indent=2))
