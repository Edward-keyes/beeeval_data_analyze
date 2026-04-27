"""
Dr.bee 调试台路由

给测试人员用的 RAG 调试入口：
- 暴露 system prompt 模板（带占位符），可在前端编辑后再发给 LLM；
- 4 个候选 LLM，每个模型独立 (base_url, api_key, model_name)，从 .env 加载；
- 强制 LLM 输出纯 Markdown；
- 可保存「prompt + 模型 + 问题 + 回答 + 耗时 + 检索来源」为会话记录；
- 支持「一键重放」用相同参数再调一次。

安全说明：
- base_url / api_key 只留在后端，前端只能拿到 (model_key, label, model_name)；
- 用户在前端选 model_key，后端临时构造 OpenAI client 调用，不污染全局 llm_service。
"""

from __future__ import annotations

import re
import time
from collections import defaultdict
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from api.core.config import settings
from api.core.logger import logger
from api.services.local_db_client import supabase

router = APIRouter(prefix="/api/drbee", tags=["dr_bee"])


# ────────────────────────────────────────────────────────────────────
# 默认 prompt 模板 + 占位符约束
# ────────────────────────────────────────────────────────────────────
REQUIRED_PLACEHOLDERS: tuple[str, ...] = ("{question}", "{case_details}")
OPTIONAL_PLACEHOLDERS: tuple[str, ...] = (
    "{retrieved_count}",
    "{aggregated_stats}",
    "{language}",
)


DEFAULT_SYSTEM_INSTRUCTION = """你是 Dr.Bee —— 一个智能座舱 AI 评测专家助手。
用户会问你关于某台车、某个功能域、某个版本的表现等问题。

【输出格式硬性要求】
1. 只输出 Markdown 文本，不要输出 JSON、HTML、XML，也不要把整段回答用 ``` 代码块包裹。
2. 引用视频时必须用 Markdown 链接：[视频名](视频路径.mp4)，方便用户点击播放。
3. 用户用哪种语言提问就用哪种语言回答。

【内容要求】
- 回答必须基于给定的检索数据；数据不足就诚实说「样本较少，结论仅供参考」，不要编造。
- 不要套「观点先行/数据支撑/案例佐证」之类的固定模板，根据问题自然组织。"""


DEFAULT_PROMPT_TEMPLATE = """【用户问题】
{question}

【检索到的案例数】{retrieved_count}

【聚合统计】
{aggregated_stats}

【案例明细】
{case_details}

请结合上面的数据，自然地回答用户问题（用 Markdown 输出）。"""


# ────────────────────────────────────────────────────────────────────
# 模型注册表 —— 每模型 (label, base_url, api_key, model_name) 四件套
# 任一字段为空的模型不会出现在前端下拉里
# ────────────────────────────────────────────────────────────────────
def _build_registry() -> Dict[str, Dict[str, str]]:
    """从 settings 读取 4 套模型配置；每次调用都重新读，方便修改 .env 后无需重启即可生效（reload 模式）。"""
    raw: List[Tuple[str, str, str, str, str]] = [
        ("default",
         settings.LLM_MODEL_DEFAULT_LABEL,
         settings.LLM_MODEL_DEFAULT_BASE_URL,
         settings.LLM_MODEL_DEFAULT_API_KEY,
         settings.LLM_MODEL_DEFAULT_NAME),
        ("mimo",
         settings.LLM_MODEL_MIMO_LABEL,
         settings.LLM_MODEL_MIMO_BASE_URL,
         settings.LLM_MODEL_MIMO_API_KEY,
         settings.LLM_MODEL_MIMO_NAME),
        ("minimax",
         settings.LLM_MODEL_MINIMAX_LABEL,
         settings.LLM_MODEL_MINIMAX_BASE_URL,
         settings.LLM_MODEL_MINIMAX_API_KEY,
         settings.LLM_MODEL_MINIMAX_NAME),
        ("kimi",
         settings.LLM_MODEL_KIMI_LABEL,
         settings.LLM_MODEL_KIMI_BASE_URL,
         settings.LLM_MODEL_KIMI_API_KEY,
         settings.LLM_MODEL_KIMI_NAME),
    ]
    out: Dict[str, Dict[str, str]] = {}
    for key, label, base_url, api_key, name in raw:
        # base_url 不能带 /chat/completions 后缀（OpenAI SDK 会自己拼）
        cleaned_base = base_url.rstrip("/") if base_url else ""
        if cleaned_base.endswith("/chat/completions"):
            cleaned_base = cleaned_base[: -len("/chat/completions")]
        out[key] = {
            "key": key,
            "label": label,
            "base_url": cleaned_base,
            "api_key": api_key,
            "model_name": name,
        }
    return out


def _public_model_options() -> List[Dict[str, str]]:
    """返回前端可见的字段（不含 api_key / base_url）。只返回完整配置的模型。"""
    reg = _build_registry()
    out: List[Dict[str, str]] = []
    for entry in reg.values():
        if entry["base_url"] and entry["api_key"] and entry["model_name"]:
            out.append({
                "key": entry["key"],
                "label": entry["label"],
                "model_name": entry["model_name"],
            })
    return out


def _resolve_model(key: Optional[str]) -> Dict[str, str]:
    """
    根据 model_key 取出完整配置（含 base_url / api_key）。
    传 None / 空 / 不存在 / 配置不全的 key 都会兜底到 default；
    default 也不全就报 400。
    """
    reg = _build_registry()

    def _is_complete(e: Dict[str, str]) -> bool:
        return bool(e and e.get("base_url") and e.get("api_key") and e.get("model_name"))

    if key and key in reg and _is_complete(reg[key]):
        return reg[key]

    if _is_complete(reg.get("default", {})):
        return reg["default"]

    # default 也没配齐时，找第一个可用的
    for entry in reg.values():
        if _is_complete(entry):
            return entry

    raise HTTPException(
        status_code=400,
        detail="No fully-configured LLM model found. 请在 .env 里至少给一个模型填齐 BASE_URL / API_KEY / NAME。"
    )


# ────────────────────────────────────────────────────────────────────
# 数据模型
# ────────────────────────────────────────────────────────────────────
class ModelOption(BaseModel):
    key: str
    label: str
    model_name: str


class ConfigResponse(BaseModel):
    default_system_instruction: str
    default_prompt_template: str
    required_placeholders: List[str]
    optional_placeholders: List[str]
    models: List[ModelOption]
    default_model_key: str
    # auto 模式默认参数（前端用于初始化 UI 控件）
    default_min_score: float
    rag_min_k: int
    rag_max_k: int


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1)
    prompt_template: Optional[str] = None
    system_instruction: Optional[str] = None
    model_key: Optional[str] = None
    top_k: int = 20
    # auto / manual 切换：
    # - manual：使用 top_k（保持旧行为）
    # - auto：忽略 top_k，按 min_score + 相对断崖 + min_k/max_k 自动决定数量
    selection_mode: Literal["auto", "manual"] = "manual"
    # auto 模式下的最低相似度阈值（0~1），不传则使用配置中的 RAG_MIN_SCORE_DEFAULT
    min_score: Optional[float] = None


class SourceItem(BaseModel):
    video_name: Optional[str] = None
    video_path: Optional[str] = None
    user_question: Optional[str] = None
    system_response: Optional[str] = None
    summary: Optional[str] = None
    score: Optional[float] = None
    brand_model: Optional[str] = None
    system_version: Optional[str] = None
    function_domain: Optional[str] = None


class QueryResponse(BaseModel):
    answer: str
    sources: List[SourceItem]
    model_key: str
    model_name: str
    llm_latency_ms: int
    total_latency_ms: int
    retrieved_count: int
    # auto 模式相关字段（manual 时也会回填，方便前端统一展示）
    selection_mode: Literal["auto", "manual"]
    min_score_used: Optional[float] = None
    top_score: Optional[float] = None
    low_relevance: bool = False


class SaveSessionRequest(BaseModel):
    title: Optional[str] = None
    prompt_template: str
    model_key: str
    model_name: str
    user_question: str
    answer: str
    llm_latency_ms: int
    total_latency_ms: int
    top_k: int
    retrieved_sources: List[dict] = Field(default_factory=list)
    selection_mode: Literal["auto", "manual"] = "manual"
    min_score: Optional[float] = None
    top_score: Optional[float] = None
    low_relevance: bool = False


class SessionListItem(BaseModel):
    id: int
    title: Optional[str]
    model_key: Optional[str]
    model_name: str
    user_question: str
    llm_latency_ms: Optional[int]
    total_latency_ms: Optional[int]
    top_k: Optional[int]
    created_at: str
    selection_mode: Optional[str] = None
    min_score: Optional[float] = None
    top_score: Optional[float] = None
    low_relevance: Optional[bool] = None


class SessionDetail(SessionListItem):
    prompt_template: str
    answer: str
    retrieved_sources: List[dict]


class ReplayResponse(BaseModel):
    original: SessionDetail
    replay: QueryResponse


# ────────────────────────────────────────────────────────────────────
# 辅助函数
# ────────────────────────────────────────────────────────────────────
def _validate_placeholders(prompt_template: str) -> None:
    missing = [p for p in REQUIRED_PLACEHOLDERS if p not in prompt_template]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=(
                f"prompt_template 缺少必填占位符: {', '.join(missing)}。"
                f"必填: {', '.join(REQUIRED_PLACEHOLDERS)}。"
                f"可选: {', '.join(OPTIONAL_PLACEHOLDERS)}。"
            ),
        )


def _detect_language(text: str) -> str:
    chinese_chars = len(re.findall(r"[\u4e00-\u9fff]", text or ""))
    return "zh" if chinese_chars > len(text or "") * 0.3 else "en"


def _avg(xs: list) -> Optional[float]:
    xs = [x for x in xs if isinstance(x, (int, float))]
    return round(sum(xs) / len(xs), 2) if xs else None


def _collect_scores(case_list: list[dict]) -> list[float]:
    out: list[float] = []
    for c in case_list:
        for ev in c.get("evaluations", []) or []:
            sc = ev.get("score")
            if isinstance(sc, (int, float)):
                out.append(sc)
    return out


def _format_aggregated(sources: list[dict], lang: str) -> str:
    by_domain: dict[str, list[dict]] = defaultdict(list)
    by_model: dict[str, list[dict]] = defaultdict(list)
    by_version: dict[str, list[dict]] = defaultdict(list)
    for s in sources:
        if s.get("function_domain"):
            by_domain[s["function_domain"]].append(s)
        if s.get("brand_model"):
            by_model[s["brand_model"]].append(s)
        if s.get("system_version"):
            by_version[s["system_version"]].append(s)

    def _fmt(group: dict, title_zh: str, title_en: str) -> str:
        if not group:
            return ""
        lines: list[str] = []
        for key, items in sorted(group.items(), key=lambda kv: -len(kv[1])):
            avg = _avg(_collect_scores(items))
            if lang == "zh":
                lines.append(f"  - {key}：{len(items)} 个案例" + (f"，平均分 {avg}" if avg is not None else ""))
            else:
                lines.append(f"  - {key}: {len(items)} cases" + (f", avg score {avg}" if avg is not None else ""))
        title = title_zh if lang == "zh" else title_en
        return f"{title}\n" + "\n".join(lines)

    parts = [
        _fmt(by_domain, "按功能域分布：", "By function domain:"),
        _fmt(by_model, "按车型分布：", "By vehicle model:"),
        _fmt(by_version, "按系统版本分布：", "By system version:"),
    ]
    out = "\n".join(p for p in parts if p)
    return out or ("（无结构化字段）" if lang == "zh" else "(no structured fields)")


def _format_case_details(sources: list[dict], video_paths: dict[str, str], lang: str) -> str:
    lines: list[str] = []
    for i, s in enumerate(sources):
        video_name = s.get("video_name", "") or ""
        video_path = video_paths.get(video_name, video_name)
        score_list = [
            f"{e.get('metric_name', e.get('criteria', 'N/A'))}={e.get('score', 'N/A')}"
            for e in (s.get("evaluations") or [])
        ]
        if lang == "zh":
            lines.append(
                f"[案例 {i+1}] [{video_name}]({video_path}) "
                f"| 车型={s.get('brand_model', 'N/A')} 版本={s.get('system_version', 'N/A')} "
                f"功能域={s.get('function_domain', 'N/A')}\n"
                f"  问：{s.get('user_question', '')}\n"
                f"  答：{s.get('system_response', '')}\n"
                f"  评估：{s.get('summary', '')}\n"
                f"  评分：{', '.join(score_list) if score_list else 'N/A'}"
            )
        else:
            lines.append(
                f"[Case {i+1}] [{video_name}]({video_path}) "
                f"| model={s.get('brand_model', 'N/A')} version={s.get('system_version', 'N/A')} "
                f"domain={s.get('function_domain', 'N/A')}\n"
                f"  Q: {s.get('user_question', '')}\n"
                f"  A: {s.get('system_response', '')}\n"
                f"  Eval: {s.get('summary', '')}\n"
                f"  Scores: {', '.join(score_list) if score_list else 'N/A'}"
            )
    return "\n".join(lines)


def _enrich_video_paths(sources: list[dict]) -> dict[str, str]:
    """从 PG 的 video_results.metadata.path 反查每个 video_name 的实际播放路径。"""
    paths: dict[str, str] = {}
    names = list({s.get("video_name") for s in sources if s.get("video_name")})
    if not names:
        return paths
    placeholders = ", ".join(["%s"] * len(names))
    sql = (
        f"SELECT DISTINCT ON (video_name) video_name, metadata "
        f"FROM video_results WHERE video_name IN ({placeholders}) "
        f"ORDER BY video_name, created_at DESC"
    )
    try:
        rows = supabase.raw_sql(sql, names).data
        for row in rows:
            meta = row.get("metadata") or {}
            p = meta.get("path") if isinstance(meta, dict) else None
            if p:
                paths[row["video_name"]] = p
    except Exception as e:
        logger.warning(f"_enrich_video_paths failed: {e}")
    return paths


def _row_to_session_detail(row: dict) -> SessionDetail:
    # selection_mode / min_score / top_score / low_relevance 在 ALTER TABLE 之前的旧记录里是 NULL，
    # 这里给前端兜底成 manual / None / None / False，避免老数据破坏 UI。
    selection_mode = row.get("selection_mode") or "manual"
    raw_min = row.get("min_score")
    raw_top = row.get("top_score")
    return SessionDetail(
        id=row["id"],
        title=row.get("title"),
        prompt_template=row.get("prompt_template", ""),
        model_key=row.get("model_key"),
        model_name=row.get("model_name", ""),
        user_question=row.get("user_question", ""),
        answer=row.get("answer", "") or "",
        llm_latency_ms=row.get("llm_latency_ms"),
        total_latency_ms=row.get("total_latency_ms"),
        top_k=row.get("top_k"),
        retrieved_sources=row.get("retrieved_sources") or [],
        created_at=str(row.get("created_at")),
        selection_mode=selection_mode,
        min_score=float(raw_min) if raw_min is not None else None,
        top_score=float(raw_top) if raw_top is not None else None,
        low_relevance=bool(row.get("low_relevance")) if row.get("low_relevance") is not None else False,
    )


# ────────────────────────────────────────────────────────────────────
# 路由
# ────────────────────────────────────────────────────────────────────
@router.get("/config", response_model=ConfigResponse)
async def get_config():
    options = _public_model_options()
    default_key = options[0]["key"] if options else ""
    return ConfigResponse(
        default_system_instruction=DEFAULT_SYSTEM_INSTRUCTION,
        default_prompt_template=DEFAULT_PROMPT_TEMPLATE,
        required_placeholders=list(REQUIRED_PLACEHOLDERS),
        optional_placeholders=list(OPTIONAL_PLACEHOLDERS),
        models=[ModelOption(**o) for o in options],
        default_model_key=default_key,
        default_min_score=settings.RAG_MIN_SCORE_DEFAULT,
        rag_min_k=settings.RAG_MIN_K,
        rag_max_k=settings.RAG_MAX_K,
    )


@router.post("/query", response_model=QueryResponse)
async def drbee_query(req: QueryRequest):
    import httpx
    from openai import OpenAI

    from api.services.embed_service import embed_service
    from api.services.rag_service import rag_service

    prompt_template = (req.prompt_template or DEFAULT_PROMPT_TEMPLATE).strip()
    system_instruction = (req.system_instruction or DEFAULT_SYSTEM_INSTRUCTION).strip()
    _validate_placeholders(prompt_template)

    cfg = _resolve_model(req.model_key)
    model_key = cfg["key"]
    model_name = cfg["model_name"]

    lang = _detect_language(req.question)
    total_t0 = time.perf_counter()

    # 1) 向量检索
    #    manual：使用 req.top_k；auto：忽略 top_k，按 min_score + 相对断崖动态决定数量
    selection_mode = req.selection_mode
    min_score_used: Optional[float] = None
    top_score: Optional[float] = None
    low_relevance: bool = False
    try:
        query_vector = embed_service.embed(req.question)
        if selection_mode == "auto":
            auto_res = rag_service.search_auto(
                req.question,
                query_vector,
                min_score=req.min_score,
            )
            sources = auto_res["items"]
            min_score_used = auto_res["min_score_used"]
            top_score = auto_res["top_score"]
            low_relevance = bool(auto_res["low_relevance"])
        else:
            sources = rag_service.search(req.question, query_vector, top_k=req.top_k)
    except Exception as e:
        logger.error(f"Dr.bee retrieval failed: {e}")
        raise HTTPException(status_code=502, detail=f"向量检索失败：{e}")

    # 2) 反查视频实际路径
    video_paths = _enrich_video_paths(sources) if sources else {}

    # 3) 渲染占位符
    rendered = prompt_template.format(
        question=req.question,
        retrieved_count=len(sources),
        aggregated_stats=_format_aggregated(sources, lang),
        case_details=_format_case_details(sources, video_paths, lang),
        language=lang,
    )

    # 4) 临时构造一个 OpenAI client，用本次选中模型的 base_url + api_key 调
    #    不复用全局 llm_service 以免污染主流程的视频打分调用
    httpx_client = httpx.Client(timeout=180.0, trust_env=False)
    client = OpenAI(
        api_key=cfg["api_key"],
        base_url=cfg["base_url"],
        timeout=180.0,
        max_retries=1,
        http_client=httpx_client,
    )

    # 不同 LLM 网关对采样参数的容忍度不同（如 Kimi K2.6 只接受 temperature=1，
    # 部分 reasoning 模型不支持 max_tokens），所以这里做一个"逐步降级"的兼容重试：
    # 先用偏好参数试，命中网关白名单错误就剥掉对应字段再来一次，最多 3 次。
    messages = [
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": rendered},
    ]
    base_kwargs = {"model": model_name, "messages": messages,
                   "temperature": 0.7, "max_tokens": 4096}

    def _strip_on_error(kwargs: dict, err_msg: str) -> Optional[dict]:
        """根据网关报错从 kwargs 里剥掉/改写不被接受的字段；返回新 kwargs 或 None（已无法降级）。"""
        low = err_msg.lower()
        new = dict(kwargs)
        if "temperature" in low and "temperature" in new:
            # Kimi K2.6 这种"only 1 is allowed"的限制 → 直接改成 1
            new["temperature"] = 1
            return new if new != kwargs else None
        if "max_tokens" in low and "max_tokens" in new:
            new.pop("max_tokens")
            return new
        if ("top_p" in low or "frequency_penalty" in low or "presence_penalty" in low):
            for k in ("top_p", "frequency_penalty", "presence_penalty"):
                new.pop(k, None)
            return new if new != kwargs else None
        return None

    llm_t0 = time.perf_counter()
    answer = ""
    last_err: Optional[Exception] = None
    kwargs = base_kwargs
    try:
        for attempt in range(3):
            try:
                resp = client.chat.completions.create(**kwargs)
                answer = resp.choices[0].message.content or ""
                last_err = None
                break
            except Exception as e:
                last_err = e
                downgraded = _strip_on_error(kwargs, str(e))
                if downgraded is None:
                    break
                logger.warning(
                    f"Dr.bee retry (key={model_key}, attempt {attempt+1}) after gateway "
                    f"complaint: {e}; downgraded kwargs -> "
                    f"{ {k: v for k, v in downgraded.items() if k not in ('messages',)} }"
                )
                kwargs = downgraded
        if last_err is not None:
            raise last_err
    except Exception as e:
        logger.error(f"Dr.bee LLM call failed (key={model_key}, model={model_name}): {e}")
        raise HTTPException(status_code=502, detail=f"LLM 调用失败：{e}")
    finally:
        try:
            httpx_client.close()
        except Exception:
            pass

    llm_latency_ms = int((time.perf_counter() - llm_t0) * 1000)
    total_latency_ms = int((time.perf_counter() - total_t0) * 1000)

    out_sources = [
        SourceItem(
            video_name=s.get("video_name"),
            video_path=video_paths.get(s.get("video_name") or "", ""),
            user_question=s.get("user_question"),
            system_response=s.get("system_response"),
            summary=s.get("summary"),
            score=s.get("score"),
            brand_model=s.get("brand_model"),
            system_version=s.get("system_version"),
            function_domain=s.get("function_domain"),
        )
        for s in sources
    ]

    return QueryResponse(
        answer=answer,
        sources=out_sources,
        model_key=model_key,
        model_name=model_name,
        llm_latency_ms=llm_latency_ms,
        total_latency_ms=total_latency_ms,
        retrieved_count=len(sources),
        selection_mode=selection_mode,
        min_score_used=min_score_used,
        top_score=top_score,
        low_relevance=low_relevance,
    )


# ───── Sessions CRUD ─────
@router.get("/sessions", response_model=List[SessionListItem])
async def list_sessions(limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    rows = supabase.raw_sql(
        """
        SELECT id, title, model_key, model_name, user_question,
               llm_latency_ms, total_latency_ms, top_k,
               selection_mode, min_score, top_score, low_relevance,
               created_at
        FROM dr_bee_sessions
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s
        """,
        [limit, offset],
    ).data
    out: List[SessionListItem] = []
    for r in rows:
        raw_min = r.get("min_score")
        raw_top = r.get("top_score")
        out.append(SessionListItem(
            id=r["id"],
            title=r.get("title"),
            model_key=r.get("model_key"),
            model_name=r.get("model_name", ""),
            user_question=r.get("user_question", ""),
            llm_latency_ms=r.get("llm_latency_ms"),
            total_latency_ms=r.get("total_latency_ms"),
            top_k=r.get("top_k"),
            created_at=str(r.get("created_at")),
            selection_mode=r.get("selection_mode") or "manual",
            min_score=float(raw_min) if raw_min is not None else None,
            top_score=float(raw_top) if raw_top is not None else None,
            low_relevance=bool(r.get("low_relevance")) if r.get("low_relevance") is not None else False,
        ))
    return out


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def get_session(session_id: int):
    rows = supabase.raw_sql(
        "SELECT * FROM dr_bee_sessions WHERE id = %s",
        [session_id],
    ).data
    if not rows:
        raise HTTPException(status_code=404, detail="session not found")
    return _row_to_session_detail(rows[0])


@router.post("/sessions", response_model=SessionDetail)
async def save_session(req: SaveSessionRequest):
    from psycopg2.extras import Json

    rows = supabase.raw_sql(
        """
        INSERT INTO dr_bee_sessions
            (title, prompt_template, model_key, model_name, user_question, answer,
             llm_latency_ms, total_latency_ms, top_k, retrieved_sources,
             selection_mode, min_score, top_score, low_relevance)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        [
            req.title,
            req.prompt_template,
            req.model_key,
            req.model_name,
            req.user_question,
            req.answer,
            req.llm_latency_ms,
            req.total_latency_ms,
            req.top_k,
            Json(req.retrieved_sources),
            req.selection_mode,
            req.min_score,
            req.top_score,
            req.low_relevance,
        ],
    ).data
    if not rows:
        raise HTTPException(status_code=500, detail="failed to save session")
    return _row_to_session_detail(rows[0])


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: int):
    supabase.raw_sql(
        "DELETE FROM dr_bee_sessions WHERE id = %s",
        [session_id],
    )
    return {"status": "ok", "id": session_id}


@router.post("/sessions/{session_id}/replay", response_model=ReplayResponse)
async def replay_session(session_id: int):
    """用保存的 prompt + model_key + question + top_k 再跑一次，方便对比效果。"""
    rows = supabase.raw_sql("SELECT * FROM dr_bee_sessions WHERE id = %s", [session_id]).data
    if not rows:
        raise HTTPException(status_code=404, detail="session not found")
    original = _row_to_session_detail(rows[0])

    replay = await drbee_query(
        QueryRequest(
            question=original.user_question,
            prompt_template=original.prompt_template,
            model_key=original.model_key,
            top_k=original.top_k or 20,
            selection_mode=original.selection_mode or "manual",
            min_score=original.min_score,
        )
    )
    return ReplayResponse(original=original, replay=replay)
