#!/usr/bin/env python3
"""Ableton CLI -- Control Ableton Live via AbletonOSC from the command line.

This CLI communicates with Ableton Live through the AbletonOSC MIDI Remote
Script using OSC over UDP. Requires AbletonOSC installed in Ableton Live and
the python-osc (pythonosc) library.

Usage:
    # Connect and query
    ableton session connect
    ableton transport tempo
    ableton track list
    ableton clip fire 0 0

    # With JSON output
    ableton --json track list
    ableton --json transport status

    # Interactive REPL
    ableton repl
"""

import sys
import os
import json
import click
from typing import Optional

from cli_anything.ableton.core.session import Session, AbletonOSCError
from cli_anything.ableton.core import transport as transport_mod
from cli_anything.ableton.core import tracks as tracks_mod
from cli_anything.ableton.core import clips as clips_mod
from cli_anything.ableton.core import midi as midi_mod
from cli_anything.ableton.core import scenes as scenes_mod
from cli_anything.ableton.core import devices as devices_mod
from cli_anything.ableton.core import mixer as mixer_mod
from cli_anything.ableton.core import view as view_mod

# Global session state
_session: Optional[Session] = None
_json_output = False
_repl_mode = False


def get_session() -> Session:
    global _session
    if _session is None:
        _session = Session()
    return _session


def output(data, message: str = ""):
    """Print output in JSON or human-readable format."""
    if _json_output:
        click.echo(json.dumps(data, indent=2, default=str))
    else:
        if message:
            click.echo(message)
        if isinstance(data, dict):
            _print_dict(data)
        elif isinstance(data, list):
            _print_list(data)
        else:
            click.echo(str(data))


def _print_dict(d: dict, indent: int = 0):
    prefix = "  " * indent
    for k, v in d.items():
        if isinstance(v, dict):
            click.echo(f"{prefix}{k}:")
            _print_dict(v, indent + 1)
        elif isinstance(v, list):
            click.echo(f"{prefix}{k}:")
            _print_list(v, indent + 1)
        else:
            click.echo(f"{prefix}{k}: {v}")


def _print_list(items: list, indent: int = 0):
    prefix = "  " * indent
    for i, item in enumerate(items):
        if isinstance(item, dict):
            click.echo(f"{prefix}[{i}]")
            _print_dict(item, indent + 1)
        else:
            click.echo(f"{prefix}- {item}")


def handle_error(func):
    """Decorator that catches common errors and formats output."""
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except AbletonOSCError as e:
            if _json_output:
                click.echo(json.dumps({"error": str(e), "type": "osc_error"}))
            else:
                click.echo(f"OSC Error: {e}", err=True)
            if not _repl_mode:
                sys.exit(1)
        except (ValueError, IndexError, RuntimeError) as e:
            if _json_output:
                click.echo(json.dumps({"error": str(e), "type": type(e).__name__}))
            else:
                click.echo(f"Error: {e}", err=True)
            if not _repl_mode:
                sys.exit(1)
        except Exception as e:
            if _json_output:
                click.echo(json.dumps({"error": str(e), "type": type(e).__name__}))
            else:
                click.echo(f"Error: {e}", err=True)
            if not _repl_mode:
                sys.exit(1)
    wrapper.__name__ = func.__name__
    wrapper.__doc__ = func.__doc__
    return wrapper


# -- Main CLI Group --------------------------------------------------------

@click.group(invoke_without_command=True)
@click.option("--json", "use_json", is_flag=True, help="Output as JSON")
@click.pass_context
def cli(ctx, use_json):
    """Ableton CLI -- Control Ableton Live via AbletonOSC.

    Run without a subcommand to enter interactive REPL mode.
    Requires AbletonOSC MIDI Remote Script running in Ableton Live.
    """
    global _json_output
    _json_output = use_json

    if ctx.invoked_subcommand is None:
        ctx.invoke(repl)


# -- Session Commands ------------------------------------------------------

@cli.group()
def session():
    """Connection management (connect/disconnect/status)."""
    pass


@session.command("connect")
@click.option("--host", default="127.0.0.1", help="Ableton host IP")
@click.option("--send-port", type=int, default=11000, help="AbletonOSC listen port")
@click.option("--recv-port", type=int, default=11001, help="Our reply port")
@click.option("--timeout", type=float, default=5.0, help="Query timeout (seconds)")
@handle_error
def session_connect(host, send_port, recv_port, timeout):
    """Connect to AbletonOSC."""
    sess = get_session()
    result = sess.connect(host=host, send_port=send_port, recv_port=recv_port, timeout=timeout)
    output(result, "Connected to AbletonOSC")


@session.command("disconnect")
@handle_error
def session_disconnect():
    """Disconnect from AbletonOSC."""
    sess = get_session()
    result = sess.disconnect()
    output(result, "Disconnected")


@session.command("status")
@handle_error
def session_status():
    """Show connection status."""
    sess = get_session()
    result = sess.status()
    output(result)


# -- Transport Commands ----------------------------------------------------

@cli.group()
def transport():
    """Playback, recording, tempo, and position controls."""
    pass


@transport.command("play")
@handle_error
def transport_play():
    """Start playback."""
    result = transport_mod.play(get_session())
    output(result, "Playing")


@transport.command("stop")
@handle_error
def transport_stop():
    """Stop playback."""
    result = transport_mod.stop(get_session())
    output(result, "Stopped")


@transport.command("continue")
@handle_error
def transport_continue():
    """Continue playback from current position."""
    result = transport_mod.continue_playing(get_session())
    output(result, "Continuing playback")


@transport.command("record")
@click.argument("state", required=False, type=click.Choice(["on", "off"]))
@handle_error
def transport_record(state):
    """Get or set record mode (on/off)."""
    sess = get_session()
    if state is None:
        result = transport_mod.record(sess)
    else:
        result = transport_mod.record(sess, enable=(state == "on"))
    output(result)


@transport.command("overdub")
@click.argument("state", required=False, type=click.Choice(["on", "off"]))
@handle_error
def transport_overdub(state):
    """Get or set overdub mode (on/off)."""
    sess = get_session()
    if state is None:
        result = transport_mod.overdub(sess)
    else:
        result = transport_mod.overdub(sess, enable=(state == "on"))
    output(result)


@transport.command("tempo")
@click.argument("bpm", required=False, type=float)
@handle_error
def transport_tempo(bpm):
    """Get or set tempo (BPM). Query if no argument given."""
    sess = get_session()
    if bpm is None:
        result = transport_mod.get_tempo(sess)
    else:
        result = transport_mod.set_tempo(sess, bpm)
    output(result)


@transport.command("position")
@click.argument("beats", required=False, type=float)
@handle_error
def transport_position(beats):
    """Get or set playback position (in beats). Query if no argument given."""
    sess = get_session()
    if beats is None:
        result = transport_mod.get_position(sess)
    else:
        result = transport_mod.set_position(sess, beats)
    output(result)


@transport.command("metronome")
@click.argument("state", required=False, type=click.Choice(["on", "off"]))
@handle_error
def transport_metronome(state):
    """Get or set metronome (on/off)."""
    sess = get_session()
    if state is None:
        result = transport_mod.metronome(sess)
    else:
        result = transport_mod.metronome(sess, enable=(state == "on"))
    output(result)


@transport.command("loop")
@click.option("--enable/--disable", default=None, help="Enable or disable loop")
@click.option("--start", type=float, default=None, help="Loop start (beats)")
@click.option("--length", type=float, default=None, help="Loop length (beats)")
@handle_error
def transport_loop(enable, start, length):
    """Get or set loop state and boundaries."""
    sess = get_session()
    result = transport_mod.loop(sess, enable=enable, start=start, length=length)
    output(result)


@transport.command("status")
@handle_error
def transport_status():
    """Get full transport status (tempo, position, record, loop, etc.)."""
    result = transport_mod.get_full_status(get_session())
    output(result)


@transport.command("undo")
@handle_error
def transport_undo():
    """Undo the last action in Ableton."""
    result = transport_mod.undo(get_session())
    output(result, "Undone")


@transport.command("redo")
@handle_error
def transport_redo():
    """Redo the last undone action in Ableton."""
    result = transport_mod.redo(get_session())
    output(result, "Redone")


@transport.command("master-volume")
@click.argument("level", required=False, type=float)
@handle_error
def transport_master_volume(level):
    """Get or set master volume (0.0 to 1.0)."""
    sess = get_session()
    if level is None:
        result = transport_mod.get_master_volume(sess)
    else:
        result = transport_mod.set_master_volume(sess, level)
    output(result)


# -- Track Commands --------------------------------------------------------

@cli.group()
def track():
    """Track management (list, get, rename)."""
    pass


@track.command("list")
@handle_error
def track_list():
    """List all tracks with properties."""
    result = tracks_mod.list_tracks(get_session())
    output(result, "Tracks:")


@track.command("get")
@click.argument("index", type=int)
@handle_error
def track_get(index):
    """Get detailed info for a track by index."""
    result = tracks_mod.get_track(get_session(), index)
    output(result)


@track.command("rename")
@click.argument("index", type=int)
@click.argument("name")
@handle_error
def track_rename(index, name):
    """Rename a track."""
    result = tracks_mod.rename_track(get_session(), index, name)
    output(result, f"Renamed track {index} to: {name}")


@track.command("arm")
@click.argument("index", type=int)
@click.argument("state", type=click.Choice(["on", "off"]))
@handle_error
def track_arm(index, state):
    """Arm or disarm a track for recording."""
    result = tracks_mod.set_arm(get_session(), index, state == "on")
    output(result)


@track.command("color")
@click.argument("index", type=int)
@click.argument("color", type=int)
@handle_error
def track_color(index, color):
    """Set a track's color (integer color value)."""
    result = tracks_mod.set_color(get_session(), index, color)
    output(result)


@track.command("fold")
@click.argument("index", type=int)
@click.argument("state", required=False, type=click.Choice(["on", "off"]))
@handle_error
def track_fold(index, state):
    """Get or set fold state of a group track."""
    sess = get_session()
    if state is None:
        result = tracks_mod.get_fold_state(sess, index)
    else:
        result = tracks_mod.set_fold_state(sess, index, state == "on")
    output(result)


@track.command("monitor")
@click.argument("index", type=int)
@click.argument("state", required=False, type=click.Choice(["in", "auto", "off"]))
@handle_error
def track_monitor(index, state):
    """Get or set monitoring state (in/auto/off)."""
    sess = get_session()
    if state is None:
        result = tracks_mod.get_monitoring_state(sess, index)
    else:
        state_map = {"in": 0, "auto": 1, "off": 2}
        result = tracks_mod.set_monitoring_state(sess, index, state_map[state])
    output(result)


# -- Clip Commands ---------------------------------------------------------

@cli.group()
def clip():
    """Clip management (list, fire, stop, properties)."""
    pass


@clip.command("list")
@click.argument("track_index", type=int)
@handle_error
def clip_list(track_index):
    """List all clips on a track."""
    result = clips_mod.list_clips(get_session(), track_index)
    output(result, f"Clips on track {track_index}:")


@clip.command("get")
@click.argument("track_index", type=int)
@click.argument("clip_index", type=int)
@handle_error
def clip_get(track_index, clip_index):
    """Get detailed clip properties."""
    result = clips_mod.get_clip(get_session(), track_index, clip_index)
    output(result)


@clip.command("fire")
@click.argument("track_index", type=int)
@click.argument("clip_index", type=int)
@handle_error
def clip_fire(track_index, clip_index):
    """Fire (launch) a clip."""
    result = clips_mod.fire_clip(get_session(), track_index, clip_index)
    output(result, f"Fired clip [{track_index}][{clip_index}]")


@clip.command("stop")
@click.argument("track_index", type=int)
@click.argument("clip_index", type=int)
@handle_error
def clip_stop(track_index, clip_index):
    """Stop a clip."""
    result = clips_mod.stop_clip(get_session(), track_index, clip_index)
    output(result, f"Stopped clip [{track_index}][{clip_index}]")


@clip.command("name")
@click.argument("track_index", type=int)
@click.argument("clip_index", type=int)
@click.argument("name")
@handle_error
def clip_name(track_index, clip_index, name):
    """Set a clip's name."""
    result = clips_mod.set_clip_name(get_session(), track_index, clip_index, name)
    output(result)


@clip.command("loop")
@click.argument("track_index", type=int)
@click.argument("clip_index", type=int)
@click.option("--enable/--disable", default=None, help="Enable/disable loop")
@click.option("--start", type=float, default=None, help="Loop start (beats)")
@click.option("--end", type=float, default=None, help="Loop end (beats)")
@handle_error
def clip_loop(track_index, clip_index, enable, start, end):
    """Get or set clip loop properties."""
    sess = get_session()
    results = {}
    if enable is not None:
        r = clips_mod.set_looping(sess, track_index, clip_index, enable)
        results.update(r)
    if start is not None:
        r = clips_mod.set_loop_start(sess, track_index, clip_index, start)
        results.update(r)
    if end is not None:
        r = clips_mod.set_loop_end(sess, track_index, clip_index, end)
        results.update(r)
    if not results:
        # Query current state
        r = clips_mod.get_clip(sess, track_index, clip_index)
        results = {
            "track_index": track_index,
            "clip_index": clip_index,
            "looping": r.get("looping"),
            "loop_start": r.get("loop_start"),
            "loop_end": r.get("loop_end"),
        }
    output(results)


@clip.command("get-notes")
@click.argument("track_index", type=int)
@click.argument("clip_index", type=int)
@handle_error
def clip_get_notes(track_index, clip_index):
    """Get all MIDI notes in a clip."""
    result = midi_mod.get_notes(get_session(), track_index, clip_index)
    output(result)


@clip.command("set-notes")
@click.argument("track_index", type=int)
@click.argument("clip_index", type=int)
@click.argument("notes_json")
@handle_error
def clip_set_notes(track_index, clip_index, notes_json):
    """Replace all notes in a MIDI clip from JSON.

    NOTES_JSON format: '[{"pitch":60,"start":0,"duration":1,"velocity":100}, ...]'
    """
    result = midi_mod.set_notes_from_json(
        get_session(), track_index, clip_index, notes_json
    )
    output(result)


@clip.command("add-note")
@click.argument("track_index", type=int)
@click.argument("clip_index", type=int)
@click.option("--pitch", "-p", type=int, required=True, help="MIDI pitch (0-127)")
@click.option("--start", "-s", type=float, required=True, help="Start time (beats)")
@click.option("--duration", "-d", type=float, required=True, help="Duration (beats)")
@click.option("--velocity", "-v", type=int, default=100, help="Velocity (0-127)")
@click.option("--mute", is_flag=True, help="Mute the note")
@handle_error
def clip_add_note(track_index, clip_index, pitch, start, duration, velocity, mute):
    """Add a single MIDI note to a clip."""
    result = midi_mod.add_note(
        get_session(), track_index, clip_index,
        pitch, start, duration, velocity, mute,
    )
    output(result, f"Added note: pitch={pitch} start={start} dur={duration}")


@clip.command("remove-notes")
@click.argument("track_index", type=int)
@click.argument("clip_index", type=int)
@click.option("--start", type=float, default=0.0, help="Start of range (beats)")
@click.option("--span", type=float, default=9999.0, help="Range length (beats)")
@click.option("--pitch-lo", type=int, default=0, help="Lowest pitch to remove")
@click.option("--pitch-hi", type=int, default=127, help="Highest pitch to remove")
@handle_error
def clip_remove_notes(track_index, clip_index, start, span, pitch_lo, pitch_hi):
    """Remove MIDI notes from a clip within a range."""
    result = midi_mod.remove_notes(
        get_session(), track_index, clip_index,
        start, span, pitch_lo, pitch_hi,
    )
    output(result)


@clip.command("clear-notes")
@click.argument("track_index", type=int)
@click.argument("clip_index", type=int)
@handle_error
def clip_clear_notes(track_index, clip_index):
    """Remove all MIDI notes from a clip."""
    result = midi_mod.clear_notes(get_session(), track_index, clip_index)
    output(result, "Cleared all notes")


# -- Scene Commands --------------------------------------------------------

@cli.group()
def scene():
    """Scene management (list, fire, name)."""
    pass


@scene.command("list")
@handle_error
def scene_list():
    """List all scenes."""
    result = scenes_mod.list_scenes(get_session())
    output(result, "Scenes:")


@scene.command("fire")
@click.argument("index", type=int)
@handle_error
def scene_fire(index):
    """Fire (launch) a scene."""
    result = scenes_mod.fire_scene(get_session(), index)
    output(result, f"Fired scene {index}")


@scene.command("get")
@click.argument("index", type=int)
@handle_error
def scene_get(index):
    """Get scene info."""
    result = scenes_mod.get_scene(get_session(), index)
    output(result)


@scene.command("name")
@click.argument("index", type=int)
@click.argument("name")
@handle_error
def scene_name(index, name):
    """Set scene name."""
    result = scenes_mod.set_scene_name(get_session(), index, name)
    output(result)


@scene.command("tempo")
@click.argument("index", type=int)
@click.argument("bpm", type=float)
@handle_error
def scene_tempo(index, bpm):
    """Set scene tempo (launches at this BPM)."""
    result = scenes_mod.set_scene_tempo(get_session(), index, bpm)
    output(result)


@scene.command("color")
@click.argument("index", type=int)
@click.argument("color", type=int)
@handle_error
def scene_color(index, color):
    """Set scene color."""
    result = scenes_mod.set_scene_color(get_session(), index, color)
    output(result)


# -- Device Commands -------------------------------------------------------

@cli.group()
def device():
    """Device and parameter management."""
    pass


@device.command("list")
@click.argument("track_index", type=int)
@handle_error
def device_list(track_index):
    """List all devices on a track."""
    result = devices_mod.list_devices(get_session(), track_index)
    output(result, f"Devices on track {track_index}:")


@device.command("get")
@click.argument("track_index", type=int)
@click.argument("device_index", type=int)
@handle_error
def device_get(track_index, device_index):
    """Get device info."""
    result = devices_mod.get_device(get_session(), track_index, device_index)
    output(result)


@device.command("params")
@click.argument("track_index", type=int)
@click.argument("device_index", type=int)
@handle_error
def device_params(track_index, device_index):
    """List all parameters of a device."""
    result = devices_mod.list_parameters(get_session(), track_index, device_index)
    output(result, f"Parameters for device [{track_index}][{device_index}]:")


@device.command("param-get")
@click.argument("track_index", type=int)
@click.argument("device_index", type=int)
@click.argument("param_index", type=int)
@handle_error
def device_param_get(track_index, device_index, param_index):
    """Get a device parameter value."""
    result = devices_mod.get_parameter(
        get_session(), track_index, device_index, param_index
    )
    output(result)


@device.command("param-set")
@click.argument("track_index", type=int)
@click.argument("device_index", type=int)
@click.argument("param_index", type=int)
@click.argument("value", type=float)
@handle_error
def device_param_set(track_index, device_index, param_index, value):
    """Set a device parameter value."""
    result = devices_mod.set_parameter(
        get_session(), track_index, device_index, param_index, value
    )
    output(result, f"Set param [{param_index}] = {value}")


@device.command("enable")
@click.argument("track_index", type=int)
@click.argument("device_index", type=int)
@click.argument("state", type=click.Choice(["on", "off"]))
@handle_error
def device_enable(track_index, device_index, state):
    """Enable or disable a device."""
    result = devices_mod.set_device_active(
        get_session(), track_index, device_index, state == "on"
    )
    output(result)


# -- Mixer Commands --------------------------------------------------------

@cli.group()
def mixer():
    """Mixer controls (volume, pan, mute, solo, send)."""
    pass


@mixer.command("volume")
@click.argument("track_index", type=int)
@click.argument("level", required=False, type=float)
@handle_error
def mixer_volume(track_index, level):
    """Get or set track volume (0.0 to 1.0)."""
    sess = get_session()
    if level is None:
        result = mixer_mod.get_volume(sess, track_index)
    else:
        result = mixer_mod.set_volume(sess, track_index, level)
    output(result)


@mixer.command("pan")
@click.argument("track_index", type=int)
@click.argument("value", required=False, type=float)
@handle_error
def mixer_pan(track_index, value):
    """Get or set track panning (-1.0 to 1.0)."""
    sess = get_session()
    if value is None:
        result = mixer_mod.get_pan(sess, track_index)
    else:
        result = mixer_mod.set_pan(sess, track_index, value)
    output(result)


@mixer.command("mute")
@click.argument("track_index", type=int)
@click.argument("state", required=False, type=click.Choice(["on", "off"]))
@handle_error
def mixer_mute(track_index, state):
    """Get or set track mute (on/off)."""
    sess = get_session()
    if state is None:
        result = mixer_mod.get_mute(sess, track_index)
    else:
        result = mixer_mod.set_mute(sess, track_index, state == "on")
    output(result)


@mixer.command("solo")
@click.argument("track_index", type=int)
@click.argument("state", required=False, type=click.Choice(["on", "off"]))
@handle_error
def mixer_solo(track_index, state):
    """Get or set track solo (on/off)."""
    sess = get_session()
    if state is None:
        result = mixer_mod.get_solo(sess, track_index)
    else:
        result = mixer_mod.set_solo(sess, track_index, state == "on")
    output(result)


@mixer.command("send")
@click.argument("track_index", type=int)
@click.argument("send_index", type=int)
@click.argument("level", required=False, type=float)
@handle_error
def mixer_send(track_index, send_index, level):
    """Get or set send level (0.0 to 1.0)."""
    sess = get_session()
    if level is None:
        result = mixer_mod.get_send(sess, track_index, send_index)
    else:
        result = mixer_mod.set_send(sess, track_index, send_index, level)
    output(result)


@mixer.command("arm")
@click.argument("track_index", type=int)
@click.argument("state", required=False, type=click.Choice(["on", "off"]))
@handle_error
def mixer_arm(track_index, state):
    """Get or set track arm (record-enable)."""
    sess = get_session()
    if state is None:
        result = mixer_mod.get_arm(sess, track_index)
    else:
        result = mixer_mod.set_arm(sess, track_index, state == "on")
    output(result)


@mixer.command("snapshot")
@click.argument("track_index", type=int)
@handle_error
def mixer_snapshot(track_index):
    """Get full mixer state for a track."""
    result = mixer_mod.get_mixer_snapshot(get_session(), track_index)
    output(result)


# -- View Commands ---------------------------------------------------------

@cli.group()
def view():
    """View and cursor controls (selected track/scene)."""
    pass


@view.command("selected-track")
@click.argument("index", required=False, type=int)
@handle_error
def view_selected_track(index):
    """Get or set selected track cursor."""
    if index is None:
        result = view_mod.get_selected_track()
    else:
        result = view_mod.set_selected_track(index)
    output(result)


@view.command("selected-scene")
@click.argument("index", required=False, type=int)
@handle_error
def view_selected_scene(index):
    """Get or set selected scene cursor."""
    if index is None:
        result = view_mod.get_selected_scene()
    else:
        result = view_mod.set_selected_scene(index)
    output(result)


@view.command("cursor")
@click.option("--track-delta", "-t", type=int, default=0, help="Move track cursor by N")
@click.option("--scene-delta", "-s", type=int, default=0, help="Move scene cursor by N")
@handle_error
def view_cursor(track_delta, scene_delta):
    """Get cursor state, or move by relative offsets."""
    sess = get_session()
    if track_delta == 0 and scene_delta == 0:
        result = view_mod.get_cursor(sess)
    else:
        result = view_mod.move_cursor(sess, track_delta, scene_delta)
    output(result)


@view.command("overview")
@handle_error
def view_overview():
    """Get a session overview (tracks, scenes, tempo, cursor)."""
    result = view_mod.get_session_overview(get_session())
    output(result)


# -- REPL ------------------------------------------------------------------

@cli.command()
@handle_error
def repl():
    """Start interactive REPL session."""
    global _repl_mode
    _repl_mode = True

    click.echo("=" * 60)
    click.echo("  Ableton CLI v1.0.0 -- AbletonOSC Interface")
    click.echo("  Type 'help' for commands, 'quit' to exit")
    click.echo("=" * 60)
    click.echo()

    # Auto-connect on REPL start
    sess = get_session()
    if not sess.connected:
        click.echo("Connecting to AbletonOSC (127.0.0.1:11000)...")
        try:
            result = sess.connect()
            if result.get("tempo") is not None:
                click.echo(f"Connected! Tempo: {result['tempo']} BPM")
            else:
                click.echo("Connected (Ableton may not be responding yet)")
        except Exception as e:
            click.echo(f"Auto-connect failed: {e}")
            click.echo("Use 'session connect' to connect manually.")
        click.echo()

    try:
        from prompt_toolkit import PromptSession as PTSession
        from prompt_toolkit.history import InMemoryHistory
        pt_session = PTSession(history=InMemoryHistory())
        use_pt = True
    except ImportError:
        use_pt = False

    while True:
        try:
            if use_pt:
                line = pt_session.prompt("ableton> ")
            else:
                line = input("ableton> ")

            if not line or not line.strip():
                continue
            line = line.strip()

            if line.lower() in ("quit", "exit", "q"):
                click.echo("Goodbye.")
                break
            if line.lower() == "help":
                _repl_help()
                continue

            args = line.split()
            try:
                cli.main(args, standalone_mode=False)
            except SystemExit:
                pass
            except click.exceptions.UsageError as e:
                click.echo(f"Usage error: {e}")
            except Exception as e:
                click.echo(f"Error: {e}")

        except (EOFError, KeyboardInterrupt):
            click.echo("\nGoodbye.")
            break

    _repl_mode = False

    # Disconnect on exit
    if sess.connected:
        sess.disconnect()


def _repl_help():
    """Print REPL help."""
    commands = {
        "session connect|disconnect|status": "Connection management",
        "transport play|stop|continue|record|tempo|position|status": "Transport controls",
        "transport metronome|loop|undo|redo|master-volume": "More transport",
        "track list|get|rename|arm|color|fold|monitor": "Track management",
        "clip list|get|fire|stop|name|loop": "Clip management",
        "clip get-notes|set-notes|add-note|remove-notes|clear-notes": "MIDI notes",
        "scene list|fire|get|name|tempo|color": "Scene management",
        "device list|get|params|param-get|param-set|enable": "Device controls",
        "mixer volume|pan|mute|solo|send|arm|snapshot": "Mixer controls",
        "view selected-track|selected-scene|cursor|overview": "View/cursor",
        "help": "Show this help",
        "quit": "Exit REPL",
    }
    click.echo("\nCommands:")
    for cmd, desc in commands.items():
        click.echo(f"  {cmd:55s} {desc}")
    click.echo()


# -- Entry Point -----------------------------------------------------------

def main():
    cli()


if __name__ == "__main__":
    main()
