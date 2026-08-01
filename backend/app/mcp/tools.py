"""AgentVN MCP tool registry shared by providers and JSON-RPC routes."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.core.errors import AIProviderError
from app.ai.structured_normalization import normalize_structured_payload
from app.models.memory import MemoryUpdate
from app.models.novel_import import (
    AdaptSceneResponse,
    NovelAiBranchSuggestionResponse,
    NovelAiChapterScenePlan,
    NovelAiChunkAnalysis,
    NovelAiChunkEntityIndex,
    NovelAiChunkSummary,
    NovelAiChunkTimelineNotes,
    NovelAiConflictAnalysisResponse,
    NovelAiOutlineIndex,
    NovelAiOutlineMainline,
    NovelAiOutlineResponse,
    NovelAiOutlineStructure,
    NovelAiScenePlanResponse,
)
from app.models.novel_process import SceneLinkPolishResponse, SubagentModelOutput
from app.models.scene import SceneBeat

T = TypeVar("T", bound=BaseModel)


def generation_schema_for_model(response_model: type[BaseModel]) -> dict[str, Any]:
    """Return the complete model-facing schema supported by editor and runtime."""

    return response_model.model_json_schema()


@dataclass(frozen=True)
class AgentVNTool:
    name: str
    description: str
    response_model: type[BaseModel]


class AgentVNToolRegistry:
    """Owns the schema and validation rules for model-callable AgentVN tools."""

    def __init__(self) -> None:
        self._tools: tuple[AgentVNTool, ...] = (
            AgentVNTool(
                name="create_scene_beat",
                description=(
                    "Create one validated AgentVN SceneBeat for the visual novel editor. "
                    "Use this as the final action for scene generation."
                ),
                response_model=SceneBeat,
            ),
            AgentVNTool(
                name="extract_memory_update",
                description=(
                    "Create one validated AgentVN MemoryUpdate from a scene. "
                    "Use this as the final action for memory extraction."
                ),
                response_model=MemoryUpdate,
            ),
            AgentVNTool(
                name="analyze_novel_chunk",
                description=(
                    "Analyze one imported novel text chunk and create validated chapter, character, "
                    "location, timeline, foreshadowing, warning, and confidence data."
                ),
                response_model=NovelAiChunkAnalysis,
            ),
            AgentVNTool(
                name="build_novel_outline",
                description=(
                    "Build one validated full-book outline from novel chunk analyses for AgentVN novel import."
                ),
                response_model=NovelAiOutlineResponse,
            ),
            AgentVNTool(
                name="plan_novel_chapter",
                description=(
                    "Plan validated visual-novel scene candidates for one confirmed imported novel chapter."
                ),
                response_model=NovelAiScenePlanResponse,
            ),
            AgentVNTool(
                name="adapt_novel_scene",
                description=(
                    "Adapt one novel scene candidate into a validated AgentVN AdaptSceneResponse."
                ),
                response_model=AdaptSceneResponse,
            ),
            AgentVNTool(
                name="summarize_novel_chunk",
                description="Summarize one imported novel chunk into validated AgentVN analysis data.",
                response_model=NovelAiChunkSummary,
            ),
            AgentVNTool(
                name="index_novel_chunk_entities",
                description="Extract validated character, chapter, and location indexes from one novel chunk.",
                response_model=NovelAiChunkEntityIndex,
            ),
            AgentVNTool(
                name="extract_novel_chunk_timeline",
                description="Extract validated timeline and foreshadowing notes from one novel chunk.",
                response_model=NovelAiChunkTimelineNotes,
            ),
            AgentVNTool(
                name="build_novel_outline_mainline",
                description="Build the validated mainline portion of an AgentVN novel outline.",
                response_model=NovelAiOutlineMainline,
            ),
            AgentVNTool(
                name="build_novel_outline_structure",
                description="Build the validated chapter structure portion of an AgentVN novel outline.",
                response_model=NovelAiOutlineStructure,
            ),
            AgentVNTool(
                name="build_novel_outline_index",
                description="Build the validated character and location index portion of an AgentVN novel outline.",
                response_model=NovelAiOutlineIndex,
            ),
            AgentVNTool(
                name="plan_novel_chapter_scenes",
                description="Plan validated visual-novel scenes for one imported novel chapter.",
                response_model=NovelAiChapterScenePlan,
            ),
            AgentVNTool(
                name="analyze_novel_conflicts",
                description="Analyze validated story conflict points for an imported novel chapter or scene.",
                response_model=NovelAiConflictAnalysisResponse,
            ),
            AgentVNTool(
                name="suggest_novel_branches",
                description="Suggest validated interactive branches for an imported novel chapter or scene.",
                response_model=NovelAiBranchSuggestionResponse,
            ),
            AgentVNTool(
                name="polish_scene_links",
                description="Produce validated patches that polish scene-to-scene links.",
                response_model=SceneLinkPolishResponse,
            ),
            AgentVNTool(
                name="submit_subagent_output",
                description="Submit one validated AgentVN novel-processing subagent result.",
                response_model=SubagentModelOutput,
            ),
        )
        self._by_name = {tool.name: tool for tool in self._tools}
        self._by_model = {tool.response_model: tool for tool in self._tools}

    def list_tools(self) -> list[dict[str, object]]:
        return [
            {
                "name": tool.name,
                "description": tool.description,
                "inputSchema": generation_schema_for_model(tool.response_model),
            }
            for tool in self._tools
        ]

    def has_model(self, response_model: type[BaseModel]) -> bool:
        return response_model in self._by_model

    def tool_for_model(self, response_model: type[T]) -> AgentVNTool:
        tool = self._by_model.get(response_model)
        if tool is None:
            raise AIProviderError(f"No AgentVN MCP tool is registered for {response_model.__name__}.")
        return tool

    def openai_tool_for_model(self, response_model: type[T]) -> dict[str, object]:
        tool = self.tool_for_model(response_model)
        return {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": generation_schema_for_model(tool.response_model),
            },
        }

    def validate_tool_arguments(self, name: str, arguments: str | dict[str, Any]) -> BaseModel:
        tool = self._by_name.get(name)
        if tool is None:
            raise AIProviderError(f"Unknown AgentVN MCP tool: {name}.")

        try:
            if isinstance(arguments, str):
                payload = json.loads(arguments)
            else:
                payload = arguments
        except json.JSONDecodeError as exc:
            raise AIProviderError(f"Tool arguments for {name} are not valid JSON: {exc}") from exc

        try:
            normalized_payload = normalize_structured_payload(tool.response_model, payload)
            return tool.response_model.model_validate(normalized_payload)
        except ValidationError as exc:
            raise AIProviderError(f"Tool arguments for {name} do not match AgentVN schema: {exc}") from exc

    def call_tool(self, name: str, arguments: dict[str, Any]) -> BaseModel:
        return self.validate_tool_arguments(name, arguments)


agentvn_tool_registry = AgentVNToolRegistry()
