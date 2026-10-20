# Max and Ableton MCP tools

This map was verified against local source/configuration on 2026-10-20.
Source presence is not proof of a callable MCP session. Discover tools using
the available tool-search mechanism and read their schemas before constructing
arguments. If discovery is unavailable, use verified local source for offline
work and report the connection as unverified.

## Max patch authoring: `maxmsp`

The user's `.mcp.json` configures `maxmsp` with:

```json
{
  "mcpServers": {
    "maxmsp": {
      "command": "C:\\Users\\Owner\\colab\\MaxMSP-MCP-Server\\.venv\\Scripts\\python.exe",
      "args": ["C:\\Users\\Owner\\colab\\MaxMSP-MCP-Server\\server.py"]
    }
  }
}
```

This is an example fragment for clients accepting this JSON schema, not a file
to overwrite existing configuration with. Adapt paths on another machine.
The server uses MCP stdio. Its Socket.IO relay at `127.0.0.1:5050` and namespace
`/mcp` is an internal transport, **not** an MCP HTTP URL. Max must contain the
matching `MaxMSP_Agent` patch with its Node dependencies and running relay.
For this checkout, open/copy `MaxMSP_Agent/demo.maxpat` into the intended patch
context, use `script npm version` to check its Node tooling, `script npm install`
if dependencies are absent, and `script start` to start its `node.script`.
The client launches the Python server separately over stdio. Follow that
checkout's README and confirm Max 9+ before setup; do not start a hypothetical
`python app.py` relay.

The configured checkout exposes these tool names:

| Task | Tools |
|---|---|
| Inspect | `get_objects_in_patch`, `get_objects_in_selected`, `get_object_attributes` |
| Object reference and placement | `list_all_objects`, `get_object_doc`, `get_avoid_rect_position` |
| Graph edits | `add_max_object`, `remove_max_object`, `connect_max_objects`, `disconnect_max_objects` |
| Values/messages | `set_object_attribute`, `set_message_text`, `set_number`, `send_bang_to_object`, `send_messages_to_object` |

Start with `get_objects_in_patch` and inspect the intended objects/documentation.
Tools act on the patch containing the agent; they do not target whichever window
looks foreground. Use observed scripting `varname` values and outlet/inlet
indices. Check placement with `get_avoid_rect_position`, apply the requested
edits, then reread the patch and inspect the result.

The verified base signatures include:

```text
get_objects_in_patch()
get_object_doc(object_name: str)
get_object_attributes(varname: str)
add_max_object(position: list, obj_type: str, varname: str, args: list)
connect_max_objects(src_varname: str, outlet_idx: int, dst_varname: str, inlet_idx: int)
set_object_attribute(varname: str, attr_name: str, attr_value: list)
```

`position` is `[x, y]`; the server-injected `ctx` is not a tool argument. Runtime
schemas take precedence over these source snapshots.

No dedicated save/package/export tool exists in this base tool list. Complete
the normal save/build/freeze workflow separately. Sending a bang or message can
change audio, transport, or external hardware; its purpose must match the task.

### Extended fork is a different target

`C:\Users\Owner\colab\maxmsp-mcp\server.py` is a separate checkout, with a default
relay port of `5002`. It adds `get_patcher_context`, `get_object_connections`,
`create_subpatcher`, `enter_subpatcher`, `exit_subpatcher`, `add_subpatcher_io`,
`recreate_with_args`, `move_object`, `autofit_existing`, `check_signal_safety`,
and `encapsulate`. Some base signatures are also extended.

Do not call these extra tools unless runtime discovery shows them. Do not mix
one fork's server, relay port, and agent patch with the other fork. Both advertise
the server name `MaxMSPMCP`; inspect the configured implementation.

## Live session inspection: Producer Pal

A running `Producer_Pal.amxd` provides Streamable HTTP MCP at
`http://localhost:3350/mcp`. The optional stdio portal is `npx -y producer-pal`;
use an already installed/pinned version when available. Local source is
`C:\Users\Owner\colab\producer-pal`.

Read workflow: `ppal-connect`, then `ppal-read-live-set`, then `ppal-read-track`
and `ppal-read-device` for the target. Inspect current schemas to request
parameters/values and supply returned object IDs. Use these reads to establish
what Live actually loaded and to verify parameter behavior.

- `ppal-create-device` supports native Live devices; it is not a general
  arbitrary `.amxd` loader.
- `ppal-raw-live-api` is conditional development tooling, not a guaranteed tool.
- The local Producer Pal MCP end-to-end suite opens Live Sets. Do not run it
  against the user's active session without authorization for that replacement.
- Producer Pal is external GPL-3.0-or-later tooling. Do not copy its implementation
  into a proprietary device or assume its license matches the MIT Max server.

At creation time neither integration was declared in this machine's
`.codex/config.toml`, and runtime tool discovery was unavailable. The skill's
`agents/openai.yaml` declares the integration targets without modifying global
client configuration. Recheck availability when invoked.

## Fallbacks and boundaries

CoLaB's AbletonBridge TCP and AbletonOSC UDP services are application transports,
not automatically MCP servers. The local `ableton-mcp` configuration uses
`uvx ableton-mcp`; discover its actual tools before relying on it.
Supabase is unrelated to AMXD authoring and is not required for this workflow.

Prefer purpose-built connected tools, then verified project scripts. Use desktop
automation only when needed for loading, saving, or visual checks. Read the
current computer-use instructions first. On this workspace any browser step
must attach to the user's Brave CDP session on port 9222; do not launch Chrome
or a separate browser profile to work around an unavailable session.
