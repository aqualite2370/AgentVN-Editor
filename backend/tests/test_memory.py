import sqlite3

from app.core.config import Settings
from app.db.init_db import init_db
from app.memory.manager import MemoryManager
from app.models.common import MemoryMode
from app.models.memory import EmotionSnapshot, NewRelation


def make_manager() -> MemoryManager:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)
    settings = Settings(DATABASE_PATH=":memory:", DEFAULT_MEMORY_MODE=MemoryMode.HYBRID)
    return MemoryManager(conn, settings)


def test_chronicle_graph_add_and_invalidate_relation() -> None:
    manager = make_manager()
    relation = manager.add_relation(
        NewRelation(source="alice", target="bob", relation="trusts", confidence=0.9),
        chapter=1,
    )
    assert len(manager.get_active_relations()) == 1

    invalidated = manager.invalidate_relation(chapter=3, relation_id=relation.id)
    assert invalidated == 1
    assert manager.get_active_relations() == []
    history = manager.get_relation_history()
    assert history[0].is_active is False
    assert history[0].invalidated_at_chapter == 3


def test_emotion_trace_add_and_retrieve_memory() -> None:
    manager = make_manager()
    manager.add_memory(
        EmotionSnapshot(
            character_id="alice",
            summary="Bob left Alice behind.",
            original_emotion="anger",
            current_emotion="anger",
            memory_strength=0.9,
            valence=-0.8,
            arousal=0.7,
            dominance=-0.3,
        ),
        embedding=[1.0, 0.0, 0.0],
        chapter=2,
    )
    results = manager.retrieve_memories(
        query_embedding=[1.0, 0.0, 0.0],
        chapter=3,
        character_id="alice",
        query_valence=-0.7,
        query_arousal=0.6,
        query_dominance=-0.2,
    )
    assert len(results) == 1
    assert results[0].recall_score > 0.0
