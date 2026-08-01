from app.models.memory import MemoryUpdate


def test_memory_update_accepts_deepseek_hallucinated_variant_keys() -> None:
    update = MemoryUpdate.model_validate(
        {
            "summary_100": "爱丽丝告诉主角两人是同父异母的兄妹，主角受到冲击。",
            "objective_relation_changes": [
                {
                    "character1_id": "alice",
                    "character2_id": "protagonist",
                    "relation": "同父异母的兄妹",
                    "evidence": "爱丽丝说出了隐藏已久的真相。",
                    "change": "add",
                }
            ],
            "subjective_emotion_snapshots": [
                {
                    "character_id": "protagonist",
                    "summary": "主角得知亲缘关系后震惊且难以接受。",
                    "current_emotion": "震惊",
                    "original_emotion": "困惑",
                    "goal": "理解爱丽丝为什么现在才说出真相",
                }
            ],
        }
    )

    assert update.new_relations[0].source == "alice"
    assert update.new_relations[0].target == "protagonist"
    assert update.new_relations[0].relation == "同父异母的兄妹"
    assert update.emotion_snapshots[0].character_id == "protagonist"
    assert update.emotion_snapshots[0].current_emotion == "震惊"
