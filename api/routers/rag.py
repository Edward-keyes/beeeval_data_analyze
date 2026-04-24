"""
RAG 路由：向量化和检索问答 API
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from api.services.rag_service import rag_service
from api.services.local_db_client import supabase
from api.core.logger import logger
import hashlib
import uuid
import os
import json
from datetime import datetime

router = APIRouter(prefix="/api/rag", tags=["rag"])


class VectorizeRequest(BaseModel):
    task_ids: list[str]  # 支持批量选择任务入库


class VectorizeResponse(BaseModel):
    vectorized_count: int
    skipped_count: int
    failed_count: int


class QueryRequest(BaseModel):
    question: str
    top_k: int = 20


class QueryResponse(BaseModel):
    answer: str
    sources: list[dict]


@router.post("/vectorize", response_model=VectorizeResponse)
async def vectorize_evaluations(request: VectorizeRequest):
    """
    手动选择评估结果入库

    从选中的任务中提取所有视频的评估结果，生成向量后存入 Qdrant
    """
    from api.services.embed_service import embed_service

    vectorized_count = 0
    skipped_count = 0
    failed_count = 0
    evaluations_to_vectorize = []

    for task_id in request.task_ids:
        logger.info(f"Processing task: {task_id}")

        # 从 SQLite 查询该任务下的所有视频结果（包含结构化信息）
        results = supabase.table("video_results")\
            .select("id, video_name, metadata, created_at, case_id, brand_model, system_version, function_domain, scenario, sequence")\
            .eq("task_id", task_id)\
            .execute()

        if not results.data:
            logger.warning(f"No results found for task: {task_id}")
            continue

        for result in results.data:
            metadata = result.get('metadata', {})
            video_name = result.get('video_name', '')

            # 跳过已入库的（通过 is_vectorized 标记）
            if metadata.get('is_vectorized'):
                skipped_count += 1
                logger.debug(f"Skipping already vectorized video: {video_name}")
                continue

            cases = metadata.get('cases', [])
            if not cases:
                logger.debug(f"No cases found for video: {video_name}")
                continue

            for case in cases:
                user_question = case.get('user_question', '')
                system_response = case.get('system_response', '')
                summary = case.get('summary', '')

                if not user_question or not system_response:
                    continue

                # 生成唯一 ID（基于视频名 + 问题哈希）
                unique_id = hashlib.md5(
                    f"{video_name}_{user_question[:50]}".encode('utf-8')
                ).hexdigest()

                eval_entry = {
                    "id": unique_id,
                    "video_name": video_name,
                    "user_question": user_question,
                    "system_response": system_response,
                    "summary": summary,
                    "evaluations": case.get('matched_metrics', []),
                    "created_at": result.get('created_at', ''),
                    # 结构化信息
                    "case_id": result.get('case_id', ''),
                    "brand_model": result.get('brand_model', ''),
                    "system_version": result.get('system_version', ''),
                    "function_domain": result.get('function_domain', ''),
                    "scenario": result.get('scenario', ''),
                    "sequence": result.get('sequence', '')
                }
                evaluations_to_vectorize.append(eval_entry)

    # 批量生成向量并入库
    if evaluations_to_vectorize:
        logger.info(f"Vectorizing {len(evaluations_to_vectorize)} evaluations...")

        # 批量生成向量
        search_texts = [
            f"用户问题：{e['user_question']}\n系统回复：{e['system_response']}\n评估总结：{e['summary']}"
            for e in evaluations_to_vectorize
        ]

        try:
            vectors = embed_service.embed_batch(search_texts, batch_size=32, show_progress=True)

            # 添加向量到数据
            for i, e in enumerate(evaluations_to_vectorize):
                e['vector'] = vectors[i]

            # 入库到 Qdrant
            vectorized_count = rag_service.add_evaluations(evaluations_to_vectorize)
            logger.info(f"Successfully vectorized {vectorized_count} evaluations")

        except Exception as e:
            logger.error(f"Failed to vectorize evaluations: {e}")
            failed_count = len(evaluations_to_vectorize)

    return VectorizeResponse(
        vectorized_count=vectorized_count,
        skipped_count=skipped_count,
        failed_count=failed_count
    )


@router.post("/query", response_model=QueryResponse)
async def rag_query(request: QueryRequest):
    """
    RAG 检索增强问答

    1. 生成查询向量
    2. 从 Qdrant 检索相关评估结果
    3. 构建 RAG Prompt
    4. 调用云端大模型生成回答
    """
    from api.services.llm_service import llm_service
    from api.services.embed_service import embed_service

    # 1. 生成查询向量
    query_vector = embed_service.embed(request.question)

    # 2. 向量检索
    sources = rag_service.search(request.question, query_vector, top_k=request.top_k)

    # 检测用户问题语言
    import re
    def detect_language(text):
        # 简单判断：如果包含较多中文字符，则为中文
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
        return 'zh' if chinese_chars > len(text) * 0.3 else 'en'

    user_lang = detect_language(request.question)

    if not sources:
        # 无相关结果时，直接调用大模型
        if user_lang == 'zh':
            prompt = f"""你是一个智能座舱 AI 评测助手。请回答用户的问题。

【用户问题】
{request.question}

由于暂无相关评估数据，请基于你的通用知识进行回答。"""
        else:
            prompt = f"""You are an intelligent cockpit AI evaluation assistant. Please answer the user's question.

【User Question】
{request.question}

Since there is no relevant evaluation data available, please answer based on your general knowledge."""

        answer = await llm_service.evaluate_video.__func__(
            llm_service,
            {"segments": [], "text": request.question},
            [],
            language="zh" if user_lang == 'zh' else "en"
        )
        # 简化处理，直接调用
        import json
        try:
            result = json.loads(answer)
            answer_text = result.get('cases', [{}])[0].get('system_response', answer)
        except:
            answer_text = answer

        return QueryResponse(answer=answer_text, sources=[])
    else:
        # 从数据库查询视频实际路径
        video_paths = {}
        for s in sources:
            video_name = s.get('video_name', '')
            if video_name:
                # 查询该视频的路径
                result = supabase.table("video_results").select("metadata").eq("video_name", video_name).execute()
                if result.data and len(result.data) > 0:
                    path = result.data[0].get('metadata', {}).get('path', '')
                    if path:
                        video_paths[video_name] = path

        # 3. 构建 RAG Prompt - 松绑版（给数据+轻约束，把思考空间交给 LLM）
        def _avg(xs):
            xs = [x for x in xs if isinstance(x, (int, float))]
            return round(sum(xs) / len(xs), 2) if xs else None

        def _collect_scores(case_list):
            all_scores = []
            for c in case_list:
                for ev in c.get('evaluations', []) or []:
                    sc = ev.get('score')
                    if isinstance(sc, (int, float)):
                        all_scores.append(sc)
            return all_scores

        # 按功能域、车型等维度做聚合统计（让 LLM 能直接回答对比/排序类问题）
        from collections import defaultdict
        by_domain = defaultdict(list)
        by_model = defaultdict(list)
        by_version = defaultdict(list)
        for s in sources:
            if s.get('function_domain'):
                by_domain[s['function_domain']].append(s)
            if s.get('brand_model'):
                by_model[s['brand_model']].append(s)
            if s.get('system_version'):
                by_version[s['system_version']].append(s)

        def _fmt_group(group: dict, label_zh: str, label_en: str, lang: str) -> str:
            if not group:
                return ""
            lines = []
            for key, items in sorted(group.items(), key=lambda kv: -len(kv[1])):
                scores = _collect_scores(items)
                avg = _avg(scores)
                if lang == 'zh':
                    lines.append(f"  - {key}：{len(items)} 个案例" + (f"，平均分 {avg}" if avg is not None else ""))
                else:
                    lines.append(f"  - {key}: {len(items)} cases" + (f", avg score {avg}" if avg is not None else ""))
            title = label_zh if lang == 'zh' else label_en
            return f"{title}\n" + "\n".join(lines)

        agg_zh = "\n".join(x for x in [
            _fmt_group(by_domain, "按功能域分布：", "", 'zh'),
            _fmt_group(by_model, "按车型分布：", "", 'zh'),
            _fmt_group(by_version, "按系统版本分布：", "", 'zh'),
        ] if x)

        agg_en = "\n".join(x for x in [
            _fmt_group(by_domain, "", "By function domain:", 'en'),
            _fmt_group(by_model, "", "By vehicle model:", 'en'),
            _fmt_group(by_version, "", "By system version:", 'en'),
        ] if x)

        # 构建案例数据
        case_details = []
        for i, s in enumerate(sources):
            video_name = s.get('video_name', '')
            video_path = video_paths.get(video_name, video_name)
            score_list = [f"{e.get('metric_name', e.get('criteria', 'N/A'))}={e.get('score', 'N/A')}"
                          for e in (s.get('evaluations') or [])]
            if user_lang == 'zh':
                case_info = (
                    f"[案例 {i+1}] [{video_name}]({video_path}) "
                    f"| 车型={s.get('brand_model', 'N/A')} 版本={s.get('system_version', 'N/A')} "
                    f"功能域={s.get('function_domain', 'N/A')}\n"
                    f"  问：{s.get('user_question', '')}\n"
                    f"  答：{s.get('system_response', '')}\n"
                    f"  评估：{s.get('summary', '')}\n"
                    f"  评分：{', '.join(score_list) if score_list else 'N/A'}"
                )
            else:
                case_info = (
                    f"[Case {i+1}] [{video_name}]({video_path}) "
                    f"| model={s.get('brand_model', 'N/A')} version={s.get('system_version', 'N/A')} "
                    f"domain={s.get('function_domain', 'N/A')}\n"
                    f"  Q: {s.get('user_question', '')}\n"
                    f"  A: {s.get('system_response', '')}\n"
                    f"  Eval: {s.get('summary', '')}\n"
                    f"  Scores: {', '.join(score_list) if score_list else 'N/A'}"
                )
            case_details.append(case_info)

        if user_lang == 'zh':
            system_instruction = (
                "你是 Dr.Bee —— 一个智能座舱 AI 评测专家助手。"
                "用户会问你关于某台车、某个功能域、某个版本的表现等问题，"
                "你基于下面给出的真实评测数据（检索 + 聚合统计）自由地给出你的判断与解读。\n\n"
                "几条轻约束：\n"
                "① 回答必须来自给定数据；数据不足就诚实说「样本较少，结论仅供参考」，不要编造。\n"
                "② 引用视频时用 Markdown 链接：[视频名](视频路径)，方便用户点击查看。\n"
                "③ 用户用哪种语言提问就用哪种语言回答。\n"
                "其他格式、结构、长度、是否列表，全都由你根据问题自己决定，"
                "不需要套「观点先行/数据支撑/案例佐证」之类的模板。"
            )

            prompt = f"""【用户问题】
{request.question}

【检索到的案例数】{len(sources)}

【聚合统计】
{agg_zh if agg_zh else '（无结构化字段）'}

【案例明细】
{chr(10).join(case_details)}

请结合上面的数据，自然地回答用户问题。"""
        else:
            system_instruction = (
                "You are Dr.Bee, an expert assistant for in-car AI assistant evaluation. "
                "Users ask you about how a specific car / function domain / system version performs, "
                "and you give your judgement based on the real evaluation data below "
                "(retrieved cases + aggregated statistics).\n\n"
                "Soft rules:\n"
                "(1) Base your answer on the provided data; if the sample is small, say so honestly — do not fabricate.\n"
                "(2) When referring to a video, use a Markdown link: [video_name](video_path) so the user can click.\n"
                "(3) Respond in the same language the user used.\n"
                "Everything else — structure, length, whether to use lists — is up to you. "
                "No need to follow a rigid 'point-first / data-support / case-evidence' template."
            )

            prompt = f"""[User Question]
{request.question}

[Retrieved cases] {len(sources)}

[Aggregated stats]
{agg_en if agg_en else '(no structured fields)'}

[Case details]
{chr(10).join(case_details)}

Please answer the user's question naturally, grounded in the data above."""

        messages = [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": prompt}
        ]

        try:
            response = llm_service.client.chat.completions.create(
                model=llm_service.model,
                messages=messages,
                temperature=0.7,
                max_tokens=4096,
            )
            answer = response.choices[0].message.content
        except Exception as e:
            logger.error(f"LLM call failed: {e}")
            answer = "抱歉，大模型服务暂时不可用，请稍后重试。" if user_lang == 'zh' else "Sorry, the LLM service is temporarily unavailable. Please try again later."

        return QueryResponse(answer=answer, sources=sources)


@router.get("/stats")
async def get_vector_stats():
    """获取向量库统计信息"""
    return rag_service.get_stats()


@router.get("/vectors")
async def list_vectors(
    offset: str = None,
    limit: int = 20,
    video_name: str = None,
    brand_model: str = None,
    function_domain: str = None,
):
    """分页浏览向量库中的数据"""
    try:
        return rag_service.scroll_vectors(
            offset=offset,
            limit=limit,
            video_name_filter=video_name,
            brand_model_filter=brand_model,
            function_domain_filter=function_domain,
        )
    except Exception as e:
        logger.error(f"Error listing vectors: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/vectors/{point_id}")
async def get_vector_detail(point_id: str):
    """获取单条向量的完整信息"""
    result = rag_service.get_point(point_id)
    if not result:
        raise HTTPException(status_code=404, detail="Vector not found")
    return result


class UpdateVectorPayload(BaseModel):
    video_name: str = ""
    user_question: str = ""
    system_response: str = ""
    summary: str = ""
    evaluations: list = []
    case_id: str = ""
    brand_model: str = ""
    system_version: str = ""
    function_domain: str = ""
    scenario: str = ""
    sequence: str = ""
    created_at: str = ""
    re_embed: bool = False


@router.put("/vectors/{point_id}")
async def update_vector(point_id: str, body: UpdateVectorPayload):
    """
    编辑单条向量的 payload。
    如果 re_embed=true，会根据新内容重新生成 embedding（适用于修改了问题/回复/总结等语义字段时）。
    """
    existing = rag_service.get_point(point_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Vector not found")

    payload = body.model_dump(exclude={"re_embed"})
    try:
        rag_service.update_point_payload(point_id, payload, re_embed=body.re_embed)
        return {"status": "ok", "id": point_id, "re_embedded": body.re_embed}
    except Exception as e:
        logger.error(f"Error updating vector {point_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/facets")
async def get_vector_facets():
    """获取向量库中的筛选选项（视频名、品牌车型、功能域的去重列表）"""
    try:
        return rag_service.get_payload_facets()
    except Exception as e:
        logger.error(f"Error fetching facets: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class DeleteVectorsRequest(BaseModel):
    ids: list[str]


@router.post("/vectors/delete-batch")
async def delete_vectors_batch(request: DeleteVectorsRequest):
    """批量删除指定 ID 的向量"""
    try:
        rag_service.delete_by_ids(request.ids)
        return {"status": "ok", "deleted": len(request.ids)}
    except Exception as e:
        logger.error(f"Error deleting vectors: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/vectors/clear")
async def clear_vectors():
    """清空并重建向量集合"""
    try:
        rag_service.clear_collection()
        return {"status": "ok", "message": "Collection cleared and recreated"}
    except Exception as e:
        logger.error(f"Error clearing collection: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export")
async def export_vectors(with_vectors: bool = True):
    """
    导出向量库全部数据为 JSON 文件下载。
    with_vectors=true 时包含 embedding 向量（用于完整迁移），
    with_vectors=false 时仅导出 payload 元数据。
    """
    try:
        data = rag_service.export_all(with_vectors=with_vectors)
        stats = rag_service.get_stats()

        export_obj = {
            "exported_at": datetime.utcnow().isoformat() + "Z",
            "collection_name": stats["collection_name"],
            "dimension": stats["dimension"],
            "total_vectors": len(data),
            "with_vectors": with_vectors,
            "points": data,
        }

        json_bytes = json.dumps(export_obj, ensure_ascii=False, indent=2).encode("utf-8")
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"beeeval_vectors_{timestamp}.json"

        return StreamingResponse(
            iter([json_bytes]),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        logger.error(f"Error exporting vectors: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/video/{video_name}")
async def delete_video_vectors(video_name: str):
    """删除指定视频的向量"""
    rag_service.delete_by_video(video_name)
    return {"status": "ok", "message": f"Deleted vectors for video: {video_name}"}
