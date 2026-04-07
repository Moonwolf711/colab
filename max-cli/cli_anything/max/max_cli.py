#!/usr/bin/env python3
"""cli-anything-max — Click entry point and REPL.

Run with no subcommand to drop into the REPL; run with subcommands for
one-shot usage. Every command supports ``--json`` on the top-level group.
"""

from __future__ import annotations

import json
import shlex
import sys
from pathlib import Path
from typing import Any, Optional

import click

from cli_anything.max import __version__
from cli_anything.max.core import control as control_mod
from cli_anything.max.core import device as device_mod
from cli_anything.max.core import launch as launch_mod
from cli_anything.max.core import patch as patch_mod
from cli_anything.max.core import render as render_mod
from cli_anything.max.utils.max_backend import (
    MaxNotInstalledError,
    find_max_exe,
    max_install_info,
)

DATA_DIR = Path(__file__).parent / "data"
CONTROL_PATCH_PATH = DATA_DIR / "cli_anything_max_control.maxpat"

# Single module-level dict so the REPL and subcommands share state without
# having to thread a context object through every command.
_state: dict[str, Any] = {"json": False, "current_patch": None, "modified": False}


# ── Output helpers ───────────────────────────────────────────────────


def _emit(data: Any, *, human_fallback: Optional[str] = None) -> None:
    """Print ``data`` as JSON or human text depending on --json."""
    if _state["json"]:
        click.echo(json.dumps(data, indent=2, default=str, sort_keys=False))
        return
    if human_fallback is not None:
        click.echo(human_fallback)
        return
    if isinstance(data, dict):
        for k, v in data.items():
            click.echo(f"{k}: {v}")
    elif isinstance(data, list):
        for item in data:
            click.echo(item)
    else:
        click.echo(str(data))


def _die(msg: str, code: int = 1) -> None:
    click.echo(f"error: {msg}", err=True)
    sys.exit(code)


# ── Main group ───────────────────────────────────────────────────────


@click.group(invoke_without_command=True, context_settings={"help_option_names": ["-h", "--help"]})
@click.option("--json", "json_mode", is_flag=True, help="Emit JSON output for all commands.")
@click.version_option(__version__, prog_name="cli-anything-max")
@click.pass_context
def cli(ctx: click.Context, json_mode: bool) -> None:
    """CLI harness for Cycling '74 Max 9.

    Run without a subcommand to enter the REPL.
    """
    _state["json"] = json_mode
    if ctx.invoked_subcommand is None:
        ctx.invoke(repl)


# ── doctor ───────────────────────────────────────────────────────────


@cli.command()
def doctor() -> None:
    """Show Max install info and verify prerequisites."""
    info = max_install_info()
    info["control_patch"] = str(CONTROL_PATCH_PATH)
    info["control_patch_exists"] = CONTROL_PATCH_PATH.exists()
    _emit(info)


# ── patch group ──────────────────────────────────────────────────────


@cli.group()
def patch() -> None:
    """.maxpat file operations (no Max running required)."""


@patch.command("new")
@click.argument("path", type=click.Path(dir_okay=False))
def patch_new(path: str) -> None:
    """Create a new empty .maxpat at PATH."""
    doc = patch_mod.new_patcher()
    p = patch_mod.write_patcher(doc, path)
    _state["current_patch"] = str(p)
    _state["modified"] = False
    _emit({"file": str(p), "created": True, "boxes": 0, "lines": 0})


@patch.command("info")
@click.argument("path", type=click.Path(exists=True, dir_okay=False))
def patch_info(path: str) -> None:
    """Print a summary of a .maxpat."""
    doc = patch_mod.read_patcher(path)
    info = patch_mod.patcher_info(doc)
    info["file"] = str(path)
    _emit(info)


@patch.command("add-object")
@click.argument("path", type=click.Path(exists=True, dir_okay=False))
@click.option("--text", "-t", required=True, help="Object text (e.g. 'cycle~ 440').")
@click.option("--id", "obj_id", default=None, help="Explicit box id. Auto-assigned if omitted.")
@click.option("--class", "maxclass", default="newobj", help="maxclass (newobj, message, comment).")
@click.option("--inlets", default=1, type=int, help="Number of inlets.")
@click.option("--outlets", default=1, type=int, help="Number of outlets.")
def patch_add_object(
    path: str, text: str, obj_id: Optional[str], maxclass: str, inlets: int, outlets: int
) -> None:
    """Add a new object box to an existing .maxpat."""
    doc = patch_mod.read_patcher(path)
    pd = patch_mod.PatcherDoc(doc)
    try:
        new_id = pd.add_object(
            text, id=obj_id, maxclass=maxclass, numinlets=inlets, numoutlets=outlets
        )
    except patch_mod.PatcherError as e:
        _die(str(e))
    patch_mod.write_patcher(doc, path)
    _emit({"file": path, "added_id": new_id, "text": text})


@patch.command("connect")
@click.argument("path", type=click.Path(exists=True, dir_okay=False))
@click.argument("src_id")
@click.argument("src_outlet", type=int)
@click.argument("dst_id")
@click.argument("dst_inlet", type=int)
def patch_connect(
    path: str, src_id: str, src_outlet: int, dst_id: str, dst_inlet: int
) -> None:
    """Connect two object outlets with a patchline."""
    doc = patch_mod.read_patcher(path)
    pd = patch_mod.PatcherDoc(doc)
    try:
        pd.connect(src_id, src_outlet, dst_id, dst_inlet)
    except patch_mod.PatcherError as e:
        _die(str(e))
    patch_mod.write_patcher(doc, path)
    _emit(
        {
            "file": path,
            "connected": True,
            "from": {"id": src_id, "outlet": src_outlet},
            "to": {"id": dst_id, "inlet": dst_inlet},
        }
    )


@patch.command("to-amxd")
@click.argument("patch_path", type=click.Path(exists=True, dir_okay=False))
@click.argument("amxd_path", type=click.Path(dir_okay=False))
def patch_to_amxd(patch_path: str, amxd_path: str) -> None:
    """Wrap a .maxpat as a .amxd (M4L device, ampf binary)."""
    doc = patch_mod.read_patcher(patch_path)
    p = device_mod.write_amxd(doc, amxd_path)
    _emit({"input": patch_path, "output": str(p), "bytes": p.stat().st_size})


@patch.command("from-amxd")
@click.argument("amxd_path", type=click.Path(exists=True, dir_okay=False))
@click.argument("patch_path", type=click.Path(dir_okay=False))
def patch_from_amxd(amxd_path: str, patch_path: str) -> None:
    """Extract the patcher JSON from a .amxd to a .maxpat."""
    doc = device_mod.read_amxd(amxd_path)
    p = patch_mod.write_patcher(doc, patch_path)
    _emit({"input": amxd_path, "output": str(p)})


@patch.command("diff")
@click.argument("a", type=click.Path(exists=True, dir_okay=False))
@click.argument("b", type=click.Path(exists=True, dir_okay=False))
def patch_diff(a: str, b: str) -> None:
    """Structural diff of two patchers."""
    da = patch_mod.read_patcher(a)
    db = patch_mod.read_patcher(b)
    diff = patch_mod.patcher_diff(da, db)
    diff["a"] = a
    diff["b"] = b
    _emit(diff)


# ── device group (.amxd) ─────────────────────────────────────────────


@cli.group()
def device() -> None:
    """.amxd (Max for Live device) operations."""


@device.command("build")
@click.argument("patch_path", type=click.Path(exists=True, dir_okay=False))
@click.argument("amxd_path", type=click.Path(dir_okay=False))
def device_build(patch_path: str, amxd_path: str) -> None:
    """Build an .amxd from a .maxpat (same as patch to-amxd)."""
    doc = patch_mod.read_patcher(patch_path)
    p = device_mod.write_amxd(doc, amxd_path)
    _emit({"output": str(p), "bytes": p.stat().st_size})


@device.command("extract")
@click.argument("amxd_path", type=click.Path(exists=True, dir_okay=False))
@click.argument("patch_path", type=click.Path(dir_okay=False))
def device_extract(amxd_path: str, patch_path: str) -> None:
    """Extract .maxpat JSON from an .amxd."""
    doc = device_mod.read_amxd(amxd_path)
    p = patch_mod.write_patcher(doc, patch_path)
    _emit({"output": str(p)})


@device.command("validate")
@click.argument("amxd_path", type=click.Path(exists=True, dir_okay=False))
def device_validate(amxd_path: str) -> None:
    """Validate the ampf binary envelope of an .amxd."""
    try:
        info = device_mod.validate_amxd(amxd_path)
    except device_mod.AmxdError as e:
        _die(str(e))
    info["valid"] = True
    _emit(info)


# ── launch group ─────────────────────────────────────────────────────


@cli.group()
def launch() -> None:
    """Launch a Max subprocess with a .maxpat."""


def _launch_flavor(flavor: str, patch_path: Optional[str], use_control_patch: bool):
    if use_control_patch:
        if patch_path:
            _die("cannot pass both a patch path and --control-patch")
        if not CONTROL_PATCH_PATH.exists():
            _die(f"control patch missing: {CONTROL_PATCH_PATH}")
        patch_path = str(CONTROL_PATCH_PATH)
    if not patch_path:
        _die("must pass a .maxpat path or --control-patch")

    try:
        proc = launch_mod.launch(flavor=flavor, patch=patch_path)  # type: ignore[arg-type]
    except MaxNotInstalledError as e:
        _die(str(e))
    except FileNotFoundError as e:
        _die(str(e))
    _emit(proc.to_dict())


@launch.command("edit")
@click.argument("patch_path", required=False, type=click.Path(exists=True, dir_okay=False))
@click.option("--control-patch", is_flag=True, help="Launch with the shipped control patch.")
def launch_edit(patch_path: Optional[str], control_patch: bool) -> None:
    """Launch Max.exe (full editor) with a patch."""
    _launch_flavor("edit", patch_path, control_patch)


@launch.command("runtime")
@click.argument("patch_path", required=False, type=click.Path(exists=True, dir_okay=False))
@click.option("--control-patch", is_flag=True, help="Launch with the shipped control patch.")
def launch_runtime(patch_path: Optional[str], control_patch: bool) -> None:
    """Launch MaxRT.exe (runtime, no editor) with a patch."""
    _launch_flavor("runtime", patch_path, control_patch)


@launch.command("headless")
@click.argument("patch_path", required=False, type=click.Path(exists=True, dir_okay=False))
@click.option("--control-patch", is_flag=True, help="Launch with the shipped control patch.")
def launch_headless(patch_path: Optional[str], control_patch: bool) -> None:
    """Launch MaxRT_nocef.exe (runtime without Chromium) with a patch."""
    _launch_flavor("runtime_nocef", patch_path, control_patch)


# ── control group ────────────────────────────────────────────────────


@cli.group()
def control() -> None:
    """OSC/UDP commands to a running Max control patch."""


@control.command("connect")
@click.option("--timeout", default=2.0, type=float, help="Seconds to wait for /pong.")
def control_connect(timeout: float) -> None:
    """Ping the control patch and report latency."""
    try:
        result = control_mod.ping(timeout_s=timeout)
    except control_mod.MaxNotRespondingError as e:
        _die(str(e))
    _emit(
        {
            "ok": result.ok,
            "round_trip_ms": round(result.round_trip_ms, 2),
            "patch_time_ms": result.patch_time_ms,
        }
    )


@control.command("query")
@click.argument("key")
@click.option("--timeout", default=2.0, type=float)
def control_query(key: str, timeout: float) -> None:
    """Ask the dispatcher for a state value (dsp, sr, patch)."""
    try:
        result = control_mod.query(key, timeout_s=timeout)
    except (control_mod.MaxNotRespondingError, control_mod.MaxControlError) as e:
        _die(str(e))
    _emit(result)


@control.command("js")
@click.argument("code", nargs=-1, required=True)
@click.option("--timeout", default=3.0, type=float)
def control_js(code: tuple, timeout: float) -> None:
    """Evaluate a JS snippet inside the dispatcher."""
    src = " ".join(code)
    try:
        result = control_mod.eval_js(src, timeout_s=timeout)
    except (control_mod.MaxNotRespondingError, control_mod.MaxControlError) as e:
        _die(str(e))
    _emit(result)


@control.command("osc")
@click.argument("address")
@click.argument("args", nargs=-1)
def control_osc(address: str, args: tuple) -> None:
    """Send a raw OSC message to the control patch (fire-and-forget)."""
    # Attempt to coerce numeric args so `control osc /foo 42 0.5` sends
    # int/float rather than str.
    coerced: list[Any] = []
    for a in args:
        try:
            if "." in a:
                coerced.append(float(a))
            else:
                coerced.append(int(a))
        except ValueError:
            coerced.append(a)
    control_mod.raw_send(address, *coerced)
    _emit({"sent": address, "args": coerced})


@control.command("shutdown")
@click.option("--timeout", default=1.0, type=float)
def control_shutdown(timeout: float) -> None:
    """Send /shutdown to the control patch (does not kill the Max process)."""
    ok = control_mod.shutdown(timeout_s=timeout)
    _emit({"sent": "/shutdown", "bye_received": ok})


# ── render group ─────────────────────────────────────────────────────


@cli.group()
def render() -> None:
    """Render audio / image / symbolic output via the control patch."""


@render.command("audio")
@click.argument("out_path", type=click.Path(dir_okay=False))
@click.option("--duration", "-d", default=1.0, type=float, help="Record duration in seconds.")
def render_audio(out_path: str, duration: float) -> None:
    """Render <duration>s of the control patch's test tone to a .wav."""
    try:
        result = render_mod.render_audio(out_path, duration_s=duration)
    except (
        control_mod.MaxNotRespondingError,
        control_mod.MaxControlError,
        FileNotFoundError,
        ValueError,
    ) as e:
        _die(str(e))
    _emit(result)


@render.command("midi")
@click.argument("out_path", type=click.Path(dir_okay=False))
def render_midi(out_path: str) -> None:
    """Render the control patch's built-in C-major riff to a .mid (SMF)."""
    try:
        result = render_mod.render_midi(out_path)
    except (
        control_mod.MaxNotRespondingError,
        control_mod.MaxControlError,
        FileNotFoundError,
        ValueError,
    ) as e:
        _die(str(e))
    _emit(result)


# ── session group (minimal) ──────────────────────────────────────────


@cli.group()
def session() -> None:
    """Stateful session commands (REPL state). Minimal in tier B."""


@session.command("status")
def session_status() -> None:
    """Show current REPL state (project, modified flag)."""
    _emit(
        {
            "current_patch": _state.get("current_patch"),
            "modified": _state.get("modified"),
            "json_mode": _state.get("json"),
        }
    )


# ── REPL ─────────────────────────────────────────────────────────────


@cli.command()
def repl() -> None:
    """Interactive REPL (default when no subcommand is given)."""
    # Delay importing the skin until the REPL is actually requested so
    # one-shot CLI invocations don't pay the prompt_toolkit import cost.
    from cli_anything.max.utils.repl_skin import ReplSkin

    skin = ReplSkin("max", version=__version__)
    skin.print_banner()

    while True:
        try:
            project_name = ""
            if _state.get("current_patch"):
                project_name = Path(str(_state["current_patch"])).name
            prompt_str = skin.prompt(project_name=project_name, modified=bool(_state.get("modified")))
            line = input(prompt_str)
        except (EOFError, KeyboardInterrupt):
            click.echo()
            break

        line = line.strip()
        if not line:
            continue
        if line in ("quit", "exit", ":q"):
            break
        if line in ("help", "?"):
            click.echo("Commands: patch, device, launch, control, render, session, doctor, quit")
            click.echo("Prefix any command with --json for machine output.")
            continue

        try:
            tokens = shlex.split(line)
        except ValueError as e:
            click.echo(f"parse error: {e}")
            continue

        try:
            cli.main(args=tokens, prog_name="cli-anything-max", standalone_mode=False)
        except SystemExit:
            # Raised by click on --help or explicit exit calls inside commands.
            pass
        except click.ClickException as e:
            e.show()
        except Exception as e:  # pragma: no cover - defensive
            click.echo(f"error: {e}")

    # ── goodbye ──
    try:
        skin.print_goodbye()
    except AttributeError:
        click.echo("bye.")


def main() -> None:
    """Console-scripts entry point."""
    cli(prog_name="cli-anything-max")


if __name__ == "__main__":
    main()
