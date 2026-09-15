"""ICE server configuration for public WebRTC sessions.

Static TURN credentials are supported for local/testing deployments. For a
public deployment, Cloudflare Realtime can issue short-lived credentials from
a server-side TURN key and API token. The generated credentials are cached
until shortly before expiry so a dashboard poll does not create a new TURN
allocation each time.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import settings

logger = logging.getLogger("services.turn")

_cache_lock = asyncio.Lock()
_cached_ice_servers: Optional[List[Dict[str, Any]]] = None
_cached_turn_uri = ""
_cached_until = 0.0


def _filter_browser_turn_urls(urls: Any) -> List[str]:
    """Remove Cloudflare's port-53 fallback, which delays non-trickle ICE."""
    if isinstance(urls, str):
        urls = [urls]
    if not isinstance(urls, list):
        return []
    return [
        url for url in urls
        if isinstance(url, str) and ":53" not in url.split("?", 1)[0]
    ]


def _gstreamer_turn_uri(
    urls: List[str], username: str, credential: str
) -> str:
    """Convert a browser TURN URL into webrtcbin's TURN URI format."""
    if not urls or not username or not credential:
        return ""
    parsed = urllib.parse.urlsplit(urls[0])
    if parsed.scheme not in ("turn", "turns"):
        return ""
    # Browser TURN URLs normally use `turn:host:port`; urlsplit stores that
    # host/port in `path` because the scheme has no `//` separator.
    host = parsed.netloc or parsed.path
    if not host:
        return ""
    suffix = f"?{parsed.query}" if parsed.query else ""
    encoded_user = urllib.parse.quote(username, safe="")
    encoded_credential = urllib.parse.quote(credential, safe="")
    return f"{parsed.scheme}://{encoded_user}:{encoded_credential}@{host}{suffix}"


def _static_configuration() -> Tuple[List[Dict[str, Any]], str]:
    return settings.browser_ice_servers, settings.turn_uri


def _request_cloudflare_credentials() -> Tuple[List[Dict[str, Any]], str, int]:
    key_id = settings.cloudflare_turn_key_id.strip()
    api_token = settings.cloudflare_turn_api_token.strip()
    if not key_id or not api_token:
        raise RuntimeError("Cloudflare TURN credentials are not configured")

    ttl = max(300, min(int(settings.cloudflare_turn_ttl), 86400))
    url = (
        "https://rtc.live.cloudflare.com/v1/turn/keys/"
        f"{urllib.parse.quote(key_id, safe='')}/credentials/generate-ice-servers"
    )
    request = urllib.request.Request(
        url,
        data=json.dumps({"ttl": ttl}).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
            "User-Agent": "CloudKH-WebRTC/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise RuntimeError(f"Cloudflare TURN credential request failed: {exc}") from exc

    raw_servers = payload.get("iceServers")
    if not isinstance(raw_servers, list):
        raise RuntimeError("Cloudflare TURN response did not include iceServers")

    browser_servers: List[Dict[str, Any]] = []
    turn_uri = ""
    for server in raw_servers:
        if not isinstance(server, dict):
            continue
        urls = _filter_browser_turn_urls(server.get("urls"))
        username = server.get("username")
        credential = server.get("credential")
        if username and credential and urls:
            browser_servers.append({
                "urls": urls,
                "username": username,
                "credential": credential,
            })
            if not turn_uri:
                turn_uri = _gstreamer_turn_uri(urls, username, credential)
        elif urls:
            browser_servers.append({"urls": urls})

    if not browser_servers or not turn_uri:
        raise RuntimeError("Cloudflare TURN response did not include a usable relay")
    return browser_servers, turn_uri, ttl


async def get_ice_configuration() -> Tuple[List[Dict[str, Any]], str]:
    """Return browser ICE servers and the matching GStreamer TURN URI."""
    global _cached_ice_servers, _cached_turn_uri, _cached_until

    # Explicit static credentials take precedence and avoid an external API
    # call for local development or providers other than Cloudflare.
    if settings.turn_uri:
        return _static_configuration()

    if not settings.cloudflare_turn_key_id or not settings.cloudflare_turn_api_token:
        return _static_configuration()

    now = time.monotonic()
    if _cached_ice_servers is not None and now < _cached_until:
        return _cached_ice_servers, _cached_turn_uri

    async with _cache_lock:
        now = time.monotonic()
        if _cached_ice_servers is not None and now < _cached_until:
            return _cached_ice_servers, _cached_turn_uri
        try:
            ice_servers, turn_uri, ttl = await asyncio.to_thread(
                _request_cloudflare_credentials
            )
        except Exception as exc:
            logger.warning("Falling back to STUN-only ICE: %s", exc)
            return _static_configuration()
        _cached_ice_servers = ice_servers
        _cached_turn_uri = turn_uri
        _cached_until = time.monotonic() + max(60, ttl - 60)
        return ice_servers, turn_uri
