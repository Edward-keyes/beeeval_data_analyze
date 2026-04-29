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
        # 连接池上限：一个浏览器播放 mp4 时会有多个并发 Range 请求；
        # 多人同时观看时也要够，但又不能让进程把 NAS 打爆，64 是个折中。
        self._limits = httpx.Limits(
            max_connections=64,
            max_keepalive_connections=32,
            keepalive_expiry=60.0,
        )
        # 单实例长连接客户端：所有 stream/browse/search 共用，避免每次新建
        # client 触发 TCP+TLS 握手（在 frp 内网穿透链路下握手 RTT 占大头）。
        self._client: Optional[httpx.AsyncClient] = None

    @property
    def available(self) -> bool:
        return bool(self.base_url and self.token)

    def _get_client(self) -> httpx.AsyncClient:
        """惰性创建并复用 AsyncClient。
        在 fork 之后（uvicorn workers / Celery prefork）老 client 句柄不能跨进程用，
        所以这里只在调用时创建，第一个进入的请求建立连接池。
        """
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self._timeout,
                limits=self._limits,
                trust_env=False,
                http2=False,  # NAS 通常只 HTTP/1.1，开 h2 反而要 TLS ALPN 协商失败回退
            )
        return self._client

    async def aclose(self) -> None:
        """进程退出时调用，让连接池优雅关闭。"""
        if self._client is not None and not self._client.is_closed:
            try:
                await self._client.aclose()
            except Exception as e:
                logger.warning(f"NASService client close error: {e}")
            finally:
                self._client = None

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
        client = self._get_client()
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
        client = self._get_client()
        resp = await client.get(f"{self.base_url}/api/search", params=params)
        resp.raise_for_status()
        return resp.json()

    async def info(self, path: str) -> dict:
        params = self._params({"path": path})
        client = self._get_client()
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
                # 大文件下载用独立 client：避免长时间占用 stream 池；
                # 也方便 worker 并发跑分析时各自有自己的连接，不互相 head-of-line 阻塞。
                async with httpx.AsyncClient(
                    timeout=download_timeout,
                    trust_env=False,
                    limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
                ) as client:
                    async with client.stream("GET", f"{self.base_url}/api/download", params=params) as resp:
                        resp.raise_for_status()
                        expected_size = int(resp.headers.get("content-length", 0))
                        downloaded = 0
                        with open(local_path, "wb") as f:
                            async for chunk in resp.aiter_bytes(chunk_size=4 * 1048576):
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

    async def download_to_path(self, nas_path: str, local_path: str, max_retries: int = 2) -> None:
        """
        把 NAS 视频下载到指定路径（视频缓存层用）。
        和 download_to_temp 的区别：调用方完全控制目标位置，不写到 settings.TEMP_DIR；
        不做去重；带较短的重试（缓存填充失败可以容忍）。
        """
        params = self._params({"path": nas_path})
        download_timeout = httpx.Timeout(connect=15.0, read=600.0, write=10.0, pool=10.0)

        last_error = None
        for attempt in range(1, max_retries + 1):
            try:
                async with httpx.AsyncClient(
                    timeout=download_timeout,
                    trust_env=False,
                    limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
                ) as client:
                    async with client.stream("GET", f"{self.base_url}/api/download", params=params) as resp:
                        resp.raise_for_status()
                        expected = int(resp.headers.get("content-length", 0))
                        with open(local_path, "wb") as f:
                            async for chunk in resp.aiter_bytes(chunk_size=4 * 1048576):
                                f.write(chunk)
                actual = os.path.getsize(local_path)
                if expected > 0 and actual != expected:
                    raise IOError(f"size mismatch: expected {expected}, got {actual}")
                return
            except Exception as e:
                last_error = e
                logger.warning(
                    f"download_to_path attempt {attempt}/{max_retries} failed for {nas_path}: {e}"
                )
                if os.path.exists(local_path):
                    try:
                        os.remove(local_path)
                    except OSError:
                        pass
                if attempt < max_retries:
                    await asyncio.sleep(2 ** attempt)

        raise RuntimeError(f"download_to_path failed after {max_retries} attempts: {last_error}")

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

        关键点：
        1) 复用实例级 AsyncClient → 多个 Range 请求走 keep-alive，省 TCP+TLS 握手
        2) chunk_size **必须小**（64KB）。视频流是「时延优先」不是「吞吐优先」：
           小 chunk 让 NAS 一拿到首块就能立刻往浏览器推，video player 解析完
           moov 立即开播。大 chunk（之前用过 1MB）会把首字节硬等到攒满才发，
           是负优化。
        3) Accept-Encoding: identity 阻止 NAS / 中间代理给视频上 gzip
           （视频本来已经是压缩格式，gzip 不省字节但要 CPU 解压一遍）
        """
        url = f"{self.base_url}/api/stream"
        params = self._params({"path": nas_path})
        headers = {"Accept-Encoding": "identity"}
        if range_header:
            headers["Range"] = range_header

        client = self._get_client()
        req = client.build_request("GET", url, params=params, headers=headers)
        resp = await client.send(req, stream=True)

        fwd_headers: dict = {}
        for key in ("content-type", "content-length", "content-range", "accept-ranges"):
            if key in resp.headers:
                fwd_headers[key] = resp.headers[key]
        fwd_headers.setdefault("accept-ranges", "bytes")
        if resp.status_code == 206:
            fwd_headers["cache-control"] = "no-store"
        else:
            # 完整响应可以让浏览器缓存一天，下次同一个 video src 不再回源
            fwd_headers["cache-control"] = "public, max-age=86400"

        async def _gen():
            try:
                # 64KB：让 video player 尽快拿到首块开始解析 moov。
                # syscall 多一些不要紧，瓶颈是 NAS→服务器的链路，不是 CPU。
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    yield chunk
            finally:
                await resp.aclose()

        return _gen(), resp.status_code, fwd_headers


nas_service = NASService()
