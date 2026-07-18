# Run Services Guide

> The project was rebuilt in July 2026: the old `server/` (multi-pipeline
> Python) and `client/` folders were replaced by [backend/](backend/)
> (FastAPI + GStreamer) and [frontend/](frontend/) (React + native WebRTC).
> Full setup instructions live in [backend/README.md](backend/README.md) and
> [frontend/README.md](frontend/README.md).

## Ports

| Service | Port | Purpose |
|---|---:|---|
| Backend (FastAPI) | 8000 | WebRTC signaling + controller WebSocket + API |
| Frontend (Vite) | 5173 | Phone web app |

## Normal run

```powershell
# Terminal 1 — backend
cd "C:\Users\cheon\Product development\Cloud-pc-Game-for-mobile\backend"
.\.venv\Scripts\Activate.ps1
python run.py
```

Expected:

```text
=======================================================
  Cloud Game Backend (FastAPI + GStreamer)
=======================================================
  API:        http://<PC_IP>:8000
  Input WS:   ws://<PC_IP>:8000/ws/input
  Video:      854x480 @ 60fps
=======================================================
(QR code)
INFO  input.gamepad Virtual Xbox 360 controller initialized
INFO  Application startup complete.
```

```powershell
# Terminal 2 — frontend
cd "C:\Users\cheon\Product development\Cloud-pc-Game-for-mobile\frontend"
npm run dev
```

Open `http://<PC_IP>:5173` on the phone (same WiFi), or scan the QR code.

When the phone connects, the backend logs:

```text
INFO streaming.peer [xxxxxxxx] Building pipeline
INFO streaming.peer [xxxxxxxx] Pipeline PLAYING, applying remote offer
INFO streaming.peer [xxxxxxxx] Negotiation complete
INFO streaming.peer [xxxxxxxx] ICE state: connected
```

## Remote access through `cloudkh.space`

The remote controller grants keyboard, mouse, and gamepad control of this
computer. Protect the subdomain with Cloudflare Access before exposing it.

1. Create a Cloudflare Zero Trust Access application for
   `cloudkh.space` and allow only your account.
2. Copy `frontend/.env.remote.example` to `frontend/.env`.
3. Change `HOST=127.0.0.1` and set
   `PUBLIC_FRONTEND_URL=https://cloudkh.space` in `backend/.env`.
4. In Cloudflare Pages, remove `cloudkh.space` from the landing site's custom
   domains; a Pages custom domain and a Tunnel hostname cannot share the apex.
5. Install the new `cloudkh-pc-host` tunnel as a separate systemd service. Do
   not replace the existing `cloudflared.service`, which already serves other
   applications. Follow the commands below, using the token shown only in your
   Cloudflare dashboard.
6. Once its status is `active (running)`, open `cloudkh-pc-host` in Cloudflare
   and add a Published application: domain `cloudkh.space`, service type
   `HTTP`, service URL `http://127.0.0.1:5173`. This replaces the prior
   apex-domain landing site.
7. Start the backend and frontend using the commands above, then visit
   `https://cloudkh.space` and complete the Access login.

Vite proxies `/api` and `/ws` to the local backend, so the browser uses HTTPS
and WSS under the domain. Do not create a public hostname for port 8000.

### Install the dedicated CloudKH tunnel

Copy the exact token from Cloudflare directly into the local file below; never
place it in this repository or share it in chat.

```bash
sudo install -d -m 700 /etc/cloudflared
sudo nano /etc/cloudflared/cloudkh-pc-host.env
# Add exactly: TUNNEL_TOKEN=<token from Cloudflare>
sudo chmod 600 /etc/cloudflared/cloudkh-pc-host.env
sudo cp deploy/cloudflared-cloudkh.service.example /etc/systemd/system/cloudflared-cloudkh.service
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-cloudkh
sudo systemctl status cloudflared-cloudkh --no-pager
```

This creates `cloudflared-cloudkh.service` alongside the existing connectors.
Do **not** run `cloudflared service install <token>`: it may replace the
generic `cloudflared.service`. The config example in
`deploy/cloudflared-cloudplay.example.yml` remains only for a manually managed
tunnel configuration.

## Changing stream quality

Edit `backend/.env` (`VIDEO_WIDTH`, `VIDEO_HEIGHT`, `TARGET_FPS`,
`VIDEO_BITRATE`), then restart the backend.

## Diagnostics

```powershell
# GStreamer plugin check (from backend/, venv active)
python -m app.services.streaming.diagnostics

# Backend liveness
curl http://127.0.0.1:8000/api/health

# Port conflicts
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

## Common problems

| Problem | Fix |
|---|---|
| No PC screen on phone | Read the on-screen error in the video area; check `/api/health` shows `"gstreamer_available": true` |
| Buttons don't work in game | Install ViGEmBus, restart Windows |
| Port 8000 already in use | Kill the old backend process (see above) |
| Phone can't open app | Same WiFi + use the Network URL Vite prints |
| Stream laggy | Lower resolution/FPS in `backend/.env` |

## Smooth streaming alternative: Sunshine + Moonlight

If you need GPU-encoded, lowest-latency streaming, Sunshine (PC host) +
Moonlight (phone client) remains a solid alternative — it replaces this
project's browser stream and controller overlay entirely.

- Sunshine: https://github.com/LizardByte/Sunshine/releases
- Moonlight: https://moonlight-stream.org/
