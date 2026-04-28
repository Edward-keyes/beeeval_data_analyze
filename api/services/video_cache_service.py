"""
NAS 视频本地缓存（disk LRU + ffmpeg faststart）
======================================================

为什么需要：
    - NAS 视频每次都要走「浏览器 → nginx → api → frp → NAS HTTP API → SMB」一长串
    - 多人多次播放同一视频时，全部都得回源 NAS，链路很重
    - 录屏 mp4 经常 moov atom 在文件尾，浏览器必须下完才能开始播

缓存策略：
    1. 第一次访问某个 NAS 视频 → 仍然走 NAS 代理（用户体验 ≈ 改造前）
       同时启动后台任务：下载完整视频 → ffmpeg -movflags +faststart 重写 → 写入缓存
    2. 后续访问 → 命中缓存，直接 FileResponse + Range（本地磁盘 IO，毫秒级首字节）
    3. 总大小超过 VIDEO_CACHE_MAX_SIZE_GB 时按 atime LRU 淘汰

去重：
    - 同一 nas_path 已经在 warm 队列 / 正在转码时不会重复触发
    - 进程级锁，多 worker / 多 uvicorn 进程间不共享（最差情况是同时各跑一遍，浪费一次）

幂等：
    - 缓存键 = sha1(nas_path)；失败的中间产物会被清理，不会留残文件
    - 完整性校验：转码后大小必须 > 1KB（防 ffmpeg 异常退出留个 0 字节文件）
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import time
from typing import Optional

from api.core.config import settings
from api.core.logger import logger


class VideoCacheService:
    """本地视频缓存 + 异步 faststart 转码。"""

    def __init__(self):
        self.enabled: bool = settings.VIDEO_CACHE_ENABLED
        self.cache_dir: str = settings.VIDEO_CACHE_DIR
        self.max_bytes: int = int(settings.VIDEO_CACHE_MAX_SIZE_GB * 1024 * 1024 * 1024)
        # 单个文件大小上限：超过的不缓存（典型场景：超大原始素材，缓存收益不抵磁盘成本）
        self.per_file_max_bytes: int = int(settings.VIDEO_CACHE_PER_FILE_MAX_GB * 1024 * 1024 * 1024)

        # 进程内去重：正在 warm 的 nas_path 集合
        self._warming: set[str] = set()
        self._warming_lock = asyncio.Lock()

        if self.enabled:
            os.makedirs(self.cache_dir, exist_ok=True)
            logger.info(
                f"[VideoCache] enabled, dir={self.cache_dir} "
                f"max={settings.VIDEO_CACHE_MAX_SIZE_GB}GB "
                f"per_file_max={settings.VIDEO_CACHE_PER_FILE_MAX_GB}GB"
            )
        else:
            logger.info("[VideoCache] disabled (set VIDEO_CACHE_ENABLED=true to enable)")

    # ──────────────────────────────────────────────────────────────
    # 路径 / 命中查询
    # ──────────────────────────────────────────────────────────────
    def _key(self, nas_path: str) -> str:
        """sha1 短哈希作为缓存文件名前缀，避免 NAS 路径里的特殊字符破坏文件系统。"""
        return hashlib.sha1(nas_path.encode("utf-8")).hexdigest()

    def cache_path(self, nas_path: str) -> str:
        return os.path.join(self.cache_dir, f"{self._key(nas_path)}.mp4")

    def is_cached(self, nas_path: str) -> bool:
        if not self.enabled:
            return False
        p = self.cache_path(nas_path)
        try:
            return os.path.isfile(p) and os.path.getsize(p) > 1024
        except OSError:
            return False

    def touch(self, nas_path: str) -> None:
        """命中缓存时更新 atime/mtime，让 LRU 把这个文件视为「刚刚用过」。"""
        if not self.enabled:
            return
        p = self.cache_path(nas_path)
        try:
            now = time.time()
            os.utime(p, (now, now))
        except OSError:
            pass

    # ──────────────────────────────────────────────────────────────
    # 触发缓存（异步、非阻塞）
    # ──────────────────────────────────────────────────────────────
    async def schedule_warm(self, nas_path: str) -> None:
        """
        非阻塞地触发一次「下载 NAS → faststart → 入缓存」。
        已经在 warm 或已命中的视频不会重复跑。

        这里用 asyncio.create_task 直接跑，不依赖 BackgroundTasks，
        因为 BackgroundTasks 的执行时机绑定在 response 完成之后，
        而我们希望缓存是真正异步、和当前 stream 响应解耦。
        """
        if not self.enabled:
            return
        if self.is_cached(nas_path):
            return

        async with self._warming_lock:
            if nas_path in self._warming:
                return
            self._warming.add(nas_path)

        asyncio.create_task(self._warm_with_release(nas_path))

    async def _warm_with_release(self, nas_path: str) -> None:
        try:
            await self._warm(nas_path)
        except Exception as e:
            logger.warning(f"[VideoCache] warm failed for {nas_path}: {e}")
        finally:
            async with self._warming_lock:
                self._warming.discard(nas_path)

    # ──────────────────────────────────────────────────────────────
    # 真正的下载 + 转码
    # ──────────────────────────────────────────────────────────────
    async def _warm(self, nas_path: str) -> None:
        from api.services.nas_service import nas_service

        if not nas_service.available:
            logger.debug(f"[VideoCache] skip warm, NAS not configured: {nas_path}")
            return

        target = self.cache_path(nas_path)
        if os.path.exists(target):
            return

        # 1. 先下载到 .raw 临时文件
        raw_path = target + ".raw"
        try:
            logger.info(f"[VideoCache] warm start: {nas_path}")
            await nas_service.download_to_path(nas_path, raw_path)
        except Exception as e:
            self._safe_unlink(raw_path)
            raise RuntimeError(f"download failed: {e}")

        try:
            raw_size = os.path.getsize(raw_path)
        except OSError as e:
            self._safe_unlink(raw_path)
            raise RuntimeError(f"stat raw failed: {e}")

        if raw_size <= 1024:
            self._safe_unlink(raw_path)
            raise RuntimeError(f"downloaded file too small: {raw_size}")

        if raw_size > self.per_file_max_bytes:
            logger.info(
                f"[VideoCache] file too large, skip caching: {nas_path} "
                f"({raw_size / 1024 / 1024 / 1024:.2f}GB > {settings.VIDEO_CACHE_PER_FILE_MAX_GB}GB)"
            )
            self._safe_unlink(raw_path)
            return

        # 2. ffmpeg -movflags +faststart 把 moov atom 移到文件头
        #    -c copy 不重新编码（秒级完成、不损失画质）
        tmp_path = target + ".tmp"
        rc, stderr = await self._run_ffmpeg_faststart(raw_path, tmp_path)
        # raw 不再需要
        self._safe_unlink(raw_path)

        if rc != 0:
            self._safe_unlink(tmp_path)
            raise RuntimeError(f"ffmpeg rc={rc}: {stderr[-300:] if stderr else ''}")

        try:
            tmp_size = os.path.getsize(tmp_path)
        except OSError as e:
            self._safe_unlink(tmp_path)
            raise RuntimeError(f"stat tmp failed: {e}")

        if tmp_size <= 1024:
            self._safe_unlink(tmp_path)
            raise RuntimeError(f"faststart output too small: {tmp_size}")

        # 3. 原子改名落地
        try:
            os.replace(tmp_path, target)
        except OSError as e:
            self._safe_unlink(tmp_path)
            raise RuntimeError(f"rename failed: {e}")

        logger.info(
            f"[VideoCache] warm done: {nas_path} "
            f"-> {target} ({tmp_size / 1024 / 1024:.1f}MB)"
        )

        # 4. 触发 LRU 淘汰
        try:
            self._evict_if_over_limit()
        except Exception as e:
            logger.warning(f"[VideoCache] evict failed: {e}")

    @staticmethod
    async def _run_ffmpeg_faststart(src: str, dst: str) -> tuple[int, str]:
        """调用 ffmpeg 做 faststart 重写。-c copy 不转码，秒级完成。"""
        ffmpeg_bin = os.environ.get("FFMPEG_BINARY") or shutil.which("ffmpeg") or "ffmpeg"
        cmd = [
            ffmpeg_bin,
            "-y",                      # 覆盖
            "-i", src,
            "-c", "copy",              # 不重新编码
            "-movflags", "+faststart", # moov 放文件头
            "-loglevel", "error",
            dst,
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        return proc.returncode or 0, (stderr.decode("utf-8", errors="ignore") if stderr else "")

    # ──────────────────────────────────────────────────────────────
    # LRU 淘汰
    # ──────────────────────────────────────────────────────────────
    def _evict_if_over_limit(self) -> None:
        """超过 max_bytes 时按 atime 升序删除最久未用的文件。"""
        if not self.enabled:
            return
        try:
            entries: list[tuple[str, int, float]] = []
            total = 0
            for name in os.listdir(self.cache_dir):
                # 只算正式 .mp4，临时 .raw / .tmp 不计入也不淘汰（让 warm 自己处理）
                if not name.endswith(".mp4"):
                    continue
                p = os.path.join(self.cache_dir, name)
                try:
                    st = os.stat(p)
                except OSError:
                    continue
                entries.append((p, st.st_size, st.st_atime))
                total += st.st_size

            if total <= self.max_bytes:
                return

            # 最早 atime 的先删
            entries.sort(key=lambda x: x[2])
            for path, size, _ in entries:
                if total <= self.max_bytes:
                    break
                try:
                    os.remove(path)
                    total -= size
                    logger.info(
                        f"[VideoCache] evict {os.path.basename(path)} "
                        f"({size / 1024 / 1024:.1f}MB), total now {total / 1024 / 1024 / 1024:.2f}GB"
                    )
                except OSError as e:
                    logger.warning(f"[VideoCache] failed to evict {path}: {e}")
        except Exception as e:
            logger.warning(f"[VideoCache] evict scan failed: {e}")

    # ──────────────────────────────────────────────────────────────
    # 工具
    # ──────────────────────────────────────────────────────────────
    @staticmethod
    def _safe_unlink(p: str) -> None:
        try:
            if os.path.exists(p):
                os.remove(p)
        except OSError:
            pass

    def stats(self) -> dict:
        if not self.enabled:
            return {"enabled": False}
        files = 0
        total = 0
        try:
            for name in os.listdir(self.cache_dir):
                if not name.endswith(".mp4"):
                    continue
                p = os.path.join(self.cache_dir, name)
                try:
                    total += os.path.getsize(p)
                    files += 1
                except OSError:
                    continue
        except Exception:
            pass
        return {
            "enabled": True,
            "dir": self.cache_dir,
            "files": files,
            "total_mb": round(total / 1024 / 1024, 1),
            "max_gb": settings.VIDEO_CACHE_MAX_SIZE_GB,
            "warming": len(self._warming),
        }


video_cache_service = VideoCacheService()
