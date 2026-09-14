"""Lifecycle management for active WebRTC streaming peers."""
from __future__ import annotations

import logging
import threading
import uuid
from typing import Dict

from app.core.config import settings
from app.services.streaming.diagnostics import GSTREAMER_AVAILABLE, GSTREAMER_IMPORT_ERROR
from app.services.streaming.peer import GStreamerWebRTCPeer

logger = logging.getLogger("streaming.manager")


class StreamManager:
    """Creates, tracks and tears down GStreamer WebRTC peers."""

    def __init__(self) -> None:
        self._peers: Dict[str, GStreamerWebRTCPeer] = {}
        self._lock = threading.Lock()
        self._disconnect_timer: Optional[threading.Timer] = None
        self.on_empty_callback = None

    def set_empty_callback(self, cb) -> None:
        """Register callback invoked when all stream peers disconnect without reconnecting."""
        self.on_empty_callback = cb

    def _start_disconnect_timer(self, delay: float = 6.0) -> None:
        with self._lock:
            if self._disconnect_timer is not None:
                try:
                    self._disconnect_timer.cancel()
                except Exception:
                    pass

            def _on_timeout():
                with self._lock:
                    if len(self._peers) > 0:
                        return
                logger.info(
                    "[StreamManager] All streaming peers disconnected for %.1fs. Client left browser. Triggering auto-close...",
                    delay,
                )
                if self.on_empty_callback is not None:
                    try:
                        self.on_empty_callback()
                    except Exception as e:
                        logger.warning("[StreamManager] Error in on_empty_callback: %s", e)

            t = threading.Timer(delay, _on_timeout)
            t.daemon = True
            self._disconnect_timer = t
            t.start()

    def _cancel_disconnect_timer(self) -> None:
        with self._lock:
            if self._disconnect_timer is not None:
                try:
                    self._disconnect_timer.cancel()
                except Exception:
                    pass
                self._disconnect_timer = None

    @property
    def available(self) -> bool:
        return GSTREAMER_AVAILABLE

    @property
    def unavailable_reason(self) -> str:
        return GSTREAMER_IMPORT_ERROR or ""

    def peer_count(self) -> int:
        with self._lock:
            return len(self._peers)

    @staticmethod
    def _clamped(value, low, high, fallback) -> int:
        try:
            return max(low, min(high, int(value)))
        except (TypeError, ValueError):
            return fallback

    async def create_peer_answer(
        self,
        offer_sdp: str,
        width=None,
        height=None,
        fps=None,
        bitrate=None,
        window_handle=None,
    ) -> dict:
        """Create a new peer for a browser offer and return the SDP answer.

        Optional per-stream quality overrides; None keeps the .env default.
        Optional window_handle captures only the specified HWND via WGC.
        """
        if not GSTREAMER_AVAILABLE:
            raise RuntimeError(f"GStreamer not available: {self.unavailable_reason}")

        # Cancel any pending disconnect auto-close timer since a new stream connection is starting
        self._cancel_disconnect_timer()

        # The host configuration is the safe upper limit. Client quality
        # presets may request lower values but cannot exceed what this host's
        # capture and encoder are configured to provide.
        width = self._clamped(width, 320, settings.video_width, settings.video_width)
        height = self._clamped(height, 180, settings.video_height, settings.video_height)
        fps = self._clamped(fps, 15, settings.target_fps, settings.target_fps)
        bitrate = self._clamped(bitrate, 500_000, settings.video_bitrate, settings.video_bitrate)

        # This host is a single-user remote desktop. Browser refreshes do not
        # reliably trigger an immediate ICE close, so discard old capture /
        # encoder pipelines before creating the replacement stream.
        with self._lock:
            previous_peers = list(self._peers.values())
            self._peers.clear()
        for old_peer in previous_peers:
            old_peer.on_closed = None
            old_peer.close()

        pc_id = str(uuid.uuid4())[:8]
        logger.info(
            "[%s] Stream quality: %dx%d @ %dfps, %.1f Mbps (window_handle: %s)",
            pc_id, width, height, fps, bitrate / 1_000_000, window_handle,
        )
        peer = GStreamerWebRTCPeer(
            pc_id=pc_id,
            width=width,
            height=height,
            fps=fps,
            bitrate_kbps=bitrate // 1000,
            monitor_index=settings.monitor_index,
            capture_use_damage=settings.capture_use_damage,
            stun_server=settings.stun_server,
            on_closed=self._remove_peer,
            window_handle=window_handle,
        )
        with self._lock:
            self._peers[pc_id] = peer

        try:
            return await peer.handle_offer(offer_sdp)
        except Exception:
            logger.exception("[%s] Failed to handle offer", pc_id)
            peer.close()
            raise

    def _remove_peer(self, pc_id: str) -> None:
        with self._lock:
            self._peers.pop(pc_id, None)
            remaining = len(self._peers)
        if remaining == 0:
            self._start_disconnect_timer(delay=6.0)

    def close_all(self) -> None:
        self._cancel_disconnect_timer()
        with self._lock:
            peers = list(self._peers.values())
            self._peers.clear()
        for peer in peers:
            peer.on_closed = None
            peer.close()


stream_manager = StreamManager()
