"""
RAG 服务：管理 Qdrant 向量数据库的连接、入库、检索
"""

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
from api.core.logger import logger
from api.core.config import settings
from typing import Optional


class RagService:
    """RAG 服务：向量数据库管理"""

    def __init__(self, qdrant_url: str = None, collection_name: str = None):
        """
        初始化 RAG 服务

        Args:
            qdrant_url: Qdrant 服务地址
            collection_name: 集合名称
        """
        self.qdrant_url = qdrant_url or settings.QDRANT_URL
        self.collection_name = collection_name or settings.QDRANT_COLLECTION
        self.dimension = 768  # bge-base-zh 的向量维度

        # QDRANT_API_KEY is optional: empty string = unauthenticated (dev / local).
        # When the server runs Qdrant with QDRANT__SERVICE__API_KEY set, clients
        # MUST pass the same key or get 401.
        api_key = settings.QDRANT_API_KEY or None
        logger.info(
            f"Connecting to Qdrant at: {self.qdrant_url} "
            f"(api_key={'***' if api_key else 'none'})"
        )
        self.client = QdrantClient(url=self.qdrant_url, api_key=api_key)
        self._ensure_collection()

    def _ensure_collection(self):
        """确保集合存在，不存在则创建"""
        try:
            collections = self.client.get_collections().collections
            exists = any(c.name == self.collection_name for c in collections)

            if not exists:
                logger.info(f"Creating collection: {self.collection_name}")
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(size=self.dimension, distance=Distance.COSINE)
                )
                logger.info(f"Collection '{self.collection_name}' created successfully")
            else:
                logger.info(f"Collection '{self.collection_name}' already exists")
        except Exception as e:
            logger.error(f"Failed to ensure collection: {e}")
            raise

    def add_evaluations(self, evaluations: list[dict]) -> int:
        """
        批量入库评估结果

        Args:
            evaluations: 评估数据列表，每项包含：
                - id: 唯一 ID
                - video_name: 视频名称
                - user_question: 用户问题
                - system_response: 系统回复
                - summary: 评估总结
                - evaluations: 指标评估列表
                - vector: 向量（可选，如未提供则方法内生成）
                - case_id: 用例 ID（可选）
                - brand_model: 品牌车型（可选）
                - system_version: 系统版本（可选）
                - function_domain: 功能域（可选）

        Returns:
            入库数量
        """
        from api.services.embed_service import embed_service

        points = []
        for eval_data in evaluations:
            # 构建用于检索的完整文本（包含结构化信息）
            search_text = f"""用例 ID: {eval_data.get('case_id', 'N/A')}
品牌车型：{eval_data.get('brand_model', 'N/A')}
系统版本：{eval_data.get('system_version', 'N/A')}
功能域：{eval_data.get('function_domain', 'N/A')}
用户问题：{eval_data['user_question']}
系统回复：{eval_data['system_response']}
评估总结：{eval_data['summary']}"""

            # 生成向量（如果未提供）
            vector = eval_data.get('vector')
            if not vector:
                vector = embed_service.embed(search_text)

            point = PointStruct(
                id=eval_data['id'],
                vector=vector,
                payload={
                    "video_name": eval_data['video_name'],
                    "user_question": eval_data['user_question'],
                    "system_response": eval_data['system_response'],
                    "summary": eval_data['summary'],
                    "evaluations": eval_data.get('evaluations', []),
                    "created_at": eval_data.get('created_at', ''),
                    # 结构化信息
                    "case_id": eval_data.get('case_id', ''),
                    "brand_model": eval_data.get('brand_model', ''),
                    "system_version": eval_data.get('system_version', ''),
                    "function_domain": eval_data.get('function_domain', ''),
                    "scenario": eval_data.get('scenario', ''),
                    "sequence": eval_data.get('sequence', '')
                }
            )
            points.append(point)

        if points:
            result = self.client.upsert(collection_name=self.collection_name, points=points)
            logger.info(f"Upserted {len(points)} vectors to Qdrant")
            return len(points)

        return 0

    def search(self, query: str, query_vector: Optional[list[float]] = None, top_k: int = 5) -> list[dict]:
        """
        向量检索

        Args:
            query: 查询文本（如未提供 query_vector 则自动生成）
            query_vector: 查询向量（可选，如未提供则自动生成）
            top_k: 返回数量

        Returns:
            相关评估结果列表
        """
        from api.services.embed_service import embed_service

        # 生成查询向量（如未提供）
        if query_vector is None:
            query_vector = embed_service.embed(query)

        results = self.client.query_points(
            collection_name=self.collection_name,
            query=query_vector,
            limit=top_k
        ).points

        return [{
            "score": r.score,
            "video_name": r.payload.get("video_name"),
            "user_question": r.payload.get("user_question"),
            "system_response": r.payload.get("system_response"),
            "summary": r.payload.get("summary"),
            "evaluations": r.payload.get("evaluations", []),
            "created_at": r.payload.get("created_at", ""),
            # 结构化信息
            "case_id": r.payload.get("case_id", ""),
            "brand_model": r.payload.get("brand_model", ""),
            "system_version": r.payload.get("system_version", ""),
            "function_domain": r.payload.get("function_domain", ""),
            "scenario": r.payload.get("scenario", ""),
            "sequence": r.payload.get("sequence", "")
        } for r in results]

    def scroll_vectors(
        self,
        offset: str = None,
        limit: int = 20,
        video_name_filter: str = None,
        brand_model_filter: str = None,
        function_domain_filter: str = None,
    ) -> dict:
        """
        分页浏览向量数据（基于 Qdrant scroll API）。

        Returns:
            {"points": [...], "next_offset": str | None, "total": int}
        """
        from qdrant_client.models import Filter, FieldCondition, MatchValue

        scroll_filter = None
        conditions = []
        if video_name_filter:
            conditions.append(FieldCondition(key="video_name", match=MatchValue(value=video_name_filter)))
        if brand_model_filter:
            conditions.append(FieldCondition(key="brand_model", match=MatchValue(value=brand_model_filter)))
        if function_domain_filter:
            conditions.append(FieldCondition(key="function_domain", match=MatchValue(value=function_domain_filter)))
        if conditions:
            scroll_filter = Filter(must=conditions)

        records, next_offset = self.client.scroll(
            collection_name=self.collection_name,
            scroll_filter=scroll_filter,
            offset=offset,
            limit=limit,
            with_payload=True,
            with_vectors=False,
        )

        info = self.client.get_collection(self.collection_name)
        total = info.points_count or 0

        points = []
        for r in records:
            payload = r.payload or {}
            points.append({
                "id": r.id,
                "video_name": payload.get("video_name", ""),
                "user_question": payload.get("user_question", ""),
                "system_response": payload.get("system_response", ""),
                "summary": payload.get("summary", ""),
                "evaluations": payload.get("evaluations", []),
                "created_at": payload.get("created_at", ""),
                "case_id": payload.get("case_id", ""),
                "brand_model": payload.get("brand_model", ""),
                "system_version": payload.get("system_version", ""),
                "function_domain": payload.get("function_domain", ""),
                "scenario": payload.get("scenario", ""),
                "sequence": payload.get("sequence", ""),
            })

        return {
            "points": points,
            "next_offset": str(next_offset) if next_offset is not None else None,
            "total": total,
        }

    def get_point(self, point_id: str) -> dict | None:
        """获取单条向量的完整数据"""
        results = self.client.retrieve(
            collection_name=self.collection_name,
            ids=[point_id],
            with_payload=True,
            with_vectors=False,
        )
        if not results:
            return None
        r = results[0]
        payload = r.payload or {}
        return {
            "id": r.id,
            **payload,
        }

    def update_point_payload(self, point_id: str, new_payload: dict, re_embed: bool = False):
        """
        更新单条向量的 payload。
        如果 re_embed=True，根据新 payload 重新生成 embedding 并 upsert。
        否则仅更新 payload（向量不变）。
        """
        if re_embed:
            from api.services.embed_service import embed_service

            search_text = f"""用例 ID: {new_payload.get('case_id', 'N/A')}
品牌车型：{new_payload.get('brand_model', 'N/A')}
系统版本：{new_payload.get('system_version', 'N/A')}
功能域：{new_payload.get('function_domain', 'N/A')}
用户问题：{new_payload.get('user_question', '')}
系统回复：{new_payload.get('system_response', '')}
评估总结：{new_payload.get('summary', '')}"""

            vector = embed_service.embed(search_text)
            point = PointStruct(id=point_id, vector=vector, payload=new_payload)
            self.client.upsert(collection_name=self.collection_name, points=[point])
            logger.info(f"Updated point {point_id} with re-embedding")
        else:
            self.client.set_payload(
                collection_name=self.collection_name,
                payload=new_payload,
                points=[point_id],
            )
            logger.info(f"Updated payload for point {point_id}")

    def clear_collection(self):
        """清空并重建集合"""
        self.client.delete_collection(self.collection_name)
        logger.info(f"Deleted collection: {self.collection_name}")
        self._ensure_collection()
        logger.info(f"Recreated collection: {self.collection_name}")

    def get_payload_facets(self) -> dict:
        """获取向量库中 brand_model / function_domain / video_name 的去重值列表，用于前端筛选。"""
        records, _ = self.client.scroll(
            collection_name=self.collection_name,
            limit=10000,
            with_payload=["video_name", "brand_model", "function_domain"],
            with_vectors=False,
        )
        video_names = set()
        brand_models = set()
        function_domains = set()
        for r in records:
            p = r.payload or {}
            if p.get("video_name"):
                video_names.add(p["video_name"])
            if p.get("brand_model"):
                brand_models.add(p["brand_model"])
            if p.get("function_domain"):
                function_domains.add(p["function_domain"])
        return {
            "video_names": sorted(video_names),
            "brand_models": sorted(brand_models),
            "function_domains": sorted(function_domains),
        }

    def export_all(self, with_vectors: bool = True) -> list[dict]:
        """
        导出向量库全部数据，用于迁移到其他向量库。
        逐批 scroll 获取所有 point，返回 [{id, vector, payload}, ...] 列表。
        """
        all_points = []
        offset = None
        batch_size = 100

        while True:
            records, next_offset = self.client.scroll(
                collection_name=self.collection_name,
                offset=offset,
                limit=batch_size,
                with_payload=True,
                with_vectors=with_vectors,
            )
            for r in records:
                entry: dict = {"id": r.id, "payload": r.payload or {}}
                if with_vectors and r.vector is not None:
                    entry["vector"] = r.vector
                all_points.append(entry)

            if next_offset is None:
                break
            offset = next_offset

        logger.info(f"Exported {len(all_points)} vectors (with_vectors={with_vectors})")
        return all_points

    def get_stats(self) -> dict:
        """获取向量库统计信息"""
        info = self.client.get_collection(self.collection_name)
        return {
            "total_vectors": info.points_count or 0,
            "dimension": info.config.params.vectors.size,
            "collection_name": self.collection_name
        }

    def delete_by_video(self, video_name: str) -> int:
        """
        删除指定视频的向量

        Args:
            video_name: 视频名称

        Returns:
            删除数量（Qdrant 不返回具体数量，返回 0 表示成功）
        """
        self.client.delete(
            collection_name=self.collection_name,
            points_selector=Filter(
                must=[FieldCondition(key="video_name", match=MatchValue(value=video_name))]
            )
        )
        logger.info(f"Deleted vectors for video: {video_name}")
        return 0

    def delete_by_ids(self, ids: list[str]) -> int:
        """
        批量删除指定 ID 的向量

        Args:
            ids: ID 列表

        Returns:
            0（表示成功）
        """
        self.client.delete(
            collection_name=self.collection_name,
            points_selector=ids
        )
        logger.info(f"Deleted {len(ids)} vectors by IDs")
        return 0


# 单例
rag_service = RagService()
