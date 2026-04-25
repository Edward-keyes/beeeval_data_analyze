"""
车辆聚合评分接口。

设计要点：
- 「车」按 (brand_model, system_version) 这一对联合主键来识别。
  同车型不同系统版本属于不同的「车」，因为版本升级后语音表现差异通常很大。
- 两种均分：
    1. criteria：按 evaluation_scores.criteria 求 AVG(score) —— 各指标均分
    2. function_domain：按 video_results.function_domain 求 AVG(metadata->>response_quality_score)
       —— 各功能域 Overall Score 均分
- 计算结果缓存进 vehicle_aggregated_scores 表（用户已建好），upsert 覆盖更新。
- 用户主动点「一键计算」才算，不在打分流水线里算。
"""

from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from api.core.logger import logger
from api.services.local_db_client import supabase

router = APIRouter(prefix="/api/aggregation", tags=["aggregation"])


# ----------------------------------------------------------------------
# Schemas
# ----------------------------------------------------------------------
class VehicleListItem(BaseModel):
    brand_model: str
    system_version: Optional[str] = None
    video_count: int                                 # 该车有多少条 video_results
    has_cache: bool                                  # 是否已经计算过缓存
    last_computed_at: Optional[str] = None           # ISO 字符串


class DimensionScore(BaseModel):
    dimension_key: str
    avg_score: float
    sample_count: int


class VehicleScoreSnapshot(BaseModel):
    brand_model: str
    system_version: Optional[str] = None
    last_computed_at: Optional[str] = None
    criteria_scores: List[DimensionScore]            # 指标均分
    function_domain_scores: List[DimensionScore]     # 功能域均分


class ComputeRequest(BaseModel):
    brand_model: str
    system_version: Optional[str] = None


# ----------------------------------------------------------------------
# 帮助函数：处理 NULL 版本号（PG 里 NULL 不能直接 = NULL，要 IS NULL）
# ----------------------------------------------------------------------
def _build_version_filter(field: str, value: Optional[str]) -> tuple[str, list]:
    """根据 system_version 是否为空生成对应的 WHERE 片段和参数。

    返回 (sql_clause, params_to_append)
    - 给定值：生成 "AND <field> = %s" + [value]
    - None / 空字符串：生成 "AND <field> IS NULL" + []（让 NULL 自洽）
    """
    if value:
        return f"AND {field} = %s", [value]
    return f"AND {field} IS NULL", []


# ----------------------------------------------------------------------
# GET /api/aggregation/vehicles
# ----------------------------------------------------------------------
@router.get("/vehicles", response_model=List[VehicleListItem])
async def list_vehicles():
    """列出所有有打分数据的车（brand_model + system_version 去重）。

    同时附上每辆车已有多少视频、是否已缓存均分、最近一次计算时间，
    供前端下拉框 + 状态徽标使用。
    """
    try:
        rows = supabase.raw_sql(
            """
            SELECT
                vr.brand_model,
                vr.system_version,
                COUNT(*) AS video_count,
                MAX(vas.last_computed_at) AS last_computed_at
            FROM video_results vr
            LEFT JOIN (
                SELECT brand_model,
                       system_version,
                       MAX(computed_at) AS last_computed_at
                FROM vehicle_aggregated_scores
                GROUP BY brand_model, system_version
            ) vas
              ON vas.brand_model = vr.brand_model
             AND vas.system_version IS NOT DISTINCT FROM vr.system_version
            WHERE vr.brand_model IS NOT NULL AND vr.brand_model <> ''
            GROUP BY vr.brand_model, vr.system_version
            ORDER BY vr.brand_model, vr.system_version
            """
        ).data
    except Exception as e:
        logger.error(f"list_vehicles failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    out: List[VehicleListItem] = []
    for r in rows:
        out.append(VehicleListItem(
            brand_model=r["brand_model"],
            system_version=r.get("system_version"),
            video_count=int(r["video_count"]),
            has_cache=r.get("last_computed_at") is not None,
            last_computed_at=(
                r["last_computed_at"].isoformat()
                if r.get("last_computed_at") else None
            ),
        ))
    return out


# ----------------------------------------------------------------------
# GET /api/aggregation/vehicle
# ----------------------------------------------------------------------
@router.get("/vehicle", response_model=VehicleScoreSnapshot)
async def get_vehicle_scores(
    brand_model: str = Query(..., description="品牌车型，比如 蔚来ET5"),
    system_version: Optional[str] = Query(None, description="系统版本，比如 3.2.2；不传表示 NULL"),
):
    """读取已缓存的均分结果。

    如果该车没有任何缓存记录，返回空数组，前端据此提示「请先点击计算」。
    本接口绝不现场计算，省得用户打开页面就触发慢操作。
    """
    ver_clause, ver_params = _build_version_filter("system_version", system_version)
    try:
        rows = supabase.raw_sql(
            f"""
            SELECT aggregation_type,
                   dimension_key,
                   avg_score,
                   sample_count,
                   computed_at
            FROM vehicle_aggregated_scores
            WHERE brand_model = %s
              {ver_clause}
            ORDER BY aggregation_type, avg_score DESC
            """,
            [brand_model] + ver_params,
        ).data
    except Exception as e:
        logger.error(f"get_vehicle_scores failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    criteria: List[DimensionScore] = []
    domain: List[DimensionScore] = []
    last_at = None
    for r in rows:
        item = DimensionScore(
            dimension_key=r["dimension_key"],
            avg_score=float(r["avg_score"]),
            sample_count=int(r["sample_count"]),
        )
        if r["aggregation_type"] == "criteria":
            criteria.append(item)
        elif r["aggregation_type"] == "function_domain":
            domain.append(item)
        if r.get("computed_at") and (last_at is None or r["computed_at"] > last_at):
            last_at = r["computed_at"]

    return VehicleScoreSnapshot(
        brand_model=brand_model,
        system_version=system_version,
        last_computed_at=last_at.isoformat() if last_at else None,
        criteria_scores=criteria,
        function_domain_scores=domain,
    )


# ----------------------------------------------------------------------
# POST /api/aggregation/vehicle/compute
# ----------------------------------------------------------------------
@router.post("/vehicle/compute", response_model=VehicleScoreSnapshot)
async def compute_vehicle_scores(req: ComputeRequest):
    """现场计算 + 覆盖写入缓存表，返回最新快照。

    覆盖策略（不留历史）：
      1. 删除该车在 vehicle_aggregated_scores 中的所有旧行
      2. 插入本次计算结果
    都在一个事务里靠 supabase.raw_sql 顺序执行；失败则交由调用方重试。
    数据量极小（一台车几十/几百视频），不需要分批。
    """
    brand = req.brand_model
    ver = req.system_version
    ver_clause, ver_params = _build_version_filter("vr.system_version", ver)
    ver_clause_self, ver_params_self = _build_version_filter("system_version", ver)

    # ---- 算 ① 指标均分 ----
    try:
        criteria_rows = supabase.raw_sql(
            f"""
            SELECT es.criteria AS dimension_key,
                   AVG(es.score) AS avg_score,
                   COUNT(*) AS sample_count
            FROM evaluation_scores es
            JOIN video_results vr ON vr.id = es.result_id
            WHERE vr.brand_model = %s
              {ver_clause}
              AND es.criteria IS NOT NULL AND es.criteria <> ''
              AND es.score IS NOT NULL
            GROUP BY es.criteria
            ORDER BY avg_score DESC
            """,
            [brand] + ver_params,
        ).data
    except Exception as e:
        logger.error(f"compute criteria failed: {e}")
        raise HTTPException(status_code=500, detail=f"compute criteria failed: {e}")

    # ---- 算 ② 功能域均分（从 metadata.response_quality_score 取） ----
    try:
        domain_rows = supabase.raw_sql(
            f"""
            SELECT vr.function_domain AS dimension_key,
                   AVG((vr.metadata->>'response_quality_score')::numeric) AS avg_score,
                   COUNT(*) AS sample_count
            FROM video_results vr
            WHERE vr.brand_model = %s
              {ver_clause}
              AND vr.function_domain IS NOT NULL AND vr.function_domain <> ''
              AND vr.metadata ? 'response_quality_score'
              AND (vr.metadata->>'response_quality_score') ~ '^[0-9]+(\\.[0-9]+)?$'
            GROUP BY vr.function_domain
            ORDER BY avg_score DESC
            """,
            [brand] + ver_params,
        ).data
    except Exception as e:
        logger.error(f"compute function_domain failed: {e}")
        raise HTTPException(status_code=500, detail=f"compute function_domain failed: {e}")

    # ---- 覆盖写入 ----
    try:
        # 先清旧
        supabase.raw_sql(
            f"""
            DELETE FROM vehicle_aggregated_scores
            WHERE brand_model = %s
              {ver_clause_self}
            """,
            [brand] + ver_params_self,
        )

        # 再批量插入新
        insert_rows: List[tuple] = []
        for r in criteria_rows:
            insert_rows.append((
                brand, ver, "criteria",
                r["dimension_key"],
                round(float(r["avg_score"]), 2),
                int(r["sample_count"]),
            ))
        for r in domain_rows:
            insert_rows.append((
                brand, ver, "function_domain",
                r["dimension_key"],
                round(float(r["avg_score"]), 2),
                int(r["sample_count"]),
            ))

        for row in insert_rows:
            supabase.raw_sql(
                """
                INSERT INTO vehicle_aggregated_scores
                    (brand_model, system_version, aggregation_type,
                     dimension_key, avg_score, sample_count, computed_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                """,
                list(row),
            )
    except Exception as e:
        logger.error(f"upsert vehicle_aggregated_scores failed: {e}")
        raise HTTPException(status_code=500, detail=f"persist failed: {e}")

    # 直接复用 GET 接口拼装返回值，避免重复处理
    return await get_vehicle_scores(brand_model=brand, system_version=ver)
