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

    # Auto-sanitize if user copied CLI prefix or quotes
    redis_url = redis_url.strip("\"' ")
    if "rediss://" in redis_url:
        redis_url = redis_url[redis_url.index("rediss://"):]
    elif "redis://" in redis_url:
        redis_url = redis_url[redis_url.index("redis://"):]

    # Upstash with TLS enabled requires rediss:// (double 's') for SSL in Python
    if redis_url.startswith("redis://") and "upstash.io" in redis_url:
        redis_url = "rediss://" + redis_url[len("redis://"):]

    try:
        import redis.asyncio as aioredis
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


async def is_redis_online() -> bool:
    """Check if Redis server is reachable."""
    client = await get_redis_client()
    if not client:
        return False
    try:
        await client.ping()
        return True
    except Exception:
        return False


async def acquire_lock(lock_key: str, ttl_seconds: int = 10) -> bool:
    """
    Distributed mutual exclusion lock.
    Returns True if lock acquired, False if already held.
    """
    client = await get_redis_client()
    if client:
        try:
            # SET NX EX
            res = await client.set(lock_key, "locked", nx=True, ex=ttl_seconds)
            return bool(res)
        except Exception as e:
            logger.debug(f"[CACHE] Lock acquire error: {e}")

    # In-memory lock fallback
    now = time.time()
    item = _in_memory_cache.get(lock_key)
    if item and item[1] > now:
        return False
    _in_memory_cache[lock_key] = ("locked", now + ttl_seconds)
    return True


async def release_lock(lock_key: str) -> bool:
    """Release distributed lock."""
    return await cache_delete(lock_key)


async def increment_dmaic_counter(metric: str, amount: int = 1) -> int:
    """Increment real-time DMAIC Six Sigma telemetry metric."""
    client = await get_redis_client()
    key = f"dmaic:{metric}"
    if client:
        try:
            return await client.incrby(key, amount)
        except Exception:
            pass

    # In-memory fallback
    item = _in_memory_cache.get(key)
    current = int(item[0]) if item else 0
    new_val = current + amount
    _in_memory_cache[key] = (str(new_val), None)
    return new_val


async def record_dmaic_unique_user(user_id: Any) -> int:
    """Record unique player in Redis HyperLogLog for Six Sigma population statistics."""
    client = await get_redis_client()
    key = "dmaic:unique_players_hll"
    if client:
        try:
            await client.pfadd(key, str(user_id))
            return await client.pfcount(key)
        except Exception:
            pass

    # In-memory fallback
    set_key = "dmaic:unique_players_set"
    current_set = _in_memory_cache.setdefault(set_key, (set(), None))[0]
    current_set.add(str(user_id))
    return len(current_set)


async def get_dmaic_redis_metrics() -> dict:
    """Retrieve summarized DMAIC real-time telemetry metrics."""
    client = await get_redis_client()
    total_sessions = 0
    today_sessions = 0
    unique_users = 0
    today_str = time.strftime("%Y-%m-%d")

    if client:
        try:
            total_val = await client.get("dmaic:sessions:total")
            total_sessions = int(total_val) if total_val else 0

            today_val = await client.get(f"dmaic:sessions:{today_str}")
            today_sessions = int(today_val) if today_val else 0

            unique_users = await client.pfcount("dmaic:unique_players_hll")
        except Exception as e:
            logger.debug(f"[CACHE] Error fetching DMAIC metrics: {e}")
    else:
        tot = _in_memory_cache.get("dmaic:sessions:total")
        total_sessions = int(tot[0]) if tot else 0
        tod = _in_memory_cache.get(f"dmaic:sessions:{today_str}")
        today_sessions = int(tod[0]) if tod else 0
        s = _in_memory_cache.get("dmaic:unique_players_set")
        unique_users = len(s[0]) if s else 0

    return {
        "redis_connected": await is_redis_online(),
        "total_sessions_launched": total_sessions,
        "today_sessions": today_sessions,
        "unique_beta_players": unique_users,
    }
