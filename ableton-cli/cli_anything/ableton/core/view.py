"""Ableton CLI - View module.

Query and control the selected track, scene, and clip in Ableton's
Session/Arrangement view.

AbletonOSC provides limited view-related commands. For richer view
control, the Live Object Model (LOM) paths are:
  live_set view selected_track
  live_set view selected_scene

We use the OSC track/scene enumeration combined with the Live API
view properties where AbletonOSC exposes them. Some view operations
require tracking state client-side since AbletonOSC does not expose
a direct "get selected track" endpoint -- we use the track/scene
listener mechanism or fall back to a cursor-based approach.

For full view control, a Max for Live device with the LOM is needed.
This module provides what is possible through pure OSC.
"""

from typing import Any, Dict, Optional

from cli_anything.ableton.core.session import Session, AbletonOSCError
from cli_anything.ableton.core import tracks as tracks_mod
from cli_anything.ableton.core import scenes as scenes_mod


# Client-side cursor state (since AbletonOSC has limited view queries)
_cursor_track: int = 0
_cursor_scene: int = 0


def get_selected_track() -> Dict[str, Any]:
    """Get the client-side selected track index.

    Note: This is the CLI's internal cursor, not necessarily synced
    with Ableton's actual selection unless explicitly set.
    """
    return {"selected_track": _cursor_track}


def set_selected_track(track_index: int) -> Dict[str, Any]:
    """Set the client-side selected track cursor."""
    global _cursor_track
    _cursor_track = track_index
    return {"selected_track": _cursor_track}


def get_selected_scene() -> Dict[str, Any]:
    """Get the client-side selected scene index."""
    return {"selected_scene": _cursor_scene}


def set_selected_scene(scene_index: int) -> Dict[str, Any]:
    """Set the client-side selected scene cursor."""
    global _cursor_scene
    _cursor_scene = scene_index
    return {"selected_scene": _cursor_scene}


def get_cursor(session: Session) -> Dict[str, Any]:
    """Get the full cursor state (selected track + scene) with info.

    Queries Ableton for the names of the currently selected track
    and scene.
    """
    result = {
        "selected_track": _cursor_track,
        "selected_scene": _cursor_scene,
    }

    try:
        track_info = tracks_mod.get_track(session, _cursor_track)
        result["track_name"] = track_info.get("name")
    except (AbletonOSCError, Exception):
        result["track_name"] = None

    try:
        scene_info = scenes_mod.get_scene(session, _cursor_scene)
        result["scene_name"] = scene_info.get("name")
    except (AbletonOSCError, Exception):
        result["scene_name"] = None

    return result


def move_cursor(
    session: Session,
    track_delta: int = 0,
    scene_delta: int = 0,
) -> Dict[str, Any]:
    """Move the cursor by relative offsets.

    Args:
        track_delta: Number of tracks to move (positive=right, negative=left).
        scene_delta: Number of scenes to move (positive=down, negative=up).

    Returns:
        Updated cursor state.
    """
    global _cursor_track, _cursor_scene

    if track_delta != 0:
        track_count = tracks_mod.get_track_count(session)
        new_track = _cursor_track + track_delta
        _cursor_track = max(0, min(new_track, track_count - 1))

    if scene_delta != 0:
        scene_count = scenes_mod.get_scene_count(session)
        new_scene = _cursor_scene + scene_delta
        _cursor_scene = max(0, min(new_scene, scene_count - 1))

    return get_cursor(session)


def get_session_overview(session: Session) -> Dict[str, Any]:
    """Get a high-level overview of the Live set.

    Returns track count, scene count, tempo, and the cursor position.
    """
    from cli_anything.ableton.core import transport as transport_mod

    track_count = tracks_mod.get_track_count(session)
    scene_count = scenes_mod.get_scene_count(session)
    tempo_info = transport_mod.get_tempo(session)

    return {
        "track_count": track_count,
        "scene_count": scene_count,
        "tempo": tempo_info.get("tempo"),
        "cursor": {
            "track": _cursor_track,
            "scene": _cursor_scene,
        },
    }
