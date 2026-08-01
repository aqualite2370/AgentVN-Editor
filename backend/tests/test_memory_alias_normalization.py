from app.models.memory import MemoryUpdate


def test_memory_update_accepts_direct_relation_and_emotion_aliases() -> None:
    update = MemoryUpdate.model_validate(
        {
            "summary": "主角无法接受父亲是肇事司机的真相，情绪失控地质问爱丽丝。",
            "relational_changes": [
                {
                    "subject": "alice",
                    "object": "protagonist",
                    "relationship": "revealed painful truth",
                    "evidence": "Alice tells him his father killed her mother.",
                }
            ],
            "emotion_snapshots": [
                {
                    "character": "protagonist",
                    "emotion": "denial, angry, shocked",
                    "summary_100": "主角无法接受父亲是肇事司机的真相，情绪失控地质问爱丽丝。",
                },
                {
                    "character": "alice",
                    "emotion": "painful, crying, distressed",
                    "summary_100": "爱丽丝痛苦地揭露真相，在主角面前崩溃。",
                },
            ],
        }
    )

    assert update.summary_100.startswith("主角无法接受")
    assert update.new_relations[0].source == "alice"
    assert update.new_relations[0].target == "protagonist"
    assert update.new_relations[0].relation == "revealed painful truth"
    assert update.emotion_snapshots[0].character_id == "protagonist"
    assert update.emotion_snapshots[0].current_emotion == "denial, angry, shocked"
    assert update.emotion_snapshots[1].character_id == "alice"
