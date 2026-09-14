"""
Redis client and caching service with transparent in-memory fallback.
Supports Upstash Redis (rediss://), Render Redis, and standard Redis instances.
"""
import time
import logging
from typing import Optional, Any
from app.core.config import get_settings

logger = logging.getLogger(__name__)

_redis_client = None
_redis_init_attempted = False
_in_memory_cache: dict = {}


async def get_redis_client():
    global _redis_client, _redis_init_attempted
    if _redis_init_attempted:
        return _redis_client

    _redis_init_attempted = True
    settings = get_settings()
    redis_url = settings.redis_url.strip() if settings.redis_url else ""

    if not redis_url:
        logger.info("[CACHE] No REDIS_URL configured. Operating in high-speed in-memory fallback mode.")
        return None

    try:
        import redis.asyncio as aioredis
        # Support TLS connection strings (rediss:// for Upstash)
        client = aioredis.from_url(
            redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_timeout=3.0,
            socket_connect_timeout=3.0,
        )
        await client.ping()
        _redis_client = client
        logger.info("[CACHE] Successfully connected to Redis! In-memory cache upgraded to Redis.")
        return _redis_client
    except Exception as exc:
        logger.warning(f"[CACHE] Could not connect to Redis ({exc}). Falling back to in-memory cache.")
        _redis_client = None
        return None


async def cache_get(key: str) -> Optional[str]:
    """Retrieve string value from Redis or memory cache."""
    client = await get_redis_client()
    if client:
        try:
            return await client.get(key)
        except Exception as e:
            logger.debug(f"[CACHE] Redis get error: {e}")

    # In-memory fallback
    item = _in_memory_cache.get(key)
    if item:
        val, expire_at = item
        if expire_at is None or expire_at > time.time():
            return val
        del _in_memory_cache[key]
    return None


async def cache_set(key: str, value: str, ttl_seconds: int = 60) -> bool:
    """Store string value in Redis or memory cache with TTL."""
    client = await get_redis_client()
    if client:
        try:
            await client.set(key, value, ex=ttl_seconds)
            return True
        except Exception as e:
            logger.debug(f"[CACHE] Redis set error: {e}")

    # In-memory fallback
    expire_at = time.time() + ttl_seconds if ttl_seconds > 0 else None
    _in_memory_cache[key] = (value, expire_at)
    return True


async def cache_delete(key: str) -> bool:
    """Delete key from Redis or memory cache."""
    client = await get_redis_client()
    if client:
        try:
            await client.delete(key)
        except Exception:
            pass

    _in_memory_cache.pop(key, None)
    return True


async def check_rate_limit(key: str, max_requests: int = 10, window_seconds: int = 60) -> bool:
    """
    Token-bucket rate limiter.
    Returns True if allowed, False if limit exceeded.
    """
    client = await get_redis_client()
    if client:
        try:
            current = await client.incr(key)
            if current == 1:
                await client.expire(key, window_seconds)
            return current <= max_requests
        except Exception:
            pass

    # In-memory rate limiting fallback
    now = time.time()
    item = _in_memory_cache.get(key)
    if not item or item[1] <= now:
        _in_memory_cache[key] = (1, now + window_seconds)
        return True
    count, expire_at = item
    if count >= max_requests:
        return False
    _in_memory_cache[key] = (count + 1, expire_at)
    return True
