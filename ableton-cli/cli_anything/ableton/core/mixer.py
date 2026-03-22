"""Ableton CLI - Mixer module.

Volume, panning, mute, solo, and send controls for tracks.

OSC Reference:
  /live/track/get/volume <track_idx>
  /live/track/set/volume <track_idx> <vol>
  /live/track/get/panning <track_idx>
  /live/track/set/panning <track_idx> <pan>
  /live/track/get/mute <track_idx>
  /live/track/set/mute <track_idx> <0|1>
  /live/track/get/solo <track_idx>
  /live/track/set/solo <track_idx> <0|1>
  /live/track/get/send <track_idx> <send_idx>
  /live/track/set/send <track_idx> <send_idx> <val>
  /live/song/get/master_volume
  /live/song/set/master_volume <0.0-1.0>
"""

from typing import Any, Dict, Optional

from cli_anything.ableton.core.session import Session


def get_volume(session: Session, track_index: int) -> Dict[str, Any]:
    """Get track volume (0.0 to 1.0, where 0.85 is 0 dB)."""
    result = session.query("/live/track/get/volume", track_index)
    return {
        "track_index": track_index,
        "volume": _extract_float(result, skip=1),
    }


def set_volume(
    session: Session, track_index: int, volume: float
) -> Dict[str, Any]:
    """Set track volume (0.0 to 1.0)."""
    if volume < 0.0 or volume > 1.0:
        raise ValueError(f"Volume must be between 0.0 and 1.0, got {volume}")
    session.send_message("/live/track/set/volume", track_index, float(volume))
    return {"track_index": track_index, "volume": volume}


def get_pan(session: Session, track_index: int) -> Dict[str, Any]:
    """Get track panning (-1.0 left to 1.0 right, 0.0 center)."""
    result = session.query("/live/track/get/panning", track_index)
    return {
        "track_index": track_index,
        "panning": _extract_float(result, skip=1),
    }


def set_pan(session: Session, track_index: int, pan: float) -> Dict[str, Any]:
    """Set track panning (-1.0 to 1.0)."""
    if pan < -1.0 or pan > 1.0:
        raise ValueError(f"Panning must be between -1.0 and 1.0, got {pan}")
    session.send_message("/live/track/set/panning", track_index, float(pan))
    return {"track_index": track_index, "panning": pan}


def get_mute(session: Session, track_index: int) -> Dict[str, Any]:
    """Get track mute state."""
    result = session.query("/live/track/get/mute", track_index)
    return {
        "track_index": track_index,
        "mute": _extract_bool(result, skip=1),
    }


def set_mute(
    session: Session, track_index: int, mute: bool
) -> Dict[str, Any]:
    """Set track mute state."""
    session.send_message("/live/track/set/mute", track_index, int(mute))
    return {"track_index": track_index, "mute": mute}


def get_solo(session: Session, track_index: int) -> Dict[str, Any]:
    """Get track solo state."""
    result = session.query("/live/track/get/solo", track_index)
    return {
        "track_index": track_index,
        "solo": _extract_bool(result, skip=1),
    }


def set_solo(
    session: Session, track_index: int, solo: bool
) -> Dict[str, Any]:
    """Set track solo state."""
    session.send_message("/live/track/set/solo", track_index, int(solo))
    return {"track_index": track_index, "solo": solo}


def get_send(
    session: Session, track_index: int, send_index: int
) -> Dict[str, Any]:
    """Get the level of a send on a track."""
    result = session.query("/live/track/get/send", track_index, send_index)
    return {
        "track_index": track_index,
        "send_index": send_index,
        "send_level": _extract_float(result, skip=2),
    }


def set_send(
    session: Session, track_index: int, send_index: int, level: float
) -> Dict[str, Any]:
    """Set the level of a send on a track."""
    if level < 0.0 or level > 1.0:
        raise ValueError(f"Send level must be between 0.0 and 1.0, got {level}")
    session.send_message(
        "/live/track/set/send", track_index, send_index, float(level)
    )
    return {
        "track_index": track_index,
        "send_index": send_index,
        "send_level": level,
    }


def get_arm(session: Session, track_index: int) -> Dict[str, Any]:
    """Get track arm (record-enable) state."""
    result = session.query("/live/track/get/arm", track_index)
    return {
        "track_index": track_index,
        "arm": _extract_bool(result, skip=1),
    }


def set_arm(
    session: Session, track_index: int, arm: bool
) -> Dict[str, Any]:
    """Set track arm (record-enable) state."""
    session.send_message("/live/track/set/arm", track_index, int(arm))
    return {"track_index": track_index, "arm": arm}


def get_mixer_snapshot(session: Session, track_index: int) -> Dict[str, Any]:
    """Get a full mixer snapshot for a track (volume, pan, mute, solo, arm)."""
    vol_r = session.query("/live/track/get/volume", track_index)
    pan_r = session.query("/live/track/get/panning", track_index)
    mute_r = session.query("/live/track/get/mute", track_index)
    solo_r = session.query("/live/track/get/solo", track_index)
    arm_r = session.query("/live/track/get/arm", track_index)

    return {
        "track_index": track_index,
        "volume": _extract_float(vol_r, skip=1),
        "panning": _extract_float(pan_r, skip=1),
        "mute": _extract_bool(mute_r, skip=1),
        "solo": _extract_bool(solo_r, skip=1),
        "arm": _extract_bool(arm_r, skip=1),
    }


# -- Helpers --

def _extract_float(result: tuple, skip: int = 0) -> Optional[float]:
    if result and len(result) > skip:
        try:
            return float(result[skip])
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
