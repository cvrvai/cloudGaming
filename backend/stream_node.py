#!/usr/bin/env python3
"""CloudKH Streaming PC Node Service (Terminal Client)

Run this script on each gaming PC in the terminal to pair it with the CloudKH backend
and stream games to remote players.

Usage:
    python stream_node.py
    python stream_node.py --api https://cloudkh-backend.netlify.app --code 123-456
    python stream_node.py --re-pair
"""
import argparse
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

CONFIG_FILE = Path(__file__).resolve().parent / ".node_config.json"


def detect_local_hardware() -> dict:
    """Detect local GPU, CPU, RAM, and OS specifications."""
    computer_name = platform.node() or "Gaming-PC"
    gpu_name = "Discrete Gaming GPU"
    cpu_name = platform.processor() or "Multi-Core CPU"
    ram_str = "16GB RAM"
    os_name = f"{platform.system()} {platform.release()}"

    if sys.platform == "win32":
        # Query Windows GPU
        try:
            cmd = "Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Virtual|Basic|Citrix|RDP' } | Select-Object -ExpandProperty Name"
            res = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, timeout=5)
            lines = [l.strip() for l in res.stdout.strip().splitlines() if l.strip()]
            if lines:
                gpu_name = lines[0]
        except Exception:
            pass

        # Query Windows CPU
        try:
            cmd = "Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name"
            res = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, timeout=5)
            lines = [l.strip() for l in res.stdout.strip().splitlines() if l.strip()]
            if lines:
                cpu_name = lines[0]
        except Exception:
            pass

        # Query Windows RAM
        try:
            cmd = "Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty TotalPhysicalMemory"
            res = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, timeout=5)
            raw = res.stdout.strip()
            if raw.isdigit():
                ram_gb = round(int(raw) / (1024 ** 3))
                ram_str = f"{ram_gb}GB RAM"
        except Exception:
            pass

        # Query Windows OS
        try:
            cmd = "Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty Caption"
            res = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, timeout=5)
            lines = [l.strip() for l in res.stdout.strip().splitlines() if l.strip()]
            if lines:
                os_name = lines[0]
        except Exception:
            pass
    elif sys.platform.startswith("linux"):
        # Query Linux CPU
        try:
            with open("/proc/cpuinfo") as f:
                for line in f:
                    if "model name" in line:
                        cpu_name = line.split(":", 1)[1].strip()
                        break
        except Exception:
            pass

        # Query Linux RAM
        try:
            with open("/proc/meminfo") as f:
                for line in f:
                    if "MemTotal:" in line:
                        kb = int(line.split()[1])
                        ram_str = f"{round(kb / 1024 / 1024)}GB RAM"
                        break
        except Exception:
            pass

    return {
        "name": "Cloud Gaming Rig",
        "gpu": gpu_name,
        "cpu": cpu_name,
        "ram": ram_str,
        "os": os_name,
    }


def post_json(url: str, payload: dict) -> dict:
    """Send JSON POST request using standard library."""
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
    """Perform keypair handshake with CloudKH backend."""
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
    print(f"  • GPU: {specs['gpu']}")
    print(f"  • CPU: {specs['cpu']}")
    print(f"  • RAM: {specs['ram']}")
    print(f"  • OS:  {specs['os']}")

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


def run_node_service(api_base: str, node_id: int, machine_name: str) -> None:
    """Run persistent streaming daemon and heartbeat loop."""
    print("\n" + "=" * 60)
    print("  CloudKH Gaming PC Streaming Service")
    print("=" * 60)
    print(f"  Node ID:     #{node_id}")
    print(f"  Node Name:   {machine_name}")
    print(f"  Backend:     {api_base}")
    print("  Status:      ONLINE & READY FOR SESSIONS")
    print("=" * 60)
    print("\n[*] Service active. Press Ctrl+C to disconnect and stop.\n")

    heartbeat_url = f"{api_base.rstrip('/')}/api/machines/{node_id}/heartbeat"

    while True:
        try:
            post_json(heartbeat_url, {})
            ts = datetime.now().strftime("%H:%M:%S")
            sys.stdout.write(f"\r[{ts}] Heartbeat OK | Node #{node_id} online")
            sys.stdout.flush()
        except Exception:
            pass
        time.sleep(20)


def main():
    parser = argparse.ArgumentParser(description="CloudKH Gaming PC Stream Node Service")
    parser.add_argument("--api", type=str, default="", help="CloudKH Backend API URL")
    parser.add_argument("--code", type=str, default="", help="6-digit pairing code from Admin Dashboard")
    parser.add_argument("--name", type=str, default="", help="Custom PC name override")
    parser.add_argument("--re-pair", action="store_true", help="Force new pairing handshake")
    args = parser.parse_args()

    config = load_config()

    if args.re_pair or not config.get("node_id") or not config.get("api_base"):
        api_base = args.api.strip()
        if not api_base:
            env_api = os.environ.get("CLOUDKH_API_URL", "").strip()
            default_api = env_api or config.get("api_base") or "http://localhost:8000"
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
            print(f"\n[✓] {result.get('message', 'Pairing complete!')}")

            config = {
                "api_base": api_base,
                "node_id": node_id,
                "machine_name": machine_name,
                "paired_at": datetime.now(timezone.utc).isoformat(),
            }
            save_config(config)
        except Exception as e:
            print(f"\n[✗] Pairing failed: {e}")
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
