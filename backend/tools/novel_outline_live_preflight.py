"""Offline planner check against a private saved task, never call a provider."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.models.novel_import import NovelAiOutlineRequest
from app.services.novel_import_service import NovelImportService
from app.services.novel_outline_pipeline import OutlinePipeline, MODELS, tokens


def main():
    source, output = map(Path, sys.argv[1:])
    if output.exists():
        raise RuntimeError("Refusing to overwrite evidence")
    project = json.loads(source.read_text(encoding="utf-8"))
    session = project["editor_settings"]["novelPersistence"]["sessionSnapshot"]
    # Provenance modelName is editor-only and deliberately absent from strict
    # model-output schemas, exactly as the real frontend transport strips it.
    analyses = [{k: v for k, v in a.items() if k != "modelName"}
                for a in session["ai_chunk_analyses"]]
    document = session["document"]
    request = NovelAiOutlineRequest.model_validate({
        "document_id": document["document_id"], "title": document["title"],
        "total_chars": len(document["normalized_text"]), "analyses": analyses,
        "partial_mainline": session["outline_partials"]["mainline"],
        "provider_selection": {"connection_id": "offline-preflight", "model_id": "deepseek-flash",
            "api_key": "synthetic-never-used", "base_url": "http://127.0.0.1:1/v1",
            "parameters": {"max_tokens": 3000, "context_budget_tokens": 24000}},
    })
    service = NovelImportService()
    def forbidden(*args, **kwargs):
        raise AssertionError("Offline preflight must never send a model request")
    service.provider.create_with_tools = forbidden
    service.provider.stream_with_tools = forbidden
    pipeline = OutlinePipeline(service, request)
    generator = pipeline.mainline()
    try:
        next(generator)
        raise AssertionError("Existing mainline must be reused without events or model calls")
    except StopIteration as stop:
        mainline = stop.value
    stages = []
    for stage in ("structure", "index"):
        groups = pipeline.groups(stage, pipeline.stage_rows(stage), mainline)
        selection, output_budget, input_budget = pipeline.selection(stage)
        counts = []
        for rows in groups:
            system, user = pipeline.prompts(stage, rows, mainline)
            prompt_tokens = tokens(system + user + json.dumps(
                MODELS[stage].model_json_schema(), ensure_ascii=False))
            assert prompt_tokens <= input_budget
            assert len(rows) <= 4
            counts.append({"rows": len(rows), "estimated_prompt_tokens": prompt_tokens,
                           "chapters": sum(len(r.chapter_candidates) for r in rows),
                           "characters": sum(len(r.characters) for r in rows)})
        stages.append({"stage": stage, "batches": counts, "max_tokens": output_budget,
                       "available_input_budget": input_budget})
    result = {"status": "PASS_OFFLINE_PRIVATE_85_SCAN_PLANNER_ONLY",
              "modelRequests": 0, "scans": len(analyses), "reused_mainline": True,
              "test_context_budget": 24000,
              "boundary": "Synthetic budget, not actual provider request, generation or restart proof",
              "stages": stages}
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "stages"}))


if __name__ == "__main__":
    main()
