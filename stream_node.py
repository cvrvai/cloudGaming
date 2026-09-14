#!/usr/bin/env python3
"""CloudKH Streaming PC Node Service (Terminal Client)

Run this script on each gaming PC to pair it with the CloudKH backend
and stream games to remote players via DirectX 11 screen capture and WebRTC.

Usage:
    python stream_node.py
    python stream_node.py --api https://api.cloudkh.space --code 123-456
    python stream_node.py --re-pair
"""
import argparse
import asyncio
import json
import os
import platform
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

# Add backend directory to sys.path so app packages can be imported
BACKEND_DIR = Path(__file__).resolve().parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import functools
print = functools.partial(print, flush=True)

# Ensure GStreamer environment is configured before any gi imports
try:
    import app.core.gst_env
except ImportError:
    pass

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

CONFIG_FILE = Path(__file__).resolve().parent / ".node_config.json"


def detect_local_hardware() -> dict:
    """Detect local GPU, CPU, RAM, and OS specifications."""
    computer_name = platform.node() or "Gaming-PC"
    gpu_name = "Discrete Gaming GPU"
    cpu_name = platform.processor() or "Multi-Core CPU"
    ram_str = "16GB RAM"
    os_name = f"{platform.system()} {platform.release()}"

    if sys.platform == "win32":
        try:
            cmd = "Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Virtual|Basic|Citrix|RDP' } | Select-Object -ExpandProperty Name"
            res = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, timeout=5)
            lines = [l.strip() for l in res.stdout.strip().splitlines() if l.strip()]
            if lines:
                gpu_name = lines[0]
        except Exception:
            pass

        try:
            cmd = "Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name"
            res = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, timeout=5)
            lines = [l.strip() for l in res.stdout.strip().splitlines() if l.strip()]
            if lines:
                cpu_name = lines[0]
        except Exception:
            pass

        try:
            cmd = "Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty TotalPhysicalMemory"
            res = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, timeout=5)
            raw = res.stdout.strip()
            if raw.isdigit():
                ram_gb = round(int(raw) / (1024 ** 3))
                ram_str = f"{ram_gb}GB RAM"
        except Exception:
            pass

        try:
            cmd = "Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty Caption"
            res = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, timeout=5)
            lines = [l.strip() for l in res.stdout.strip().splitlines() if l.strip()]
            if lines:
                os_name = lines[0]
        except Exception:
            pass

    return {
        "name": f"Gaming PC ({computer_name})",
        "gpu": gpu_name,
        "cpu": cpu_name,
        "ram": ram_str,
        "os": os_name,
    }


def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": "CloudKH-NodeStreamer/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_config(cfg: dict) -> None:
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        print(f"[!] Warning: Could not save config locally: {e}")


def pair_pc(api_base: str, pair_code: str, custom_name: str = "") -> dict:
    api_base = api_base.rstrip("/")
    specs = detect_local_hardware()
    if custom_name:
        specs["name"] = custom_name

    url = f"{api_base}/api/machines/pair/node"
    payload = {
        "code": pair_code.strip(),
        "name": specs["name"],
        "gpu": specs["gpu"],
        "cpu": specs["cpu"],
        "ram": specs["ram"],
        "os": specs["os"],
        "notes": f"Paired via Streaming PC Terminal on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
    }

    print("\nConnecting to CloudKH backend...")
    print(f"URL: {url}")
    print(f"Pairing Code: {pair_code.strip()}")
    print("\nDetected Hardware:")
    print(f"  - GPU: {specs['gpu']}")
    print(f"  - CPU: {specs['cpu']}")
    print(f"  - RAM: {specs['ram']}")
    print(f"  - OS:  {specs['os']}")

    try:
        resp = post_json(url, payload)
        return resp
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(body).get("detail", body)
        except Exception:
            detail = body
        raise RuntimeError(f"Pairing error ({e.code}): {detail}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Network error: Failed to reach backend at {api_base} ({e.reason})")


async def run_streaming_tunnel(api_base: str, node_id: int, machine_name: str) -> None:
    """Maintain outbound WebSocket tunnel to CloudKH cloud for WebRTC signaling and input."""
    import websockets
    from app.services.streaming.manager import stream_manager
    from app.services.agent import host_agent
    from app.services.input.gamepad import gamepad_service

    # Start local virtual gamepad / keyboard emulator service
    gamepad_service.start()

    ws_url = api_base.replace("https://", "wss://").replace("http://", "ws://").rstrip("/") + f"/ws/node/{node_id}"
    hardware = detect_local_hardware()

    print("\n" + "=" * 62)
    print("  CloudKH Gaming PC Streaming Service")
    print("=" * 62)
    print(f"  Node ID:     #{node_id}")
    print(f"  Node Name:   {machine_name}")
    print(f"  GPU:         {hardware['gpu']}")
    print(f"  Backend:     {api_base}")
    print(f"  Tunnel:      {ws_url}")
    print(f"  GStreamer:   {'READY (DirectX 11 Capture)' if stream_manager.available else 'OFFLINE'}")
    print(f"  Status:      ONLINE & READY FOR SESSIONS")
    print("=" * 62)
    print("\n[*] Streaming daemon active. Press Ctrl+C to stop.\n")

    loop = asyncio.get_running_loop()
    active_ws = None

    def on_game_exit(game_id, title):
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"\n[{ts}] [STREAM] Game '{title}' exited! Terminating WebRTC capture pipeline immediately...")
        try:
            stream_manager.close_all()
        except Exception as e:
            print(f"[{ts}] Error closing stream manager: {e}")

        # Send notification over websocket to cloud backend
        if active_ws:
            try:
                exit_msg = json.dumps({
                    "type": "game_exited",
                    "game_id": game_id,
                    "title": title,
                    "message": f"Game '{title}' has ended. Save data secured.",
                })
                asyncio.run_coroutine_threadsafe(active_ws.send(exit_msg), loop)
            except Exception as e:
                print(f"[{ts}] Error notifying cloud relay of game exit: {e}")

    host_agent.register_exit_callback(on_game_exit)

    reconnect_delay = 3

    while True:
        hb_task = None
        try:
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"[{ts}] Connecting to CloudKH streaming relay...")

            async with websockets.connect(
                ws_url,
                ping_interval=20,
                ping_timeout=15,
                open_timeout=30,
                max_size=10 * 1024 * 1024,
            ) as ws:
                active_ws = ws
                reconnect_delay = 3
                ts = datetime.now().strftime("%H:%M:%S")
                print(f"[{ts}] [OK] Connected to CloudKH Cloud Relay. Ready for player sessions.")

                # Announce node capabilities
                await ws.send(json.dumps({
                    "type": "node_specs",
                    "specs": {
                        "name": machine_name,
                        "gstreamer_available": stream_manager.available,
                        "gpu": hardware["gpu"],
                        "cpu": hardware["cpu"],
                        "ram": hardware["ram"],
                        "os": hardware["os"],
                    },
                }))

                async def send_heartbeats():
                    try:
                        while True:
                            await asyncio.sleep(10)
                            await ws.send(json.dumps({"type": "heartbeat"}))
                    except (asyncio.CancelledError, Exception):
                        pass

                hb_task = asyncio.create_task(send_heartbeats())
                async for raw_message in ws:
                    try:
                        msg = json.loads(raw_message)
                    except Exception:
                        continue

                    msg_type = msg.get("type")

                    # Handle WebRTC SDP Offer from browser
                    if msg_type == "stream_offer":
                        corr_id = msg.get("correlation_id")
                        offer = msg.get("offer", {})
                        ts = datetime.now().strftime("%H:%M:%S")
                        print(f"\n[{ts}] [STREAM] Incoming session offer from browser client...")

                        # Privacy / Kiosk Protection: Strictly prohibit streaming Windows desktop
                        # Wait up to 15 seconds for authorized game process and its native window HWND
                        wait_sec = 0.0
                        game_hwnd = None
                        print(f"[{ts}] [STREAM] Waiting for game window...")
                        while wait_sec < 15.0:
                            if host_agent.is_game_running():
                                game_hwnd = host_agent.get_active_game_window_handle()
                                if game_hwnd:
                                    host_agent.bring_game_to_foreground(game_hwnd)
                                    break
                            await asyncio.sleep(0.5)
                            wait_sec += 0.5

                        if not game_hwnd and not host_agent.is_game_running():
                            err_msg = "Streaming blocked: No authorized game is actively running on this PC. Windows desktop interface streaming is disabled."
                            print(f"[{ts}] [!] {err_msg}")
                            await ws.send(json.dumps({
                                "type": "stream_error",
                                "correlation_id": corr_id,
                                "error": err_msg,
                            }))
                            continue

                        if not game_hwnd:
                            # If game is running but window handle couldn't be detected yet, try one more time
                            game_hwnd = host_agent.get_active_game_window_handle()
                            if game_hwnd:
                                host_agent.bring_game_to_foreground(game_hwnd)

                        if not game_hwnd:
                            err_msg = "Streaming blocked: Game window not found or minimized. Windows desktop interface streaming is restricted."
                            print(f"[{ts}] [!] {err_msg}")
                            await ws.send(json.dumps({
                                "type": "stream_error",
                                "correlation_id": corr_id,
                                "error": err_msg,
                            }))
                            continue

                        # Ensure watchdog is actively monitoring process lifecycle
                        if host_agent.is_game_running() and not host_agent._watchdog_active:
                            active_title = host_agent._active_game_info.get("title", "Game") if host_agent._active_game_info else "Game"
                            active_id = host_agent._active_game_info.get("game_id", 1) if host_agent._active_game_info else 1
                            host_agent._start_process_watchdog(active_title, active_id)

                        try:
                            hwnd_str = f"0x{game_hwnd:x}" if game_hwnd else "auto"
                            print(f"[{ts}] [STREAM] Game confirmed running (HWND: {hwnd_str}). Initializing DirectX 11 desktop capture...")
                            answer = await stream_manager.create_peer_answer(
                                offer["sdp"],
                                width=offer.get("width"),
                                height=offer.get("height"),
                                fps=offer.get("fps"),
                                bitrate=offer.get("bitrate"),
                                window_handle=None,
                            )
                            await ws.send(json.dumps({
                                "type": "stream_answer",
                                "correlation_id": corr_id,
                                "answer": answer,
                            }))
                            print(f"[{ts}] [STREAM] WebRTC answer dispatched. DirectX 11 capture active at 60 FPS!")
                        except Exception as exc:
                            print(f"[{ts}] [!] Stream negotiation failed: {exc}")
                            await ws.send(json.dumps({
                                "type": "stream_error",
                                "correlation_id": corr_id,
                                "error": str(exc),
                            }))

                    # Handle real-time gamepad and keyboard input
                    elif msg_type == "input":
                        payload = msg.get("payload", {})
                        inp = payload.get("type")
                        if inp == "key":
                            gamepad_service.handle_key(
                                payload.get("key", ""),
                                bool(payload.get("pressed", False)),
                            )
                        elif inp == "button":
                            gamepad_service.handle_button(
                                payload.get("button", ""),
                                bool(payload.get("pressed", False)),
                            )
                        elif inp == "left_stick":
                            gamepad_service.handle_left_stick(
                                float(payload.get("x", 0)),
                                float(payload.get("y", 0)),
                            )
                        elif inp == "right_stick":
                            gamepad_service.handle_right_stick(
                                float(payload.get("x", 0)),
                                float(payload.get("y", 0)),
                            )
                        elif inp == "dpad":
                            gamepad_service.handle_dpad(
                                payload.get("direction", ""),
                                bool(payload.get("pressed", False)),
                            )
                        elif inp == "mouse_move":
                            gamepad_service.handle_mouse_move(
                                payload.get("dx", 0),
                                payload.get("dy", 0),
                            )
                        elif inp == "mouse_abs":
                            gamepad_service.handle_mouse_absolute(
                                payload.get("x", 0),
                                payload.get("y", 0),
                            )
                        elif inp == "mouse_button":
                            gamepad_service.handle_mouse_button(
                                payload.get("button", "left"),
                                bool(payload.get("pressed", False)),
                            )
                        elif inp in ("stop_session", "exit_game", "STOP_GAME"):
                            ts = datetime.now().strftime("%H:%M:%S")
                            print(f"\n[{ts}] [STREAM] Received '{inp}' signal via input channel. Stopping game & stream immediately...")
                            try:
                                host_agent.stop_game()
                                stream_manager.close_all()
                            except Exception as exc:
                                print(f"[{ts}] [!] Error stopping game on client request: {exc}")

                    # Handle direct session stop or exit command
                    elif msg_type in ("stop_session", "exit_game", "STOP_GAME", "STOP_SESSION"):
                        ts = datetime.now().strftime("%H:%M:%S")
                        print(f"\n[{ts}] [STREAM] Received top-level '{msg_type}' request. Terminating game & stream immediately...")
                        try:
                            host_agent.stop_game()
                            stream_manager.close_all()
                        except Exception as exc:
                            print(f"[{ts}] [!] Error stopping game: {exc}")

                    # Handle game execution command from gatekeeper
                    elif msg_type == "agent_command":
                        corr_id = msg.get("correlation_id")
                        op = msg.get("operation")
                        cmd_payload = msg.get("payload", {})
                        ts = datetime.now().strftime("%H:%M:%S")
                        print(f"\n[{ts}] [AGENT] Executing operation: {op}")

                        try:
                            res = host_agent.dispatch(op, cmd_payload)
                            if op in ("STOP_GAME", "STOP_SESSION"):
                                stream_manager.close_all()
                            await ws.send(json.dumps({
                                "type": "command_result",
                                "correlation_id": corr_id,
                                "result": res,
                            }))
                            print(f"[{ts}] [AGENT] Result: {res.get('status')}")
                        except Exception as exc:
                            print(f"[{ts}] [AGENT] Error: {exc}")
                            await ws.send(json.dumps({
                                "type": "command_result",
                                "correlation_id": corr_id,
                                "error": str(exc),
                            }))

        except (websockets.exceptions.ConnectionClosedError, websockets.exceptions.ConnectionClosedOK) as exc:
            active_ws = None
            if hb_task:
                hb_task.cancel()
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"\n[{ts}] [!] Tunnel disconnected: {exc}. Reconnecting in {reconnect_delay}s...")
        except Exception as exc:
            active_ws = None
            if hb_task:
                hb_task.cancel()
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"\n[{ts}] [!] Tunnel connection error: {exc}. Reconnecting in {reconnect_delay}s...")

        await asyncio.sleep(reconnect_delay)
        reconnect_delay = min(30, reconnect_delay * 1.5)


def run_node_service(api_base: str, node_id: int, machine_name: str) -> None:
    """Run persistent streaming daemon and tunnel loop."""
    asyncio.run(run_streaming_tunnel(api_base, node_id, machine_name))


def main():
    parser = argparse.ArgumentParser(description="CloudKH Gaming PC Stream Node Service")
    parser.add_argument("--api", type=str, default="", help="CloudKH Backend API URL")
    parser.add_argument("--code", type=str, default="", help="6-digit pairing code from Admin Dashboard")
    parser.add_argument("--name", type=str, default="", help="Custom PC name override")
    parser.add_argument("--re-pair", action="store_true", help="Force new pairing handshake")
    args = parser.parse_args()

    config = load_config()

    if bool(args.code) or args.re_pair or not config.get("node_id") or not config.get("api_base"):
        api_base = args.api.strip()
        if not api_base:
            env_api = os.environ.get("CLOUDKH_API_URL", "").strip()
            default_api = env_api or config.get("api_base") or "https://api.cloudkh.space"
            entered = input(f"Enter CloudKH Backend API URL [{default_api}]: ").strip()
            api_base = entered if entered else default_api

        pair_code = args.code.strip()
        if not pair_code:
            pair_code = input("Enter 6-digit Pairing Code (from Admin Dashboard): ").strip()

        if not pair_code:
            print("[!] Error: A valid pairing code is required to connect this PC.")
            sys.exit(1)

        try:
            result = pair_pc(api_base, pair_code, args.name)
            node_id = result.get("node_id") or result.get("machine", {}).get("id")
            machine_name = result.get("machine", {}).get("name") or "Gaming Rig Node"
            print(f"\n[OK] {result.get('message', 'Pairing complete!')}")

            config = {
                "api_base": api_base,
                "node_id": node_id,
                "machine_name": machine_name,
                "paired_at": datetime.now(timezone.utc).isoformat(),
            }
            save_config(config)
        except Exception as e:
            print(f"\n[FAIL] Pairing failed: {e}")
            sys.exit(1)

    api_base = args.api.strip() or config["api_base"]
    node_id = config["node_id"]
    machine_name = config.get("machine_name", f"Node #{node_id}")

    try:
        run_node_service(api_base, node_id, machine_name)
    except KeyboardInterrupt:
        print("\n\n[!] Streaming service stopped by user.")
        sys.exit(0)


if __name__ == "__main__":
    main()
