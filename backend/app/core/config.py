"""Centralized application settings loaded from backend/.env."""
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
except ImportError:
    class BaseSettings:  # type: ignore
        def __init__(self, **kwargs):
            for cls in reversed(self.__class__.__mro__):
                for k, v in cls.__dict__.items():
                    if not k.startswith("_") and not callable(v):
                        setattr(self, k, v)
            for k, v in kwargs.items():
                setattr(self, k, v)

    def SettingsConfigDict(**kwargs):  # type: ignore
        return kwargs

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Network
    host: str = "0.0.0.0"
    port: int = 8000
    # Optional URL shown in the startup banner and QR code. Set this to the
    # Access-protected frontend domain when using a reverse tunnel.
    public_frontend_url: str = ""

    # Database & Cache
    database_url: str = "postgresql://cloudkh:cloudkh_pass@127.0.0.1:5432/cloudkh"
    # Optional Redis URL (e.g. Upstash rediss://default:...@singapore-...upstash.io:6379 or Render Redis)
    redis_url: str = ""

    # Security & Authentication
    jwt_secret: str = "cloudkh-super-secure-jwt-secret-key-2026"
    mfa_encryption_key: str = "cloudkh-mfa-encryption-key-2026-super-secret"
    bootstrap_admin_email: str = "choonvai@cloudkh.space"
    bootstrap_admin_password: str = "cloudkh2026"

    # Video stream
    target_fps: int = 60
    video_width: int = 854
    video_height: int = 480
    video_bitrate: int = 4_000_000
    monitor_index: int = 0
    capture_use_damage: bool = True

    # WebRTC
    stun_server: str = "stun://stun.l.google.com:19302"
    # Optional public TURN relay. Use a provider-issued hostname and
    # short-lived credentials for internet/mobile streaming.
    turn_server: str = ""
    turn_username: str = ""
    turn_credential: str = ""
    # Optional Cloudflare Realtime TURN credential generator. Keep this API
    # token server-side; only the generated short-lived ICE credentials leave
    # the backend.
    cloudflare_turn_key_id: str = ""
    cloudflare_turn_api_token: str = ""
    cloudflare_turn_ttl: int = 3600

    # Input
    input_mode: str = "auto"  # auto | keyboard
    mouse_sensitivity: int = 20

    # GStreamer (Windows install location, used for DLL loading)
    gstreamer_bin: str = r"C:\Program Files\gstreamer\1.0\msvc_x86_64\bin"

    @property
    def video_bitrate_kbps(self) -> int:
        return self.video_bitrate // 1000

    @property
    def turn_uri(self) -> str:
        """Return the GStreamer TURN URI, or an empty string when disabled."""
        server = self.turn_server.strip()
        username = self.turn_username.strip()
        credential = self.turn_credential.strip()
        if not server or not username or not credential:
            return ""

        if server.startswith("turn://") or server.startswith("turns://"):
            scheme, host = server.split("://", 1)
        elif server.startswith("turn:") or server.startswith("turns:"):
            scheme, host = server.split(":", 1)
        else:
            scheme, host = "turn", server

        return (
            f"{scheme}://{quote(username, safe='')}:{quote(credential, safe='')}"
            f"@{host.lstrip('/')}"
        )

    @property
    def browser_ice_servers(self) -> list[dict]:
        """Return browser-compatible ICE server objects for system metadata."""
        servers = []
        stun = self.stun_server.strip()
        if stun:
            servers.append({"urls": stun.replace("stun://", "stun:", 1)})

        server = self.turn_server.strip()
        username = self.turn_username.strip()
        credential = self.turn_credential.strip()
        if server and username and credential:
            if server.startswith("turn://") or server.startswith("turns://"):
                scheme, host = server.split("://", 1)
            elif server.startswith("turn:") or server.startswith("turns:"):
                scheme, host = server.split(":", 1)
            else:
                scheme, host = "turn", server
            servers.append({
                "urls": f"{scheme}:{host}",
                "username": username,
                "credential": credential,
            })
        return servers


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
