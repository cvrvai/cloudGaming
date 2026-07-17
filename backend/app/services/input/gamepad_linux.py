"""Linux virtual Xbox 360 controller via /dev/uinput.

Duck-types the small subset of vgamepad.VX360Gamepad's API that
GamepadService uses, so gamepad.py doesn't need platform branches beyond
picking which backend to instantiate.

Requires read/write access to /dev/uinput (membership in the `input` group
plus a udev rule - see backend/README.md "Linux setup").
"""
from __future__ import annotations

import uinput

_AXIS_MIN, _AXIS_MAX = -32768, 32767
_TRIGGER_MIN, _TRIGGER_MAX = 0, 255


class Button:
    """Sentinels passed to press_button/release_button."""

    A = uinput.BTN_SOUTH
    B = uinput.BTN_EAST
    X = uinput.BTN_WEST
    Y = uinput.BTN_NORTH
    LB = uinput.BTN_TL
    RB = uinput.BTN_TR
    START = uinput.BTN_START
    BACK = uinput.BTN_SELECT
    # No real evdev button code for these - real Xbox 360 pads report the
    # d-pad as a hat switch, handled specially in _set_button below.
    DPAD_UP = "DPAD_UP"
    DPAD_DOWN = "DPAD_DOWN"
    DPAD_LEFT = "DPAD_LEFT"
    DPAD_RIGHT = "DPAD_RIGHT"


_DPAD_KEYS = {
    Button.DPAD_UP: "up",
    Button.DPAD_DOWN: "down",
    Button.DPAD_LEFT: "left",
    Button.DPAD_RIGHT: "right",
}

_EVENTS = (
    Button.A,
    Button.B,
    Button.X,
    Button.Y,
    Button.LB,
    Button.RB,
    Button.START,
    Button.BACK,
    uinput.ABS_X + (_AXIS_MIN, _AXIS_MAX, 0, 0),
    uinput.ABS_Y + (_AXIS_MIN, _AXIS_MAX, 0, 0),
    uinput.ABS_RX + (_AXIS_MIN, _AXIS_MAX, 0, 0),
    uinput.ABS_RY + (_AXIS_MIN, _AXIS_MAX, 0, 0),
    uinput.ABS_Z + (_TRIGGER_MIN, _TRIGGER_MAX, 0, 0),
    uinput.ABS_RZ + (_TRIGGER_MIN, _TRIGGER_MAX, 0, 0),
    uinput.ABS_HAT0X + (-1, 1, 0, 0),
    uinput.ABS_HAT0Y + (-1, 1, 0, 0),
)


class LinuxVirtualGamepad:
    def __init__(self) -> None:
        # vendor/product match a real Xbox 360 pad so SDL/games recognize
        # the standard button layout automatically.
        self.device = uinput.Device(
            _EVENTS, name="Microsoft X-Box 360 pad", vendor=0x045E, product=0x028E
        )
        self._dpad_state = {"up": False, "down": False, "left": False, "right": False}

    def left_joystick_float(self, x_value_float: float, y_value_float: float) -> None:
        self.device.emit(uinput.ABS_X, self._scale_axis(x_value_float), syn=False)
        self.device.emit(uinput.ABS_Y, self._scale_axis(-y_value_float))

    def right_joystick_float(self, x_value_float: float, y_value_float: float) -> None:
        self.device.emit(uinput.ABS_RX, self._scale_axis(x_value_float), syn=False)
        self.device.emit(uinput.ABS_RY, self._scale_axis(-y_value_float))

    def left_trigger(self, value: int) -> None:
        self.device.emit(uinput.ABS_Z, max(0, min(255, int(value))))

    def right_trigger(self, value: int) -> None:
        self.device.emit(uinput.ABS_RZ, max(0, min(255, int(value))))

    def press_button(self, button) -> None:
        self._set_button(button, True)

    def release_button(self, button) -> None:
        self._set_button(button, False)

    def update(self) -> None:
        """No-op: each setter already flushes a SYN_REPORT."""

    def reset(self) -> None:
        for axis in (uinput.ABS_X, uinput.ABS_Y, uinput.ABS_RX, uinput.ABS_RY, uinput.ABS_Z, uinput.ABS_RZ):
            self.device.emit(axis, 0, syn=False)
        for button in (Button.A, Button.B, Button.X, Button.Y, Button.LB, Button.RB, Button.START, Button.BACK):
            self.device.emit(button, 0, syn=False)
        self._dpad_state = {"up": False, "down": False, "left": False, "right": False}
        self.device.emit(uinput.ABS_HAT0X, 0, syn=False)
        self.device.emit(uinput.ABS_HAT0Y, 0)

    # ------------------------------------------------------------------
    def _scale_axis(self, value: float) -> int:
        value = max(-1.0, min(1.0, value))
        return int(round(value * (_AXIS_MAX if value >= 0 else -_AXIS_MIN)))

    def _set_button(self, button, pressed: bool) -> None:
        dpad_key = _DPAD_KEYS.get(button)
        if dpad_key is not None:
            self._dpad_state[dpad_key] = pressed
            hat_x = (-1 if self._dpad_state["left"] else 0) + (1 if self._dpad_state["right"] else 0)
            hat_y = (-1 if self._dpad_state["up"] else 0) + (1 if self._dpad_state["down"] else 0)
            self.device.emit(uinput.ABS_HAT0X, hat_x, syn=False)
            self.device.emit(uinput.ABS_HAT0Y, hat_y)
            return
        self.device.emit(button, 1 if pressed else 0)
