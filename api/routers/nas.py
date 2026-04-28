"""
NAS 相关 API 路由
前端通过后端代理访问 NAS，不暴露 NAS Token。
"""

import os
import re
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.services.nas_service import nas_service
from api.services.video_cache_service import video_cache_service
from api.core.logger import logger
from api.core.video_name_parser import parse_video_name

router = APIRouter(prefix="/api/nas", tags=["nas"])


# ──────────────────────────────────────────────────────────────────────
# Range-aware 本地文件流（命中缓存时使用）
# ──────────────────────────────────────────────────────────────────────
_RANGE_RE = re.compile(r"bytes=(\d+)?-(\d+)?")


def _parse_range(range_header: str, file_size: int) -> tuple[int, int]:
    """
    解析 HTTP Range 头。返回 (start, end) 闭区间。
    Range 不合法时直接返回全文件范围（HTTP 200，让浏览器降级）。
    """
    if not range_header:
        return 0, file_size - 1
    m = _RANGE_RE.match(range_header.strip().lower())
    if not m:
        return 0, file_size - 1
    start_s, end_s = m.group(1), m.group(2)
    if start_s is None and end_s is None:
        return 0, file_size - 1
    if start_s is None:
        # bytes=-N 表示最后 N 字节
        suffix = int(end_s)
        start = max(0, file_size - suffix)
        return start, file_size - 1
    start = int(start_s)
    end = int(end_s) if end_s else file_size - 1
    end = min(end, file_size - 1)
    if start > end:
        return 0, file_size - 1
    return start, end


def _ranged_file_response(file_path: str, range_header: Optional[str]) -> StreamingResponse:
    """
    服务端本地视频文件的 Range-aware 响应。
    比 FastAPI 内置 FileResponse 多了：
      1) 完整解析 Range，返回 206 + Content-Range
      2) Cache-Control: public, max-age=86400, immutable（缓存键 = sha1(NAS path)，内容稳定）
    """
    file_size = os.path.getsize(file_path)
    start, end = _parse_range(range_header or "", file_size)
    chunk_size = 1 * 1024 * 1024  # 1MB

    def _iter():
        with open(file_path, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                buf = f.read(min(chunk_size, remaining))
                if not buf:
                    break
                remaining -= len(buf)
                yield buf

    headers = {
        "content-type": "video/mp4",
        "content-length": str(end - start + 1),
        "accept-ranges": "bytes",
    }
    if range_header:
        headers["content-range"] = f"bytes {start}-{end}/{file_size}"
        headers["cache-control"] = "no-store"
        status = 206
    else:
        headers["cache-control"] = "public, max-age=86400, immutable"
        status = 200

    return StreamingResponse(_iter(), status_code=status, headers=headers)


@router.get("/status")
async def nas_status():
    """检查 NAS 服务是否可用"""
    if not nas_service.available:
        return {"available": False, "message": "NAS not configured (NAS_URL or NAS_TOKEN missing)"}
    try:
        data = await nas_service.browse(path=None)
        return {
            "available": True,
            "root": nas_service.video_root,
            "roots": [item["path"] for item in data.get("items", [])],
        }
    except Exception as e:
        logger.error(f"NAS status check failed: {e}")
        return {"available": False, "message": str(e)}


@router.get("/browse")
async def browse_nas(
    path: Optional[str] = None,
    type: Optional[str] = None,
    sort: str = "name",
    order: str = "asc",
    offset: int = 0,
):
    """浏览 NAS 目录（代理 NAS browse API）"""
    if not nas_service.available:
        raise HTTPException(status_code=503, detail="NAS service not configured")
    try:
        data = await nas_service.browse(
            path=path if path is not None else nas_service.video_root,
            type_filter=type,
            sort=sort,
            order=order,
            offset=offset,
        )
        return data
    except Exception as e:
        logger.error(f"NAS browse error: {e}")
        raise HTTPException(status_code=502, detail=f"NAS request failed: {e}")


@router.get("/search")
async def search_nas(
    keyword: str,
    path: Optional[str] = None,
    depth: int = 5,
    limit: int = 100,
):
    """搜索 NAS 文件"""
    if not nas_service.available:
        raise HTTPException(status_code=503, detail="NAS service not configured")
    try:
        data = await nas_service.search(
            path=path or nas_service.video_root,
            keyword=keyword,
            depth=depth,
            limit=limit,
        )
        return data
    except Exception as e:
        logger.error(f"NAS search error: {e}")
        raise HTTPException(status_code=502, detail=f"NAS request failed: {e}")


@router.get("/info")
async def get_nas_info(path: str):
    """获取 NAS 文件/目录信息"""
    if not nas_service.available:
        raise HTTPException(status_code=503, detail="NAS service not configured")
    try:
        data = await nas_service.info(path)
        return data
    except Exception as e:
        logger.error(f"NAS info error: {e}")
        raise HTTPException(status_code=502, detail=f"NAS request failed: {e}")


@router.get("/stream")
async def stream_nas_video(path: str, request: Request):
    """
    代理 NAS 视频流到前端。

    优化路径：
      1) 命中本地 video_cache → 直接 FileResponse（带 Range），毫秒级首字节
         + 这些文件已经被 ffmpeg 重写过 moov atom（faststart），浏览器秒开
      2) 未命中 → 沿用 NAS 代理（行为和优化前一致），同时异步触发 warm，
         让下次访问的人享受到加速
    """
    if not nas_service.available:
        raise HTTPException(status_code=503, detail="NAS service not configured")

    range_header = request.headers.get("range")

    # 1. 缓存命中
    if video_cache_service.is_cached(path):
        try:
            video_cache_service.touch(path)  # 更新 LRU atime
            return _ranged_file_response(video_cache_service.cache_path(path), range_header)
        except Exception as e:
            # 本地文件出问题就回退到 NAS 代理，下面的逻辑还能兜底
            logger.warning(f"video cache hit but read failed for {path}: {e}")

    # 2. 缓存未命中：照常代理 NAS，同时后台拉取 → faststart → 入缓存
    try:
        await video_cache_service.schedule_warm(path)
    except Exception as e:
        logger.debug(f"schedule_warm failed for {path}: {e}")

    try:
        gen, status_code, headers = await nas_service.stream_video(path, range_header)
        return StreamingResponse(
            gen,
            status_code=status_code,
            headers=headers,
        )
    except Exception as e:
        logger.error(f"NAS stream error for {path}: {e}")
        raise HTTPException(status_code=502, detail=f"NAS stream failed: {e}")


@router.get("/cache/stats")
async def video_cache_stats():
    """查看视频缓存使用情况（运维 / 调试）。"""
    return video_cache_service.stats()


class NasScanRequest(BaseModel):
    nas_path: str


class NasScanResult(BaseModel):
    total_files: int
    video_files: int
    parsed_videos: List[dict]


@router.post("/scan")
async def scan_nas_directory(req: NasScanRequest):
    """
    扫描 NAS 目录，返回所有视频的解析信息。
    可用于预览目录中视频的用例 ID、品牌车型等信息。
    """
    if not nas_service.available:
        raise HTTPException(status_code=503, detail="NAS service not configured")
    try:
        data = await nas_service.browse(
            path=req.nas_path,
            type_filter="video",
            sort="name",
            order="asc",
        )
        items = data.get("items", [])
        total = data.get("total", len(items))

        if total > 500:
            all_items = list(items)
            offset = 500
            while offset < total:
                more = await nas_service.browse(
                    path=req.nas_path,
                    type_filter="video",
                    sort="name",
                    order="asc",
                    offset=offset,
                )
                all_items.extend(more.get("items", []))
                offset += 500
            items = all_items

        parsed = []
        for item in items:
            if not item.get("is_video"):
                continue
            name = item["name"]
            info = parse_video_name(name)
            parsed.append({
                "video_name": name,
                "nas_path": item["path"],
                "size": item.get("size"),
                "modified": item.get("modified"),
                **info,
            })

        return {
            "nas_path": req.nas_path,
            "total_files": total,
            "video_files": len(parsed),
            "parsed_videos": parsed,
        }
    except Exception as e:
        logger.error(f"NAS scan error: {e}")
        raise HTTPException(status_code=502, detail=f"NAS scan failed: {e}")
