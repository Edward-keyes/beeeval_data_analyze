from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from api.services.llm_service import llm_service
from api.services.supabase_client import supabase
from api.core.logger import logger

router = APIRouter(prefix="/api/chat", tags=["chat"])

class ChatRequest(BaseModel):
    query: str

def _fallback_answer(query: str, results: list[dict]) -> str:
    # Existing fallback logic preserved as backup
    q = (query or "").strip().lower()

    items = []
    for r in results:
        meta = r.get("metadata") or {}
        items.append(
            {
                "video_name": r.get("video_name") or "",
                "path": meta.get("path") or "",
                "score": meta.get("response_quality_score"),
                "user_question": meta.get("user_question") or "",
                "system_response": meta.get("system_response") or "",
                "summary": meta.get("summary") or "",
            }
        )

    if any(k in q for k in ["最高", "最好", "top", "质量", "评分"]):
        def _score(v):
            s = v.get("score")
            return float(s) if isinstance(s, (int, float)) else -1.0

        items.sort(key=_score, reverse=True)
        selected = items[:5]
        lines = ["根据最近的分析结果（按回复质量分数排序）："]
        for it in selected:
            name = it["video_name"]
            path = it["path"]
            score = it.get("score")
            summary = it.get("summary")
            link = f"[{name}]({path})" if name and path else name
            suffix = f"（{score}/5）" if isinstance(score, (int, float)) else ""
            lines.append(f"- {link}{suffix}：{summary}".strip())
        return "\n".join(lines)

    keywords = []
    for token in ["银河", "理想", "flyme", "ota", "耗电", "闲聊", "情感", "推荐", "看海", "抱怨"]:
        if token in query:
            keywords.append(token)

    filtered = items
    if keywords:
        filtered = [it for it in items if any(k in it["video_name"] or k in it["summary"] for k in keywords)]

    selected = (filtered or items)[:6]
    lines = ["我先基于数据库中的最近分析结果做一个简要汇总（当前大模型回答链路不稳定时会用此兜底）："]
    for it in selected:
        name = it["video_name"]
        path = it["path"]
        summary = it.get("summary")
        link = f"[{name}]({path})" if name and path else name
        if summary:
            lines.append(f"- {link}：{summary}")
        else:
            uq = it.get("user_question")
            sr = it.get("system_response")
            if uq or sr:
                lines.append(f"- {link}：用户问题「{uq}」，系统回答「{sr}」")
            else:
                lines.append(f"- {link}")

    return "\n".join(lines)

@router.post("/query")
async def chat_query(request: ChatRequest):
    try:
        # 1. Fetch relevant context from database (video_results)
        # Enhanced query to fetch evaluation_scores
        try:
            # Fetch more results to allow for better filtering
            res = (
                supabase.table("video_results")
                .select("video_name, metadata, evaluation_scores(*)")
                .order("created_at", desc=True)
                .limit(50) 
                .execute()
            )
            all_results = res.data
        except Exception as db_err:
            logger.error(f"Chat DB query failed: {db_err}")
            raise HTTPException(status_code=503, detail="Database query failed")
        
        # 2. Smart Filtering / Re-ranking
        query_terms = request.query.lower().split()
        relevant_results = []
        
        for r in all_results:
            score = 0
            # Search in video name
            v_name = (r.get("video_name") or "").lower()
            if any(t in v_name for t in query_terms):
                score += 3
            
            # Search in metadata summary
            meta = r.get("metadata") or {}
            summary = (meta.get("summary") or "").lower()
            if any(t in summary for t in query_terms):
                score += 2
                
            # Search in user question
            uq = (meta.get("user_question") or "").lower()
            if any(t in uq for t in query_terms):
                score += 2

            r["_relevance"] = score
            relevant_results.append(r)
            
        # Sort by relevance desc, then created_at (implicitly)
        relevant_results.sort(key=lambda x: x["_relevance"], reverse=True)
        
        # Take top 15 most relevant
        top_results = relevant_results[:15]
        
        # 3. Format Context - Enhanced with Scores
        context_str = "Here are the video analysis results from the database:\n\n"
        for r in top_results:
            meta = r.get("metadata", {})
            eval_scores = r.get("evaluation_scores", [])
            
            # Format detailed scores
            scores_str = ""
            if eval_scores:
                scores_list = []
                for s in eval_scores:
                    criteria = s.get("criteria", "Unknown")
                    val = s.get("score", "N/A")
                    scores_list.append(f"{criteria}: {val}")
                scores_str = ", ".join(scores_list)
            
            context_str += f"### Video: {r['video_name']}\n"
            context_str += f"- Path: {meta.get('path', 'N/A')}\n"
            context_str += f"- User Question: {meta.get('user_question', 'N/A')}\n"
            context_str += f"- System Response: {meta.get('system_response', 'N/A')}\n"
            context_str += f"- Quality Score: {meta.get('response_quality_score', 'N/A')}/5\n"
            context_str += f"- Latency: {meta.get('latency_ms', 'N/A')}ms\n"
            if scores_str:
                context_str += f"- Detailed Scores: {scores_str}\n"
            context_str += f"- Summary: {meta.get('summary', '')}\n\n"
            
        # 4. Construct Enhanced Prompt
        prompt = f"""
        You are BeeEVAL, an expert AI data analyst for smart cabin evaluation.
        User Query: "{request.query}"
        
        **Analysis Data (Context):**
        {context_str}
        
        **Instructions:**
        1. **Deep Analysis**: Do not just list facts. Analyze the data to answer the user's specific question.
        2. **Synthesize**: If the user asks for "highlights" or "issues", group findings by themes (e.g., "Semantic Understanding", "Response Speed", "Emotional Intelligence").
        3. **Evidence-Based**: Support every claim with specific video examples.
        4. **Comparative**: If applicable, compare performance across different videos.
        5. **Format**:
           - Use Markdown.
           - Use **Bold** for key insights.
           - When referencing a video, ALWAYS use this link format: `[Video Name](Video Path)`.
           - Example: `[demo.mp4](/tmp/demo.mp4)`.
        6. **Language**: Respond in Chinese (Simplified).
        
        **Goal**: Provide a professional, insightful, and structured answer that helps the user understand the system's performance.
        """
        
        # 5. Call LLM
        messages = [
            {"role": "system", "content": "You are an expert data analyst. You provide deep, structured insights based on data."},
            {"role": "user", "content": prompt}
        ]
        
        try:
            response = llm_service.client.chat.completions.create(
                model=llm_service.model,
                messages=messages,
                stream=False
            )
            return {"answer": response.choices[0].message.content}
        except Exception as llm_err:
            logger.error(f"Chat LLM request failed: {llm_err}")
            # Fallback to the local logic if LLM fails
            return {"answer": _fallback_answer(request.query, all_results)}
        
    except Exception as e:
        logger.error(f"Chat Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
