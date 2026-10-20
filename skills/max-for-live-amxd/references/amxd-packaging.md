# AMXD packaging and validation

## Choose the packaging path

Use Max's save/freeze workflow when editing a frozen device or assembling
dependencies. For reproducible generation of a simple unfrozen device, reuse a
verified stock template of the correct category and this skill's helper.
Do not assume a fixed header can describe every AMXD archive.

Installed templates inspected on 2026-10-20 live under:
`C:\ProgramData\Ableton\Live 12 Suite\Resources\Misc\Max Devices`.
Discover the actual installation path on another machine.

| Byte offset | Observed stock template field |
|---|---|
| 0 | `ampf` |
| 4 | uint32 little-endian version `4` |
| 8 | `mmmm` MIDI effect; `aaaa` audio effect; `iiii` instrument |
| 12 | `meta` |
| 16 | uint32 little-endian metadata length `4` |
| 20 | metadata bytes; value `0` in these templates |
| 24 | `ptch` |
| 28 | uint32 little-endian payload **byte** length |
| 32 | UTF-8 patcher JSON, with a final NUL inside the declared length in these templates |

These are local observations, not a published universal file specification.
Preserve the template's header and NUL convention. Older CoLaB notes that write
metadata value `1` or assume every device is `mmmm` are not authoritative for
these installed templates. Never discard unknown chunks to force a file through
this simple layout.

## Helper

Run from this skill's directory:

```powershell
python scripts/amxd.py inspect "C:\ProgramData\Ableton\Live 12 Suite\Resources\Misc\Max Devices\Max MIDI Effect.amxd"
python scripts/amxd.py pack --template "C:\ProgramData\Ableton\Live 12 Suite\Resources\Misc\Max Devices\Max MIDI Effect.amxd" --patcher "C:\path\device.maxpat" --output "C:\path\Device.amxd"
python scripts/amxd.py inspect "C:\path\Device.amxd"
python -B -m unittest discover -s scripts -p "test_amxd.py"
```

Use the Audio Effect or Instrument template for those categories. The helper
does not infer a device category from the object graph. Existing output requires
explicit `--force`; inputs cannot be used as outputs.

The helper validates the supported envelope and JSON graph. It cannot prove
that an object class exists, that JavaScript runs in Max, that all dependencies
resolve, or that Live accepts the device. Unsupported/frozen layouts must be
opened through Max rather than rewritten by this helper.

## Dependencies and distribution

- An unfrozen `.amxd` can depend on neighboring JS, abstractions, samples,
  externals, or bridge executables. Include all required files and preserve their
  relative layout; a complete folder is a legitimate deliverable when specified.
- For a single-file deliverable, collect dependencies, resolve dynamic file
  references, then freeze **and save** in Max. Verify the resulting frozen device
  from a location without the development search path.
  [Cycling '74 freezing guide](https://docs.cycling74.com/userguide/m4l/live_freezing/).
- Node subprocesses and external vendor installations may need additional
  packaging. Do not promise that freezing automatically embeds an independently
  launched executable or installs a vendor application.
- Declare the Node module format in a neighboring `package.json` and include it
  in the installed package. A CommonJS `.js` manager can fail when a parent of
  the User Library contains `"type": "module"`. Test the packaged manager under
  such an ancestor using the bundled Node version; do not edit that ancestor.
- Confirm OS/architecture compatibility and redistribution rights for bundled
  externals and binaries. Keep license material and hashes with distributable
  packages. Avoid absolute developer-machine paths in shipped patches.

## Verification ladder

1. **Static/package:** correct container/category; unique object IDs; valid cord
   endpoints and indices; intended MIDI/audio routing; required files present.
2. **Logic:** test the changed protocol, parameter transformation, state machine,
   or process lifecycle. Mock `max-api` outside Max instead of installing an
   unrelated replacement; Max provides it to `node.script`.
   [Node for Max interfaces](https://docs.cycling74.com/legacy/max8/vignettes/07_n4m_maxapi).
3. **Host:** load on the proper track in a safe test set; inspect Max console;
   verify presentation, initialization, controls, and signal behavior. Save and
   reopen, duplicate/remove the device, and check for leaked helpers or observers.
   Test automation/preset recall when applicable.
4. **Distribution/hardware:** install to the configured User Library, reopen from
   there, and test the requested physical I/O or vendor integration. Discover the
   library path instead of assuming the default Documents folder.

Report each level separately. Screenshot evidence proves appearance, not MIDI
correctness or independent physical inputs. A failed desktop helper limits host
validation; successful package tests remain useful evidence.

If Windows reports `Error 127 loading external node.script`, inspect the actual
Max runtime and search paths before changing JavaScript. In the validated local
case, Live's bundled Max 9.0.10 found a Max 9.1.4 external through an overly broad
installation-root search path; that external imported a missing MaxAPI function.
Back up and remove only the conflicting path, then restart a saved/test host.
Do not mix runtime DLLs or redistribute Max externals to mask the conflict.
