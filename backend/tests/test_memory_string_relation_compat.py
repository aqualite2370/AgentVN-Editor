from app.models.memory import MemoryUpdate


def test_memory_update_drops_unsafe_string_relations() -> None:
    update = MemoryUpdate.model_validate(
        {
            "summary": "Alice learns a new fact at the station.",
            "new_relations": [
                "Alice is a conductor",
                {
                    "entity1_id": "alice",
                    "entity2_id": "protagonist",
                    "relationship": "trusts",
                },
            ],
            "emotion_snapshots": [
                {"character": "alice", "memory": "rain station promise", "emotion": "worried"},
            ],
        }
    )

    assert len(update.new_relations) == 1
    assert update.new_relations[0].source == "alice"
    assert update.new_relations[0].target == "protagonist"
    assert update.new_relations[0].relation == "trusts"
    assert update.emotion_snapshots[0].summary == "rain station promise"
