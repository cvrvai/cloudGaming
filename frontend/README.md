# Cloud Game Frontend

React + Vite web app for the phone: renders the PC screen over **native
WebRTC** (RTCPeerConnection in `src/components/WebRTCPlayer.jsx`, no iframe)
and sends controller input over a WebSocket to the FastAPI backend.

## Connection model

Everything talks to one backend port (default 8000):

- Video: `POST http://<pc-ip>:8000/api/stream/offer` (SDP offer/answer)
- Input: `ws://<pc-ip>:8000/ws/input`

Server IP resolution order (`src/config.js`):
1. `?server=` URL query param
2. Browser hostname (works automatically when opened via the LAN URL)
3. `VITE_SERVER_IP` in `.env`

## Run (development)

```powershell
cd frontend
npm install
npm run dev
```

Open `http://<pc-ip>:5173` on the phone (same WiFi as the PC). The backend
prints a QR code for this URL on startup.

## Build (production)

```powershell
npm run build    # outputs to dist/
```

## Remote access with a domain

This setup publishes the controller at `cloudkh.space`. It replaces the
public landing site, so protect it with Cloudflare Access: this app can send
keyboard and mouse input to this computer.

1. In Cloudflare Zero Trust, create an **Access application** for
   `cloudkh.space`. Add a policy that allows only your identity (for
   example, your email address). Do this before creating the public hostname.
2. Copy `.env.remote.example` to `.env`. This binds Vite to localhost and
   makes its `/api` and `/ws` proxy reach the local backend.
3. Set `HOST=127.0.0.1` and
   `PUBLIC_FRONTEND_URL=https://cloudkh.space` in `backend/.env`, so
   port 8000 cannot be reached directly from the LAN or internet and the QR
   code opens the protected domain.
4. In Cloudflare Pages, remove `cloudkh.space` from the landing site's custom
   domains. Install the new `cloudkh-pc-host` tunnel as a separate systemd
   service with `deploy/cloudflared-cloudkh.service.example`; do not replace
   the existing connector used by other applications.
5. Once that tunnel is Connected, add a Published application: domain
   `cloudkh.space`, service type `HTTP`, service URL
   `http://127.0.0.1:5173`.
6. Start the backend and `npm run dev`. Open
   `https://cloudkh.space` after Access signs you in.

The Cloudflare Tunnel carries only the app, signaling, and controller traffic.
For remote video, WebRTC still needs a working ICE path. The frontend now
waits for the complete one-shot ICE offer and receives the ICE server list from
`/api/system/info`. STUN may be sufficient on permissive NATs; configure the
same TURN provider in the node/backend `.env` when the stream must work on
public or mobile networks:

```env
STUN_SERVER=stun://stun.l.google.com:19302
TURN_SERVER=turn:turn.example.com:3478
TURN_USERNAME=temporary-user
TURN_CREDENTIAL=temporary-password
```

TURN credentials are delivered to the browser because the browser must use the
relay. For Cloudflare Realtime, set `CLOUDFLARE_TURN_KEY_ID` to the TURN key
`uid` and `CLOUDFLARE_TURN_API_TOKEN` to the TURN key's one-time bearer token
(`key`) in the backend environment; the backend generates short-lived
credentials and forwards the matching relay URI to the node. Keep that token
server-side and do not commit `.env` files.

## Key files

| File | Purpose |
|---|---|
| `src/config.js` | Same-origin proxy and direct-LAN connection resolution |
| `src/App.jsx` | Input WebSocket + view routing |
| `src/components/WebRTCPlayer.jsx` | Native WebRTC video (H264, auto-reconnect, FPS overlay) |
| `src/components/GamepadController.jsx` | Touch controller UI |
| `src/components/SettingsPage.jsx` | Server/stream info |
