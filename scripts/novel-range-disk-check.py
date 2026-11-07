"""Read the finished isolated real task's SQLite data without copying credentials."""
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

qa = Path(sys.argv[1]).resolve()
private = Path(sys.argv[2]).resolve()
report = json.loads((qa / "report.json").read_text(encoding="utf8"))
assert report["status"] == "PASS_REAL_OUTLINE_REVIEW_REQUIRED"
terminal = json.loads((private / "terminal-session.json").read_text(encoding="utf8"))
database = qa / "isolated-data" / "vn_engine.db"
with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as conn:
    rows = conn.execute("SELECT project_id, project_json FROM editor_project_details").fetchall()
matches = []
for project_id, text in rows:
    project = json.loads(text)
    snapshot = project.get("editor_settings", {}).get("novelPersistence", {}).get("sessionSnapshot")
    if snapshot and snapshot.get("session_id") == terminal.get("session_id"):
        matches.append((project_id, project, snapshot))
assert len(matches) == 1, "Exact persisted session ownership required"
project_id, project, saved = matches[0]
for key in ("document", "ai_chunk_analyses", "outline_partials", "ai_outline", "ai_stage"):
    assert saved[key] == terminal[key], f"Disk differs from terminal {key}"
assert saved["ai_stage"] == "outline"
assert len(saved["ai_chunk_analyses"]) == 85
assert saved["ai_outline"]["chapters"]
target = private / "persisted-copy.vnproj"
with target.open("x", encoding="utf8") as handle:
    json.dump(project, handle, ensure_ascii=False)
result = {
    "status": "PASS_REAL_SQLITE_FINAL_OUTLINE",
    "database": str(database),
    "providerRequests": 0,
    "scans": len(saved["ai_chunk_analyses"]),
    "batches": len(saved["outline_partials"]["batches"]),
    "chapters": len(saved["ai_outline"]["chapters"]),
    "needsReview": saved["ai_outline"].get("needs_review"),
    "privateProjectSha256": hashlib.sha256(target.read_bytes()).hexdigest(),
}
with (qa / "disk-check.json").open("x", encoding="utf8") as handle:
    json.dump(result, handle, indent=2)
print(json.dumps(result))
