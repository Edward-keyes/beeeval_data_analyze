"""
NAS 相关 API 路由
前端通过后端代理访问 NAS，不暴露 NAS Token。
"""

from typing import Optional, List
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.services.nas_service import nas_service
from api.core.logger import logger
from api.core.video_name_parser import parse_video_name

router = APIRouter(prefix="/api/nas", tags=["nas"])


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
    转发 Range 请求头以支持拖拽进度条，前端无需知道 NAS Token。
    """
    if not nas_service.available:
        raise HTTPException(status_code=503, detail="NAS service not configured")
    try:
        range_header = request.headers.get("range")
        gen, status_code, headers = await nas_service.stream_video(path, range_header)
        return StreamingResponse(
            gen,
            status_code=status_code,
            headers=headers,
        )
    except Exception as e:
        logger.error(f"NAS stream error for {path}: {e}")
        raise HTTPException(status_code=502, detail=f"NAS stream failed: {e}")


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
