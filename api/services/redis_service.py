"""
Redis client for task progress caching.
Falls back to in-memory dict if Redis is unavailable.
"""
import json
from typing import Optional, Dict
from api.core.config import settings
from api.core.logger import logger

_fallback_cache: Dict[str, dict] = {}
_redis_client = None


def _get_redis():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        import redis
        _redis_client = redis.Redis.from_url(
            settings.REDIS_URL, decode_responses=True, socket_connect_timeout=2
        )
        _redis_client.ping()
        logger.info(f"Redis connected: {settings.REDIS_URL}")
        return _redis_client
    except Exception as e:
        logger.warning(f"Redis unavailable ({e}), using in-memory fallback")
        _redis_client = False
        return None


def set_progress(video_result_id: str, data: dict):
    r = _get_redis()
    if r:
        r.hset(f"progress:{video_result_id}", mapping={
            k: json.dumps(v) if isinstance(v, (dict, list)) else str(v)
            for k, v in data.items()
        })
        r.expire(f"progress:{video_result_id}", 3600)
    else:
        _fallback_cache[video_result_id] = data


def get_progress(video_result_id: str) -> Optional[dict]:
    r = _get_redis()
    if r:
        raw = r.hgetall(f"progress:{video_result_id}")
        if not raw:
            return None
        result = {}
        for k, v in raw.items():
            try:
                result[k] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                result[k] = v
        return result
    else:
        return _fallback_cache.get(video_result_id)


def get_all_progress_for_task(video_result_ids: list) -> Dict[str, dict]:
    """Batch read progress for multiple videos."""
    result = {}
    r = _get_redis()
    if r:
        pipe = r.pipeline()
        for vid in video_result_ids:
            pipe.hgetall(f"progress:{vid}")
        responses = pipe.execute()
        for vid, raw in zip(video_result_ids, responses):
            if raw:
                parsed = {}
                for k, v in raw.items():
                    try:
                        parsed[k] = json.loads(v)
                    except (json.JSONDecodeError, TypeError):
                        parsed[k] = v
                result[vid] = parsed
    else:
        for vid in video_result_ids:
            if vid in _fallback_cache:
                result[vid] = _fallback_cache[vid]
    return result


def delete_progress(video_result_id: str):
    r = _get_redis()
    if r:
        r.delete(f"progress:{video_result_id}")
    else:
        _fallback_cache.pop(video_result_id, None)
