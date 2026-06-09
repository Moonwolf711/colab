# Anima → moonpie (Pi-synth) integration notes

Notes on how **Anima** (Fullive-AI/Anima, Apache-2.0 — "an open-source Agent OS for hardware
intelligence") could give the **Pi-synth ("moonpie")** a sense → learn → act loop instead of
the synth passively waiting for commands. Grounded in Anima's actual `README.md`
(vendored at `E:\Projects\_deps\Anima`, gitignored). Bullets use Anima's real primitives:
**Adapter** (`discover()`/`subscribe()`/`execute()`), **Skill** (`SKILL.md` + `references/decide.md`
+ `references/learn.md` + `scripts/actions.py`), the **L1/L2/L3 Memory** stack, and the
OpenAI-compatible **Brain** (LangGraph planner/executor).

- **Write a moonpie Adapter** under `adapters/` next to Anima's `adapters/miot/`. Anima's
  adapter interface is small — `discover()`, `subscribe()`, `execute()`. For moonpie this maps
  to: `discover()` registers the synth as a device on the LAN (its host IP + the CoLaB/synth
  UDP port); `subscribe()` polls/streams current synth state (active patch, filter cutoff,
  tempo); `execute()` translates Anima's structured actions into **plain-text UDP lines to the
  CoLaB M4L device on `8001`** (e.g. `/live/device/set/parameter/value <t> <d> <p> <v>` or a
  `[PARAM]`/`[NOTE]` line) — exactly the protocol the Dial controller in this repo already
  uses. The synth becomes a first-class Anima-controllable device with zero MIoT dependency.

- **Package synth domain knowledge as a Skill** (`skills/custom/moonpie_synth/`) rather than
  hardcoding policy in the Brain or Adapter — Anima explicitly prefers this. `SKILL.md` lists
  the synth's parameters and safe ranges; `references/decide.md` is the single-decision prompt
  ("given time of day, recent activity, and learned preferences, should the pad swell, the
  filter open, the tempo drift?"); `references/learn.md` is the long-term learning prompt;
  `scripts/actions.py` emits the structured actions the Adapter turns into UDP. This is what
  makes moonpie's behavior *contextual* (sense → act) instead of one-shot `note on`.

- **Sense via the Brain's scheduled ticks + environment state.** Anima runs scheduled "brain
  ticks" for proactive environment checks, and aggregates device/environment signals into
  `get_planner_context()`. moonpie can feed the loop with what it can sense — incoming MIDI
  activity, transport play/stop, time of day, or any sensor wired to the Pi — and the Brain
  plans an action within the synth Skill's boundaries each tick. That closes the **sense → plan
  → act** arc: the synth reacts to the room/session rather than waiting to be told.

- **Learn preferred settings through the L1/L2/L3 Memory + learned profiles.** Anima extracts
  candidate memories from interaction history (`history.json` → typed `claim_type` with
  `positive_evidence`/`negative_evidence`, promoted `candidate → confirmed`) and stores a
  per-device-type `learned.json` profile. For moonpie this means it gradually learns your
  habitual patch/filter/tempo choices — "evening = warmer pad, lower cutoff" — and only
  *confirmed* memory feeds decisions, so it adapts to your taste without erratic swings. L1
  (lightweight summary) loads every tick; L3 detail loads only when the synth Skill actually
  runs, keeping the Pi's context cost low.

- **Drive moonpie's Brain with a local/OpenAI-compatible endpoint.** Anima's Brain accepts any
  OpenAI-compatible API via `ANIMA_LLM_API_KEY` / `ANIMA_LLM_BASE_URL`, including
  Ollama-compatible local endpoints. That lines up with the existing moonpie/Jarvis pattern of
  an env-driven local brain (e.g. an Ollama host on the LAN), so the whole sense→learn→act loop
  can run **local-first** on or beside the Pi without a cloud dependency — consistent with
  Anima's stated local-first design.

> Caveats from Anima's README, kept honest: Anima is **early-stage**, ships only a **MIoT
> adapter** today (no synth/OSC adapter exists yet — the moonpie Adapter above is net-new
> work), and its security notes warn to keep automation conservative and never expose the
> dashboard/API to the public internet. Treat this as an integration design sketch, not a
> drop-in.
