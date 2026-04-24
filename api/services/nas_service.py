"""
NAS File API 客户端
封装 NAS HTTP API（browse/download/stream/search/info），
NAS_URL 和 NAS_TOKEN 从 config 读取。
"""

import os
import re
import asyncio
import httpx
from typing import Optional
from urllib.parse import quote

from api.core.config import settings
from api.core.logger import logger


class NASService:
    def __init__(self):
        self.base_url = settings.NAS_URL.rstrip("/")
        self.token = settings.NAS_TOKEN
        self.video_root = settings.NAS_VIDEO_ROOT
        # browse/info/search 可能经内网穿透、大目录列表较慢；read 过短易出现「对端未发完就断连」
        self._timeout = httpx.Timeout(connect=15.0, read=120.0, write=15.0, pool=15.0)

    @property
    def available(self) -> bool:
        return bool(self.base_url and self.token)

    def _params(self, extra: Optional[dict] = None) -> dict:
        p = {"token": self.token}
        if extra:
            p.update({k: v for k, v in extra.items() if v is not None})
        return p

    async def browse(
        self,
        path: Optional[str] = None,
        type_filter: Optional[str] = None,
        sort: str = "name",
        order: str = "asc",
        offset: int = 0,
    ) -> dict:
        extra: dict = {"sort": sort, "order": order, "offset": offset}
        if type_filter:
            extra["type"] = type_filter
        if path is not None:
            extra["path"] = path
        params = self._params(extra)
        async with httpx.AsyncClient(timeout=self._timeout, trust_env=False) as client:
            resp = await client.get(f"{self.base_url}/api/browse", params=params)
            resp.raise_for_status()
            return resp.json()

    async def search(
        self,
        path: str,
        keyword: str,
        depth: int = 5,
        limit: int = 100,
    ) -> dict:
        params = self._params({
            "path": path or self.video_root,
            "keyword": keyword,
            "depth": depth,
            "limit": limit,
        })
        async with httpx.AsyncClient(timeout=self._timeout, trust_env=False) as client:
            resp = await client.get(f"{self.base_url}/api/search", params=params)
            resp.raise_for_status()
            return resp.json()

    async def info(self, path: str) -> dict:
        params = self._params({"path": path})
        async with httpx.AsyncClient(timeout=self._timeout, trust_env=False) as client:
            resp = await client.get(f"{self.base_url}/api/info", params=params)
            resp.raise_for_status()
            return resp.json()

    def get_stream_url(self, nas_path: str) -> str:
        """直连 NAS 的流播放 URL（内部使用，不暴露给前端）"""
        return f"{self.base_url}/api/stream?path={quote(nas_path, safe='/')}&token={self.token}"

    async def download_to_temp(self, nas_path: str, max_retries: int = 3) -> str:
        """
        下载 NAS 视频到本地临时目录，返回本地路径。
        带重试、不完整文件清理和大小校验。
        """
        safe_name = re.sub(r'[^\w\-_\.]', '_', os.path.basename(nas_path))
        local_path = os.path.join(settings.TEMP_DIR, f"nas_{safe_name}")

        if os.path.exists(local_path):
            file_size = os.path.getsize(local_path)
            if file_size > 0:
                logger.debug(f"NAS temp file already exists: {local_path} ({file_size} bytes)")
                return local_path
            else:
                os.remove(local_path)

        params = self._params({"path": nas_path})
        download_timeout = httpx.Timeout(connect=15.0, read=600.0, write=10.0, pool=10.0)
        last_error = None

        for attempt in range(1, max_retries + 1):
            try:
                logger.info(f"Downloading NAS video (attempt {attempt}/{max_retries}): {nas_path}")
                async with httpx.AsyncClient(timeout=download_timeout, trust_env=False) as client:
                    async with client.stream("GET", f"{self.base_url}/api/download", params=params) as resp:
                        resp.raise_for_status()
                        expected_size = int(resp.headers.get("content-length", 0))
                        downloaded = 0
                        with open(local_path, "wb") as f:
                            async for chunk in resp.aiter_bytes(chunk_size=1048576):
                                f.write(chunk)
                                downloaded += len(chunk)

                actual_size = os.path.getsize(local_path)

                if expected_size > 0 and actual_size != expected_size:
                    raise IOError(
                        f"Size mismatch: expected {expected_size}, got {actual_size}"
                    )

                logger.info(f"NAS download complete: {local_path} ({actual_size} bytes)")
                return local_path

            except Exception as e:
                last_error = e
                logger.warning(f"NAS download attempt {attempt}/{max_retries} failed for {nas_path}: {e}")
                if os.path.exists(local_path):
                    try:
                        os.remove(local_path)
                    except OSError:
                        pass
                if attempt < max_retries:
                    wait = 2 ** attempt
                    logger.info(f"Retrying in {wait}s...")
                    await asyncio.sleep(wait)

        raise RuntimeError(
            f"NAS download failed after {max_retries} attempts for {nas_path}: {last_error}"
        )

    async def cleanup_temp(self, local_path: str):
        """清理临时下载文件"""
        if local_path and os.path.exists(local_path) and local_path.startswith(settings.TEMP_DIR):
            try:
                os.remove(local_path)
                logger.debug(f"Cleaned up NAS temp file: {local_path}")
            except OSError as e:
                logger.warning(f"Failed to cleanup temp file {local_path}: {e}")

    async def stream_video(self, nas_path: str, range_header: Optional[str] = None):
        """
        流式代理 NAS 视频。返回 (async_generator, status_code, headers)。
        支持 Range 请求（拖拽进度条）。
        """
        url = f"{self.base_url}/api/stream"
        params = self._params({"path": nas_path})
        headers = {}
        if range_header:
            headers["Range"] = range_header

        stream_timeout = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)
        client = httpx.AsyncClient(timeout=stream_timeout, trust_env=False)
        req = client.build_request("GET", url, params=params, headers=headers)
        resp = await client.send(req, stream=True)

        fwd_headers = {}
        for key in ("content-type", "content-length", "content-range", "accept-ranges"):
            if key in resp.headers:
                fwd_headers[key] = resp.headers[key]

        async def _gen():
            try:
                async for chunk in resp.aiter_bytes(chunk_size=262144):
                    yield chunk
            finally:
                await resp.aclose()
                await client.aclose()

        return _gen(), resp.status_code, fwd_headers


nas_service = NASService()
