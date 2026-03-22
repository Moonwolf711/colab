"""Ableton CLI - Transport control module.

Controls playback, recording, tempo, time signature, metronome,
looping, quantization, cue points, and undo/redo via AbletonOSC.

OSC Reference:
  /live/song/start_playing
  /live/song/stop_playing
  /live/song/continue_playing
  /live/song/get/tempo, /live/song/set/tempo
  /live/song/get/current_song_time, /live/song/set/current_song_time
  /live/song/get/record_mode, /live/song/set/record_mode
  /live/song/get/overdub, /live/song/set/overdub
  /live/song/get/metronome, /live/song/set/metronome
  /live/song/get/loop, /live/song/set/loop
  /live/song/get/loop_start, /live/song/set/loop_start
  /live/song/get/loop_length, /live/song/set/loop_length
  /live/song/undo, /live/song/redo
"""

from typing import Any, Dict, Optional

from cli_anything.ableton.core.session import Session


def play(session: Session) -> Dict[str, Any]:
    """Start playback from the current position."""
    session.send_message("/live/song/start_playing")
    return {"action": "play", "status": "playing"}


def stop(session: Session) -> Dict[str, Any]:
    """Stop playback."""
    session.send_message("/live/song/stop_playing")
    return {"action": "stop", "status": "stopped"}


def continue_playing(session: Session) -> Dict[str, Any]:
    """Continue playback from the current position."""
    session.send_message("/live/song/continue_playing")
    return {"action": "continue", "status": "playing"}


def stop_all_clips(session: Session) -> Dict[str, Any]:
    """Stop all playing clips."""
    session.send_message("/live/song/stop_all_clips")
    return {"action": "stop_all_clips"}


def record(session: Session, enable: Optional[bool] = None) -> Dict[str, Any]:
    """Get or set record mode.

    Args:
        enable: If None, query current state. Otherwise set True/False.
    """
    if enable is None:
        result = session.query("/live/song/get/record_mode")
        return {"record_mode": bool(result[0]) if result else None}
    else:
        session.send_message("/live/song/set/record_mode", int(enable))
        return {"record_mode": enable}


def overdub(session: Session, enable: Optional[bool] = None) -> Dict[str, Any]:
    """Get or set overdub mode."""
    if enable is None:
        result = session.query("/live/song/get/overdub")
        return {"overdub": bool(result[0]) if result else None}
    else:
        session.send_message("/live/song/set/overdub", int(enable))
        return {"overdub": enable}


def get_tempo(session: Session) -> Dict[str, Any]:
    """Query the current tempo."""
    result = session.query("/live/song/get/tempo")
    return {"tempo": result[0] if result else None}


def set_tempo(session: Session, bpm: float) -> Dict[str, Any]:
    """Set the tempo in BPM."""
    if bpm < 20.0 or bpm > 999.0:
        raise ValueError(f"Tempo must be between 20.0 and 999.0, got {bpm}")
    session.send_message("/live/song/set/tempo", float(bpm))
    return {"tempo": bpm}


def get_position(session: Session) -> Dict[str, Any]:
    """Get the current playback position in beats."""
    result = session.query("/live/song/get/current_song_time")
    return {"position_beats": result[0] if result else None}


def set_position(session: Session, beats: float) -> Dict[str, Any]:
    """Set the playback position in beats."""
    session.send_message("/live/song/set/current_song_time", float(beats))
    return {"position_beats": beats}


def get_time_signature(session: Session) -> Dict[str, Any]:
    """Get the time signature."""
    num_result = session.query("/live/song/get/signature_numerator")
    den_result = session.query("/live/song/get/signature_denominator")
    return {
        "numerator": int(num_result[0]) if num_result else None,
        "denominator": int(den_result[0]) if den_result else None,
    }


def set_time_signature(
    session: Session,
    numerator: Optional[int] = None,
    denominator: Optional[int] = None,
) -> Dict[str, Any]:
    """Set the time signature numerator and/or denominator."""
    result = {}
    if numerator is not None:
        session.send_message("/live/song/set/signature_numerator", int(numerator))
        result["numerator"] = numerator
    if denominator is not None:
        session.send_message("/live/song/set/signature_denominator", int(denominator))
        result["denominator"] = denominator
    return result


def metronome(session: Session, enable: Optional[bool] = None) -> Dict[str, Any]:
    """Get or set metronome state."""
    if enable is None:
        result = session.query("/live/song/get/metronome")
        return {"metronome": bool(result[0]) if result else None}
    else:
        session.send_message("/live/song/set/metronome", int(enable))
        return {"metronome": enable}


def loop(
    session: Session,
    enable: Optional[bool] = None,
    start: Optional[float] = None,
    length: Optional[float] = None,
) -> Dict[str, Any]:
    """Get or set loop state and boundaries."""
    result = {}

    if enable is not None:
        session.send_message("/live/song/set/loop", int(enable))
        result["loop"] = enable
    if start is not None:
        session.send_message("/live/song/set/loop_start", float(start))
        result["loop_start"] = start
    if length is not None:
        session.send_message("/live/song/set/loop_length", float(length))
        result["loop_length"] = length

    # If all None, query current state
    if enable is None and start is None and length is None:
        loop_result = session.query("/live/song/get/loop")
        start_result = session.query("/live/song/get/loop_start")
        length_result = session.query("/live/song/get/loop_length")
        result = {
            "loop": bool(loop_result[0]) if loop_result else None,
            "loop_start": start_result[0] if start_result else None,
            "loop_length": length_result[0] if length_result else None,
        }

    return result


def get_quantization(session: Session) -> Dict[str, Any]:
    """Get clip trigger and MIDI recording quantization."""
    clip_q = session.query("/live/song/get/clip_trigger_quantization")
    midi_q = session.query("/live/song/get/midi_recording_quantization")
    return {
        "clip_trigger_quantization": clip_q[0] if clip_q else None,
        "midi_recording_quantization": midi_q[0] if midi_q else None,
    }


def set_quantization(
    session: Session,
    clip_trigger: Optional[int] = None,
    midi_recording: Optional[int] = None,
) -> Dict[str, Any]:
    """Set clip trigger and/or MIDI recording quantization."""
    result = {}
    if clip_trigger is not None:
        session.send_message(
            "/live/song/set/clip_trigger_quantization", int(clip_trigger)
        )
        result["clip_trigger_quantization"] = clip_trigger
    if midi_recording is not None:
        session.send_message(
            "/live/song/set/midi_recording_quantization", int(midi_recording)
        )
        result["midi_recording_quantization"] = midi_recording
    return result


def undo(session: Session) -> Dict[str, Any]:
    """Undo the last action in Ableton Live."""
    session.send_message("/live/song/undo")
    return {"action": "undo"}


def redo(session: Session) -> Dict[str, Any]:
    """Redo the last undone action in Ableton Live."""
    session.send_message("/live/song/redo")
    return {"action": "redo"}


def jump_to_next_cue(session: Session) -> Dict[str, Any]:
    """Jump to the next cue point."""
    session.send_message("/live/song/jump_to_next_cue")
    return {"action": "jump_to_next_cue"}


def jump_to_prev_cue(session: Session) -> Dict[str, Any]:
    """Jump to the previous cue point."""
    session.send_message("/live/song/jump_to_prev_cue")
    return {"action": "jump_to_prev_cue"}


def jump_by_time(session: Session, seconds: float) -> Dict[str, Any]:
    """Jump by a time offset in seconds (can be negative)."""
    session.send_message("/live/song/jump_by_time", float(seconds))
    return {"action": "jump_by_time", "seconds": seconds}


def get_master_volume(session: Session) -> Dict[str, Any]:
    """Get the master volume level (0.0 to 1.0)."""
    result = session.query("/live/song/get/master_volume")
    return {"master_volume": result[0] if result else None}


def set_master_volume(session: Session, volume: float) -> Dict[str, Any]:
    """Set the master volume level (0.0 to 1.0)."""
    if volume < 0.0 or volume > 1.0:
        raise ValueError(f"Master volume must be between 0.0 and 1.0, got {volume}")
    session.send_message("/live/song/set/master_volume", float(volume))
    return {"master_volume": volume}


def get_full_status(session: Session) -> Dict[str, Any]:
    """Get a comprehensive transport status snapshot."""
    tempo = session.query("/live/song/get/tempo")
    position = session.query("/live/song/get/current_song_time")
    record = session.query("/live/song/get/record_mode")
    overdub_val = session.query("/live/song/get/overdub")
    metro = session.query("/live/song/get/metronome")
    loop_val = session.query("/live/song/get/loop")
    sig_num = session.query("/live/song/get/signature_numerator")
    sig_den = session.query("/live/song/get/signature_denominator")

    return {
        "tempo": tempo[0] if tempo else None,
        "position_beats": position[0] if position else None,
        "record_mode": bool(record[0]) if record else None,
        "overdub": bool(overdub_val[0]) if overdub_val else None,
        "metronome": bool(metro[0]) if metro else None,
        "loop": bool(loop_val[0]) if loop_val else None,
        "time_signature": {
            "numerator": int(sig_num[0]) if sig_num else None,
            "denominator": int(sig_den[0]) if sig_den else None,
        },
    }
