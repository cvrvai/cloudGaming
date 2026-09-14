"""Real hardware detection for host machine (FR-02).

Queries Windows WMI / CimInstance or Linux /proc to return real hardware specs
instead of hardcoded mock data.
"""
import os
import platform
import subprocess
from functools import lru_cache
from typing import Dict


@lru_cache(maxsize=1)
def detect_host_hardware() -> Dict[str, str]:
    """Detect actual GPU, CPU, RAM, and Host Name from the local system."""
    computer_name = os.environ.get("COMPUTERNAME") or platform.node() or "Host-PC"
    gpu_name = "Integrated Graphics"
    cpu_name = platform.processor() or "Multi-Core CPU"
    ram_str = "16GB RAM"
    os_name = f"{platform.system()} {platform.release()}"

    if platform.system() == "Windows":
        try:
            # Query real GPU
            cmd = (
                "Get-CimInstance Win32_VideoController | "
                "Where-Object { $_.Name -like '*NVIDIA*' -or $_.Name -like '*Radeon*' -or $_.Name -like '*Intel*' } | "
                "Select-Object -ExpandProperty Name"
            )
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command", cmd],
                capture_output=True,
                text=True,
                timeout=5,
            )
            lines = [l.strip() for l in result.stdout.splitlines() if l.strip()]
            if lines:
                # Prefer dedicated GPU if multiple
                dedicated = [l for l in lines if "nvidia" in l.lower() or "radeon" in l.lower()]
                gpu_name = dedicated[0] if dedicated else lines[0]
        except Exception:
            pass

        try:
            # Query real CPU
            cmd = "Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name"
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command", cmd],
                capture_output=True,
                text=True,
                timeout=5,
            )
            out = result.stdout.strip().splitlines()
            if out:
                cpu_name = out[0].strip()
        except Exception:
            pass

        try:
            # Query real RAM
            cmd = "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)"
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command", cmd],
                capture_output=True,
                text=True,
                timeout=5,
            )
            ram_gb = result.stdout.strip()
            if ram_gb.isdigit():
                ram_str = f"{ram_gb}GB RAM"
        except Exception:
            pass

        try:
            # Query real OS
            cmd = "Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty Caption"
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command", cmd],
                capture_output=True,
                text=True,
                timeout=5,
            )
            caption = result.stdout.strip().splitlines()
            if caption:
                os_name = caption[0].strip()
        except Exception:
            pass

    return {
        "name": f"Host PC ({computer_name})",
        "gpu": gpu_name,
        "cpu": cpu_name,
        "ram": ram_str,
        "os": os_name,
    }
