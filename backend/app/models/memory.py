"""Memory data contracts."""

from typing import Any

from pydantic import Field, model_validator

from app.models.common import MemoryMode, StrictBaseModel


class CharacterProfile(StrictBaseModel):
    character_id: str
    profile: str
    speaking_style: str | None = None
    background_story: str | None = None


class RelationEdge(StrictBaseModel):
    id: str
    source: str
    target: str
    relation: str
    valid_since_chapter: int = Field(..., ge=0)
    invalidated_at_chapter: int | None = Field(default=None, ge=0)
    is_active: bool = True
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    source_scene_id: str | None = None
    note: str | None = None


class NewRelation(StrictBaseModel):
    source: str
    target: str
    relation: str
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    source_scene_id: str | None = None
    note: str | None = None


class RelationInvalidation(StrictBaseModel):
    relation_id: str | None = None
    source: str | None = None
    target: str | None = None
    relation: str | None = None
    invalidated_at_chapter: int | None = Field(default=None, ge=0)
    note: str | None = None


class EmotionSnapshot(StrictBaseModel):
    character_id: str
    summary: str
    original_emotion: str
    current_emotion: str
    memory_strength: float = Field(default=0.8, ge=0.0, le=1.0)
    source_scene_id: str | None = None
    valence: float = Field(default=0.0, ge=-1.0, le=1.0)
    arousal: float = Field(default=0.0, ge=-1.0, le=1.0)
    dominance: float = Field(default=0.0, ge=-1.0, le=1.0)


class EpisodicMemory(StrictBaseModel):
    id: str
    character_id: str
    summary: str
    embedding: list[float] = Field(default_factory=list)
    memory_strength: float = Field(..., ge=0.0, le=1.0)
    original_emotion: str
    current_emotion: str
    created_at_chapter: int = Field(..., ge=0)
    last_accessed_chapter: int = Field(..., ge=0)
    source_scene_id: str | None = None
    valence: float = Field(default=0.0, ge=-1.0, le=1.0)
    arousal: float = Field(default=0.0, ge=-1.0, le=1.0)
    dominance: float = Field(default=0.0, ge=-1.0, le=1.0)


class RetrievedMemory(EpisodicMemory):
    embedding_similarity: float = Field(default=0.0, ge=0.0, le=1.0)
    recency_score: float = Field(default=0.0, ge=0.0, le=1.0)
    emotion_relevance: float = Field(default=0.0, ge=0.0, le=1.0)
    recall_score: float = Field(default=0.0, ge=0.0)


class EmotionalState(StrictBaseModel):
    character_id: str
    dominant_emotion: str | None = None
    average_valence: float = 0.0
    average_arousal: float = 0.0
    average_dominance: float = 0.0
    memory_count: int = 0


class MemoryUpdate(StrictBaseModel):
    summary_100: str = Field(..., max_length=100)
    invalidated_relations: list[RelationInvalidation] = Field(default_factory=list)
    new_relations: list[NewRelation] = Field(default_factory=list)
    emotion_snapshots: list[EmotionSnapshot] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def normalize_model_variants(cls, data: Any) -> Any:
        """Accept common model-side memory key variants before strict validation."""

        if not isinstance(data, dict):
            return data
        normalized = dict(data)

        if "summary_100" not in normalized:
            summary = (
                normalized.pop("summary", None)
                or normalized.pop("short_summary", None)
                or normalized.pop("scene_summary", None)
                or normalized.pop("memory_summary", None)
            )
            if summary:
                normalized["summary_100"] = str(summary)[:100]
        elif isinstance(normalized.get("summary_100"), str) and len(normalized["summary_100"]) > 100:
            normalized["summary_100"] = normalized["summary_100"][:100]

        objective_relations = normalized.pop("objective_relations", None)
        if objective_relations is None:
            objective_relations = normalized.pop("objective_relation_changes", None)
        if objective_relations is None:
            objective_relations = normalized.pop("relational_changes", None)
        if objective_relations is None:
            objective_relations = normalized.pop("relation_changes", None)
        if objective_relations is not None:
            new_relations = list(normalized.get("new_relations") or [])
            invalidated_relations = list(normalized.get("invalidated_relations") or [])
            for item in objective_relations if isinstance(objective_relations, list) else []:
                if not isinstance(item, dict):
                    continue
                change = str(item.get("change") or item.get("action") or "add").lower()
                relation = item.get("relation") or item.get("relation_type") or item.get("relationship") or item.get("predicate")
                source = item.get("source") or item.get("entity1_id") or item.get("character1_id") or item.get("subject") or item.get("from")
                target = item.get("target") or item.get("entity2_id") or item.get("character2_id") or item.get("object") or item.get("to")
                note = item.get("note") or item.get("evidence") or item.get("reason")
                if change in {"remove", "delete", "invalidate", "invalidated", "end"}:
                    invalidated_relations.append(
                        {
                            "relation_id": item.get("relation_id"),
                            "source": source,
                            "target": target,
                            "relation": relation,
                            "invalidated_at_chapter": item.get("invalidated_at_chapter"),
                            "note": note,
                        }
                    )
                elif source and target and relation:
                    new_relations.append(
                        {
                            "source": source,
                            "target": target,
                            "relation": relation,
                            "confidence": item.get("confidence", 0.8),
                            "source_scene_id": item.get("source_scene_id") or item.get("scene_id"),
                            "note": note,
                        }
                    )
            normalized["new_relations"] = new_relations
            normalized["invalidated_relations"] = invalidated_relations

        normalized["new_relations"] = _normalize_new_relations(normalized.get("new_relations"))
        normalized["invalidated_relations"] = _normalize_invalidated_relations(normalized.get("invalidated_relations"))
        normalized["emotion_snapshots"] = _normalize_emotion_snapshots(normalized.get("emotion_snapshots"))

        subjective_snapshots = normalized.pop("subjective_snapshots", None)
        if subjective_snapshots is None:
            subjective_snapshots = normalized.pop("subjective_emotion_snapshots", None)
        if subjective_snapshots is not None:
            emotion_snapshots = list(normalized.get("emotion_snapshots") or [])
            for item in subjective_snapshots if isinstance(subjective_snapshots, list) else []:
                if not isinstance(item, dict):
                    continue
                character_id = item.get("character_id") or item.get("character") or item.get("entity_id")
                summary = item.get("summary") or item.get("memory") or item.get("content") or item.get("note")
                if not character_id or not summary:
                    continue
                emotion = item.get("emotion") or item.get("current_emotion") or "未知"
                emotion_snapshots.append(
                    {
                        "character_id": character_id,
                        "summary": summary,
                        "original_emotion": item.get("original_emotion") or emotion,
                        "current_emotion": item.get("current_emotion") or emotion,
                        "memory_strength": item.get("memory_strength", item.get("strength", 0.8)),
                        "source_scene_id": item.get("source_scene_id") or item.get("scene_id"),
                        "valence": item.get("valence", 0.0),
                        "arousal": item.get("arousal", 0.0),
                        "dominance": item.get("dominance", 0.0),
                    }
                )
            normalized["emotion_snapshots"] = emotion_snapshots

        return normalized


class GenerationMemoryContext(StrictBaseModel):
    memory_mode: MemoryMode
    character_profiles: list[CharacterProfile] = Field(default_factory=list)
    active_relations: list[RelationEdge] = Field(default_factory=list)
    emotional_memories: list[RetrievedMemory] = Field(default_factory=list)


def _normalize_new_relations(value: Any) -> list[dict[str, Any]]:
    """Keep only relation objects that can safely become ChronicleGraph facts."""

    relations: list[dict[str, Any]] = []
    for item in value if isinstance(value, list) else []:
        if not isinstance(item, dict):
            continue
        source = item.get("source") or item.get("entity1_id") or item.get("character1_id") or item.get("subject") or item.get("from")
        target = item.get("target") or item.get("entity2_id") or item.get("character2_id") or item.get("object") or item.get("to")
        relation = item.get("relation") or item.get("relation_type") or item.get("relationship") or item.get("predicate")
        if not source or not target or not relation:
            continue
        relations.append(
            {
                "source": str(source),
                "target": str(target),
                "relation": str(relation),
                "confidence": item.get("confidence", 0.8),
                "source_scene_id": item.get("source_scene_id") or item.get("scene_id"),
                "note": item.get("note") or item.get("evidence") or item.get("reason"),
            }
        )
    return relations


def _normalize_invalidated_relations(value: Any) -> list[dict[str, Any]]:
    invalidations: list[dict[str, Any]] = []
    for item in value if isinstance(value, list) else []:
        if not isinstance(item, dict):
            continue
        invalidations.append(
            {
                "relation_id": item.get("relation_id"),
                "source": item.get("source") or item.get("entity1_id") or item.get("character1_id") or item.get("subject") or item.get("from"),
                "target": item.get("target") or item.get("entity2_id") or item.get("character2_id") or item.get("object") or item.get("to"),
                "relation": item.get("relation") or item.get("relation_type") or item.get("relationship") or item.get("predicate"),
                "invalidated_at_chapter": item.get("invalidated_at_chapter") or item.get("chapter"),
                "note": item.get("note") or item.get("evidence") or item.get("reason"),
            }
        )
    return invalidations


def _normalize_emotion_snapshots(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [
        snapshot
        for snapshot in (
            _normalize_emotion_snapshot(item)
            for item in value if isinstance(item, dict)
        )
        if snapshot is not None
    ]


def _normalize_emotion_snapshot(item: dict[str, Any]) -> dict[str, Any] | None:
    character_id = item.get("character_id") or item.get("character") or item.get("entity_id")
    summary = item.get("summary") or item.get("summary_100") or item.get("memory") or item.get("content") or item.get("note")
    if not character_id or not summary:
        return None

    emotion = item.get("emotion") or item.get("current_emotion") or item.get("dominant_emotion") or "未知"
    return {
        "character_id": character_id,
        "summary": str(summary),
        "original_emotion": item.get("original_emotion") or item.get("before_emotion") or emotion,
        "current_emotion": item.get("current_emotion") or item.get("after_emotion") or emotion,
        "memory_strength": item.get("memory_strength", item.get("strength", 0.8)),
        "source_scene_id": item.get("source_scene_id") or item.get("scene_id"),
        "valence": item.get("valence", 0.0),
        "arousal": item.get("arousal", 0.0),
        "dominance": item.get("dominance", 0.0),
    }
