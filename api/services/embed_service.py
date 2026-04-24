"""
嵌入服务：使用 BGE 模型生成文本向量
"""

from sentence_transformers import SentenceTransformer
from api.core.logger import logger
from api.core.config import settings


class EmbedService:
    """嵌入服务：文本向量化"""

    def __init__(self, model_path: str = None):
        """
        初始化嵌入服务

        Args:
            model_path: 嵌入模型路径，默认使用配置中的 EMBEDDING_MODEL_PATH
        """
        model_path = model_path or settings.EMBEDDING_MODEL_PATH

        if not model_path:
            raise ValueError("EMBEDDING_MODEL_PATH not configured in .env")

        logger.info(f"Loading embedding model from: {model_path}")
        self.model = SentenceTransformer(model_path)
        self.dimension = 768  # bge-base-zh 的向量维度
        logger.info(f"Embedding model loaded, dimension: {self.dimension}")

    def embed(self, text: str) -> list[float]:
        """
        生成单条文本的向量

        Args:
            text: 输入文本

        Returns:
            768 维向量列表
        """
        embedding = self.model.encode(text, normalize_embeddings=True)
        return embedding.tolist()

    def embed_batch(self, texts: list[str], batch_size: int = 32, show_progress: bool = False) -> list[list[float]]:
        """
        批量生成向量

        Args:
            texts: 文本列表
            batch_size: 批次大小
            show_progress: 是否显示进度条

        Returns:
            向量列表
        """
        embeddings = self.model.encode(
            texts,
            normalize_embeddings=True,
            batch_size=batch_size,
            show_progress_bar=show_progress
        )
        return embeddings.tolist()


# 单例
embed_service = EmbedService()
