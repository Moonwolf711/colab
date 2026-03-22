"""Ableton CLI - MIDI note manipulation module.

Get and set MIDI notes within clips via AbletonOSC.

OSC Reference:
  /live/clip/get/notes <track_idx> <clip_idx>
    Response: series of (pitch, start_time, duration, velocity, mute) tuples

  /live/clip/add/notes <t> <c> <pitch> <start> <dur> <vel> <mute>
    Adds a single MIDI note to the clip.

  /live/clip/remove/notes <t> <c> <start> <span> <pitch_lo> <pitch_hi>
    Removes notes in the given time range and pitch range.
"""

import json
from typing import Any, Dict, List, Optional, Tuple

from cli_anything.ableton.core.session import Session


def get_notes(
    session: Session, track_index: int, clip_index: int
) -> Dict[str, Any]:
    """Get all MIDI notes in a clip.

    Returns a dict with the note list. Each note is:
      {pitch, start, duration, velocity, mute}

    AbletonOSC returns notes as a flat list of values:
      [pitch1, start1, dur1, vel1, mute1, pitch2, start2, ...]
    We parse these into structured note dicts.
    """
    result = session.query(
        "/live/clip/get/notes", track_index, clip_index, timeout=10.0
    )

    notes = _parse_notes(result)
    return {
        "track_index": track_index,
        "clip_index": clip_index,
        "note_count": len(notes),
        "notes": notes,
    }


def add_note(
    session: Session,
    track_index: int,
    clip_index: int,
    pitch: int,
    start: float,
    duration: float,
    velocity: int = 100,
    mute: bool = False,
) -> Dict[str, Any]:
    """Add a single MIDI note to a clip.

    Args:
        track_index: 0-based track index.
        clip_index: 0-based clip slot index.
        pitch: MIDI pitch (0-127).
        start: Start time in beats.
        duration: Duration in beats.
        velocity: Note velocity (0-127).
        mute: Whether the note is muted.

    Returns:
        Dict confirming the added note.
    """
    if pitch < 0 or pitch > 127:
        raise ValueError(f"MIDI pitch must be 0-127, got {pitch}")
    if velocity < 0 or velocity > 127:
        raise ValueError(f"Velocity must be 0-127, got {velocity}")
    if duration <= 0:
        raise ValueError(f"Duration must be positive, got {duration}")

    session.send_message(
        "/live/clip/add/notes",
        track_index,
        clip_index,
        int(pitch),
        float(start),
        float(duration),
        int(velocity),
        int(mute),
    )
    return {
        "action": "add_note",
        "track_index": track_index,
        "clip_index": clip_index,
        "note": {
            "pitch": pitch,
            "start": start,
            "duration": duration,
            "velocity": velocity,
            "mute": mute,
        },
    }


def add_notes(
    session: Session,
    track_index: int,
    clip_index: int,
    notes: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Add multiple MIDI notes to a clip.

    Args:
        notes: List of note dicts, each with keys:
            pitch (int), start (float), duration (float),
            velocity (int, default 100), mute (bool, default False).

    Returns:
        Dict with count of added notes.
    """
    added = 0
    for note in notes:
        pitch = int(note["pitch"])
        start = float(note["start"])
        duration = float(note["duration"])
        velocity = int(note.get("velocity", 100))
        mute = bool(note.get("mute", False))

        add_note(
            session, track_index, clip_index,
            pitch, start, duration, velocity, mute,
        )
        added += 1

    return {
        "action": "add_notes",
        "track_index": track_index,
        "clip_index": clip_index,
        "notes_added": added,
    }


def remove_notes(
    session: Session,
    track_index: int,
    clip_index: int,
    start: float = 0.0,
    span: float = 9999.0,
    pitch_lo: int = 0,
    pitch_hi: int = 127,
) -> Dict[str, Any]:
    """Remove MIDI notes from a clip within a time/pitch range.

    Args:
        start: Start of the time range in beats.
        span: Length of the time range in beats.
        pitch_lo: Lowest pitch to remove (inclusive).
        pitch_hi: Highest pitch to remove (inclusive).

    Returns:
        Dict confirming the removal parameters.
    """
    session.send_message(
        "/live/clip/remove/notes",
        track_index,
        clip_index,
        float(start),
        float(span),
        int(pitch_lo),
        int(pitch_hi),
    )
    return {
        "action": "remove_notes",
        "track_index": track_index,
        "clip_index": clip_index,
        "range": {
            "start": start,
            "span": span,
            "pitch_lo": pitch_lo,
            "pitch_hi": pitch_hi,
        },
    }


def clear_notes(
    session: Session, track_index: int, clip_index: int
) -> Dict[str, Any]:
    """Remove all MIDI notes from a clip (convenience wrapper)."""
    return remove_notes(session, track_index, clip_index)


def set_notes(
    session: Session,
    track_index: int,
    clip_index: int,
    notes: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Replace all notes in a clip with the given list.

    Clears existing notes then adds the new ones.
    """
    clear_notes(session, track_index, clip_index)
    result = add_notes(session, track_index, clip_index, notes)
    result["action"] = "set_notes"
    return result


def set_notes_from_json(
    session: Session,
    track_index: int,
    clip_index: int,
    json_str: str,
) -> Dict[str, Any]:
    """Replace all notes from a JSON string.

    JSON format: [{"pitch": 60, "start": 0.0, "duration": 1.0, "velocity": 100}, ...]
    """
    notes = json.loads(json_str)
    if not isinstance(notes, list):
        raise ValueError("JSON must be a list of note objects")
    return set_notes(session, track_index, clip_index, notes)


def _parse_notes(result: tuple) -> List[Dict[str, Any]]:
    """Parse the flat OSC note response into structured note dicts.

    AbletonOSC returns notes as a flat sequence of values after the
    track and clip indices. Each note is 5 consecutive values:
      pitch (int), start (float), duration (float), velocity (int), mute (int)

    Some versions of AbletonOSC prepend the track and clip index to
    the response. We detect and skip those.
    """
    if not result:
        return []

    # Convert to list for easier manipulation
    values = list(result)

    # Skip the first 2 values if they look like track/clip indices
    # (AbletonOSC typically echoes them back)
    if len(values) >= 2:
        # Heuristic: if values[0] and values[1] are small ints and
        # the remaining count is divisible by 5, skip them
        remaining = len(values) - 2
        if remaining >= 0 and remaining % 5 == 0:
            values = values[2:]
        elif len(values) % 5 == 0:
            pass  # No prefix to skip
        else:
            # Try skipping 2 anyway
            if remaining > 0 and remaining % 5 == 0:
                values = values[2:]

    notes = []
    for i in range(0, len(values), 5):
        if i + 4 < len(values):
            notes.append({
                "pitch": int(values[i]),
                "start": float(values[i + 1]),
                "duration": float(values[i + 2]),
                "velocity": int(values[i + 3]),
                "mute": bool(int(values[i + 4])),
            })

    return notes
