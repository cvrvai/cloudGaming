# CloudKH Cloud Gaming

CloudKH lets a player open a PC game in a browser, view the game through
WebRTC, and control it with a phone touch controller.

This repository contains three parts:

| Part | Location | Responsibility |
| --- | --- | --- |
| Cloud backend | `backend/` | FastAPI API, authentication, database access, WebSocket relay, and WebRTC signaling |
| Web app | `frontend/` | React/Vite game UI, WebRTC video player, and touch controls |
| Gaming PC node | `stream_node.py` | Runs on the physical Windows gaming PC, captures the game, and receives controller input |

## How the system works

```text
Phone browser
  | HTTPS/WSS: login, API, controller input, WebRTC offer/answer
  v
CloudKH backend (api.cloudkh.space)
  | PostgreSQL/Supabase, optional Redis, node WebSocket relay
  ^
Gaming PC running stream_node.py
  | WebRTC media: DirectX 11 capture -> GStreamer -> browser video
  | Input: WebSocket -> ViGEmBus virtual Xbox controller or keyboard fallback
```

The gaming PC makes an outbound WebSocket connection to the backend. No inbound
port forwarding is required. Cloudflare Tunnel or another HTTPS reverse proxy
handles the web application and signaling traffic. WebRTC video uses STUN or
TURN candidates separately; the Cloudflare Tunnel does not carry the video
frames.

## Production URLs

The current deployment uses:

- Web app: `https://cloudkh.space`
- Backend API: `https://api.cloudkh.space`
- Node relay: `wss://api.cloudkh.space/ws/node/<node_id>`
- Backend API health check: `https://api.cloudkh.space/api/health`

## Prerequisites

### Cloud services

You need:

1. A PostgreSQL database, such as Supabase Postgres.
2. A backend host that can run the FastAPI service.
3. A frontend host for the Vite build.
4. A DNS/HTTPS provider. The production setup uses Cloudflare for the domain,
   tunnel, and TURN relay.
5. Optional: a managed Redis service such as Upstash or Render Redis. Redis is
   configured with `REDIS_URL` and is useful for shared sessions, rate limits,
   and cache data when the backend has more than one instance.

### Windows gaming PC

Install these on every PC that will stream:

- Windows 10/11 64-bit
- Python 3.9 for the current GStreamer `gi` bindings
- GStreamer MSVC 64-bit Runtime and Development packages
- ViGEmBus for virtual Xbox controller support
- A supported game installed and configured in the CloudKH Admin Console

Install both GStreamer packages from the [GStreamer downloads page](https://gstreamer.freedesktop.org/download/).
Install ViGEmBus from its [release page](https://github.com/ViGEm/ViGEmBus/releases),
then restart Windows. Without ViGEmBus, CloudKH can use keyboard fallback, but
the phone will not appear as a virtual Xbox controller.

## 1. Configure the cloud backend

Create the backend environment variables in the hosting provider's secret or
environment-variable settings. Do not commit `backend/.env` and do not paste
secrets into chat, screenshots, or Git.

Minimum production settings:

```env
HOST=0.0.0.0
PORT=8000
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<database>
JWT_SECRET=<long-random-secret>
MFA_ENCRYPTION_KEY=<long-random-secret>
BOOTSTRAP_ADMIN_EMAIL=<admin-email>
BOOTSTRAP_ADMIN_PASSWORD=<temporary-bootstrap-password>
PUBLIC_FRONTEND_URL=https://cloudkh.space
```

If using managed Redis, add its TLS connection URL:

```env
REDIS_URL=rediss://default:<password>@<redis-host>:6379
```

### Enable Cloudflare TURN

TURN is needed when the phone and gaming PC are on different networks, mobile
data, restrictive NAT, or a firewall that prevents a direct WebRTC path.

1. Open Cloudflare Dashboard and go to **Realtime > TURN Server**.
2. Click **Get Started**.
3. Create a TURN Server app. The name can be `cloudkh-production-turn`.
4. Copy the generated TURN key `uid` and secret `key` into the backend hosting
   environment as:

```env
CLOUDFLARE_TURN_KEY_ID=<turn-key-uid>
CLOUDFLARE_TURN_API_TOKEN=<turn-key-secret>
CLOUDFLARE_TURN_TTL=3600
```

The `key` is a TURN key bearer secret, not a normal Cloudflare DNS API token.
Keep it server-side. The backend uses it to generate short-lived browser ICE
credentials, so no TURN secret is required in the frontend.

After saving the variables, wait for the backend deployment to finish. Confirm
that this endpoint responds successfully:

```text
https://api.cloudkh.space/api/health
```

The backend's `/api/system/info` endpoint should then include an `ice_servers`
array containing the browser's STUN/TURN configuration.

See the official [Cloudflare TURN documentation](https://developers.cloudflare.com/realtime/turn/)
and [credential generation documentation](https://developers.cloudflare.com/realtime/turn/generate-credentials/).

## 2. Deploy the frontend

Build the React app from `frontend/`:

```powershell
cd frontend
npm install
npm run build
```

Deploy the resulting `frontend/dist/` directory to the frontend host. The
production frontend should be available at `https://cloudkh.space`.

When the frontend is served through a Cloudflare Tunnel, the tunnel should
route the public hostname to the frontend service. The frontend proxies API
and WebSocket requests to the backend, so do not expose backend port `8000`
directly to the internet.

For the detailed tunnel procedure, see [RUN_SERVICES.md](RUN_SERVICES.md).

## 3. Pair a gaming PC

Pairing is required once per PC.

1. Sign in at `https://cloudkh.space`.
2. Open **Admin**.
3. Select **Pair PC** or **Pair Gaming PC**.
4. Generate a six-digit pairing code. It expires after approximately ten
   minutes.
5. On the Windows gaming PC, open PowerShell in this repository:

```powershell
cd C:\Users\<your-user>\PJ\cloudGaming
& .\backend\.venv\Scripts\python.exe -u .\stream_node.py --api https://api.cloudkh.space --code <PAIRING-CODE>
```

The node detects the GPU, CPU, RAM, and Windows version, registers the PC, and
saves its node identity in `.node_config.json`. That file is local-only and is
ignored by Git.

If the PC was already paired, start it without a new code:

```powershell
cd C:\Users\<your-user>\PJ\cloudGaming
& .\backend\.venv\Scripts\python.exe -u .\stream_node.py
```

The expected ready state is:

```text
[OK] Connected to CloudKH Cloud Relay. Ready for player sessions.
```

The node automatically reconnects after a temporary network interruption.

### Re-pair a PC

Use this only when the PC needs a new identity or backend URL:

```powershell
& .\backend\.venv\Scripts\python.exe -u .\stream_node.py --re-pair
```

The root `stream_node.py` is the supported node launcher. Do not use the older
duplicate at `backend/stream_node.py`.

## 4. Register and launch a game

1. In **Admin > Game Catalog**, add the game.
2. In the paired PC's **Installed Games** section, add the game's executable
   path and working directory.
3. Open the game through the CloudKH web app.
4. Keep the game window open and visible on the gaming PC.
5. Start the stream from the phone.

The node intentionally refuses to stream the normal Windows desktop. It waits
for an authorized game process and visible game window before creating the
capture pipeline.

## 5. Run everything locally for development

### Backend

Create the Python environment and install dependencies:

```powershell
cd backend
py -3.9 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env` with a local PostgreSQL/Redis configuration or the approved
cloud service URLs, then start the API:

```powershell
.\.venv\Scripts\python.exe run.py
```

Useful local endpoints:

- API: `http://127.0.0.1:8000`
- Health: `http://127.0.0.1:8000/api/health`
- Swagger: `http://127.0.0.1:8000/docs`

### Frontend

In another PowerShell window:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal. To test from a phone on the same
Wi-Fi, use the Vite **Network** URL and make sure Windows Firewall permits the
development server.

### Local streaming node

When using the local backend, pair or run the node against the local API:

```powershell
cd C:\Users\<your-user>\PJ\cloudGaming
& .\backend\.venv\Scripts\python.exe -u .\stream_node.py --api http://127.0.0.1:8000 --code <PAIRING-CODE>
```

For the simplest production-like test, point the node at
`https://api.cloudkh.space` as shown in the pairing section.

## What the power and session data means

The dashboard separates instantaneous power from accumulated energy:

- **W (watts):** current estimated power rate, for example `260 W active rate`.
- **kWh:** accumulated energy, calculated as `watts × hours ÷ 1,000`.
- **PC runtime:** elapsed time the authorized game/session has been active.
- **CPU/GPU estimate:** component-level estimate shown only when the detail
  view is opened. It is an estimate based on the configured rig profile unless
  hardware power telemetry is connected.
- **EDC cost:** `kWh × configured electricity tariff`.

Therefore, `260 W active rate` does not mean the PC already consumed 260 kWh.
For example, 260 W for 2 hours is approximately 0.52 kWh.

## Verbatim Voice of Customer (VOC)

After a player ends a session, CloudKH shows a short feedback form. The player
can provide:

- A required overall rating from 1 to 5 stars.
- An optional experience tag: **Smooth**, **Mostly okay**, or **Laggy**.
- An optional written comment in the player's own words.

The feedback is saved on the same `session_telemetry` row as the objective
measurements. The database fields are `user_rating`, `experience_tag`,
`user_comment`, and `feedback_submitted_at`. This lets the project compare
qualitative VOC with CTQ1 latency/FPS, CTQ2 energy, CTQ3 waiting time, and CTQ4
completion without losing the session context.

In **Admin > Lean Six Sigma DMAIC**:

- The VOC summary shows response count, average rating, smooth/laggy counts,
  and written-comment count.
- The session timeline has a **Voice of Customer** column. Select **View
  participant comment** to read the full comment.
- **Export .CSV** includes `User Rating (1-5)`, `Experience Tag`, `User Comment`,
  and `Feedback Logged At` beside the numerical CTQ columns.

If a student does not want to respond, **Skip feedback** still records the
automated telemetry row without inventing a comment or rating.

## Controller mapping

| Phone control | Virtual Xbox control |
| --- | --- |
| Left stick | Left stick |
| Right stick | Right stick and mouse camera control |
| A / B / X / Y | A / B / X / Y |
| LB / RB | Bumpers |
| LT / RT | Triggers |
| D-pad | D-pad |
| Start / Back | Start / Back |

If the node prints `vgamepad not available - keyboard fallback only`, install
ViGEmBus and reboot Windows. Keyboard fallback can still move through games
that support the configured keyboard mappings, but it is not equivalent to a
virtual Xbox controller.

## Troubleshooting

### Phone shows a black video screen

Check the node terminal in this order:

1. `Connected to CloudKH Cloud Relay` — the node is online.
2. `Incoming session offer` — the browser reached the node.
3. `Game confirmed running` — an authorized visible game was found.
4. `WebRTC answer dispatched` — negotiation reached the node.

If the answer is dispatched but video is still black:

- Confirm the phone can use the public site and the backend deployment is
  healthy.
- Confirm `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` are set on
  the backend, not only on the frontend.
- Restart `stream_node.py` after deploying code changes.
- Test once on the same Wi-Fi, then test again from mobile data.
- Check the browser console for an ICE failure. TURN is required when direct
  candidates cannot connect.

### Node says `Waiting for game window`

Launch the game from CloudKH, keep its window visible, and tap **Retry**. The
node does not stream the Windows desktop when no authorized game is running.

### Node cannot connect to the relay

Verify the backend URL and internet access:

```powershell
Invoke-RestMethod https://api.cloudkh.space/api/health
```

Then restart the node. It will retry the WebSocket automatically.

### Login is slow after a browser reload

The browser must restore the authentication session and the backend must
validate it. The dashboard then loads its independent data sections. Check the
backend logs and `/api/health` first; a slow database or unavailable Redis can
delay data loading even when the frontend itself has loaded.

### GStreamer is offline

Run diagnostics from the backend virtual environment:

```powershell
& .\backend\.venv\Scripts\python.exe -m app.services.streaming.diagnostics
```

Confirm that GStreamer MSVC 64-bit Runtime and Development packages are
installed and that `GSTREAMER_BIN` points to the GStreamer `bin` directory.

### Ports are already in use

```powershell
netstat -ano | findstr :8000
netstat -ano | findstr :5173
```

Stop only the process that owns the port, then start the service again.

## Security checklist

- Keep `backend/.env`, frontend secrets, and `.node_config.json` out of Git.
- Use long random values for `JWT_SECRET` and `MFA_ENCRYPTION_KEY`.
- Change the bootstrap admin password after the first login.
- Keep Cloudflare TURN `key` server-side; never place it in frontend source.
- Protect the public domain with authentication/Cloudflare Access.
- Do not expose backend port `8000` directly when using the production domain.
- Review the game's executable paths before enabling a machine.

## Related documentation

- [Backend README](backend/README.md)
- [Frontend README](frontend/README.md)
- [Run Services Guide](RUN_SERVICES.md)
- [Streaming Node Guide](NODE_AGENT_GUIDE.md)
- [Cloudflare TURN documentation](https://developers.cloudflare.com/realtime/turn/)
