"""Bind model scene offsets to authoritative chapter text before strict validation."""
from copy import deepcopy
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

_chapter_source: ContextVar[Any] = ContextVar("novel_chapter_source", default=None)


@contextmanager
def chapter_scene_source(request: Any):
    """Request-scoped; concurrent jobs cannot consume each other's source."""
    token = _chapter_source.set(request)
    try:
        yield
    finally:
        _chapter_source.reset(token)

def stream_chapter_source(request: Any, events: Any):
    """Bind each generator step; ASGI can resume consecutive steps in new contexts."""
    while True:
        with chapter_scene_source(request):
            try:
                event = next(events)
            except StopIteration as finished:
                return finished.value
        yield event


def ground_chapter_plan(value: Any) -> Any:
    """Repair only unique source excerpts during an explicitly bound model call."""
    request = _chapter_source.get()
    if request is None or not isinstance(value, dict) or not isinstance(value.get("scenes"), list):
        return value
    source = request.text
    chapter_start = request.chapter.start_offset
    positions = [i for i, char in enumerate(source) if not char.isspace()]
    compact = "".join(source[i] for i in positions)
    result = deepcopy(value)
    repaired = []
    for index, scene in enumerate(result["scenes"]):
        if not isinstance(scene, dict):
            continue
        span = scene.get("source_span") or scene
        if not isinstance(span, dict):
            continue  # Strict validation reports malformed span types.
        start, end = span.get("start_offset"), span.get("end_offset")
        valid = (type(start) is int and type(end) is int
                 and chapter_start <= start < end <= chapter_start + len(source))
        excerpt = scene.get("source_excerpt")
        needle = "".join(excerpt.split()) if isinstance(excerpt, str) else ""
        match = compact.find(needle) if needle else -1
        unique = match >= 0 and compact.find(needle, match + 1) < 0
        if unique:
            local_start = positions[match]
            local_end = positions[match + len(needle) - 1] + 1
            grounded = (chapter_start + local_start, chapter_start + local_end)
            if (start, end) != grounded:
                repaired.append(index + 1)
                scene.update(start_offset=grounded[0], end_offset=grounded[1],
                             source_span={"start_offset": grounded[0], "end_offset": grounded[1]},
                             source_excerpt=source[local_start:local_end])
        elif not valid:
            raise ValueError(
                f"场景 {index + 1} 原文范围无效（{start}→{end}），"
                "且摘录无法在当前章节唯一定位；断点已保留，未自动重试。"
            )
    if repaired:
        result["warnings"] = [*(result.get("warnings") or []),
            "场景 " + "、".join(map(str, repaired)) + " 的原文坐标已按唯一原文摘录重新定位，请审核覆盖范围。"]
        result["needs_review"] = True
    return result
