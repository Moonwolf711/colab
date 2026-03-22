"""Ableton CLI - Clip management module.

Manage clips in the Session View: fire, stop, query properties,
and manipulate clip slots.

OSC Reference:
  /live/clip/fire <track_idx> <clip_idx>
  /live/clip/stop <track_idx> <clip_idx>
  /live/clip_slot/fire <track_idx> <slot_idx>
  /live/clip/get/name <t> <c>
  /live/clip/set/name <t> <c> <name>
  /live/clip/get/color <t> <c>
  /live/clip/set/color <t> <c> <color>
  /live/clip/get/length <t> <c>
  /live/clip/set/length <t> <c> <beats>
  /live/clip/get/playing_position <t> <c>
  /live/clip/get/is_playing <t> <c>
  /live/clip/get/is_recording <t> <c>
  /live/clip/get/is_triggered <t> <c>
  /live/clip/get/looping <t> <c>
  /live/clip/set/looping <t> <c> <0|1>
  /live/clip/get/loop_start <t> <c>
  /live/clip/set/loop_start <t> <c> <beats>
  /live/clip/get/loop_end <t> <c>
  /live/clip/set/loop_end <t> <c> <beats>
  /live/clip/get/gain <t> <c>
  /live/clip/set/gain <t> <c> <gain>
  /live/clip/get/pitch_coarse <t> <c>
  /live/clip/set/pitch_coarse <t> <c> <semi>
  /live/clip/get/pitch_fine <t> <c>
  /live/clip/set/pitch_fine <t> <c> <cents>
  /live/clip/get/warping <t> <c>
  /live/clip/set/warping <t> <c> <0|1>
  /live/clip/get/warp_mode <t> <c>
"""

from typing import Any, Dict, List, Optional

from cli_anything.ableton.core.session import Session, AbletonOSCError


def _extract(result: tuple, skip: int = 2):
    """Extract the value from an OSC response, skipping track/clip indices."""
    if result and len(result) > skip:
        return result[skip]
    return None


def list_clips(session: Session, track_index: int) -> List[Dict[str, Any]]:
    """List all clips on a track.

    Iterates clip slots on the given track and returns info for
    each slot that contains a clip. We query up to 128 slots
    (Ableton's default scene limit) and stop at the first error.
    """
    from cli_anything.ableton.core.scenes import get_scene_count

    num_scenes = get_scene_count(session)
    clips = []
    for slot_idx in range(num_scenes):
        try:
            name_r = session.query(
                "/live/clip/get/name", track_index, slot_idx, timeout=1.0
            )
            name = _extract(name_r)
            if name is None:
                continue
            # If we got a name, there is a clip here
            clips.append({
                "track_index": track_index,
                "clip_index": slot_idx,
                "name": str(name),
            })
        except AbletonOSCError:
            # No clip in this slot or invalid slot
            continue
    return clips


def get_clip(session: Session, track_index: int, clip_index: int) -> Dict[str, Any]:
    """Get detailed properties of a clip.

    Args:
        track_index: 0-based track index.
        clip_index: 0-based clip slot index.

    Returns:
        Dict with clip properties.
    """
    name_r = session.query("/live/clip/get/name", track_index, clip_index)
    length_r = session.query("/live/clip/get/length", track_index, clip_index)
    color_r = session.query("/live/clip/get/color", track_index, clip_index)
    playing_r = session.query("/live/clip/get/is_playing", track_index, clip_index)
    recording_r = session.query("/live/clip/get/is_recording", track_index, clip_index)
    triggered_r = session.query("/live/clip/get/is_triggered", track_index, clip_index)
    looping_r = session.query("/live/clip/get/looping", track_index, clip_index)
    loop_start_r = session.query("/live/clip/get/loop_start", track_index, clip_index)
    loop_end_r = session.query("/live/clip/get/loop_end", track_index, clip_index)

    return {
        "track_index": track_index,
        "clip_index": clip_index,
        "name": _extract_str(name_r),
        "length": _extract_float(length_r),
        "color": _extract_int(color_r),
        "is_playing": _extract_bool(playing_r),
        "is_recording": _extract_bool(recording_r),
        "is_triggered": _extract_bool(triggered_r),
        "looping": _extract_bool(looping_r),
        "loop_start": _extract_float(loop_start_r),
        "loop_end": _extract_float(loop_end_r),
    }


def fire_clip(session: Session, track_index: int, clip_index: int) -> Dict[str, Any]:
    """Fire (launch) a clip."""
    session.send_message("/live/clip/fire", track_index, clip_index)
    return {"action": "fire", "track_index": track_index, "clip_index": clip_index}


def stop_clip(session: Session, track_index: int, clip_index: int) -> Dict[str, Any]:
    """Stop a clip."""
    session.send_message("/live/clip/stop", track_index, clip_index)
    return {"action": "stop", "track_index": track_index, "clip_index": clip_index}


def fire_clip_slot(
    session: Session, track_index: int, slot_index: int
) -> Dict[str, Any]:
    """Fire a clip slot (launches clip if present, stops track if empty)."""
    session.send_message("/live/clip_slot/fire", track_index, slot_index)
    return {"action": "fire_slot", "track_index": track_index, "slot_index": slot_index}


def set_clip_name(
    session: Session, track_index: int, clip_index: int, name: str
) -> Dict[str, Any]:
    """Set the name of a clip."""
    session.send_message("/live/clip/set/name", track_index, clip_index, name)
    return {"track_index": track_index, "clip_index": clip_index, "name": name}


def set_clip_color(
    session: Session, track_index: int, clip_index: int, color: int
) -> Dict[str, Any]:
    """Set the color of a clip."""
    session.send_message("/live/clip/set/color", track_index, clip_index, color)
    return {"track_index": track_index, "clip_index": clip_index, "color": color}


def set_clip_length(
    session: Session, track_index: int, clip_index: int, length: float
) -> Dict[str, Any]:
    """Set the length of a clip in beats."""
    session.send_message("/live/clip/set/length", track_index, clip_index, float(length))
    return {"track_index": track_index, "clip_index": clip_index, "length": length}


def set_looping(
    session: Session, track_index: int, clip_index: int, looping: bool
) -> Dict[str, Any]:
    """Enable or disable looping on a clip."""
    session.send_message(
        "/live/clip/set/looping", track_index, clip_index, int(looping)
    )
    return {
        "track_index": track_index,
        "clip_index": clip_index,
        "looping": looping,
    }


def set_loop_start(
    session: Session, track_index: int, clip_index: int, beats: float
) -> Dict[str, Any]:
    """Set the loop start point."""
    session.send_message(
        "/live/clip/set/loop_start", track_index, clip_index, float(beats)
    )
    return {
        "track_index": track_index,
        "clip_index": clip_index,
        "loop_start": beats,
    }


def set_loop_end(
    session: Session, track_index: int, clip_index: int, beats: float
) -> Dict[str, Any]:
    """Set the loop end point."""
    session.send_message(
        "/live/clip/set/loop_end", track_index, clip_index, float(beats)
    )
    return {
        "track_index": track_index,
        "clip_index": clip_index,
        "loop_end": beats,
    }


def get_clip_gain(
    session: Session, track_index: int, clip_index: int
) -> Dict[str, Any]:
    """Get the gain of an audio clip."""
    result = session.query("/live/clip/get/gain", track_index, clip_index)
    return {
        "track_index": track_index,
        "clip_index": clip_index,
        "gain": _extract_float(result),
    }


def set_clip_gain(
    session: Session, track_index: int, clip_index: int, gain: float
) -> Dict[str, Any]:
    """Set the gain of an audio clip."""
    session.send_message("/live/clip/set/gain", track_index, clip_index, float(gain))
    return {
        "track_index": track_index,
        "clip_index": clip_index,
        "gain": gain,
    }


def get_clip_pitch(
    session: Session, track_index: int, clip_index: int
) -> Dict[str, Any]:
    """Get the pitch transpose of an audio clip."""
    coarse_r = session.query("/live/clip/get/pitch_coarse", track_index, clip_index)
    fine_r = session.query("/live/clip/get/pitch_fine", track_index, clip_index)
    return {
        "track_index": track_index,
        "clip_index": clip_index,
        "pitch_coarse": _extract_float(coarse_r),
        "pitch_fine": _extract_float(fine_r),
    }


def set_clip_pitch(
    session: Session,
    track_index: int,
    clip_index: int,
    coarse: Optional[int] = None,
    fine: Optional[float] = None,
) -> Dict[str, Any]:
    """Set the pitch transpose of an audio clip."""
    result = {"track_index": track_index, "clip_index": clip_index}
    if coarse is not None:
        session.send_message(
            "/live/clip/set/pitch_coarse", track_index, clip_index, int(coarse)
        )
        result["pitch_coarse"] = coarse
    if fine is not None:
        session.send_message(
            "/live/clip/set/pitch_fine", track_index, clip_index, float(fine)
        )
        result["pitch_fine"] = fine
    return result


def set_warping(
    session: Session, track_index: int, clip_index: int, warp: bool
) -> Dict[str, Any]:
    """Enable or disable warping on an audio clip."""
    session.send_message(
        "/live/clip/set/warping", track_index, clip_index, int(warp)
    )
    return {
        "track_index": track_index,
        "clip_index": clip_index,
        "warping": warp,
    }


def get_playing_position(
    session: Session, track_index: int, clip_index: int
) -> Dict[str, Any]:
    """Get the current playing position within a clip."""
    result = session.query(
        "/live/clip/get/playing_position", track_index, clip_index
    )
    return {
        "track_index": track_index,
        "clip_index": clip_index,
        "playing_position": _extract_float(result),
    }


# -- Helper extractors (skip 2 for track_idx + clip_idx in response) --

def _extract_str(result: tuple, skip: int = 2) -> Optional[str]:
    if result and len(result) > skip:
        return str(result[skip])
    return None


def _extract_float(result: tuple, skip: int = 2) -> Optional[float]:
    if result and len(result) > skip:
        try:
            return float(result[skip])
        except (ValueError, TypeError):
            return None
    return None


def _extract_int(result: tuple, skip: int = 2) -> Optional[int]:
    if result and len(result) > skip:
        try:
            return int(result[skip])
        except (ValueError, TypeError):
            return None
    return None


def _extract_bool(result: tuple, skip: int = 2) -> Optional[bool]:
    if result and len(result) > skip:
        try:
            return bool(int(result[skip]))
        except (ValueError, TypeError):
            return None
    return None
