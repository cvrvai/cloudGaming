"""Virtual gamepad service: virtual Xbox 360 controller (ViGEmBus) with
keyboard/mouse fallback.

Ported from server/input/input_server.py, encapsulated as a service class so
the FastAPI WebSocket endpoint stays thin.
"""
from __future__ import annotations

import logging
import sys
import threading
import time
from typing import Dict

logger = logging.getLogger("input.gamepad")

try:
    from pynput.keyboard import Controller as KeyboardController, Key
    from pynput.mouse import Button as MouseButton, Controller as MouseController
    PYNPUT_AVAILABLE = True
except Exception as exc:
    KeyboardController = None
    MouseController = None
    Key = None
    MouseButton = None
    PYNPUT_AVAILABLE = False
    logger.info("pynput not available in headless environment (%s) - keyboard/mouse emulation disabled", exc)

from app.core.config import settings
from app.utils.display_linux import get_monitor_geometry

try:
    import vgamepad as vg

    VGAMEPAD_AVAILABLE = True
except Exception:
    VGAMEPAD_AVAILABLE = False
    if sys.platform == "win32":
        logger.warning("vgamepad not available - keyboard fallback only")

LINUX_GAMEPAD_AVAILABLE = False
if sys.platform.startswith("linux"):
    try:
        from app.services.input.gamepad_linux import Button as LinuxButton
        from app.services.input.gamepad_linux import LinuxVirtualGamepad

        LINUX_GAMEPAD_AVAILABLE = True
    except Exception as exc:
        logger.warning(
            "uinput virtual gamepad not available (%s) - keyboard fallback only. "
            "Check /dev/uinput permissions (user must be in the 'input' group).",
            exc,
        )

KEYBOARD_SPECIAL_KEYS = {
    "SPACE": Key.space,
    "SHIFT": Key.shift,
    "CTRL": Key.ctrl,
    "ALT": Key.alt,
    "ENTER": Key.enter,
    "ESC": Key.esc,
    "TAB": Key.tab,
    "BACKSPACE": Key.backspace,
    "DELETE": Key.delete,
    "WIN": Key.cmd,
    "HOME": Key.home,
    "END": Key.end,
    "PGUP": Key.page_up,
    "PGDN": Key.page_down,
    "UP": Key.up,
    "DOWN": Key.down,
    "LEFT": Key.left,
    "RIGHT": Key.right,
} if (PYNPUT_AVAILABLE and Key is not None) else {}

MOUSE_BUTTONS = {
    "left": MouseButton.left,
    "right": MouseButton.right,
    "middle": MouseButton.middle,
} if (PYNPUT_AVAILABLE and MouseButton is not None) else {}

# App button name -> keyboard key when running in fallback mode
BUTTON_KEYBOARD_MAP = {
    "A": "SPACE",
    "B": "SHIFT",
    "X": "E",
    "Y": "Q",
    "LB": "R",
    "RB": "F",
    "LT": "1",
    "RT": "2",
    "START": "ENTER",
    "SELECT": "ESC",
    "D_UP": "UP",
    "D_DOWN": "DOWN",
    "D_LEFT": "LEFT",
    "D_RIGHT": "RIGHT",
}

DPAD_TO_BUTTON = {
    "up": "D_UP",
    "down": "D_DOWN",
    "left": "D_LEFT",
    "right": "D_RIGHT",
}


class GamepadService:
    """Applies controller input messages to a virtual gamepad / keyboard / mouse."""

    def __init__(self) -> None:
        self.mouse = None
        self.keyboard = None
        if PYNPUT_AVAILABLE and MouseController is not None and KeyboardController is not None:
            try:
                self.mouse = MouseController()
                self.keyboard = KeyboardController()
            except Exception as exc:
                logger.info("Unable to initialize mouse/keyboard controller (%s)", exc)

        self.keyboard_keys_down: set = set()
        self.mouse_buttons_down: set = set()
        self.gamepad = None
        self.left_stick: Dict[str, float] = {"x": 0.0, "y": 0.0}
        self.right_stick: Dict[str, float] = {"x": 0.0, "y": 0.0}
        self.mouse_sensitivity = settings.mouse_sensitivity
        # The browser sends normalized coordinates (0..1). Resolve the X11
        # monitor once rather than spawning xrandr for every pointer event.
        self._mouse_region = None
        self._update_thread: threading.Thread = None
        self._running = False

        self.button_map = {}
        if VGAMEPAD_AVAILABLE:
            self.button_map = {
                "A": vg.XUSB_BUTTON.XUSB_GAMEPAD_A,
                "B": vg.XUSB_BUTTON.XUSB_GAMEPAD_B,
                "X": vg.XUSB_BUTTON.XUSB_GAMEPAD_X,
                "Y": vg.XUSB_BUTTON.XUSB_GAMEPAD_Y,
                "LB": vg.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_SHOULDER,
                "RB": vg.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_SHOULDER,
                "START": vg.XUSB_BUTTON.XUSB_GAMEPAD_START,
                "SELECT": vg.XUSB_BUTTON.XUSB_GAMEPAD_BACK,
                "D_UP": vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_UP,
                "D_DOWN": vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_DOWN,
                "D_LEFT": vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_LEFT,
                "D_RIGHT": vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_RIGHT,
            }
        elif LINUX_GAMEPAD_AVAILABLE:
            self.button_map = {
                "A": LinuxButton.A,
                "B": LinuxButton.B,
                "X": LinuxButton.X,
                "Y": LinuxButton.Y,
                "LB": LinuxButton.LB,
                "RB": LinuxButton.RB,
                "START": LinuxButton.START,
                "SELECT": LinuxButton.BACK,
                "D_UP": LinuxButton.DPAD_UP,
                "D_DOWN": LinuxButton.DPAD_DOWN,
                "D_LEFT": LinuxButton.DPAD_LEFT,
                "D_RIGHT": LinuxButton.DPAD_RIGHT,
            }

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def start(self) -> None:
        self._mouse_region = get_monitor_geometry(settings.monitor_index)
        if settings.input_mode != "keyboard":
            if VGAMEPAD_AVAILABLE:
                try:
                    self.gamepad = vg.VX360Gamepad()
                    logger.info("Virtual Xbox 360 controller initialized (ViGEmBus)")
                except Exception as exc:
                    logger.warning(
                        "Failed to create virtual gamepad (%s). "
                        "Install ViGEmBus: https://github.com/ViGEm/ViGEmBus/releases",
                        exc,
                    )
                    self.gamepad = None
            elif LINUX_GAMEPAD_AVAILABLE:
                try:
                    self.gamepad = LinuxVirtualGamepad()
                    logger.info("Virtual Xbox 360 controller initialized (uinput)")
                except Exception as exc:
                    logger.warning(
                        "Failed to create uinput gamepad (%s). Check /dev/uinput "
                        "permissions (user must be in the 'input' group).",
                        exc,
                    )
                    self.gamepad = None

        self._running = True
        self._update_thread = threading.Thread(target=self._update_loop, daemon=True)
        self._update_thread.start()

    def stop(self) -> None:
        self._running = False
        self.reset()

    @property
    def controller_mode(self) -> str:
        return "xinput" if self.gamepad is not None else "keyboard"

    @property
    def keyboard_fallback(self) -> bool:
        return settings.input_mode in ("keyboard", "both") or self.gamepad is None

    # ------------------------------------------------------------------
    # Continuous updates (sticks -> gamepad + mouse) at ~60 Hz
    # ------------------------------------------------------------------
    def _camera_scale(self) -> float:
        """Map the shared speed slider onto the gamepad's right stick.

        20 remains the neutral/default speed. Values below it slow camera
        movement; values above it reach full-stick deflection sooner.
        """
        return max(0.1, min(3.0, self.mouse_sensitivity / 20.0))

    def _update_loop(self) -> None:
        while self._running:
            if self.gamepad is not None:
                try:
                    self.gamepad.left_joystick_float(
                        x_value_float=self.left_stick["x"],
                        y_value_float=self.left_stick["y"],
                    )
                    self.gamepad.right_joystick_float(
                        x_value_float=max(-1.0, min(1.0, self.right_stick["x"] * self._camera_scale())),
                        y_value_float=max(-1.0, min(1.0, self.right_stick["y"] * self._camera_scale())),
                    )
                    self.gamepad.update()
                except Exception as exc:
                    logger.error("Gamepad update error: %s", exc)

            # Mouse fallback is only for hosts without a virtual controller.
            # Sending both a gamepad right stick and OS mouse movement makes
            # games apply the camera input twice, causing fast/jittery motion.
            if self.gamepad is None and (self.right_stick["x"] != 0 or self.right_stick["y"] != 0):
                dx = int(self.right_stick["x"] * self.mouse_sensitivity)
                dy = int(self.right_stick["y"] * self.mouse_sensitivity)
                if (dx != 0 or dy != 0) and self.mouse is not None:
                    try:
                        self.mouse.move(dx, dy)
                    except Exception:
                        pass

            time.sleep(0.016)

    # ------------------------------------------------------------------
    # Keyboard helpers
    # ------------------------------------------------------------------
    def _keyboard_key(self, name: str):
        return KEYBOARD_SPECIAL_KEYS.get(name.upper(), name.lower())

    def _set_keyboard_key(self, name: str, pressed: bool) -> None:
        if self.keyboard is None:
            return
        key_name = name.upper()
        key = self._keyboard_key(key_name)
        try:
            if pressed and key_name not in self.keyboard_keys_down:
                self.keyboard.press(key)
                self.keyboard_keys_down.add(key_name)
            elif not pressed and key_name in self.keyboard_keys_down:
                self.keyboard.release(key)
                self.keyboard_keys_down.discard(key_name)
        except Exception:
            logger.debug("Ignoring unsupported key: %r", name)

    def _release_all_keys(self) -> None:
        if self.keyboard is None:
            self.keyboard_keys_down.clear()
            return
        for key_name in list(self.keyboard_keys_down):
            try:
                self.keyboard.release(self._keyboard_key(key_name))
            except Exception:
                pass
        self.keyboard_keys_down.clear()

    # ------------------------------------------------------------------
    # Input message handlers (protocol shared with the frontend)
    # ------------------------------------------------------------------
    def handle_left_stick(self, x: float, y: float) -> None:
        self.left_stick["x"] = max(-1.0, min(1.0, x))
        self.left_stick["y"] = max(-1.0, min(1.0, -y))  # invert Y: up = forward
        if self.keyboard_fallback:
            threshold, release = 0.35, 0.2
            self._set_keyboard_key("W", self.left_stick["y"] > threshold)
            self._set_keyboard_key("S", self.left_stick["y"] < -threshold)
            self._set_keyboard_key("A", self.left_stick["x"] < -threshold)
            self._set_keyboard_key("D", self.left_stick["x"] > threshold)
            if abs(self.left_stick["y"]) < release:
                self._set_keyboard_key("W", False)
                self._set_keyboard_key("S", False)
            if abs(self.left_stick["x"]) < release:
                self._set_keyboard_key("A", False)
                self._set_keyboard_key("D", False)

    def handle_right_stick(self, x: float, y: float) -> None:
        self.right_stick["x"] = max(-1.0, min(1.0, x))
        self.right_stick["y"] = max(-1.0, min(1.0, y))

    def handle_button(self, button: str, pressed: bool) -> None:
        if self.keyboard_fallback:
            key_name = BUTTON_KEYBOARD_MAP.get(button)
            if key_name:
                self._set_keyboard_key(key_name, pressed)
            return

        if button == "LT":
            self.gamepad.left_trigger(value=255 if pressed else 0)
            self.gamepad.update()
            return
        if button == "RT":
            self.gamepad.right_trigger(value=255 if pressed else 0)
            self.gamepad.update()
            return

        xbox_button = self.button_map.get(button)
        if xbox_button is not None:
            if pressed:
                self.gamepad.press_button(button=xbox_button)
            else:
                self.gamepad.release_button(button=xbox_button)
            self.gamepad.update()

    def handle_dpad(self, direction: str, pressed: bool) -> None:
        button = DPAD_TO_BUTTON.get(direction.lower())
        if button:
            self.handle_button(button, pressed)

    # ------------------------------------------------------------------
    # Direct mouse/keyboard control (phone "Keys & Mouse" trackpad mode)
    # ------------------------------------------------------------------
    def handle_mouse_move(self, dx, dy) -> None:
        if self.mouse is None:
            return
        try:
            dx, dy = int(dx), int(dy)
        except (TypeError, ValueError):
            return
        if dx or dy:
            try:
                self.mouse.move(dx, dy)
            except Exception:
                pass

    def handle_mouse_absolute(self, x, y) -> None:
        """Place the host cursor at normalized coordinates from the browser.

        Unlike relative browser movement, this remains accurate at the edge of
        a fullscreen window and is independent of the streamed encode size.
        """
        if self.mouse is None:
            return
        try:
            x = max(0.0, min(1.0, float(x)))
            y = max(0.0, min(1.0, float(y)))
        except (TypeError, ValueError):
            return

        if self._mouse_region is None:
            self._mouse_region = get_monitor_geometry(settings.monitor_index)

        if self._mouse_region is not None:
            startx, starty, endx, endy = self._mouse_region
            target_x = round(startx + x * (endx - startx))
            target_y = round(starty + y * (endy - starty))
        else:
            # Best-effort fallback for platforms without X11 monitor geometry.
            target_x = round(x * max(1, settings.video_width - 1))
            target_y = round(y * max(1, settings.video_height - 1))

        try:
            self.mouse.position = (target_x, target_y)
        except Exception as exc:
            logger.debug("Absolute mouse move error: %s", exc)

    def handle_mouse_button(self, button, pressed: bool) -> None:
        if self.mouse is None:
            return
        mouse_button = MOUSE_BUTTONS.get(str(button).lower())
        if mouse_button is None:
            return
        try:
            if pressed:
                self.mouse.press(mouse_button)
                self.mouse_buttons_down.add(mouse_button)
            else:
                self.mouse.release(mouse_button)
                self.mouse_buttons_down.discard(mouse_button)
        except Exception as exc:
            logger.debug("Mouse button error: %s", exc)

    def handle_mouse_scroll(self, dx, dy) -> None:
        if self.mouse is None:
            return
        try:
            dx, dy = int(dx), int(dy)
        except (TypeError, ValueError):
            return
        if dx or dy:
            try:
                self.mouse.scroll(dx, dy)
            except Exception:
                pass

    def handle_key(self, key, pressed: bool) -> None:
        if isinstance(key, str) and key:
            self._set_keyboard_key(key, bool(pressed))

    def handle_text(self, text) -> None:
        if self.keyboard is None:
            return
        if isinstance(text, str) and text:
            try:
                self.keyboard.type(text[:200])
            except Exception as exc:
                logger.debug("Text type error: %s", exc)

    def set_sensitivity(self, value) -> int:
        """Set camera/mouse sensitivity at runtime (clamped 1-100)."""
        try:
            sensitivity = int(value)
        except (TypeError, ValueError):
            return self.mouse_sensitivity
        self.mouse_sensitivity = max(1, min(100, sensitivity))
        logger.info("Mouse sensitivity set to %d", self.mouse_sensitivity)
        return self.mouse_sensitivity

    def reset(self) -> None:
        """Return everything to neutral (called on client disconnect)."""
        self.left_stick = {"x": 0.0, "y": 0.0}
        self.right_stick = {"x": 0.0, "y": 0.0}
        self._release_all_keys()
        if self.mouse is not None:
            for mouse_button in list(self.mouse_buttons_down):
                try:
                    self.mouse.release(mouse_button)
                except Exception:
                    pass
        self.mouse_buttons_down.clear()
        if self.gamepad is not None:
            self.gamepad.reset()
            self.gamepad.update()


gamepad_service = GamepadService()
