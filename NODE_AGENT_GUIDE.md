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

## 4. Running as a 24/7 Persistent Background Daemon

### Self-Healing Daemon Architecture
Both `run_node.bat` and `start_node.bat` implement a self-healing supervision loop (`:daemon_loop`):
* **Auto-Restart on Exit:** If Python crashes, encounters a driver exception, or exits for any reason, the batch script logs the exit code and **automatically relaunches `stream_node.py` within 3 seconds**. It never halts at `pause`.
* **QuickEdit Mode Protection:** Windows Console QuickEdit mode is automatically disabled in the registry (`HKCU\Console\QuickEdit = 0`) on launch. In Windows 10, clicking inside an active console window pauses the entire process; disabling QuickEdit eliminates this freezing issue.
* **Auto-Sync:** On every restart, `run_node.bat` runs `git pull --ff-only` to seamlessly ingest updates.

### Windows Boot Autostart (`install_startup.bat`)
To ensure the node launches automatically on Windows boot (e.g. after overnight Windows Updates):
1. Double-click `install_startup.bat` (or run it via PowerShell).
2. It generates a minimized shortcut in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CloudKH_Node.lnk`.
3. The PC now runs 24 hours / 7 days without requiring manual user login.

---

## 5. Critical Operating Rules for AI Agents

> [!IMPORTANT]
> **RULE 1: NEVER RE-PAIR AN ALREADY PAIRED GAMING PC**
> * Pairing is a **one-time** hardware registration.
> * When a PC pairs, `.node_config.json` is permanently created with `node_id` (e.g. Node #3 for `DESKTOP-BR6FNPB`).
> * The cloud database permanently stores this machine.
> * Whenever `stream_node.py` starts, it automatically reads `.node_config.json` and connects to `wss://api.cloudkh.space/ws/node/{node_id}`.
> * **DO NOT** prompt the user for a new 6-digit code or run `--re-pair` unless the PC was deleted from the database or hardware was replaced.

> [!NOTE]
> **RULE 2: UNDERSTAND CLOUD BACKEND DEPLOYMENT RECONNECTS**
> * Every time code is committed and pushed to `origin/main`, Render redeploys the cloud backend container (~60–90 seconds).
> * During this reboot, active WebSocket tunnels are closed by the server.
> * In `stream_node.py`, the client logs `Tunnel disconnected... Reconnecting in 3s...` and retries with backoff.
> * **Do NOT assume the gaming PC is dead or down.** It will automatically reconnect as soon as Render finishes booting.

> [!TIP]
> **RULE 3: WINDOWS 10 24/7 POWER MANAGEMENT REQUIREMENTS**
> Even when Windows Sleep is set to "Never", ensure these two hardware settings:
> 1. **Network Adapter Power Saving:** In Device Manager > Network Adapters > Properties > Power Management, uncheck *"Allow the computer to turn off this device to save power"*. Otherwise, Windows drops Ethernet power after idle periods.
> 2. **Display Sleep vs System Sleep:** Turning off the physical monitor is fine; Windows Sleep must remain set to **"Never"**.

> [!WARNING]
> **RULE 4: NEVER EXPOSE INTERNAL IMPLEMENTATION DETAILS TO END USERS**
> * Software engineering standard: Do not display script filenames (`stream_node.py`), internal architecture names (`node_id`, `node relay`, `host PC`), or stack traces in player-facing UI or error messages.
> * Use friendly, polished status phrases (e.g. *"Starting your game…"*, *"Connecting to game session…"*, *"Gaming rig is currently offline. Please try again in a few moments."*).

---

## 6. Troubleshooting & Diagnostics Reference

| Symptom / Error | True Root Cause | Correct Resolution (AI Agent Action) |
|---|---|---|
| `Gaming PC is currently unavailable` | Cloud backend recently restarted, or node reconnecting | Wait 15–30 seconds for WebSocket handshake. Do NOT re-pair. |
| Console paused / unresponsive | QuickEdit mode triggered by a mouse click | Press `Enter` in the console, or relaunch via `run_node.bat` (which disables QuickEdit). |
| Node goes offline after 30 mins | Network adapter sleep enabled in Windows Device Manager | Disable "Allow the computer to turn off this device to save power" in NIC Power Management. |
| PC reboots after Windows update | Process not launched at startup | Run `install_startup.bat` to place the daemon in Windows Startup folder. |
| `Failed to fetch` on cancel booking | Cloud backend restarting or race condition | Upgraded in `082aacd` — cancellation now uses single authoritative endpoint with safe parsing. |
| `No module named websockets` | Missing dependency in virtual environment | Run `.\backend\.venv\Scripts\pip.exe install -r backend\requirements.txt` |
| `GStreamer OFFLINE` | GStreamer MSVC 64-bit not installed | Install GStreamer MSVC x86_64 Runtime + Dev from gstreamer.freedesktop.org |
| `vgamepad not available` | ViGEmBus driver not installed | Keyboard fallback works automatically. For Xbox controller emulation, install [ViGEmBus](https://github.com/ViGEm/ViGEmBus/releases). |

