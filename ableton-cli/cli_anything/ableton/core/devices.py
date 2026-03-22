"""Ableton CLI - Device and parameter management module.

List devices on tracks, query and set device parameters.

OSC Reference:
  /live/device/get/name <t> <d>
  /live/device/get/class_name <t> <d>
  /live/device/get/type <t> <d>
  /live/device/get/num_parameters <t> <d>
  /live/device/get/parameters/name <t> <d>
  /live/device/get/parameters/value <t> <d>
  /live/device/get/parameters/min <t> <d>
  /live/device/get/parameters/max <t> <d>
  /live/device/get/parameter/value <t> <d> <p>
  /live/device/set/parameter/value <t> <d> <p> <val>
  /live/device/get/parameter/name <t> <d> <p>
  /live/device/get/is_active <t> <d>
  /live/device/set/is_active <t> <d> <0|1>
"""

from typing import Any, Dict, List, Optional

from cli_anything.ableton.core.session import Session, AbletonOSCError


def list_devices(session: Session, track_index: int) -> List[Dict[str, Any]]:
    """List all devices on a track.

    Iterates device indices until we get an error (no more devices).
    """
    devices = []
    for d_idx in range(64):  # reasonable upper bound
        try:
            name_r = session.query(
                "/live/device/get/name", track_index, d_idx, timeout=1.5
            )
            name = _extract(name_r, skip=2)
            if name is None:
                break

            class_r = session.query(
                "/live/device/get/class_name", track_index, d_idx, timeout=1.5
            )
            type_r = session.query(
                "/live/device/get/type", track_index, d_idx, timeout=1.5
            )
            active_r = session.query(
                "/live/device/get/is_active", track_index, d_idx, timeout=1.5
            )
            num_params_r = session.query(
                "/live/device/get/num_parameters", track_index, d_idx, timeout=1.5
            )

            devices.append({
                "track_index": track_index,
                "device_index": d_idx,
                "name": str(name),
                "class_name": _extract_str(class_r, skip=2),
                "type": _extract_int(type_r, skip=2),
                "is_active": _extract_bool(active_r, skip=2),
                "num_parameters": _extract_int(num_params_r, skip=2),
            })
        except AbletonOSCError:
            break
    return devices


def get_device(
    session: Session, track_index: int, device_index: int
) -> Dict[str, Any]:
    """Get detailed info for a single device."""
    name_r = session.query("/live/device/get/name", track_index, device_index)
    class_r = session.query("/live/device/get/class_name", track_index, device_index)
    type_r = session.query("/live/device/get/type", track_index, device_index)
    active_r = session.query("/live/device/get/is_active", track_index, device_index)
    num_params_r = session.query(
        "/live/device/get/num_parameters", track_index, device_index
    )

    return {
        "track_index": track_index,
        "device_index": device_index,
        "name": _extract_str(name_r, skip=2),
        "class_name": _extract_str(class_r, skip=2),
        "type": _extract_int(type_r, skip=2),
        "is_active": _extract_bool(active_r, skip=2),
        "num_parameters": _extract_int(num_params_r, skip=2),
    }


def list_parameters(
    session: Session, track_index: int, device_index: int
) -> List[Dict[str, Any]]:
    """List all parameters of a device with names, values, min, max.

    Uses the bulk query endpoints that return all parameter data at once.
    """
    names_r = session.query(
        "/live/device/get/parameters/name", track_index, device_index, timeout=5.0
    )
    values_r = session.query(
        "/live/device/get/parameters/value", track_index, device_index, timeout=5.0
    )
    mins_r = session.query(
        "/live/device/get/parameters/min", track_index, device_index, timeout=5.0
    )
    maxs_r = session.query(
        "/live/device/get/parameters/max", track_index, device_index, timeout=5.0
    )

    # AbletonOSC returns these as flat lists after the track/device indices.
    # Skip the first 2 elements (track_idx, device_idx).
    names = _extract_list(names_r, skip=2)
    values = _extract_list(values_r, skip=2)
    mins = _extract_list(mins_r, skip=2)
    maxs = _extract_list(maxs_r, skip=2)

    params = []
    count = max(len(names), len(values))
    for i in range(count):
        params.append({
            "index": i,
            "name": str(names[i]) if i < len(names) else None,
            "value": float(values[i]) if i < len(values) else None,
            "min": float(mins[i]) if i < len(mins) else None,
            "max": float(maxs[i]) if i < len(maxs) else None,
        })

    return params


def get_parameter(
    session: Session, track_index: int, device_index: int, param_index: int
) -> Dict[str, Any]:
    """Get a single parameter's name and value."""
    name_r = session.query(
        "/live/device/get/parameter/name", track_index, device_index, param_index
    )
    value_r = session.query(
        "/live/device/get/parameter/value", track_index, device_index, param_index
    )

    return {
        "track_index": track_index,
        "device_index": device_index,
        "param_index": param_index,
        "name": _extract_str(name_r, skip=3),
        "value": _extract_float(value_r, skip=3),
    }


def set_parameter(
    session: Session,
    track_index: int,
    device_index: int,
    param_index: int,
    value: float,
) -> Dict[str, Any]:
    """Set a device parameter value."""
    session.send_message(
        "/live/device/set/parameter/value",
        track_index,
        device_index,
        param_index,
        float(value),
    )
    return {
        "track_index": track_index,
        "device_index": device_index,
        "param_index": param_index,
        "value": value,
    }


def set_device_active(
    session: Session, track_index: int, device_index: int, active: bool
) -> Dict[str, Any]:
    """Enable or disable a device."""
    session.send_message(
        "/live/device/set/is_active", track_index, device_index, int(active)
    )
    return {
        "track_index": track_index,
        "device_index": device_index,
        "is_active": active,
    }


# -- Helpers --

def _extract(result: tuple, skip: int = 0):
    if result and len(result) > skip:
        return result[skip]
    return None


def _extract_str(result: tuple, skip: int = 0) -> Optional[str]:
    if result and len(result) > skip:
        return str(result[skip])
    return None


def _extract_float(result: tuple, skip: int = 0) -> Optional[float]:
    if result and len(result) > skip:
        try:
            return float(result[skip])
        except (ValueError, TypeError):
            return None
    return None


def _extract_int(result: tuple, skip: int = 0) -> Optional[int]:
    if result and len(result) > skip:
        try:
            return int(result[skip])
        except (ValueError, TypeError):
            return None
    return None


def _extract_bool(result: tuple, skip: int = 0) -> Optional[bool]:
    if result and len(result) > skip:
        try:
            return bool(int(result[skip]))
        except (ValueError, TypeError):
            return None
    return None


def _extract_list(result: tuple, skip: int = 0) -> list:
    """Extract a list of values from an OSC response, skipping prefix elements."""
    if result and len(result) > skip:
        return list(result[skip:])
    return []
