from app.services.novel_import_service import NovelImportService


def test_character_index_prompts_keep_minor_people_out_of_default_characters() -> None:
    prompt = "\n".join(
        [
            NovelImportService._scan_entities_system_prompt(),
            NovelImportService._outline_index_system_prompt(),
        ]
    )

    for expected in ["具名", "主线", "对白", "路人", "一次性称谓", "职位泛称", "群体名", "warnings"]:
        assert expected in prompt


def test_outline_index_prompt_uses_main_supporting_character_policy() -> None:
    prompt = NovelImportService._outline_index_system_prompt()

    assert "主配角优先" in prompt
    assert "低置信" in prompt
    assert "称谓型" in prompt
    assert "群体型" in prompt
