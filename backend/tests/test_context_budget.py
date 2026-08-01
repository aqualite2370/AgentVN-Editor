from app.ai.context_budget import estimate_tokens, tokens_to_approx_chars
from app.models.novel_processing import NovelImportFileInfo
from app.services.novel_processing_service import NovelProcessingService


def test_chinese_token_estimate_uses_point_seven_characters_per_token() -> None:
    assert estimate_tokens("汉" * 700) == 1000
    assert tokens_to_approx_chars(1000) == 700


def test_novel_import_uses_the_shared_chinese_token_estimate(tmp_path) -> None:  # type: ignore[no-untyped-def]
    import sqlite3

    from app.db.init_db import init_db

    connection = sqlite3.connect(tmp_path / "token-estimate.db")
    connection.row_factory = sqlite3.Row
    init_db(connection)
    service = NovelProcessingService(connection)

    record = service.analyzeNovelImport(
        NovelImportFileInfo(
            fileName="chinese.txt",
            fileSizeBytes=2100,
            text="汉" * 700,
        )
    )

    assert record.estimatedTokens == 1000
