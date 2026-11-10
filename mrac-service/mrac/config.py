import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


@dataclass(frozen=True)
class Settings:
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    service_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    embedding_provider: str = os.getenv("EMBEDDING_PROVIDER", "hash")
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    embedding_dim: int = int(os.getenv("EMBEDDING_DIM", "384"))
    include_draft: bool = os.getenv("RAG_INCLUDE_DRAFT", "true").lower() != "false"


def get_settings() -> Settings:
    return Settings()
