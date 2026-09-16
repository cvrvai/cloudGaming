# CloudKH Engineering & Agent Directives (AGENTS.md)

This document contains fundamental engineering rules and operational directives for any AI coding assistant (Google Antigravity, Cursor, Claude Code, Copilot, Windsurf) working in this repository.

---

## 1. Golden Software Engineering Rule: Zero Internal Leaks
* **Never expose behind-the-scenes logs, script filenames, or internal infrastructure terms to players/end-users.**
* **Prohibited in user UI/errors:** `stream_node.py`, `node_id`, `node #`, `node relay`, `host PC`, `gstreamer`, `DirectX`, raw exception traces.
* **Approved user-facing phrasing:**
  * *"Starting your game…"*
  * *"Connecting to game session…"*
  * *"Gaming rig is currently offline. Please try again in a few moments."*
  * *"Unable to start game stream. Please try again."*

---

## 2. Gaming PC Node Architecture & 24/7 Operations

### A. One-Time Pairing Rule
* **NEVER re-pair an already paired PC.**
* Pairing is a permanent cryptographic association. Once paired, `.node_config.json` stores `node_id` and `api_base`.
* Whenever `stream_node.py` is executed, it reads `.node_config.json` and connects directly to `wss://api.cloudkh.space/ws/node/{node_id}`.
* **Do NOT generate new pairing codes** or ask the user to re-pair unless the machine was explicitly dropped from the Supabase database.

### B. Deployment Reconnects vs "PC Down"
* Pushing code to `origin/main` triggers an automatic Render container rebuild (~60–90 seconds).
* During this rebuild, active WebSockets drop. `stream_node.py` logs `Tunnel disconnected... Reconnecting in 3s...`.
* **The host PC is NOT down or dead.** It will auto-reconnect as soon as Render finishes booting.

### C. 24/7 Persistent Daemon
* Always launch nodes using [`run_node.bat`](file:///c:/Users/cheon/PJ/cloudGaming/run_node.bat) or [`start_node.bat`](file:///c:/Users/cheon/PJ/cloudGaming/start_node.bat).
* Both scripts run a self-healing `:daemon_loop` that automatically restarts `stream_node.py` within 3 seconds if it ever exits or crashes.
* Console QuickEdit mode is disabled in registry on startup to prevent Windows console freezing from mouse clicks.
* For automated reboot survival, run [`install_startup.bat`](file:///c:/Users/cheon/PJ/cloudGaming/install_startup.bat) once to link into Windows Startup.

### D. Windows 10 Power Settings
To keep physical PCs running 24/7:
1. Windows Settings > Power & sleep > Set **Sleep** to **Never**.
2. Device Manager > Network Adapters > Properties > Power Management > Uncheck **"Allow the computer to turn off this device to save power"**.

---

## 3. Fleet Identification
* **Node #2:** `Gaming PC (Choonvai)` — RTX 2080 Super Max-Q, Windows 11 Pro
* **Node #3:** `Gaming PC (DESKTOP-BR6FNPB)` — GTX 1660 Ti, Windows 10 Pro

See full details in [`NODE_AGENT_GUIDE.md`](file:///c:/Users/cheon/PJ/cloudGaming/NODE_AGENT_GUIDE.md).
