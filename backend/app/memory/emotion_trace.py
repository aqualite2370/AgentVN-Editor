"""EmotionTrace: subjective episodic emotional memory."""

import sqlite3

from app.core.config import Settings
from app.memory.decay import decay_strength, drift_value
from app.memory.retrieval import cosine_similarity, emotion_relevance, recall_score, recency_score
from app.models.memory import EmotionalState, EmotionSnapshot, EpisodicMemory, RetrievedMemory
from app.utils.ids import new_id
from app.utils.json import dumps_json, loads_json


class EmotionTrace:
    """Stores and retrieves character-specific subjective memories."""

    def __init__(self, conn: sqlite3.Connection, settings: Settings) -> None:
        self.conn = conn
        self.settings = settings

    def add_memory(
        self,
        snapshot: EmotionSnapshot,
        embedding: list[float],
        chapter: int,
    ) -> EpisodicMemory:
        memory = EpisodicMemory(
            id=new_id("mem"),
            character_id=snapshot.character_id,
            summary=snapshot.summary,
            embedding=embedding,
            memory_strength=snapshot.memory_strength,
            original_emotion=snapshot.original_emotion,
            current_emotion=snapshot.current_emotion,
            created_at_chapter=chapter,
            last_accessed_chapter=chapter,
            source_scene_id=snapshot.source_scene_id,
            valence=snapshot.valence,
            arousal=snapshot.arousal,
            dominance=snapshot.dominance,
        )
        self.conn.execute(
            """
            INSERT INTO episodic_memory (
                id, character_id, summary, embedding, memory_strength,
                original_emotion, current_emotion, created_at_chapter,
                last_accessed_chapter, source_scene_id, valence, arousal, dominance
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                memory.id,
                memory.character_id,
                memory.summary,
                dumps_json(memory.embedding),
                memory.memory_strength,
                memory.original_emotion,
                memory.current_emotion,
                memory.created_at_chapter,
                memory.last_accessed_chapter,
                memory.source_scene_id,
                memory.valence,
                memory.arousal,
                memory.dominance,
            ),
        )
        self.conn.commit()
        return memory

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
        clauses: list[str] = []
        params: list[object] = []
        if character_id:
            clauses.append("character_id = ?")
            params.append(character_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self.conn.execute(
            f"SELECT * FROM episodic_memory {where}",
            params,
        ).fetchall()
        weights = (
            self.settings.recall_vector_weight,
            self.settings.recall_strength_weight,
            self.settings.recall_recency_weight,
            self.settings.recall_emotion_weight,
        )
        ranked: list[RetrievedMemory] = []
        for row in rows:
            embedding = loads_json(row["embedding"], [])
            similarity = cosine_similarity(query_embedding, embedding)
            recent = recency_score(chapter, row["last_accessed_chapter"])
            affect = emotion_relevance(
                query_valence,
                query_arousal,
                query_dominance,
                row["valence"],
                row["arousal"],
                row["dominance"],
            )
            score = recall_score(similarity, row["memory_strength"], recent, affect, weights)
            ranked.append(
                RetrievedMemory(
                    id=row["id"],
                    character_id=row["character_id"],
                    summary=row["summary"],
                    embedding=embedding,
                    memory_strength=row["memory_strength"],
                    original_emotion=row["original_emotion"],
                    current_emotion=row["current_emotion"],
                    created_at_chapter=row["created_at_chapter"],
                    last_accessed_chapter=row["last_accessed_chapter"],
                    source_scene_id=row["source_scene_id"],
                    valence=row["valence"],
                    arousal=row["arousal"],
                    dominance=row["dominance"],
                    embedding_similarity=similarity,
                    recency_score=recent,
                    emotion_relevance=affect,
                    recall_score=score,
                )
            )
        ranked.sort(key=lambda item: item.recall_score, reverse=True)
        selected = ranked[:limit]
        for memory in selected:
            self.conn.execute(
                "UPDATE episodic_memory SET last_accessed_chapter = ? WHERE id = ?",
                (chapter, memory.id),
            )
        self.conn.commit()
        return selected

    def list_memories(self, character_id: str | None = None) -> list[EpisodicMemory]:
        if character_id:
            rows = self.conn.execute(
                "SELECT * FROM episodic_memory WHERE character_id = ? ORDER BY created_at_chapter DESC",
                (character_id,),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM episodic_memory ORDER BY created_at_chapter DESC"
            ).fetchall()
        return [self._row_to_memory(row) for row in rows]

    def decay_memories(self, current_chapter: int) -> int:
        rows = self.conn.execute("SELECT id, memory_strength, last_accessed_chapter FROM episodic_memory").fetchall()
        for row in rows:
            elapsed = max(0, current_chapter - row["last_accessed_chapter"])
            self.conn.execute(
                "UPDATE episodic_memory SET memory_strength = ? WHERE id = ?",
                (decay_strength(row["memory_strength"], elapsed), row["id"]),
            )
        self.conn.commit()
        return len(rows)

    def update_emotion_drift(self, current_chapter: int) -> int:
        rows = self.conn.execute("SELECT id, valence, arousal, dominance FROM episodic_memory").fetchall()
        for row in rows:
            self.conn.execute(
                """
                UPDATE episodic_memory
                SET valence = ?, arousal = ?, dominance = ?
                WHERE id = ?
                """,
                (
                    drift_value(row["valence"]),
                    drift_value(row["arousal"]),
                    drift_value(row["dominance"]),
                    row["id"],
                ),
            )
        self.conn.commit()
        return len(rows)

    def get_character_emotional_state(self, character_id: str) -> EmotionalState:
        rows = self.conn.execute(
            """
            SELECT current_emotion, valence, arousal, dominance
            FROM episodic_memory WHERE character_id = ?
            """,
            (character_id,),
        ).fetchall()
        if not rows:
            return EmotionalState(character_id=character_id)
        emotions: dict[str, int] = {}
        for row in rows:
            emotions[row["current_emotion"]] = emotions.get(row["current_emotion"], 0) + 1
        dominant = max(emotions, key=emotions.get)
        count = len(rows)
        return EmotionalState(
            character_id=character_id,
            dominant_emotion=dominant,
            average_valence=sum(row["valence"] for row in rows) / count,
            average_arousal=sum(row["arousal"] for row in rows) / count,
            average_dominance=sum(row["dominance"] for row in rows) / count,
            memory_count=count,
        )

    @staticmethod
    def _row_to_memory(row: sqlite3.Row) -> EpisodicMemory:
        return EpisodicMemory(
            id=row["id"],
            character_id=row["character_id"],
            summary=row["summary"],
            embedding=loads_json(row["embedding"], []),
            memory_strength=row["memory_strength"],
            original_emotion=row["original_emotion"],
            current_emotion=row["current_emotion"],
            created_at_chapter=row["created_at_chapter"],
            last_accessed_chapter=row["last_accessed_chapter"],
            source_scene_id=row["source_scene_id"],
            valence=row["valence"],
            arousal=row["arousal"],
            dominance=row["dominance"],
        )
