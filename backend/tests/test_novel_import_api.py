import inspect

import pytest
from fastapi.testclient import TestClient

from app.api import routes_novel_import
from app.ai.structured_normalization import normalize_structured_payload
from app.core.errors import AIProviderError
from app.main import create_app
from app.mcp.tools import agentvn_tool_registry
from app.models.novel_import import (
    AdaptSceneResponse,
    AdaptedScene,
    ChapterCandidate,
    CharacterCandidate,
    ConflictPoint,
    NovelAiChapterScenePlan,
    NovelAiBranchSuggestionResponse,
    NovelAiChunkAnalysis,
    NovelAiChunkEntityIndex,
    NovelAiChunkSummary,
    NovelAiChunkTimelineNotes,
    NovelAiConflictAnalysisResponse,
    NovelAiOutlineIndex,
    NovelAiOutlineMainline,
    NovelAiOutlineResponse,
    NovelAiOutlineStructure,
    NovelAiPlanChapterRequest,
    NovelAiScenePlanResponse,
    SceneCandidate,
    SourceMapping,
)
from app.models.scene import SceneBeat
from app.schemas.requests import ProviderSelectionParameters, ProviderSelectionRequest
from app.services.novel_import_service import NovelImportService, suggested_scene_count_for_text


def _provider_selection() -> dict[str, object]:
    return {"connection_id": "conn", "model_id": "model", "base_url": "http://localhost", "api_key": "sk-test"}


def test_novel_adaptation_prompt_covers_every_editor_event_type() -> None:
    prompt_source = inspect.getsource(NovelImportService._adapt_scene_beat_user_prompt)
    expected = {
        "dialog",
        "narration",
        "hide_dialog",
        "background",
        "show_image",
        "video",
        "sprite",
        "choice",
        "state_update",
        "conditional_jump",
        "jump",
        "animation",
        "bgm",
        "sfx",
        "camera",
        "wait",
    }

    assert all(command_type in prompt_source for command_type in expected)
    assert "Do not output structured camera motion" not in prompt_source


def test_adapt_scene_response_normalizes_nested_command_list_and_hoists_review_fields() -> None:
    payload = {
        "adapted_scene": {
            "source_scene_candidate_id": "ch6_scene_1",
            "scene_beat": [
                {"type": "narration", "text": "风停在天台门口。"},
                {"type": "sprite", "character_id": "lin_che", "position": "left"},
            ],
            "branch_suggestions": [
                {
                    "branch_id": "branch_confess",
                    "source_scene_candidate_id": "ch6_scene_1",
                    "choice_title": "留下解释",
                    "summary": "主角选择说出真相。",
                    "enabled_by_default": True,
                }
            ],
            "conflict_points": [
                {"point": "角色忽然离开缺少动机。", "suggests_branch": True}
            ],
            "review_notes": None,
        }
    }

    normalized = normalize_structured_payload(AdaptSceneResponse, payload)
    response = AdaptSceneResponse(**normalized)

    assert response.adapted_scene.source_scene_candidate_id == "ch6_scene_1"
    assert response.adapted_scene.scene_beat.commands[1].type == "sprite"
    assert response.adapted_scene.scene_beat.commands[1].sprite_id == "lin_che"
    assert response.branch_suggestions[0].suggestion_id == "branch_confess"
    assert response.branch_suggestions[0].enabled_by_default is False
    assert response.conflict_points[0].description == "角色忽然离开缺少动机。"


def test_adapt_scene_response_normalizes_text_scene_beat_with_command_aliases() -> None:
    payload = {
        "adapted_scene": {
            "scene_beat": "雷狼龙在走廊拨通电话。",
            "commands": [
                {"command": "set_background", "id": "hallway", "background_fit": "cover", "needs_review": False},
                {"command": "say", "speaker": "lei_lang", "content": "我会处理。"},
                {"wait": {"duration": 1.0}},
            ],
            "conflict_points": [{"point": "电话动机需要补足。"}],
        }
    }

    normalized = normalize_structured_payload(AdaptSceneResponse, payload)
    response = AdaptSceneResponse(**normalized)

    commands = response.adapted_scene.scene_beat.commands
    assert response.adapted_scene.scene_beat.summary == "雷狼龙在走廊拨通电话。"
    assert commands[0].type == "background"
    assert commands[0].background_id == "hallway"
    assert commands[0].background_fit == "cover"
    assert commands[1].type == "dialog"
    assert commands[1].character_id == "lei_lang"
    assert commands[2].type == "wait"
    assert commands[2].duration_ms == 1000


def test_adapt_scene_response_strips_adapted_scene_notes() -> None:
    payload = {
        "adapted_scene": {
            "scene_beat": "金奥加盘腿坐在地上，翻开旧物。",
            "commands": [
                {"type": "background", "background_id": "room"},
                {"type": "wait", "duration": 2.0},
            ],
            "conflict_points": [{"point": "主线选择清晰，场景无需分支。"}],
            "branch_suggestions": [],
            "notes": "场景从发现收纳盒开始，备注不应进入项目数据。",
        }
    }

    normalized = normalize_structured_payload(AdaptSceneResponse, payload)
    response = AdaptSceneResponse(**normalized)

    assert response.adapted_scene.scene_beat.commands[1].duration_ms == 2000
    assert "备注不应进入项目数据" in response.adapted_scene.warnings[0]
    assert response.conflict_points[0].description == "主线选择清晰，场景无需分支。"


def test_adapt_scene_response_normalizes_top_level_adapted_scene_shape() -> None:
    payload = {
        "adapted_scene_id": "adapted_scene_3",
        "source_scene_candidate_id": "ch2_scene_3",
        "scene_beat": {
            "title": "烟火前的争执",
            "summary": "两名角色在天台争论是否公开真相。",
            "commands": [{"type": "narration", "text": "风吹过栏杆。"}],
        },
        "source_mapping": {
            "document_id": "novel_doc",
            "start_offset": 10,
            "end_offset": 120,
            "source_excerpt": "风吹过栏杆。",
        },
        "needs_review": False,
        "conflict_points": [{"point": "公开真相的动机需要补足。"}],
        "branch_suggestions": [{"branch_id": "branch_public", "choice_text": "公开真相", "summary": "转向公开路线"}],
        "unused_note": "模型多余说明应该被剔除",
    }

    normalized = normalize_structured_payload(AdaptSceneResponse, payload)
    response = AdaptSceneResponse(**normalized)

    assert response.adapted_scene.adapted_scene_id == "adapted_scene_3"
    assert response.adapted_scene.source_scene_candidate_id == "ch2_scene_3"
    assert response.adapted_scene.scene_beat.title == "烟火前的争执"
    assert response.conflict_points[0].description == "公开真相的动机需要补足。"
    assert response.branch_suggestions[0].suggestion_id == "branch_public"


def test_adapt_scene_response_normalizes_camel_case_adapted_scene_shape() -> None:
    payload = {
        "adaptedSceneId": "adapted_scene_4",
        "sourceSceneCandidateId": "ch2_scene_4",
        "sceneBeat": [
            {"type": "dialog", "speaker": "shen_yan", "content": "先核对录音。"},
            {"type": "sprite", "character_id": "zhou_ming", "position": "right"},
        ],
        "sourceMapping": {
            "document_id": "novel_doc",
            "start_offset": 121,
            "end_offset": 240,
            "source_excerpt": "先核对录音。",
        },
        "needsReview": True,
        "extra": {"reason": "模型包装字段"},
    }

    normalized = normalize_structured_payload(AdaptSceneResponse, payload)
    response = AdaptSceneResponse(**normalized)

    assert response.adapted_scene.adapted_scene_id == "adapted_scene_4"
    assert response.adapted_scene.scene_beat.commands[0].type == "dialog"
    assert response.adapted_scene.scene_beat.commands[0].character_id == "shen_yan"
    assert response.adapted_scene.scene_beat.commands[1].sprite_id == "zhou_ming"
    assert response.adapted_scene.needs_review is True


def _chunk_analysis() -> NovelAiChunkAnalysis:
    return NovelAiChunkAnalysis(
        chunk_id="chunk_1",
        index=0,
        summary="林澈在雨夜抵达车站。",
        chapter_candidates=[
            ChapterCandidate(
                chapter_id="chapter_1",
                title="雨夜车站",
                index=0,
                start_offset=0,
                end_offset=120,
                summary="主角抵达车站并遇见关键角色。",
                confidence=0.8,
            )
        ],
        characters=[CharacterCandidate(character_id="lin_che", name="林澈", description="关键角色", confidence=0.8)],
        locations=["车站"],
        timeline=["夜里"],
        foreshadowing=[],
        warnings=[],
        confidence=0.8,
    )


def _chunk_summary() -> NovelAiChunkSummary:
    return NovelAiChunkSummary(
        chunk_id="chunk_1",
        index=0,
        summary="林澈在雨夜抵达车站。",
        warnings=[],
        confidence=0.8,
    )


def _chunk_entities() -> NovelAiChunkEntityIndex:
    return NovelAiChunkEntityIndex(
        chapter_candidates=[
            ChapterCandidate(
                chapter_id="chapter_1",
                title="雨夜车站",
                index=0,
                start_offset=0,
                end_offset=120,
                summary="主角抵达车站并遇见关键角色。",
                confidence=0.8,
            )
        ],
        characters=[CharacterCandidate(character_id="lin_che", name="林澈", description="关键角色", confidence=0.8)],
        locations=["车站"],
        warnings=[],
    )


def _chunk_timeline() -> NovelAiChunkTimelineNotes:
    return NovelAiChunkTimelineNotes(
        timeline=["夜里"],
        foreshadowing=[],
        warnings=[],
    )


def _outline() -> NovelAiOutlineResponse:
    return NovelAiOutlineResponse(
        document_id="doc_test",
        title="测试小说",
        summary="主角在雨夜车站卷入事件。",
        main_plot="主角调查车站谜团。",
        chapters=[
            ChapterCandidate(
                chapter_id="chapter_1",
                title="雨夜车站",
                index=0,
                start_offset=0,
                end_offset=120,
                summary="主角抵达车站。",
                confidence=0.8,
            )
        ],
        characters=[],
        timeline=["夜里"],
        locations=["车站"],
        branch_or_foreshadowing=[],
        warnings=[],
        needs_review=False,
        coverage_confidence=0.8,
    )


def _outline_mainline() -> NovelAiOutlineMainline:
    return NovelAiOutlineMainline(
        document_id="doc_test",
        title="测试小说",
        summary="主角在雨夜车站卷入事件。",
        main_plot="主角调查车站谜团。",
        warnings=[],
        needs_review=False,
        coverage_confidence=0.8,
    )


def _outline_structure() -> NovelAiOutlineStructure:
    return NovelAiOutlineStructure(
        chapters=[
            ChapterCandidate(
                chapter_id="chapter_1",
                title="雨夜车站",
                index=0,
                start_offset=0,
                end_offset=120,
                summary="主角抵达车站。",
                confidence=0.8,
            )
        ],
        timeline=["夜里"],
        branch_or_foreshadowing=[],
        conflict_points=[],
        warnings=[],
    )


def _outline_index() -> NovelAiOutlineIndex:
    return NovelAiOutlineIndex(
        characters=[],
        locations=["车站"],
        warnings=[],
    )


def _scene_plan() -> NovelAiScenePlanResponse:
    return NovelAiScenePlanResponse(
        chapter_id="chapter_1",
        scenes=[
            SceneCandidate(
                scene_candidate_id="scene_candidate_1",
                chapter_id="chapter_1",
                title="抵达车站",
                display_name="第 1 场",
                index=0,
                start_offset=0,
                end_offset=120,
                location_hint="车站",
                time_hint="夜里",
                characters=["林澈"],
                source_excerpt="林澈低声道：“你来了。”",
                summary="主角抵达车站。",
                confidence=0.8,
            )
        ],
        warnings=[],
        needs_review=False,
    )


def _chapter_scene_plan() -> NovelAiChapterScenePlan:
    return NovelAiChapterScenePlan(
        chapter_id="chapter_1",
        scenes=[
            SceneCandidate(
                scene_candidate_id="scene_candidate_1",
                chapter_id="chapter_1",
                title="抵达车站",
                display_name="第 1 场",
                index=0,
                start_offset=0,
                end_offset=120,
                location_hint="车站",
                time_hint="夜里",
                characters=["林澈"],
                source_excerpt="林澈低声道：“你来了。”",
                summary="主角抵达车站。",
                confidence=0.8,
            )
        ],
        warnings=[],
        needs_review=False,
    )


def _adapt_response() -> AdaptSceneResponse:
    scene = SceneBeat(
        scene_id="scene_test",
        scene_display_name="第 1 场",
        title="抵达车站",
        summary="主角抵达车站。",
        chapter=1,
        commands=[{"type": "narration", "text": "雨声落在站台上。"}],
        tags=["novel_import"],
    )
    return AdaptSceneResponse(
        adapted_scene=AdaptedScene(
            adapted_scene_id="adapted_1",
            source_scene_candidate_id="scene_candidate_1",
            scene_beat=scene,
            source_mapping=SourceMapping(document_id="doc_test", start_offset=0, end_offset=120, source_excerpt="林澈低声道：“你来了。”"),
            warnings=[],
            needs_review=False,
        ),
        character_updates=[],
        asset_suggestions=[],
        branch_suggestions=[],
        warnings=[],
    )


def test_novel_import_suggested_scene_count_for_6000_chars() -> None:
    assert suggested_scene_count_for_text(6000) >= 3


def test_novel_import_analyze_chunk() -> None:
    client = TestClient(create_app())
    response = client.post(
        "/api/novel/import/analyze_chunk",
        json={"text": "林澈低声道：“你还是来了。”\n阿洛问：“车站外的雨停了吗？”\n夜里，车站很安静。"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["dialogue_count"] == 2
    assert payload["characters"] == ["林澈", "阿洛"]
    assert "车站" in payload["locations"]
    assert "夜里" in payload["times"]


def test_novel_import_extract_characters_uses_real_chinese_names() -> None:
    client = TestClient(create_app())
    response = client.post(
        "/api/novel/import/extract_characters",
        json={"text": "夜里，林澈说：“我在这里。”\n她问：“真的吗？”\n陈雨答道：“真的。”"},
    )
    assert response.status_code == 200
    characters = response.json()["characters"]
    assert [item["name"] for item in characters] == ["林澈", "陈雨"]
    assert characters[0]["description"] == "自动识别，需人工确认。"


def test_novel_import_split_scene_preserves_chinese_hints() -> None:
    client = TestClient(create_app())
    text = "夜里，车站很安静。\n林澈说：“你终于来了。”\n\n第二天，教室里传来铃声。\n陈雨问：“作业交了吗？”"
    response = client.post(
        "/api/novel/import/split_scene",
        json={"chapter_id": "chapter_1", "text": text, "max_scene_chars": 32},
    )
    assert response.status_code == 200
    scenes = response.json()["scenes"]
    assert scenes[0]["title"] == "场景 1"
    assert scenes[0]["display_name"] == "第 1 场"
    assert scenes[0]["location_hint"] == "车站"
    assert scenes[0]["time_hint"] == "夜里"
    assert scenes[0]["characters"] == ["林澈"]
    assert scenes[1]["location_hint"] == "教室"
    assert scenes[1]["time_hint"] == "第二天"


def test_novel_import_adapt_scene_handles_chinese_quotes() -> None:
    client = TestClient(create_app())
    response = client.post(
        "/api/novel/import/adapt_scene",
        json={
            "scene_candidate": {
                "scene_candidate_id": "scene_candidate_test",
                "chapter_id": "chapter_1",
                "title": "雨夜重逢",
                "display_name": "第 1 场",
                "index": 0,
                "start_offset": 0,
                "end_offset": 28,
                "location_hint": "车站",
                "time_hint": "夜里",
                "characters": ["林澈"],
                "source_excerpt": "林澈低声道：「你还是来了。」\n雨声落在站台上。",
                "summary": "林澈在车站与主角重逢。",
                "confidence": 0.8,
            },
            "known_characters": [],
            "import_options": {},
            "memory_mode": "none",
        },
    )
    assert response.status_code == 200
    commands = response.json()["adapted_scene"]["scene_beat"]["commands"]
    assert commands[0]["transition_display_name"] == "淡入过场"
    assert commands[1]["type"] == "dialog"
    assert commands[1]["character_id"] == "林澈"
    assert commands[1]["text"] == "你还是来了。"
    assert commands[2]["text"] == "雨声落在站台上。"


def test_novel_import_mcp_tools_are_registered_and_validate_near_misses() -> None:
    tool_names = {tool["name"] for tool in agentvn_tool_registry.list_tools()}
    assert {"analyze_novel_chunk", "build_novel_outline", "plan_novel_chapter", "adapt_novel_scene"}.issubset(tool_names)

    chunk = agentvn_tool_registry.validate_tool_arguments(
        "analyze_novel_chunk",
        {
            "chunkId": "chunk_1",
            "chunk_index": 0,
            "summary": "林澈到达车站。",
            "chapters": [{"id": "chapter_1", "name": "雨夜车站", "start_offset": 0, "end_offset": 10, "summary": "开场。"}],
            "character_candidates": [{"id": "lin", "name": "林澈"}],
            "location": "车站",
            "times": ["夜里"],
            "confidence": 0.8,
        },
    )
    assert isinstance(chunk, NovelAiChunkAnalysis)
    assert chunk.chapter_candidates[0].chapter_id == "chapter_1"
    assert chunk.characters == []
    assert chunk.locations == ["车站"]


def test_novel_import_chunk_normalizes_gemini_near_miss_fields() -> None:
    payload = {
        "chunk_id": "chunk_1",
        "index": 0,
        "summary": "A school rooftop scene with several competing clues.",
        "chapter_candidates": [
            {
                "id": "chapter_1",
                "name": "Opening",
                "index": 0,
                "start_offset": 0,
                "end_offset": 100,
                "summary": "The opening chapter.",
            }
        ],
        "characters": [
            {
                "id": "shen",
                "name": "Shen Yan",
                "alias": "transfer student",
                "profile": "Temporary school paper editor.",
            },
            {
                "id": "zhou",
                "name": "Zhou Ming",
                "alias": ["broadcast club", "suspect"],
            },
        ],
        "locations": [
            {"name": "notice board", "description": "Anonymous accusation papers are pinned here."},
            {"name": "broadcast room"},
        ],
        "timeline": [{"name": "after school", "description": "Before the cultural festival."}],
        "plot_elements": [
            {"title": "edited recording", "description": "May become a later branch point."}
        ],
        "confidence": 0.82,
    }

    normalized = normalize_structured_payload(NovelAiChunkAnalysis, payload)
    analysis = NovelAiChunkAnalysis(**normalized)

    assert analysis.characters[0].aliases == ["transfer student"]
    assert len(analysis.characters) == 1
    assert analysis.locations[0] == "notice board：Anonymous accusation papers are pinned here."
    assert analysis.locations[1] == "broadcast room"
    assert analysis.timeline == ["after school：Before the cultural festival."]
    assert analysis.foreshadowing == ["edited recording：May become a later branch point."]
    assert any("plot_elements" in warning for warning in analysis.warnings)


def test_novel_import_ai_scan_chunk_requires_real_provider() -> None:
    client = TestClient(create_app())
    response = client.post(
        "/api/novel/import/ai_scan_chunk",
        json={
            "document_id": "doc_test",
            "chunk_id": "chunk_1",
            "index": 0,
            "text": "Chapter 1\nAlice says hello in the rain station.",
            "start_offset": 0,
            "end_offset": 48,
        },
    )
    assert response.status_code == 502
    assert "小说 AI 分块扫描失败" in response.json()["detail"]


def test_novel_import_ai_routes_use_mcp_tool_path(monkeypatch) -> None:
    calls: list[type[object]] = []

    def fake_create_with_tools(model, system_prompt, prompt, **kwargs):  # type: ignore[no-untyped-def]
        calls.append(model)
        if model is NovelAiChunkSummary:
            assert "基础摘要" in system_prompt or "导入摘要" in system_prompt
            return _chunk_summary()
        if model is NovelAiChunkEntityIndex:
            assert "人物" in system_prompt
            return _chunk_entities()
        if model is NovelAiChunkTimelineNotes:
            assert "时间线" in system_prompt
            return _chunk_timeline()
        if model is NovelAiOutlineMainline:
            assert "主线" in system_prompt
            return _outline_mainline()
        if model is NovelAiOutlineStructure:
            assert "章节结构" in system_prompt
            return _outline_structure()
        if model is NovelAiOutlineIndex:
            assert "人物和地点索引" in system_prompt
            return _outline_index()
        if model is NovelAiChapterScenePlan:
            assert "SceneCandidate" in system_prompt
            return _chapter_scene_plan()
        if model is SceneBeat:
            assert "SceneBeat" in system_prompt
            return _adapt_response().adapted_scene.scene_beat
        if model is NovelAiConflictAnalysisResponse:
            assert "conflict" in system_prompt.lower()
            return NovelAiConflictAnalysisResponse(conflict_points=[], warnings=[])
        raise AssertionError(model)

    monkeypatch.setattr(routes_novel_import.service.provider, "create_with_tools", fake_create_with_tools)
    client = TestClient(create_app())
    provider_selection = _provider_selection()
    scan_response = client.post(
        "/api/novel/import/ai_scan_chunk",
        json={
            "document_id": "doc_test",
            "chunk_id": "chunk_1",
            "index": 0,
            "text": "林澈在雨夜车站等待。",
            "start_offset": 0,
            "end_offset": 48,
            "provider_selection": provider_selection,
        },
    )
    assert scan_response.status_code == 200
    assert scan_response.json()["summary"] == "林澈在雨夜抵达车站。"

    outline_response = client.post(
        "/api/novel/import/ai_build_outline",
        json={"document_id": "doc_test", "title": "测试小说", "total_chars": 120, "analyses": [scan_response.json()], "provider_selection": provider_selection},
    )
    assert outline_response.status_code == 200
    outline = outline_response.json()
    assert outline["chapters"][0]["chapter_id"] == "chapter_1"

    plan_response = client.post(
        "/api/novel/import/ai_plan_chapter",
        json={
            "document_id": "doc_test",
            "chapter": outline["chapters"][0],
            "outline_summary": outline["summary"],
            "known_characters": [],
            "text": "林澈低声道：“你来了。”",
            "provider_selection": provider_selection,
        },
    )
    assert plan_response.status_code == 200
    plan = plan_response.json()
    assert plan["chapter_id"] == "chapter_1"
    assert plan["scenes"]

    adapt_response = client.post(
        "/api/novel/import/ai_adapt_scene",
        json={
            "scene_candidate": plan["scenes"][0],
            "known_characters": [],
            "previous_scene_summary": "",
            "outline_summary": outline["summary"],
            "import_options": {},
            "memory_mode": "none",
            "provider_selection": provider_selection,
        },
    )
    assert adapt_response.status_code == 200
    assert adapt_response.json()["adapted_scene"]["scene_beat"]["scene_id"] == "scene_test"
    assert calls == [
        NovelAiChunkSummary,
        NovelAiChunkEntityIndex,
        NovelAiChunkTimelineNotes,
        NovelAiOutlineMainline,
        NovelAiOutlineStructure,
        NovelAiOutlineIndex,
        NovelAiChapterScenePlan,
        NovelAiConflictAnalysisResponse,
        SceneBeat,
        NovelAiConflictAnalysisResponse,
    ]


def test_novel_import_ai_plan_chapter_repairs_scene_minimum_and_branch_shortfall(monkeypatch) -> None:
    calls: list[type[object]] = []
    paragraph = "夜里，林澈在车站等待。陈雨问：“你真的要走吗？”雨声落下，灯光闪烁。\n\n"
    text = (paragraph * ((6000 // len(paragraph)) + 2))[:6000]
    min_scene_count = suggested_scene_count_for_text(len(text))
    chapter = ChapterCandidate(
        chapter_id="chapter_long",
        title="长样本",
        index=0,
        start_offset=0,
        end_offset=len(text),
        summary="长样本章节。",
        confidence=0.9,
    )

    def fake_create_with_tools(model, system_prompt, prompt, **kwargs):  # type: ignore[no-untyped-def]
        calls.append(model)
        if model is NovelAiChapterScenePlan:
            assert f"scenes quantity minimum: {min_scene_count}" in prompt
            assert "source_span" in system_prompt
            if calls.count(NovelAiChapterScenePlan) > 1:
                scene_length = len(text) // min_scene_count
                return NovelAiChapterScenePlan(
                    chapter_id="chapter_long",
                    scenes=[
                        SceneCandidate(
                            scene_candidate_id=f"scene_{index + 1}",
                            chapter_id="chapter_long",
                            title=f"场景 {index + 1}",
                            index=index,
                            start_offset=index * scene_length,
                            end_offset=len(text) if index == min_scene_count - 1 else (index + 1) * scene_length,
                            location_hint="车站",
                            time_hint="夜里",
                            characters=["林澈", "陈雨"],
                            source_excerpt=text[index * scene_length:(index + 1) * scene_length][:200],
                            summary=f"原文场景 {index + 1}。",
                            confidence=0.8,
                        )
                        for index in range(min_scene_count)
                    ],
                    warnings=[],
                    needs_review=False,
                )
            return NovelAiChapterScenePlan(
                chapter_id="chapter_long",
                scenes=[
                    SceneCandidate(
                        scene_candidate_id="scene_only",
                        chapter_id="chapter_long",
                        title="单场景",
                        index=0,
                        start_offset=0,
                        end_offset=len(text),
                        location_hint="车站",
                        time_hint="夜里",
                        characters=["林澈", "陈雨"],
                        source_excerpt=text[:200],
                        summary="模型只返回了一个场景。",
                        confidence=0.8,
                    )
                ],
                warnings=[],
                needs_review=False,
            )
        if model is NovelAiConflictAnalysisResponse:
            return NovelAiConflictAnalysisResponse(conflict_points=[], warnings=[])
        if model is NovelAiBranchSuggestionResponse:
            return NovelAiBranchSuggestionResponse(branch_suggestions=[], warnings=[])
        raise AssertionError(model)

    monkeypatch.setattr(routes_novel_import.service.provider, "create_with_tools", fake_create_with_tools)
    client = TestClient(create_app())
    response = client.post(
        "/api/novel/import/ai_plan_chapter",
        json={
            "document_id": "doc_test",
            "chapter": chapter.model_dump(),
            "outline_summary": "长篇样本大纲。",
            "known_characters": [],
            "text": text,
            "suggested_scene_count": min_scene_count,
            "min_scene_count": min_scene_count,
            "min_branch_suggestion_count": 2,
            "allow_branch_suggestions": True,
            "provider_selection": _provider_selection(),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["scenes"]) >= 3
    assert all(scene["source_span"] for scene in payload["scenes"])
    assert all(scene["summary"] for scene in payload["scenes"])
    assert all(scene["commands"] for scene in payload["scenes"])
    assert payload["branch_suggestions"] == []
    assert not any("fallback adaptation scenes" in warning for warning in payload["warnings"])
    assert any("本章可用分支建议少于目标" in warning for warning in payload["warnings"])
    assert calls == [NovelAiChapterScenePlan, NovelAiChapterScenePlan, NovelAiConflictAnalysisResponse, NovelAiBranchSuggestionResponse]


def test_novel_import_retries_empty_sensitive_scene_plan_without_accepting_it(monkeypatch) -> None:
    calls: list[type[object]] = []
    chapter = ChapterCandidate(
        chapter_id="chapter_sensitive",
        title="Sensitive chapter",
        index=0,
        start_offset=0,
        end_offset=2400,
        summary="A relationship changes after a private encounter.",
        confidence=0.9,
    )
    text = "A sensitive private encounter changes the relationship. " * 48

    def fake_create_with_tools(model, system_prompt, prompt, **kwargs):  # type: ignore[no-untyped-def]
        calls.append(model)
        if model is NovelAiChapterScenePlan:
            attempt = calls.count(NovelAiChapterScenePlan)
            if attempt <= 2:
                if attempt == 2:
                    assert "Do not omit the chapter because it contains mature or sensitive material" in prompt
                return NovelAiChapterScenePlan(
                    chapter_id=chapter.chapter_id,
                    scenes=[],
                    warnings=["Sensitive content was omitted."],
                    needs_review=True,
                )
            midpoint = len(text) // 2
            return NovelAiChapterScenePlan(
                chapter_id=chapter.chapter_id,
                scenes=[
                    SceneCandidate(
                        scene_candidate_id="sensitive_1",
                        chapter_id=chapter.chapter_id,
                        title="Before",
                        index=0,
                        start_offset=0,
                        end_offset=midpoint,
                        source_excerpt=text[:200],
                        summary="The characters confront a change in trust.",
                        confidence=0.8,
                    ),
                    SceneCandidate(
                        scene_candidate_id="sensitive_2",
                        chapter_id=chapter.chapter_id,
                        title="After",
                        index=1,
                        start_offset=midpoint,
                        end_offset=len(text),
                        source_excerpt=text[midpoint:midpoint + 200],
                        summary="They decide how the relationship proceeds.",
                        confidence=0.8,
                    ),
                ],
                warnings=["Sensitive details were adapted non-graphically."],
                needs_review=True,
            )
        if model is NovelAiConflictAnalysisResponse:
            return NovelAiConflictAnalysisResponse(conflict_points=[], warnings=[])
        raise AssertionError(model)

    service = NovelImportService()
    monkeypatch.setattr(service.provider, "create_with_tools", fake_create_with_tools)
    response = service.ai_plan_chapter(
        NovelAiPlanChapterRequest(
            document_id="doc_sensitive",
            chapter=chapter,
            outline_summary="Relationship-focused story.",
            known_characters=[],
            text=text,
            suggested_scene_count=2,
            min_scene_count=2,
            allow_branch_suggestions=False,
        )
    )

    assert len(response.scenes) == 2
    assert calls.count(NovelAiChapterScenePlan) == 3
    assert all(scene.commands for scene in response.scenes)


def test_novel_import_uses_same_model_for_continuous_source_segments_after_empty_whole_chapter(monkeypatch) -> None:
    chapter = ChapterCandidate(
        chapter_id="chapter_segmented",
        title="Segmented chapter",
        index=0,
        start_offset=100,
        end_offset=2500,
        summary="A long chapter requiring neutral adaptation.",
        confidence=0.9,
    )
    text = ("First relationship beat。Second consequence beat。Third transition beat。" * 45)[:2400]
    prompts: list[str] = []

    def fake_create_with_tools(model, system_prompt, prompt, **kwargs):  # type: ignore[no-untyped-def]
        if model is NovelAiChapterScenePlan:
            prompts.append(prompt)
            if "source segment" not in prompt:
                return NovelAiChapterScenePlan(chapter_id=chapter.chapter_id, scenes=[], warnings=[], needs_review=True)
            segment_number = 1 if "source segment 1/2" in prompt else 2
            return NovelAiChapterScenePlan(
                chapter_id=f"{chapter.chapter_id}_segment_{segment_number}",
                scenes=[
                    SceneCandidate(
                        scene_candidate_id=f"segment_scene_{segment_number}",
                        chapter_id=f"{chapter.chapter_id}_segment_{segment_number}",
                        title=f"Segment {segment_number}",
                        index=0,
                        start_offset=0,
                        end_offset=10,
                        source_excerpt="grounded excerpt",
                        summary=f"Grounded segment {segment_number}.",
                        confidence=0.8,
                    )
                ],
                warnings=[],
                needs_review=False,
            )
        if model is NovelAiConflictAnalysisResponse:
            return NovelAiConflictAnalysisResponse(conflict_points=[], warnings=[])
        raise AssertionError(model)

    service = NovelImportService()
    monkeypatch.setattr(service.provider, "create_with_tools", fake_create_with_tools)
    response = service.ai_plan_chapter(
        NovelAiPlanChapterRequest(
            document_id="doc_segmented",
            chapter=chapter,
            outline_summary="Outline.",
            known_characters=[],
            text=text,
            suggested_scene_count=2,
            min_scene_count=2,
            allow_branch_suggestions=False,
        )
    )

    assert len(response.scenes) == 2
    assert len(prompts) == 5
    assert sum("source segment" in prompt for prompt in prompts) == 2
    assert response.scenes[0].source_span.start_offset == chapter.start_offset
    assert response.scenes[1].source_span.start_offset > response.scenes[0].source_span.start_offset
    assert any("continuous source segments" in warning for warning in response.warnings)


def test_novel_import_rejects_false_incomplete_source_claim() -> None:
    chapter = ChapterCandidate(
        chapter_id="chapter_complete",
        title="Complete chapter",
        index=0,
        start_offset=0,
        end_offset=120,
        summary="Complete source.",
        confidence=0.9,
    )
    request = NovelAiPlanChapterRequest(
        document_id="doc_complete",
        chapter=chapter,
        outline_summary="Outline.",
        known_characters=[],
        text="This is a complete authoritative chapter source with a beginning, middle, and end.",
        suggested_scene_count=1,
        min_scene_count=1,
    )
    plan = NovelAiChapterScenePlan(
        chapter_id=chapter.chapter_id,
        scenes=[],
        warnings=["章节原文不完整，仅包含注释和开头部分。"],
        needs_review=True,
    )

    error = NovelImportService._scene_plan_quality_error(request, plan, 1)

    assert error is not None
    assert "incomplete" in error
    assert "章节原文不完整" in error


def test_novel_import_outline_repairs_missing_chapter_source_ranges(monkeypatch) -> None:
    analyses = [
        NovelAiChunkAnalysis(
            chunk_id=f"chunk_{index + 1}",
            index=index,
            summary=f"chunk {index + 1}",
            chapter_candidates=[
                ChapterCandidate(
                    chapter_id=f"source_{index + 1}",
                    title=f"source {index + 1}",
                    index=index,
                    start_offset=index * 100,
                    end_offset=(index + 1) * 100,
                    summary="source",
                    confidence=0.9,
                )
            ],
        )
        for index in range(3)
    ]
    broken_structure = NovelAiOutlineStructure(
        chapters=[
            ChapterCandidate(
                chapter_id=f"chapter_{index + 1}",
                title=f"chapter {index + 1}",
                index=index,
                start_offset=0,
                end_offset=0,
                summary="outline",
                confidence=0.8,
            )
            for index in range(3)
        ]
    )

    def fake_create_with_tools(model, system_prompt, prompt, **kwargs):  # type: ignore[no-untyped-def]
        if model is NovelAiOutlineMainline:
            return _outline_mainline()
        if model is NovelAiOutlineStructure:
            return broken_structure
        if model is NovelAiOutlineIndex:
            return _outline_index()
        raise AssertionError(model)

    monkeypatch.setattr(routes_novel_import.service.provider, "create_with_tools", fake_create_with_tools)
    client = TestClient(create_app())
    response = client.post(
        "/api/novel/import/ai_build_outline",
        json={
            "document_id": "doc_test",
            "title": "source range repair",
            "total_chars": 300,
            "analyses": [analysis.model_dump() for analysis in analyses],
            "provider_selection": _provider_selection(),
        },
    )

    assert response.status_code == 200
    chapters = response.json()["chapters"]
    assert [(chapter["start_offset"], chapter["end_offset"]) for chapter in chapters] == [(0, 100), (100, 200), (200, 300)]
    assert all(chapter["end_offset"] > chapter["start_offset"] for chapter in chapters)
    assert all(chapter["metadata"]["source_range_repaired"] is True for chapter in chapters)


def test_novel_import_ai_adapt_scene_accepts_scene_when_conflict_analysis_fails(monkeypatch) -> None:
    calls: list[type[object]] = []

    def fake_create_with_tools(model, system_prompt, prompt, **kwargs):  # type: ignore[no-untyped-def]
        calls.append(model)
        if model is SceneBeat:
            return _adapt_response().adapted_scene.scene_beat
        if model is NovelAiConflictAnalysisResponse:
            raise RuntimeError("conflict JSON failed")
        raise AssertionError(model)

    monkeypatch.setattr(routes_novel_import.service.provider, "create_with_tools", fake_create_with_tools)
    client = TestClient(create_app())
    response = client.post(
        "/api/novel/import/ai_adapt_scene",
        json={
            "scene_candidate": _scene_plan().scenes[0].model_dump(),
            "known_characters": [],
            "previous_scene_summary": "",
            "outline_summary": _outline().summary,
            "import_options": {},
            "memory_mode": "none",
            "provider_selection": _provider_selection(),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["adapted_scene"]["scene_beat"]["scene_id"] == "scene_test"
    assert payload["conflict_points"] == []
    assert any("Conflict analysis" in warning for warning in payload["warnings"])
    assert calls == [SceneBeat, NovelAiConflictAnalysisResponse]


def test_novel_import_ai_adapt_scene_accepts_scene_when_branch_suggestions_fail(monkeypatch) -> None:
    calls: list[type[object]] = []

    def fake_create_with_tools(model, system_prompt, prompt, **kwargs):  # type: ignore[no-untyped-def]
        calls.append(model)
        if model is SceneBeat:
            return _adapt_response().adapted_scene.scene_beat
        if model is NovelAiConflictAnalysisResponse:
            return NovelAiConflictAnalysisResponse(
                conflict_points=[
                    ConflictPoint(
                        conflict_id="conflict_1",
                        source_scene_id="scene_candidate_1",
                        conflict_type="branch_opportunity",
                        description="The protagonist can choose truth or silence.",
                        mainline_resolution="Keep the truth path as the mainline.",
                        suggests_branch=True,
                        confidence=0.9,
                    )
                ],
                warnings=[],
            )
        if model is NovelAiBranchSuggestionResponse:
            raise RuntimeError("branch JSON failed")
        raise AssertionError(model)

    monkeypatch.setattr(routes_novel_import.service.provider, "create_with_tools", fake_create_with_tools)
    client = TestClient(create_app())
    response = client.post(
        "/api/novel/import/ai_adapt_scene",
        json={
            "scene_candidate": _scene_plan().scenes[0].model_dump(),
            "known_characters": [],
            "previous_scene_summary": "",
            "outline_summary": _outline().summary,
            "import_options": {"allow_branch_suggestions": True},
            "memory_mode": "none",
            "provider_selection": _provider_selection(),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["adapted_scene"]["scene_beat"]["scene_id"] == "scene_test"
    assert len(payload["conflict_points"]) == 1
    assert payload["branch_suggestions"] == []
    assert any("Branch suggestions" in warning for warning in payload["warnings"])
    assert calls == [SceneBeat, NovelAiConflictAnalysisResponse, NovelAiBranchSuggestionResponse]


def test_novel_import_ai_adapt_scene_normalizes_short_character_reference(monkeypatch) -> None:
    def fake_create_with_tools(model, system_prompt, prompt, **kwargs):  # type: ignore[no-untyped-def]
        if model is SceneBeat:
            assert "Allowed character references" in prompt
            return SceneBeat(
                scene_id="scene_alias",
                title="角色简称修复",
                summary="简称被映射回已确认角色。",
                chapter=1,
                commands=[
                    {"type": "dialog", "character_id": "阿尔汉姆", "text": "我记得这条路。"},
                    {"type": "sprite", "character_id": "阿尔汉姆", "sprite_id": "阿尔汉姆_默认"},
                ],
            )
        if model is NovelAiConflictAnalysisResponse:
            return NovelAiConflictAnalysisResponse(conflict_points=[], warnings=[])
        raise AssertionError(model)

    monkeypatch.setattr(routes_novel_import.service.provider, "create_with_tools", fake_create_with_tools)
    scene_candidate = _scene_plan().scenes[0].model_dump()
    scene_candidate["characters"] = ["阿尔汉姆·哈斯德尔"]
    client = TestClient(create_app())
    response = client.post(
        "/api/novel/import/ai_adapt_scene",
        json={
            "scene_candidate": scene_candidate,
            "known_characters": [
                {
                    "character_id": "阿尔汉姆·哈斯德尔",
                    "name": "阿尔汉姆·哈斯德尔",
                    "aliases": ["学长"],
                    "confidence": 0.9,
                }
            ],
            "previous_scene_summary": "",
            "outline_summary": _outline().summary,
            "import_options": {},
            "memory_mode": "none",
            "provider_selection": _provider_selection(),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    commands = payload["adapted_scene"]["scene_beat"]["commands"]
    assert commands[0]["character_id"] == "阿尔汉姆·哈斯德尔"
    assert commands[1]["character_id"] == "阿尔汉姆·哈斯德尔"
    assert any("normalized" in warning for warning in payload["warnings"])


def test_novel_import_ai_adapt_scene_converts_unconfirmed_character_to_narration(monkeypatch) -> None:
    def fake_create_with_tools(model, system_prompt, prompt, **kwargs):  # type: ignore[no-untyped-def]
        if model is SceneBeat:
            return SceneBeat(
                scene_id="scene_unknown",
                title="未知角色修复",
                summary="未确认角色不会进入对话命令。",
                chapter=1,
                commands=[
                    {"type": "dialog", "character_id": "阿尔汉姆", "text": "这里不该成为角色引用。"},
                    {"type": "sprite", "character_id": "阿尔汉姆", "sprite_id": "阿尔汉姆_默认"},
                    {"type": "dialog", "character_id": "金奥加", "text": "先按记录来。"},
                ],
            )
        if model is NovelAiConflictAnalysisResponse:
            return NovelAiConflictAnalysisResponse(conflict_points=[], warnings=[])
        raise AssertionError(model)

    monkeypatch.setattr(routes_novel_import.service.provider, "create_with_tools", fake_create_with_tools)
    scene_candidate = _scene_plan().scenes[0].model_dump()
    scene_candidate["characters"] = ["金奥加"]
    client = TestClient(create_app())
    response = client.post(
        "/api/novel/import/ai_adapt_scene",
        json={
            "scene_candidate": scene_candidate,
            "known_characters": [{"character_id": "金奥加", "name": "金奥加", "aliases": [], "confidence": 0.95}],
            "previous_scene_summary": "",
            "outline_summary": _outline().summary,
            "import_options": {},
            "memory_mode": "none",
            "provider_selection": _provider_selection(),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    commands = payload["adapted_scene"]["scene_beat"]["commands"]
    assert commands[0]["type"] == "narration"
    assert "阿尔汉姆：" in commands[0]["text"]
    assert commands[1]["type"] == "dialog"
    assert commands[1]["character_id"] == "金奥加"
    assert any("unconfirmed dialog character" in warning for warning in payload["warnings"])
    assert any("unconfirmed sprite character" in warning for warning in payload["warnings"])


def test_novel_import_flash_stage_token_profiles() -> None:
    flash = ProviderSelectionRequest(
        connection_id="conn",
        model_id="deepseek-v4-flash",
        base_url="https://api.deepseek.com",
        api_key="sk-test",
        parameters=ProviderSelectionParameters(max_tokens=1200, context_budget_tokens=4000, thinking_mode=True),
    )
    pro = ProviderSelectionRequest(
        connection_id="conn",
        model_id="deepseek-v4-pro",
        base_url="https://api.deepseek.com",
        api_key="sk-test",
        parameters=ProviderSelectionParameters(max_tokens=1200, context_budget_tokens=4000, thinking_mode=True),
    )
    gemini = ProviderSelectionRequest(
        connection_id="conn",
        model_id="gemini-3-flash-preview",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        api_key="sk-test",
        parameters=ProviderSelectionParameters(max_tokens=1200, context_budget_tokens=4000, thinking_mode=True),
    )

    flash_scene = NovelImportService._json_mode_selection(flash, "scene")
    flash_outline = NovelImportService._json_mode_selection(flash, "outline")
    flash_analysis = NovelImportService._json_mode_selection(flash, "analysis")
    pro_scene = NovelImportService._json_mode_selection(pro, "scene")
    pro_outline = NovelImportService._json_mode_selection(pro, "outline")
    pro_analysis = NovelImportService._json_mode_selection(pro, "analysis")
    gemini_scene = NovelImportService._json_mode_selection(gemini, "scene")
    gemini_outline = NovelImportService._json_mode_selection(gemini, "outline")
    gemini_analysis = NovelImportService._json_mode_selection(gemini, "analysis")

    assert flash_scene.parameters.max_tokens == 4096
    assert flash_outline.parameters.max_tokens == 6144
    assert flash_analysis.parameters.max_tokens == 2048
    assert flash_scene.parameters.context_budget_tokens == 24000
    assert flash_scene.parameters.thinking_mode is False
    assert flash_scene.parameters.structured_mode == "tools"
    assert pro_scene.parameters.max_tokens == 6144
    assert pro_outline.parameters.max_tokens == 10000
    assert pro_analysis.parameters.max_tokens == 3072
    assert pro_scene.parameters.context_budget_tokens == 48000
    assert pro_scene.parameters.thinking_mode is False
    assert pro_scene.parameters.structured_mode == "tools"
    assert gemini_scene.parameters.max_tokens == 4096
    assert gemini_outline.parameters.max_tokens == 6144
    assert gemini_analysis.parameters.max_tokens == 2048
    assert gemini_scene.parameters.context_budget_tokens == 24000
    assert gemini_scene.parameters.thinking_mode is False
    assert gemini_scene.parameters.structured_mode == "tools"


def test_novel_import_ai_scan_stream_uses_mcp_stream(monkeypatch) -> None:
    calls: list[type[object]] = []

    def fake_stream_with_tools(model, system_prompt, prompt, **kwargs):  # type: ignore[no-untyped-def]
        calls.append(model)
        yield ("status", f"streaming {model.__name__}")
        yield ("delta", f"delta:{model.__name__};")
        if model is NovelAiChunkSummary:
            yield ("final", _chunk_summary())
            return
        if model is NovelAiChunkEntityIndex:
            yield ("final", _chunk_entities())
            return
        if model is NovelAiChunkTimelineNotes:
            yield ("final", _chunk_timeline())
            return
        raise AssertionError(model)

    monkeypatch.setattr(routes_novel_import.service.provider, "stream_with_tools", fake_stream_with_tools)
    client = TestClient(create_app())
    response = client.post(
        "/api/novel/import/ai_scan_chunk_stream",
        json={
            "document_id": "doc_test",
            "chunk_id": "chunk_1",
            "index": 0,
            "text": "林澈在雨夜车站等待。",
            "start_offset": 0,
            "end_offset": 48,
            "provider_selection": _provider_selection(),
        },
    )
    assert response.status_code == 200
    assert "event: status" in response.text
    assert "event: delta" in response.text
    assert "event: checkpoint" in response.text
    assert "event: final" in response.text
    assert "林澈在雨夜抵达车站" in response.text
    assert calls == [NovelAiChunkSummary, NovelAiChunkEntityIndex, NovelAiChunkTimelineNotes]


def test_novel_import_service_has_single_resumable_method_definitions() -> None:
    source = inspect.getsource(NovelImportService)

    assert source.count("def stream_ai_scan_chunk(") == 1
    assert source.count("def ai_build_outline(") == 1
    assert "request.partial_summary" in source
    assert "request.partial_mainline" in source


def test_novel_import_ai_scan_stream_resumes_from_summary_checkpoint(monkeypatch) -> None:
    calls: list[type[object]] = []

    def fake_stream_with_tools(model, system_prompt, prompt, **kwargs):  # type: ignore[no-untyped-def]
        calls.append(model)
        yield ("delta", f"delta:{model.__name__};")
        if model is NovelAiChunkEntityIndex:
            yield ("final", _chunk_entities())
            return
        if model is NovelAiChunkTimelineNotes:
            yield ("final", _chunk_timeline())
            return
        raise AssertionError(model)

    monkeypatch.setattr(routes_novel_import.service.provider, "stream_with_tools", fake_stream_with_tools)
    client = TestClient(create_app())
    response = client.post(
        "/api/novel/import/ai_scan_chunk_stream",
        json={
            "document_id": "doc_test",
            "chunk_id": "chunk_1",
            "index": 0,
            "text": "text",
            "start_offset": 0,
            "end_offset": 4,
            "partial_summary": _chunk_summary().model_dump(),
            "provider_selection": _provider_selection(),
        },
    )

    assert response.status_code == 200
    assert calls == [NovelAiChunkEntityIndex, NovelAiChunkTimelineNotes]


def test_novel_import_ai_build_outline_stream_resumes_from_structure_checkpoint(monkeypatch) -> None:
    calls: list[type[object]] = []

    def fake_stream_with_tools(model, system_prompt, prompt, **kwargs):  # type: ignore[no-untyped-def]
        calls.append(model)
        yield ("delta", f"delta:{model.__name__};")
        if model is NovelAiOutlineIndex:
            yield ("final", _outline_index())
            return
        raise AssertionError(model)

    monkeypatch.setattr(routes_novel_import.service.provider, "stream_with_tools", fake_stream_with_tools)
    client = TestClient(create_app())
    response = client.post(
        "/api/novel/import/ai_build_outline_stream",
        json={
            "document_id": "doc_test",
            "title": "测试小说",
            "total_chars": 120,
            "analyses": [_chunk_analysis().model_dump()],
            "partial_mainline": _outline_mainline().model_dump(),
            "partial_structure": _outline_structure().model_dump(),
            "provider_selection": _provider_selection(),
        },
    )

    assert response.status_code == 200
    assert "event: delta" in response.text
    assert "event: checkpoint" in response.text
    assert "event: final" in response.text
    assert calls == [NovelAiOutlineIndex]


def test_novel_import_ai_plan_chapter_stream_emits_delta_before_final(monkeypatch) -> None:
    calls: list[type[object]] = []

    def fake_stream_with_tools(model, system_prompt, prompt, **kwargs):  # type: ignore[no-untyped-def]
        calls.append(model)
        yield ("status", f"streaming {model.__name__}")
        yield ("delta", f"delta:{model.__name__};")
        if model is NovelAiChapterScenePlan:
            yield ("final", _chapter_scene_plan())
            return
        if model is NovelAiConflictAnalysisResponse:
            yield ("final", NovelAiConflictAnalysisResponse(conflict_points=[], warnings=[]))
            return
        raise AssertionError(model)

    monkeypatch.setattr(routes_novel_import.service.provider, "stream_with_tools", fake_stream_with_tools)
    client = TestClient(create_app())
    response = client.post(
        "/api/novel/import/ai_plan_chapter_stream",
        json={
            "document_id": "doc_test",
            "chapter": _outline().chapters[0].model_dump(),
            "outline_summary": _outline().summary,
            "known_characters": [],
            "text": "Alice arrives at the station.",
            "provider_selection": _provider_selection(),
        },
    )

    assert response.status_code == 200
    assert response.text.index("event: delta") < response.text.index("event: final")
    assert "event: checkpoint" in response.text
    assert calls == [NovelAiChapterScenePlan, NovelAiConflictAnalysisResponse]


def test_novel_import_structured_stream_does_not_duplicate_provider_retry(monkeypatch) -> None:
    service = NovelImportService()
    calls = 0

    def fake_stream_with_tools(model, system_prompt, prompt, **kwargs):  # type: ignore[no-untyped-def]
        nonlocal calls
        calls += 1
        raise AIProviderError("temporary structured generation failure")
        yield  # pragma: no cover

    monkeypatch.setattr(service.provider, "stream_with_tools", fake_stream_with_tools)
    with pytest.raises(AIProviderError, match="temporary structured generation failure"):
        list(
            service._stream_structured_result(
                NovelAiChapterScenePlan,
                "system",
                "user",
                temperature=0.2,
                selection=None,
                phase="chapter_scene_plan",
            )
        )

    assert calls == 1


def test_novel_import_ai_adapt_scene_stream_emits_delta_before_final(monkeypatch) -> None:
    calls: list[type[object]] = []

    def fake_stream_with_tools(model, system_prompt, prompt, **kwargs):  # type: ignore[no-untyped-def]
        calls.append(model)
        yield ("status", f"streaming {model.__name__}")
        yield ("delta", f"delta:{model.__name__};")
        if model is SceneBeat:
            yield ("final", _adapt_response().adapted_scene.scene_beat)
            return
        if model is NovelAiConflictAnalysisResponse:
            yield ("final", NovelAiConflictAnalysisResponse(conflict_points=[], warnings=[]))
            return
        raise AssertionError(model)

    monkeypatch.setattr(routes_novel_import.service.provider, "stream_with_tools", fake_stream_with_tools)
    client = TestClient(create_app())
    response = client.post(
        "/api/novel/import/ai_adapt_scene_stream",
        json={
            "scene_candidate": _scene_plan().scenes[0].model_dump(),
            "known_characters": [],
            "previous_scene_summary": "",
            "outline_summary": _outline().summary,
            "import_options": {},
            "memory_mode": "none",
            "provider_selection": _provider_selection(),
        },
    )

    assert response.status_code == 200
    assert response.text.index("event: delta") < response.text.index("event: final")
    assert "event: checkpoint" in response.text
    assert calls == [SceneBeat, NovelAiConflictAnalysisResponse]


def test_novel_import_filters_blank_descriptions_and_never_uses_description_as_name() -> None:
    payload = {
        "characters": [
            {"id": "blank", "name": "飞雷龙", "description": ""},
            {"id": "leak", "profile": "医学生，与灭尽龙有过一段感情。"},
            {"id": "valid", "name": "雷狼龙", "description": "医学生，与灭尽龙有过一段感情。"},
        ],
        "locations": [],
    }

    normalized = normalize_structured_payload(NovelAiOutlineIndex, payload)
    index = NovelAiOutlineIndex(**normalized)

    assert [character.name for character in index.characters] == ["雷狼龙"]
    assert index.characters[0].description == "医学生，与灭尽龙有过一段感情。"



def test_novel_import_filters_real_monster_hunter_blank_character_sample() -> None:
    payload = {
        "characters": [
            {"id": "\u96f7\u72fc\u9f99", "name": "\u96f7\u72fc\u9f99", "description": "\u533b\u5b66\u751f\uff0c\u4e0e\u706d\u5c3d\u9f99\u6709\u8fc7\u4e00\u6bb5\u611f\u60c5\u3002"},
            {"id": "\u706d\u5c3d\u9f99", "name": "\u706d\u5c3d\u9f99", "description": "\u96f7\u72fc\u9f99\u7684\u604b\u4eba\uff0c\u66fe\u53c2\u519b\u3002"},
            {"id": "\u98de\u96f7\u9f99", "name": "\u98de\u96f7\u9f99", "description": ""},
            {"id": "\u63cf\u8ff0\u4e32\u540d", "name": "\u533b\u5b66\u751f\uff0c\u4e0e\u706d\u5c3d\u9f99\u6709\u8fc7\u4e00\u6bb5\u611f\u60c5\u3002", "description": "\u5e94\u8be5\u88ab\u8fc7\u6ee4"},
        ],
        "locations": [],
    }

    normalized = normalize_structured_payload(NovelAiOutlineIndex, payload)
    index = NovelAiOutlineIndex(**normalized)

    assert [character.name for character in index.characters] == ["\u96f7\u72fc\u9f99", "\u706d\u5c3d\u9f99"]
