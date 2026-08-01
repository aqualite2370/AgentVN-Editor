"""Unified memory manager facade."""

import sqlite3

from app.core.config import Settings, get_settings
from app.db.init_db import init_db
from app.memory.chronicle_graph import ChronicleGraph
from app.memory.emotion_trace import EmotionTrace
from app.models.common import MemoryMode
from app.models.memory import (
    CharacterProfile,
    EmotionalState,
    EmotionSnapshot,
    GenerationMemoryContext,
    MemoryUpdate,
    NewRelation,
    RelationEdge,
    RetrievedMemory,
)


class MemoryManager:
    """Single entry point for frozen memory, ChronicleGraph, and EmotionTrace."""

    def __init__(self, conn: sqlite3.Connection, settings: Settings | None = None) -> None:
        self.conn = conn
        self.settings = settings or get_settings()
        init_db(conn)
        self.chronicle_graph = ChronicleGraph(conn)
        self.emotion_trace = EmotionTrace(conn, self.settings)
        if self._get_setting("memory_mode") is None:
            self.set_memory_mode(self.settings.default_memory_mode)

    def add_character_profile(self, profile: CharacterProfile) -> CharacterProfile:
        self.conn.execute(
            """
            INSERT INTO frozen_memory (character_id, profile, speaking_style, background_story)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(character_id) DO UPDATE SET
                profile = excluded.profile,
                speaking_style = excluded.speaking_style,
                background_story = excluded.background_story
            """,
            (profile.character_id, profile.profile, profile.speaking_style, profile.background_story),
        )
        self.conn.commit()
        return profile

    def get_character_profile(self, character_id: str) -> CharacterProfile | None:
        row = self.conn.execute(
            "SELECT * FROM frozen_memory WHERE character_id = ?",
            (character_id,),
        ).fetchone()
        return self._row_to_profile(row) if row else None

    def list_character_profiles(self) -> list[CharacterProfile]:
        rows = self.conn.execute("SELECT * FROM frozen_memory ORDER BY character_id").fetchall()
        return [self._row_to_profile(row) for row in rows]

    def add_relation(self, relation: NewRelation, chapter: int) -> RelationEdge:
        return self.chronicle_graph.add_relation(relation, chapter)

    def invalidate_relation(
        self,
        chapter: int,
        relation_id: str | None = None,
        source: str | None = None,
        target: str | None = None,
        relation: str | None = None,
    ) -> int:
        return self.chronicle_graph.invalidate_relation(chapter, relation_id, source, target, relation)

    def get_active_relations(self, source: str | None = None, target: str | None = None) -> list[RelationEdge]:
        return self.chronicle_graph.get_active_relations(source, target)

    def get_relation_history(self, source: str | None = None, target: str | None = None) -> list[RelationEdge]:
        return self.chronicle_graph.get_relation_history(source, target)

    def search_relations(self, query: str) -> list[RelationEdge]:
        return self.chronicle_graph.search_relations(query)

    def add_memory(self, snapshot: EmotionSnapshot, embedding: list[float], chapter: int):
        return self.emotion_trace.add_memory(snapshot, embedding, chapter)

    def retrieve_memories(
        self,
        query_embedding: list[float],
        chapter: int,
        character_id: str | None = None,
        limit: int = 8,
        query_valence: float | None = None,
        query_arousal: float | None = None,
        query_dominance: float | None = None,
    ) -> list[RetrievedMemory]:
        return self.emotion_trace.retrieve_memories(
            query_embedding,
            chapter,
            character_id,
            limit,
            query_valence,
            query_arousal,
            query_dominance,
        )

    def list_memories(self, character_id: str | None = None):
        return self.emotion_trace.list_memories(character_id)

    def decay_memories(self, current_chapter: int) -> int:
        return self.emotion_trace.decay_memories(current_chapter)

    def update_emotion_drift(self, current_chapter: int) -> int:
        return self.emotion_trace.update_emotion_drift(current_chapter)

    def get_character_emotional_state(self, character_id: str) -> EmotionalState:
        return self.emotion_trace.get_character_emotional_state(character_id)

    def set_memory_mode(self, mode: MemoryMode) -> MemoryMode:
        self.conn.execute(
            """
            INSERT INTO app_settings (key, value) VALUES ('memory_mode', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (mode.value if isinstance(mode, MemoryMode) else mode,),
        )
        self.conn.commit()
        return MemoryMode(mode)

    def get_memory_mode(self) -> MemoryMode:
        return MemoryMode(self._get_setting("memory_mode") or self.settings.default_memory_mode)

    def build_generation_context(
        self,
        memory_mode: MemoryMode,
        chapter: int,
        query_embedding: list[float] | None = None,
        character_id: str | None = None,
    ) -> GenerationMemoryContext:
        active_relations: list[RelationEdge] = []
        emotional_memories: list[RetrievedMemory] = []
        if memory_mode in (MemoryMode.CHRONICLE_GRAPH_ONLY, MemoryMode.HYBRID):
            active_relations = self.get_active_relations()
        if memory_mode in (MemoryMode.EMOTION_TRACE_ONLY, MemoryMode.HYBRID) and query_embedding is not None:
            emotional_memories = self.retrieve_memories(query_embedding, chapter, character_id=character_id)
        return GenerationMemoryContext(
            memory_mode=memory_mode,
            character_profiles=self.list_character_profiles(),
            active_relations=active_relations,
            emotional_memories=emotional_memories,
        )

    def apply_update(self, update: MemoryUpdate, chapter: int, embeddings: list[list[float]] | None = None) -> dict[str, int]:
        invalidated = 0
        for item in update.invalidated_relations:
            invalidated += self.invalidate_relation(
                item.invalidated_at_chapter or chapter,
                relation_id=item.relation_id,
                source=item.source,
                target=item.target,
                relation=item.relation,
            )
        added_relations = 0
        for relation in update.new_relations:
            self.add_relation(relation, chapter)
            added_relations += 1
        added_memories = 0
        embeddings = embeddings or []
        for index, snapshot in enumerate(update.emotion_snapshots):
            embedding = embeddings[index] if index < len(embeddings) else []
            self.add_memory(snapshot, embedding, chapter)
            added_memories += 1
        return {
            "invalidated_relations": invalidated,
            "new_relations": added_relations,
            "emotion_snapshots": added_memories,
        }

    def _get_setting(self, key: str) -> str | None:
        row = self.conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    @staticmethod
    def _row_to_profile(row: sqlite3.Row) -> CharacterProfile:
        return CharacterProfile(
            character_id=row["character_id"],
            profile=row["profile"],
            speaking_style=row["speaking_style"],
            background_story=row["background_story"],
        )
