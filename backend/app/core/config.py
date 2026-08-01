"""Application settings."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.models.common import MemoryMode
from app.models.novel_processing import NovelProcessingConfig


class Settings(BaseSettings):
    """Environment-driven settings for local sidecar usage."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_nested_delimiter="__",
        extra="ignore",
    )

    llm_api_key: str | None = Field(default=None, alias="LLM_API_KEY")
    llm_base_url: str = Field(default="https://api.deepseek.com", alias="LLM_BASE_URL")
    llm_model: str = Field(default="deepseek-chat", alias="LLM_MODEL")

    embedding_api_key: str | None = Field(default=None, alias="EMBEDDING_API_KEY")
    embedding_base_url: str = Field(default="https://api.openai.com/v1", alias="EMBEDDING_BASE_URL")
    embedding_model: str = Field(default="text-embedding-3-small", alias="EMBEDDING_MODEL")

    database_path: str = Field(default="./data/vn_engine.db", alias="DATABASE_PATH")
    default_memory_mode: MemoryMode = Field(default=MemoryMode.HYBRID, alias="DEFAULT_MEMORY_MODE")
    novel: NovelProcessingConfig = Field(default_factory=NovelProcessingConfig)

    recall_vector_weight: float = Field(default=0.55, alias="RECALL_VECTOR_WEIGHT")
    recall_strength_weight: float = Field(default=0.25, alias="RECALL_STRENGTH_WEIGHT")
    recall_recency_weight: float = Field(default=0.10, alias="RECALL_RECENCY_WEIGHT")
    recall_emotion_weight: float = Field(default=0.10, alias="RECALL_EMOTION_WEIGHT")

    @property
    def resolved_database_path(self) -> Path:
        return Path(self.database_path).expanduser().resolve()


@lru_cache
def get_settings() -> Settings:
    """Return cached settings."""

    return Settings()
