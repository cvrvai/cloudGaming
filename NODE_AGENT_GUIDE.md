# CloudKH Streaming Node — AI Agent Setup & Operation Guide

> **Target Audience:** This document is written specifically for AI Coding Agents (such as Google Antigravity, Cursor, Claude Code, Windsurf, or GitHub Copilot) running on a secondary gaming PC to configure, pair, and operate this machine as a remote CloudKH streaming node.

---

## 1. System Role & Architecture Overview

This machine acts as a **Physical Streaming Host Node** for the CloudKH cloud gaming platform.
- **Frontend URL:** `https://cloudkh.space` (Hosted on Vercel)
- **Cloud Backend / Relay:** `https://api.cloudkh.space` (Hosted on Render)
- **Database:** PostgreSQL on Supabase Cloud

```
┌────────────────────────────────┐         ┌───────────────────────────────┐
│ Browser Client (Phone / PC)    │         │ This Gaming PC (Node Host)    │
│ https://cloudkh.space          │         │ Runs: stream_node.py          │
└──────────────┬─────────────────┘         └───────────────┬───────────────┘
               │                                           │
               │ HTTPS / WSS WebRTC SDP Relay              │ Persistent Outbound WSS Tunnel
               ▼                                           ▼
      ┌─────────────────────────────────────────────────────────────┐
      │          CloudKH Cloud Backend (api.cloudkh.space)          │
      │   WebSocket Relay: /ws/node/{node_id}                       │
      │   Database: machines, node_games, machine_pairings          │
      └─────────────────────────────────────────────────────────────┘
```

**Key Architectural Facts for the AI Agent:**
- **No Inbound Port Forwarding Required:** The node establishes a persistent *outbound* WebSocket connection to `wss://api.cloudkh.space/ws/node/{node_id}`.
- **Media Plane:** Low-latency WebRTC video stream encoded via DirectX 11 capture (`d3d11screencapturesrc` or `dx9screencapsrc` + `mfh264enc` / `openh264enc`).
- **Control Plane:** Low-latency keyboard, mouse, and gamepad emulation via `pynput` and `vgamepad` (ViGEmBus).
- **Save State Isolation:** Automated multi-tenant save management preserves each player's game progress under `user_storage/user_{id}/game_{id}/` without collisions.

---

## 2. Step-by-Step Agent Execution Workflow

Follow this procedure sequentially to set up and pair this PC:

### Step 2.1 — Verify Python Environment
Run in PowerShell:
```powershell
python --version
```
- **Requirement:** Python 3.10 or 3.11 (64-bit).
- If not installed or missing from `PATH`, ask the user to install Python 3.10+ from [python.org](https://www.python.org/downloads/) with `"Add python.exe to PATH"` checked.

### Step 2.2 — Prepare Virtual Environment
Create the dedicated `backend\.venv` environment and install dependencies:
```powershell
python -m venv backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install --upgrade pip
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

### Step 2.3 — Verify GStreamer Runtime
GStreamer MSVC 64-bit is required for DirectX screen capture. Run diagnostics:
```powershell
.\backend\.venv\Scripts\python.exe -m app.services.streaming.diagnostics
```
- **Expected Output:** `All core GStreamer elements available` or `dx11 capture pipeline ready`.
- **If GStreamer is missing:**
  Instruct the user to download and install both MSVC 64-bit packages:
  1. **Runtime:** `gstreamer-1.0-msvc-x86_64-*.msi` from `https://gstreamer.freedesktop.org/data/pkg/windows/`
  2. **Development:** `gstreamer-1.0-devel-msvc-x86_64-*.msi`
  *Note: The CloudKH engine automatically scans `%LOCALAPPDATA%\Programs\gstreamer`, `C:\Program Files\gstreamer`, and `C:\gstreamer` and dynamically links the Python `gi` bindings.*

### Step 2.4 — Pair with CloudKH Fleet
1. Prompt the user:
   > *"Please open https://cloudkh.space, go to 'Fleet Rigs' in the Admin Console, click '+ Pair Gaming PC', and provide the 6-digit Pairing Code."*
2. Once the user provides the code (e.g. `527-444`), run:
   ```powershell
   .\backend\.venv\Scripts\python.exe stream_node.py --api https://api.cloudkh.space --code <CODE>
   ```
3. The script will:
   - Auto-detect this PC's GPU, CPU, RAM, and OS specs.
   - Register this PC into Supabase as an available gaming rig.
   - Save local credentials to `.node_config.json`.
   - Establish the live WebSocket tunnel to `wss://api.cloudkh.space/ws/node/{node_id}`.

### Step 2.5 — Verify Live Connection
Run a quick query to the cloud backend to verify this node is recognized:
```powershell
Invoke-RestMethod -Uri "https://api.cloudkh.space/api/machines"
```
Ensure the machine appears with `status: "available"` and `is_host: 1`.

---

## 3. Registering Installed Games on this Machine

Once the PC is paired, map the games installed on this PC so players can launch them.

### Finding Game Executables
To search for a Steam game executable:
```powershell
Get-ChildItem "C:\Program Files (x86)\Steam\steamapps\common" -Filter "*.exe" -Recurse | Select-Object FullName
```

### Registering Game via API
Use `Invoke-RestMethod` to attach the game to this machine (replace `MACHINE_ID` and `GAME_ID`):
```powershell
$headers = @{
    "Content-Type" = "application/json"
    "Authorization" = "Bearer <ADMIN_JWT_TOKEN>"
}
$body = @{
    game_id = 1
    executable_path = "C:\Program Files (x86)\Steam\steamapps\common\YourGame\game.exe"
    working_directory = "C:\Program Files (x86)\Steam\steamapps\common\YourGame"
    launch_arguments = ""
    status = "ready"
    enabled = $true
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://api.cloudkh.space/api/machines/<MACHINE_ID>/games" -Method POST -Headers $headers -Body $body
```
*(Alternatively, configure the game executable path directly in the Admin Console UI on `cloudkh.space`).*

---

## 4. Running as a Persistent Background Daemon

### One-Click Launch
The root directory includes:
- `start_node.bat`: Starts the streaming daemon automatically using `.node_config.json`.
- `setup_node.bat`: Interactive setup and pairing script.

### Launching via Agent Background Task
When starting the node daemon in background:
```powershell
.\backend\.venv\Scripts\python.exe -u stream_node.py --api https://api.cloudkh.space
```
The node will log:
```text
==============================================================
  CloudKH Gaming PC Streaming Service
==============================================================
  Node ID:     #3
  Node Name:   Gaming Rig Node
  GPU:         NVIDIA GeForce RTX ...
  Backend:     https://api.cloudkh.space
  Status:      ONLINE & READY FOR SESSIONS
==============================================================
[*] Streaming daemon active. Press Ctrl+C to stop.
[18:00:00] [OK] Connected to CloudKH Cloud Relay. Ready for player sessions.
```

### Automatic Startup with Windows (Optional)
To ensure the node launches whenever the computer boots:
1. Open Windows Run dialog: `shell:startup`
2. Create a shortcut to `start_node.bat` inside that folder.

---

## 5. Troubleshooting & Diagnostics Reference

| Issue | Cause | Resolution |
|---|---|---|
| `No module named websockets` | Missing package in venv | Run `.\backend\.venv\Scripts\pip.exe install -r backend\requirements.txt` |
| `GStreamer OFFLINE` | GStreamer MSVC 64-bit not found | Install GStreamer MSVC x86_64 Runtime + Dev from gstreamer.freedesktop.org |
| `vgamepad not available` | ViGEmBus driver not installed | Keyboard fallback works automatically. For Xbox controller emulation, install [ViGEmBus](https://github.com/ViGEm/ViGEmBus/releases). |
| `Invalid or expired pairing code` | 10-minute code expired | Generate a new code in the Admin Console at `https://cloudkh.space` |
| `Tunnel connection error` | Network drop | `stream_node.py` auto-retries every 3–30 seconds. Verify internet connectivity. |
| Re-pairing needed | Need to change node ID / name | Run `.\backend\.venv\Scripts\python.exe stream_node.py --re-pair` |
