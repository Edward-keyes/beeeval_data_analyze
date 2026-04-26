import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # PostgreSQL configuration
    DB_HOST: str = os.getenv("DB_HOST", "localhost")
    DB_PORT: int = int(os.getenv("DB_PORT", "5432"))
    DB_NAME: str = os.getenv("DB_NAME", "beeeval")
    DB_USER: str = os.getenv("DB_USER", "postgres")
    DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "https://ai.juguang.chat/v1/chat/completions")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "gemini-3-pro-preview-thinking")

    # ───── Dr.bee 调试台候选模型 ─────
    # 每个模型独立 (label, base_url, api_key, name)。
    # base_url / api_key / name 任一为空时，前端下拉不会显示该模型。
    # 默认（DEFAULT）兜底到现有的 LLM_BASE_URL + LLM_API_KEY + LLM_MODEL。
    LLM_MODEL_DEFAULT_LABEL: str = os.getenv("LLM_MODEL_DEFAULT_LABEL", "Default")
    LLM_MODEL_DEFAULT_BASE_URL: str = os.getenv("LLM_MODEL_DEFAULT_BASE_URL", "") or os.getenv("LLM_BASE_URL", "")
    LLM_MODEL_DEFAULT_API_KEY: str = os.getenv("LLM_MODEL_DEFAULT_API_KEY", "") or os.getenv("LLM_API_KEY", "")
    LLM_MODEL_DEFAULT_NAME: str = os.getenv("LLM_MODEL_DEFAULT_NAME", "") or os.getenv("LLM_MODEL", "")

    LLM_MODEL_MIMO_LABEL: str = os.getenv("LLM_MODEL_MIMO_LABEL", "Xiaomi MiMo v2.5")
    LLM_MODEL_MIMO_BASE_URL: str = os.getenv("LLM_MODEL_MIMO_BASE_URL", "")
    LLM_MODEL_MIMO_API_KEY: str = os.getenv("LLM_MODEL_MIMO_API_KEY", "")
    LLM_MODEL_MIMO_NAME: str = os.getenv("LLM_MODEL_MIMO_NAME", "")

    LLM_MODEL_MINIMAX_LABEL: str = os.getenv("LLM_MODEL_MINIMAX_LABEL", "MiniMax v2.7")
    LLM_MODEL_MINIMAX_BASE_URL: str = os.getenv("LLM_MODEL_MINIMAX_BASE_URL", "")
    LLM_MODEL_MINIMAX_API_KEY: str = os.getenv("LLM_MODEL_MINIMAX_API_KEY", "")
    LLM_MODEL_MINIMAX_NAME: str = os.getenv("LLM_MODEL_MINIMAX_NAME", "")

    LLM_MODEL_KIMI_LABEL: str = os.getenv("LLM_MODEL_KIMI_LABEL", "Kimi K2.5")
    LLM_MODEL_KIMI_BASE_URL: str = os.getenv("LLM_MODEL_KIMI_BASE_URL", "")
    LLM_MODEL_KIMI_API_KEY: str = os.getenv("LLM_MODEL_KIMI_API_KEY", "")
    LLM_MODEL_KIMI_NAME: str = os.getenv("LLM_MODEL_KIMI_NAME", "")

    # Moonshine ASR model configuration
    MOONSHINE_MODEL_PATH: str = os.getenv("MOONSHINE_MODEL_PATH", "")
    MOONSHINE_MODEL_ARCH: int = int(os.getenv("MOONSHINE_MODEL_ARCH", "1"))

    # NAS configuration
    NAS_URL: str = os.getenv("NAS_URL", "")
    NAS_TOKEN: str = os.getenv("NAS_TOKEN", "")
    NAS_VIDEO_ROOT: str = os.getenv("NAS_VIDEO_ROOT", "/volume1")

    # RAG configuration
    QDRANT_URL: str = os.getenv("QDRANT_URL", "http://localhost:6333")
    QDRANT_COLLECTION: str = os.getenv("QDRANT_COLLECTION", "beeeval")
    QDRANT_API_KEY: str = os.getenv("QDRANT_API_KEY", "")
    EMBEDDING_MODEL_PATH: str = os.getenv("EMBEDDING_MODEL_PATH", "")

    # Redis / Celery
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    CELERY_BROKER_URL: str = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
    USE_CELERY: bool = False

    # Optional: File storage path for temp files
    TEMP_DIR: str = os.path.join(os.getcwd(), "temp_files")

    class Config:
        env_file = ".env"

settings = Settings()

# Ensure temp directory exists
if not os.path.exists(settings.TEMP_DIR):
    os.makedirs(settings.TEMP_DIR)
