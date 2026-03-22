"""Ableton CLI - Track management module.

List, create, delete, rename, and query tracks in the Live set
via AbletonOSC.

OSC Reference:
  /live/song/get/num_tracks
  /live/track/get/name <track_idx>
  /live/track/set/name <track_idx> <name>
  /live/track/get/color <track_idx>
  /live/track/set/color <track_idx> <color_int>
  /live/track/get/arm <track_idx>
  /live/track/set/arm <track_idx> <0|1>
  /live/track/get/is_foldable <track_idx>
  /live/track/get/fold_state <track_idx>
  /live/track/set/fold_state <track_idx> <0|1>
  /live/track/get/current_monitoring_state <idx>
  /live/track/set/current_monitoring_state <idx> <v>

Note: AbletonOSC does not support creating/deleting tracks via OSC.
Those operations require the Live API (Max for Live). We expose
the query/mutation commands that AbletonOSC does support.
"""

from typing import Any, Dict, List, Optional

from cli_anything.ableton.core.session import Session


def get_track_count(session: Session) -> int:
    """Get the number of tracks in the Live set."""
    result = session.query("/live/song/get/num_tracks")
    return int(result[0]) if result else 0


def list_tracks(session: Session) -> List[Dict[str, Any]]:
    """List all tracks with their names and properties.

    Returns a list of dicts with index, name, color, mute, solo,
    volume, panning, arm state.
    """
    count = get_track_count(session)
    tracks = []
    for i in range(count):
        track = get_track(session, i)
        tracks.append(track)
    return tracks


def get_track(session: Session, track_index: int) -> Dict[str, Any]:
    """Get detailed info for a single track.

    Args:
        track_index: 0-based track index.

    Returns:
        Dict with track properties.
    """
    name_r = session.query("/live/track/get/name", track_index)
    vol_r = session.query("/live/track/get/volume", track_index)
    pan_r = session.query("/live/track/get/panning", track_index)
    mute_r = session.query("/live/track/get/mute", track_index)
    solo_r = session.query("/live/track/get/solo", track_index)
    arm_r = session.query("/live/track/get/arm", track_index)
    color_r = session.query("/live/track/get/color", track_index)

    return {
        "index": track_index,
        "name": _extract_str(name_r, skip=1),
        "volume": _extract_float(vol_r, skip=1),
        "panning": _extract_float(pan_r, skip=1),
        "mute": _extract_bool(mute_r, skip=1),
        "solo": _extract_bool(solo_r, skip=1),
        "arm": _extract_bool(arm_r, skip=1),
        "color": _extract_int(color_r, skip=1),
    }


def rename_track(session: Session, track_index: int, name: str) -> Dict[str, Any]:
    """Rename a track.

    Args:
        track_index: 0-based track index.
        name: New track name.
    """
    session.send_message("/live/track/set/name", track_index, name)
    return {"index": track_index, "name": name}


def set_arm(session: Session, track_index: int, arm: bool) -> Dict[str, Any]:
    """Arm or disarm a track for recording."""
    session.send_message("/live/track/set/arm", track_index, int(arm))
    return {"index": track_index, "arm": arm}


def set_color(session: Session, track_index: int, color: int) -> Dict[str, Any]:
    """Set the track color (integer color value)."""
    session.send_message("/live/track/set/color", track_index, color)
    return {"index": track_index, "color": color}


def get_fold_state(session: Session, track_index: int) -> Dict[str, Any]:
    """Get whether a group track is folded."""
    foldable_r = session.query("/live/track/get/is_foldable", track_index)
    fold_r = session.query("/live/track/get/fold_state", track_index)
    return {
        "index": track_index,
        "is_foldable": _extract_bool(foldable_r, skip=1),
        "fold_state": _extract_bool(fold_r, skip=1),
    }


def set_fold_state(session: Session, track_index: int, folded: bool) -> Dict[str, Any]:
    """Fold or unfold a group track."""
    session.send_message("/live/track/set/fold_state", track_index, int(folded))
    return {"index": track_index, "fold_state": folded}


def get_monitoring_state(session: Session, track_index: int) -> Dict[str, Any]:
    """Get the monitoring state of a track."""
    result = session.query(
        "/live/track/get/current_monitoring_state", track_index
    )
    return {
        "index": track_index,
        "monitoring_state": _extract_int(result, skip=1),
    }


def set_monitoring_state(
    session: Session, track_index: int, state: int
) -> Dict[str, Any]:
    """Set the monitoring state (0=In, 1=Auto, 2=Off)."""
    if state not in (0, 1, 2):
        raise ValueError(f"Monitoring state must be 0 (In), 1 (Auto), or 2 (Off), got {state}")
    session.send_message(
        "/live/track/set/current_monitoring_state", track_index, state
    )
    return {"index": track_index, "monitoring_state": state}


# -- Helper functions for parsing AbletonOSC responses --
# AbletonOSC responses typically include the track index as the first
# argument, followed by the actual value. The `skip` parameter tells
# us how many leading args to skip to get to the value.

def _extract_str(result: tuple, skip: int = 0) -> Optional[str]:
    """Extract a string value from an OSC response tuple."""
    if result and len(result) > skip:
        return str(result[skip])
    return None


def _extract_float(result: tuple, skip: int = 0) -> Optional[float]:
    """Extract a float value from an OSC response tuple."""
    if result and len(result) > skip:
        try:
            return float(result[skip])
        except (ValueError, TypeError):
            return None
    return None


def _extract_int(result: tuple, skip: int = 0) -> Optional[int]:
    """Extract an int value from an OSC response tuple."""
    if result and len(result) > skip:
        try:
            return int(result[skip])
        except (ValueError, TypeError):
            return None
    return None


def _extract_bool(result: tuple, skip: int = 0) -> Optional[bool]:
    """Extract a boolean value from an OSC response tuple."""
    if result and len(result) > skip:
        try:
            return bool(int(result[skip]))
        except (ValueError, TypeError):
            return None
    return None
