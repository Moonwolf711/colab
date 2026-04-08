# Phase 0 — CloudMirror + Live 12.x .als Round-Trip Experiment

**Status: BLOCKING the entire colab Layer 2 architecture.** Until this experiment passes, no code lands in `colab-sync/`. Estimated effort: 10-30 minutes wall clock depending on which tiers you run.

---

## What this gates

The single thing this experiment decides is: **can our materializer produce a Live-acceptable `.als`?** The Strategy C architecture (CFAPI placeholder projection) only works if Live opens a regenerated `.als` byte stream cleanly. If Live rejects, corrupts, or strips data from a round-tripped `.als`, Strategy C is dead and we fall back to Strategy A.

To make the failure mode useful, the experiment is **tiered**. Each tier eliminates one variable from the next-fail debugging surface:

| Tier | What it tests | Cost | Eliminates |
|---|---|---|---|
| **0** | gzip → ungzip → re-gzip round-trip with no XML touch | seconds | The gzip layer as a suspect. If this fails, our gzip impl is broken. |
| **1** | Python `xml.etree.ElementTree` (stdlib) round-trip | seconds | The most common XML parser. If Live accepts ElementTree's output, any "good" XML lib will work. |
| **2** | Python `lxml` round-trip | seconds | A more attribute-preserving parser. If Tier 1 fails but Tier 2 passes, we know we need a serializer that preserves attribute order / whitespace. |
| **3** | CloudMirror CFAPI projection (full Strategy C) | 30+ min | The CFAPI placeholder + filesystem boundary. Only run AFTER Tier 0/1/2 pass. |

**Run them in order. Stop at the first failure.** If Tier 0 passes and Tier 1 fails, we know the issue is XML serialization, not transport. If Tier 1 passes and Tier 3 fails, we know the issue is CFAPI behavior, not the materializer.

---

## Tools you have

Verified on this machine before writing this runbook:

| Tool | Status |
|---|---|
| Python 3.13.5 | ✓ installed |
| `lxml` 6.0.2 | ✓ installed |
| `xml.etree.ElementTree` (stdlib) | ✓ available |
| Test fixtures (`test 1.als`, `test 2.als`) | ✓ on Desktop |
| Visual Studio 2022 BuildTools | ✓ installed (no IDE — `devenv` missing) |
| C++/WinRT + Win11 SDK + CFAPI headers | **unknown — you check before Tier 3** |

For Tier 3 you'll need MSBuild reachable from a terminal. If you don't have C++/WinRT installed, the runbook shows how to add it, but Tier 0/1/2 are the cheap signals worth running first either way.

---

## Pre-flight: inspect what's in your test fixtures

Before running any tier, get a baseline summary of each test file so you know what "structurally correct" looks like for them:

```bash
cd ~/colab
python phase0/als_summary.py "C:/Users/Owner/OneDrive/Desktop/test 1 Project/test 1.als"
python phase0/als_summary.py "C:/Users/Owner/OneDrive/Desktop/test 2 Project/test 2.als"
```

Verified output for both files (they're identical templates):

```
== test 1.als ==
  total_elements:  93252
  tempo:           130.0
  time_sig:        4/4
  tracks:          {'GroupTrack': 7, 'MidiTrack': 14, 'AudioTrack': 11, 'ReturnTrack': 1}
  clips:           {}
  devices:         55
  midi_notes:      0
  sample_refs:     148
  track_names[0:10]: ['PRE MASTER', 'DRUMS', 'KICK', 'SNARE', 'CYMBOLS', 'HH', 'HH CLOSED', 'CRASH', 'MIDS', 'TRIG']
```

These are template files — 33 tracks (7 group + 14 MIDI + 11 audio + 1 return), 55 devices, 148 sample refs, 0 clips, 130 BPM 4/4. After any round-trip, the same numbers should come out the other side. **If the post-round-trip values differ from these, something went wrong.**

## Tier 0 — gzip round-trip

**Goal**: prove the gzip layer is identity-preserving for our `.als` files. This is a sanity check. If it fails, every other tier fails, and the bug is in zlib / gzip metadata handling.

```bash
cd ~/colab
python phase0/tier0_gzip_roundtrip.py "C:/Users/Owner/OneDrive/Desktop/test 1 Project/test 1.als"
```

Expected output:

```
Tier 0: gzip round-trip
  input:    C:\Users\Owner\OneDrive\Desktop\test 1 Project\test 1.als (499080 bytes)
  ungzip:   <N> bytes of XML
  re-gzip:  <N2> bytes
  written:  /tmp/colab-phase0/tier0/test 1.als
TIER 0 RESULT: PASS  XML payload bytes identical, gzip wrapper differs only in metadata
```

**Pass criteria**: the script reports `PASS` and the `<N>` byte count for the ungzipped XML is non-zero.

**Fail criteria**: any error, any data loss, ungzipped XML is empty.

**What you do**:
1. Run the script with `test 1.als` AND with `test 2.als`
2. Open `/tmp/colab-phase0/tier0/test 1.als` in Live 12.x manually (File → Open)
3. **Visually confirm**: track count matches, no error dialog, no "missing samples" warnings, transport tempo correct
4. Hit Save in Live (this forces Live to write the file back through its own serializer; if it accepted the input, it'll accept its own output)
5. Run the verify helper:
   ```bash
   python phase0/verify.py "C:/Users/Owner/OneDrive/Desktop/test 1 Project/test 1.als" "/tmp/colab-phase0/tier0/test 1.als"
   ```
6. **Tell me the verify output.** I update the architecture doc.

---

## Tier 1 — Python ElementTree round-trip

**Goal**: prove a stock-Python XML parser can round-trip a Live `.als` without breaking it. This is the *minimum bar* for the materializer; if Live rejects ElementTree output, we'll need a stricter serializer in `colab-core::als_projector`.

```bash
cd ~/colab
python phase0/tier1_etree_roundtrip.py "C:/Users/Owner/OneDrive/Desktop/test 1 Project/test 1.als"
```

Expected output:

```
Tier 1: Python xml.etree.ElementTree round-trip
  input:        C:\Users\Owner\OneDrive\Desktop\test 1 Project\test 1.als
  ungzip:       <N> bytes of XML
  parse:        OK — root tag = '{http://...}Ableton'
  serialize:    <M> bytes
  re-gzip:      <P> bytes
  written:      /tmp/colab-phase0/tier1/test 1.als
TIER 1 RESULT: PASS  XML serialized cleanly, output differs from input but is structurally a superset
```

The output WILL differ from the input bytes — ElementTree always normalizes attribute order, whitespace, namespace declarations. The question is whether **Live still accepts it**.

**What you do** — same as Tier 0:
1. Run the script for both `test 1.als` and `test 2.als`
2. Open `/tmp/colab-phase0/tier1/test 1.als` in Live 12.x
3. **Visually verify**: track count, names, transport, no error dialog, no missing-data warnings
4. Save from Live
5. Run `python phase0/verify.py <original> <tier1-output>` — also acceptable to compare against the **Live-saved** copy of the tier1 output
6. **Tell me the result.** I update the architecture doc.

If Live gives an error dialog OR refuses to open the file OR opens with corrupted state, **STOP**. Do not run Tier 2 or Tier 3 yet — paste me the exact error message and I will tell you what next.

---

## Tier 2 — Python lxml round-trip

**Goal**: same as Tier 1 but with lxml, which preserves attribute order and CDATA more faithfully than ElementTree. Run this **only if Tier 1 fails**, OR if you want a second data point.

```bash
cd ~/colab
python phase0/tier2_lxml_roundtrip.py "C:/Users/Owner/OneDrive/Desktop/test 1 Project/test 1.als"
```

Output and verification flow are the same shape as Tier 1.

If Tier 2 also fails, we have a structural problem with XML round-trips against Live's `.als` schema and Strategy C is in serious trouble. That's important information — paste me the failure details immediately.

---

## Strategy D survival test (orthogonal — not a tier)

**Status: optional but cheap (≤ 2 minutes per fixture). Run alongside Tier 1 or Tier 2 if curious.**

### What Strategy D is

The architecture synthesis defines four candidate strategies for combining a CRDT envelope with a Live-readable `.als`:

| Strategy | What it does | Verdict |
|---|---|---|
| **A** | Sidecar `.colab` file lives next to the `.als`. Two files, two lifecycles. | Mac/Linux fallback; ugly UX but always works. |
| **B** | Custom 64-byte header prepended to the gzip stream in the same `.als` file. | Dead per RFC 1952 — gzip magic must be at offset 0; Ableton's loader is strict. |
| **C** | CFAPI placeholder projects the `.als` bytes on-demand from the CRDT state. | Recommended. The whole point of Tiers 0-3 above. |
| **D** | Hide CRDT metadata inside the `.als` itself by injecting a custom XML element (e.g. `<COLABSentinel>`) under `<LiveSet>`. | **Predicted dead** — Live's in-memory model doesn't know about unknown elements, so it strips them on save. Universal pattern across reverse-engineered DAWs. |

Strategy D is the only one of the four whose verdict is a **prediction, not a verification**. This 2-minute test cheaply falsifies the prediction. If it survives Live's save, Strategy D becomes a viable backstop and the architecture has a second option without needing CFAPI at all.

### What this test does NOT answer

This test is orthogonal to the gzip/serializer/CFAPI tier ladder. Tiers 0-3 ask "can our materializer produce a Live-acceptable `.als` byte stream?" — Strategy D asks "does Live preserve unknown XML across save?" Different question, complementary signal. **Run it after Tier 1 or Tier 2 has already proven the materializer works**, otherwise a failure could be the materializer rather than Live's element-stripping.

### Generate the sentinel fixtures

```bash
cd ~/colab
python phase0/make_sentinels.py "C:/Users/Owner/OneDrive/Desktop/test 1 Project/test 1.als"
```

Expected output:

```
Strategy D sentinel generator
  input:    C:\Users\Owner\OneDrive\Desktop\test 1 Project\test 1.als (499080 bytes)
  username sentinel:
    track:   GroupTrack Id=...
    edit:    'PRE MASTER' -> 'PRE MASTER [COLAB-PHASE0-USERNAME]'
    written: /tmp/colab-phase0/sentinels/test 1-sentinel-username.als (... bytes)
  custom-element sentinel:
    tag:     <COLABSentinel Value='phase0-strategy-d-test'/>
    written: /tmp/colab-phase0/sentinels/test 1-sentinel-custom.als (... bytes)
STRATEGY D GENERATOR RESULT: PASS  fixtures ready for manual Live test
```

The generator emits two fixtures, each isolating a different question:

| Fixture | Tests | Expected outcome |
|---|---|---|
| `test 1-sentinel-username.als` | Does Live preserve edits to *known schema fields* (UserName)? | **Survives.** If it doesn't, even safe field edits are dangerous and the differ design changes. |
| `test 1-sentinel-custom.als` | Does Live preserve *unknown* XML elements (Strategy D)? | **Stripped** (prediction). If it survives → SURPRISE, Strategy D viable. |

### The manual loop (per fixture, ≤ 1 minute each)

1. Open `/tmp/colab-phase0/sentinels/test 1-sentinel-username.als` in Live 12.x.
   - Look at the leftmost track. The name should contain `[COLAB-PHASE0-USERNAME]`.
   - **If Live errors on load or shows no sentinel: stop here, paste me the symptom.**
2. `File → Save` (overwriting the same file).
3. Run the verifier:
   ```bash
   python phase0/make_sentinels.py --verify username "/tmp/colab-phase0/sentinels/test 1-sentinel-username.als"
   ```
4. Repeat for the custom-element fixture:
   ```
   /tmp/colab-phase0/sentinels/test 1-sentinel-custom.als
   ```
   then:
   ```bash
   python phase0/make_sentinels.py --verify custom "/tmp/colab-phase0/sentinels/test 1-sentinel-custom.als"
   ```

### Pass/fail criteria

| Outcome | What the verifier prints | What it means |
|---|---|---|
| Username sentinel survives | `STRATEGY D / USERNAME RESULT: PASS  sentinel '[COLAB-PHASE0-USERNAME]' survived Live save` | Schema-field edits are safe. Expected and required for the differ design. |
| Username sentinel missing | `STRATEGY D / USERNAME RESULT: FAIL  sentinel … stripped or moved` | Even safe edits get touched. Investigate before any further work. |
| Custom element stripped | `STRATEGY D / CUSTOM RESULT: STRIPPED  <COLABSentinel> removed by Live (as predicted)` | **Strategy D dead, prediction confirmed. Strategy C is the only path.** Not a script failure — this is the predicted outcome. |
| Custom element survives | `STRATEGY D / CUSTOM RESULT: SURVIVED  <COLABSentinel> preserved across Live save` | **Surprise.** Strategy D is viable. Tell me immediately so the canonical doc gets a new option in the strategy table. |

### Why this is worth 2 minutes

The architecture currently picks Strategy C and treats Strategy D as "near-certain dead based on first principles." Spending 2 minutes to convert "near-certain" to "verified" is cheap insurance. If the prediction holds (most likely), the architecture doc becomes more authoritative. If the prediction is wrong, the architecture has a second viable option that's strictly simpler than CFAPI — and that's worth knowing before Phase 1 starts.

---

## Tier 3 — CloudMirror CFAPI projection (full Strategy C)

**Goal**: the actual unblock-gate test. Build the [Microsoft CloudMirror sample](https://github.com/microsoft/Windows-classic-samples/tree/master/Samples/CloudMirror), register a CFAPI sync root, project a Tier 1/2-validated `.als` through CFAPI, open in Live, save, verify bytes.

**Prerequisites** (check before starting):

```powershell
# Open a Developer Command Prompt for VS 2022 (Start menu → Visual Studio 2022 → Developer Command Prompt)
where msbuild
where cl
```

If those commands fail, you need to install the C++/WinRT workload:

1. Open the **Visual Studio Installer** (already on your machine)
2. Click **Modify** on the Build Tools 2022 entry
3. Workloads tab → check **Desktop development with C++**
4. Individual components tab → ensure **Windows 11 SDK (10.0.22621.0 or newer)** is checked
5. Individual components tab → search for and check **C++/WinRT**
6. Click **Modify** to install (~5 GB)

A sparse clone of the CloudMirror sample is already on this machine at:

```
~/colab/phase0_external/CloudMirror/Samples/CloudMirror/
```

That directory is **gitignored** (the clone is Microsoft's code with its own git history; we don't vendor it into the colab repo). If it's missing, recreate it with:

```powershell
cd ~/colab
mkdir phase0_external
cd phase0_external
git clone --depth 1 --filter=blob:none --sparse https://github.com/microsoft/Windows-classic-samples.git CloudMirror
cd CloudMirror
git sparse-checkout set Samples/CloudMirror
```

Once the prereqs are present:

```powershell
# Build via MSBuild (no IDE needed)
cd ~/colab/phase0_external/CloudMirror/Samples/CloudMirror
msbuild CloudMirror.vcxproj /p:Configuration=Release /p:Platform=x64
```

Expected: a `CloudMirror.exe` under `Release/x64/`.

**Then the manual steps** (~20 min):

1. Pick a clean directory to use as the CFAPI sync root, e.g., `C:\colab-phase0-syncroot\`
2. Edit CloudMirror's source (or use its config) so its "server" folder points at the round-tripped `.als` from Tier 1 — i.e., the projected file the kernel asks CloudMirror about IS the round-tripped one
3. Run `CloudMirror.exe`. It registers the sync root with `cldflt.sys` and starts serving callbacks
4. Open Explorer → `C:\colab-phase0-syncroot\` → confirm a placeholder for the `.als` is visible
5. **In Live**, File → Open → `C:\colab-phase0-syncroot\test 1.als`
6. **Visually verify**: same checks as Tier 1 (track count, names, no errors)
7. Hit **Save** in Live
8. CloudMirror's kernel callback will fire on save completion. Watch its console output for any callback errors
9. Run verify.py against the saved file
10. **Tell me the result.**

**Stale-state hazard** (per the [Microsoft CloudMirror README](https://github.com/microsoft/Windows-classic-samples/tree/main/Samples/CloudMirror)): "if you hydrated some files while testing and then shut down the sample, you should delete everything from the sync root folder before re-running." If you re-run Tier 3, **delete `C:\colab-phase0-syncroot\` contents first.**

---

## Pre-verified by automation

Before you do any manual Live work, the script chain has already been verified end-to-end on this machine:

| Step | Result | Notes |
|---|---|---|
| `als_summary.py` on both fixtures | ✓ | Both files: 93,252 elements, 33 tracks, 55 devices, 148 sample refs, identical structure |
| Tier 0 (gzip round-trip) on `test 1.als` | ✓ | XML payload bytes identical, 5.16 MB ungzipped |
| Tier 0 (gzip round-trip) on `test 2.als` | ✓ | XML payload bytes identical, 5.16 MB ungzipped |
| Tier 1 (ElementTree) on `test 1.als` | ✓ | -129929 bytes (whitespace normalization), output re-parses |
| Tier 1 (ElementTree) on `test 2.als` | ✓ | -129927 bytes, output re-parses |
| Tier 2 (lxml) on `test 1.als` | ✓ | -191412 bytes, output re-parses |
| Tier 2 (lxml) on `test 2.als` | ✓ | -191410 bytes, output re-parses |
| `verify.py` original vs Tier 1 output | ✓ | All structural metrics identical (93,252 elements, 33 tracks, 55 devices, 148 sample refs) |
| `verify.py` original vs Tier 2 output | ✓ | All structural metrics identical |

**What this proves so far**: Python + lxml can round-trip a Live 12.x `.als` through XML parse/serialize and produce a file that's structurally identical to the input from our verifier's perspective. The bytes-on-disk differ (lxml normalizes whitespace and shrinks the file by ~3.7%), but every track, every device, every sample reference, and the tempo/timesig all survive cleanly.

**What this does NOT prove**: that Live 12.x will *accept* the round-tripped file. That's what you test next, manually.

## Reporting back

Whichever tier(s) you run, the output format I need to update the architecture doc is:

```
Tier:          0 / 1 / 2 / 3
Fixture:       test 1.als / test 2.als
Round-trip:    PASS / FAIL  (script result)
Live opens:    YES / YES with warnings / NO
Live saves:    YES / NO
Verify output: <paste the verify.py output>
Notes:         <anything visually wrong: missing tracks, missing devices, etc.>
```

That's the minimum. Anything else (screenshots, error dialog text, console output from CloudMirror) is bonus and welcome.

---

## What I do after you report

- **All tiers pass** → update the canonical doc with "Phase 0 verified on 2026-04-XX, Strategy C confirmed viable", unblock implementation, `cargo new colab-sync`, Phase 1 begins
- **Tier 0 passes, Tier 1 fails** → ElementTree is too lossy, switch the materializer to lxml-with-explicit-attribute-preservation as the first choice for `colab-core::als_projector`
- **Tier 1 fails AND Tier 2 fails** → no Python XML lib survives. Look at quick-xml (Rust) for the materializer with explicit byte-level preservation. If even that fails, Strategy C is dead.
- **Tier 1/2 pass, Tier 3 fails** → CFAPI is the problem. Switch to Strategy A (sync root via Mac File Provider equivalent on Windows — likely just a file watcher + atomic rename, no CFAPI, no kernel boundary). Same Loro core, different filesystem boundary. Less elegant but still works.

Either way, the result tells us exactly what to do next. There is no "we don't know" outcome.
