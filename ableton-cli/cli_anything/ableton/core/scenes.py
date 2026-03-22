"""Ableton CLI - Scene management module.

List, fire, and configure scenes in the Session View.

OSC Reference:
  /live/song/get/num_scenes
  /live/scene/fire <scene_idx>
  /live/scene/get/name <scene_idx>
  /live/scene/set/name <scene_idx> <name>
  /live/scene/get/tempo <scene_idx>
  /live/scene/set/tempo <scene_idx> <bpm>
  /live/scene/get/color <scene_idx>
  /live/scene/set/color <scene_idx> <color>
"""

from typing import Any, Dict, List, Optional

from cli_anything.ableton.core.session import Session, AbletonOSCError


def get_scene_count(session: Session) -> int:
    """Get the number of scenes in the Live set."""
    result = session.query("/live/song/get/num_scenes")
    return int(result[0]) if result else 0


def list_scenes(session: Session) -> List[Dict[str, Any]]:
    """List all scenes with their names and properties."""
    count = get_scene_count(session)
    scenes = []
    for i in range(count):
        scene = get_scene(session, i)
        scenes.append(scene)
    return scenes


def get_scene(session: Session, scene_index: int) -> Dict[str, Any]:
    """Get detailed info for a single scene.

    Args:
        scene_index: 0-based scene index.

    Returns:
        Dict with scene properties.
    """
    name_r = session.query("/live/scene/get/name", scene_index)
    color_r = session.query("/live/scene/get/color", scene_index)

    # Scene tempo may not always be set (returns 0 if not)
    try:
        tempo_r = session.query("/live/scene/get/tempo", scene_index)
        tempo = _extract_float(tempo_r, skip=1)
    except AbletonOSCError:
        tempo = None

    return {
        "index": scene_index,
        "name": _extract_str(name_r, skip=1),
        "color": _extract_int(color_r, skip=1),
        "tempo": tempo,
    }


def fire_scene(session: Session, scene_index: int) -> Dict[str, Any]:
    """Fire (launch) an entire scene.

    Launches all clips in the scene's row across all tracks.
    """
    session.send_message("/live/scene/fire", scene_index)
    return {"action": "fire", "scene_index": scene_index}


def set_scene_name(
    session: Session, scene_index: int, name: str
) -> Dict[str, Any]:
    """Set the name of a scene."""
    session.send_message("/live/scene/set/name", scene_index, name)
    return {"scene_index": scene_index, "name": name}


def set_scene_tempo(
    session: Session, scene_index: int, tempo: float
) -> Dict[str, Any]:
    """Set the tempo of a scene (tempo change on scene launch)."""
    if tempo < 20.0 or tempo > 999.0:
        raise ValueError(f"Scene tempo must be between 20.0 and 999.0, got {tempo}")
    session.send_message("/live/scene/set/tempo", scene_index, float(tempo))
    return {"scene_index": scene_index, "tempo": tempo}


def set_scene_color(
    session: Session, scene_index: int, color: int
) -> Dict[str, Any]:
    """Set the color of a scene."""
    session.send_message("/live/scene/set/color", scene_index, color)
    return {"scene_index": scene_index, "color": color}


# -- Helpers --

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
