# LLM Voice Player — a bot that plays *and speaks*

**Date:** 2026-06-10
**Status:** Phase 0 ✅ proven · Phase 1 ✅ (`agents/shared/`) · Phase 2 ✅ (LLMBrain, `mode: smart|stupid`)
— next: Phase 3 (ears).
Phase 0 (2026-06-12): bot spoke Persian into a prod room, heard by a human.
Findings: (1) the rtc-node FFI needs each AudioFrame's PCM **copied** into a fresh Int16Array —
subarray views transmit silence; (2) `SOURCE_MICROPHONE` plays through the app's RemoteAudioSink
with **zero app changes**; (3) Azure `raw-48khz-16bit-mono-pcm` → AudioSource(48000, 1) works
as-is. Reference implementation: `agents/reviewer/spike-tts.ts` (keep until Phase 1 lands
`shared/` publish helpers, then delete).

## Goal
Turn the bots from silent rule-based players into an **LLM voice player**: a bot that
joins the game, **listens** to every turn, **reasons** about roles + the right move, plays
the game (propose / vote / mission) via the API, and — **when the speaking timer reaches
its turn** — **speaks** to the table in Persian like a real player. Crucially it **plays to win
for its side**: a good player analyzes the game, flushes out evil, and steers good to victory
(carefully if it's Merlin/Percival, without exposing itself); an evil player deceives, blends in,
protects its allies, and steers evil to victory. It uses its full ~30–50s slot to make its case.

Because this game enforces strict turn-taking (one speaker at a time, no out-of-turn talk),
there is **no real-time/interruption complexity**: the bot simply composes and speaks one
statement during its ~50s slot. That makes this far more tractable than a general voice agent.

## The four parts (and what already exists)
| Part | Role | Status |
|---|---|---|
| 👂 **Ears** | hear every turn → running memory | ✅ exists in `agents/reviewer` (LiveKit subscribe + Azure STT + turn segmentation) |
| 🧠 **Mind** | deduce roles, choose the move, choose what to say | ◑ the LLM client + the `Brain` seam exist; **new** = an `LLMBrain` + fresh in-game prompts (the detective's prompts are post-game, not reusable as-is) |
| ✋ **Hands** | propose / vote / mission via the API | ✅ exists in `agents/bot-supervisor` (`AgentEngine`: observe→decide→execute) |
| 🗣️ **Mouth** | text → Persian speech → into the room | 🆕 **the one genuinely new piece** (Azure TTS + LiveKit publish) |

## Key technical facts (grounded in the code)
- `Brain` interface = `decide(ctx): Promise<Action | null>` (`bot-supervisor/src/brains/Brain.ts`).
  An `LLMBrain` is a drop-in next to `RuleBrain`, selected by `mode: smart` in the bot's yaml.
- `AgentEngine` already runs `observe → decide → [jitter] → execute` polling the API.
- The reviewer's `LiveKitBot` **subscribes** to audio (`AudioStream` → `onAudioFrame`) and
  explicitly **never publishes** — publishing is the inverse with the same `@livekit/rtc-node`
  (an `AudioSource` → `LocalAudioTrack` → `localParticipant.publishTrack`).
- Azure Speech is used via **REST** for STT (`…stt.speech.microsoft.com/…/v1`). **TTS is the
  sibling endpoint** (`…tts.speech.microsoft.com/cognitiveservices/v1`, SSML → audio), same
  region + key. Persian voices are available (e.g. `fa-IR-DilaraNeural`).
- The bot knows whose turn it is from the **`speaking-timer` broadcast** (the same one the
  reviewer reads): `timerRunning ? speakingOrder[currentSpeakerIndex] : null`.

## Where it lives + the shared package
The voice bot is a **bot** (it plays via the API through `AgentEngine`) that **also joins
LiveKit** for the ears + mouth. Since it reuses the reviewer's LLM client, Azure speech, and
LiveKit audio, this is exactly the trigger for the **`agents/shared/`** workspace package we
flagged in `agents/README.md`. So:

```
agents/
  shared/          ← NEW: llm client, azure speech (STT + TTS), livekit audio helpers
  bot-supervisor/  ← gains LLMBrain + a VoiceLayer (uses shared/)
  reviewer/        ← refactored to import the shared pieces (no behavior change)
```

**VoiceLayer** = the bot's LiveKit presence, running alongside the API-playing `AgentEngine`:
it joins the game's LiveKit room (by room code, with the same LiveKit creds the reviewer uses),
**subscribes** (ears → STT → memory) and **publishes** (mouth → TTS) on the bot's turn.

Two details to nail:
- **Turn detection / identity.** The bot must join LiveKit under an identity that maps to its
  player, so the `speaking-timer` order includes it and it can tell when it's the current
  speaker (`speakingOrder[currentSpeakerIndex] === me`). Its speech is then correctly attributed
  — and, nicely, **captured by the reviewer** like any player's, if review is on.
- **Audio format.** Azure TTS PCM must reach the LiveKit `AudioSource` in the format it expects
  (sample rate / mono); resample if needed — the mirror of the reviewer's STT frame path.

**Why the LiveKit *SDK* and not the LiveKit *Agents* framework:** the Agents framework is built
for *conversational* assistants — VAD-driven turn-taking ("respond when the user stops talking")
+ interruptions. Our turns are controlled by the **game's speaking timer**, not voice activity,
and there's no back-and-forth — so its core abstraction is the wrong fit. We use the raw SDK
(`@livekit/rtc-node`) for transport and build the (game-specific) "speak on my slot" orchestration
ourselves. We reuse Azure (STT/TTS) and Gemini directly, not via Agents plugins.

---

## Phases

### Phase 0 — Spike: prove the mouth (de-risk) 🗣️
A throwaway standalone script (no game logic): join a LiveKit room as a participant, take a
**hardcoded Persian sentence**, run **Azure TTS** → PCM, **publish** it to the room via
`@livekit/rtc-node`.
- **Deliverable:** a throwaway script (e.g. `agents/spike-tts.ts`), deleted once proven.
- **Verify:** join a LiveKit room with a human listening — run against the **real** LiveKit
  (the VM's) + Azure so it exercises the actual stack → the human **hears the bot speak
  Persian**. Proves the only unknown (TTS REST + audio publish + audible in-room) up front.
- If this works, everything else is wiring parts we already have.

### Phase 1 — Shared foundation 📦
Extract `agents/shared/` (npm workspaces): the LLM client, Azure speech (**add a `synthesize`
TTS function** beside the existing STT), and LiveKit audio helpers (**add a `publishPcm`
helper** beside the subscribe path). Refactor `reviewer` to import from `shared/` — **no
behavior change** (reviewer tests must still pass).
- **Verify:** reviewer typecheck + 51 tests still green; `shared/` builds.

### Phase 2 — LLMBrain: mind + hands, no voice yet 🧠✋
A new `bot-supervisor/src/brains/LLMBrain/` implementing `Brain.decide()` with the LLM: given
the `Observation` (game state) + a running text memory, it decides the **action** for whatever
decision point is live. It must cover **every decision the `RuleBrain` does**: confirm role,
team-building (as leader), vote approve/reject, mission success/fail, Lady-of-the-Lake, and the
endgame Merlin guess (assassin). Selected via `mode: smart` in the bot yaml (vs `stupid` = the
unchanged `RuleBrain`).
- **Verify:** a `smart` bot plays a full game **via the API only** (no voice) against `stupid`
  bots — makes legal, sensible moves at every decision point.

### Phase 3 — Ears: the bot listens 👂
The voice bot joins LiveKit (reuse the reviewer's subscribe path from `shared/`), transcribes
each completed turn (Azure STT), and appends `{speaker, what they said}` to its **running
memory** — fused with the game mechanics it already polls (votes, proposed teams, quest
outcomes). The same kind of memory the blind detective keeps, but live during its own game.
- **Verify:** after a few turns, the bot's memory reflects who said what; its LLMBrain
  decisions can now cite the discussion, not just the API state.

### Phase 4 — Mouth: speak on its turn 🗣️
When the `speaking-timer` broadcast shows the bot is the current speaker, the `LLMBrain`
generates a **substantive turn statement** (~30–45s of speech) that uses the slot to **advance
its side's win** — from memory + game state + its own role/intel → **Azure TTS** → **publish**.
Good: analyze, flush out evil, support good teams (subtly if Merlin/Percival). Evil: deceive,
blend in, protect allies, sow doubt. Sized to finish before the ~50s timeout (not cut off).
- **Verify:** in a real game, on the bot's turn it **speaks a relevant Persian statement** the
  table can hear, consistent with its role and the discussion so far.

### Phase 5 — Polish, config, verify ✅
- Config knobs (per bot yaml): `mode: smart`, `gender` (→ voice) / explicit `voice`, `persona`,
  temperature, target statement length.
- Robustness: TTS/LLM failure is non-fatal (skip the turn gracefully — silence beats a crash);
  cost guard (token/char budget per game); only speak in a voice-enabled game.
- End-to-end: a full game where **we play with one LLM voice bot** that talks on its turns.

### Phase 6 — Long-term memory + persona (cross-game enhancement) 🧬
Each bot keeps a **persistent memory across games**, keyed by its identity (e.g. `bot_alice`):
after each game it reflects (LLM: "given your role and how this game went, what's one lesson or
strategy worth remembering?") and appends to a long-term store (a per-bot file or DB row).
Future games load it into the reasoning context, so the bot accumulates experience — wins,
mistakes, reads on recurring opponents — like a human regular. Paired with the configured
**persona** (cautious / aggressive / chatty), each bot becomes a distinct character.
- **Verify:** a bot's long-term memory grows game over game and visibly shapes later play/talk.
- *Built only after the core voice player (Phases 0–5) works.*

---

## Decisions (locked)
1. **Mode flag:** `mode: smart | stupid` per bot yaml. `stupid` = today's `RuleBrain` (zero
   behavior change); `smart` = the LLM voice player.
2. **Shared package:** extract `agents/shared/` (npm workspaces). The reviewer refactors onto
   it with no behavior change. (Cross-importing from `reviewer/` was rejected — tangles the
   independent Docker builds.)
3. **Voice:** per-bot in the yaml, **gendered** — a female voice (`fa-IR-DilaraNeural`) for
   "girl" bots, male (`fa-IR-FaridNeural`) for "boy" bots; tunable rate/pitch via SSML.
4. **Memory:** fuse **live STT of the talk** (what each player said) **+ game mechanics**
   (votes, proposed teams, quest outcomes from the API). Both update the running memory and
   feed reasoning + speech — so the bot reasons over *what was said* and *what happened*.
5. **Speak every turn, filling the slot.** No pass — and *not* a terse one-liner: a substantive
   ~30–45s statement using the window for real analysis/persuasion in service of its side (sized
   to finish before the ~50s timeout).
6. **Prompts:** fresh in-game reasoning prompts — partial info, acting + speaking as a secret
   role, **playing to win for its side** (good: deduce evil + steer good to win; evil: deceive +
   steer evil to win, stay hidden). Distinct from the detective's neutral post-game deduction.
7. **Long-term memory + persona (new):** each bot keeps a persistent cross-game memory and a
   configured persona — see Phase 6.

## Risks
- **Mouth reliability** (Phase 0 retires most of this): TTS REST + LiveKit publish + audible.
- **Play quality:** Avalon is hard for LLMs (hidden info, deception, persuasion). Expect an
  "okay but readable" player first; iterate on prompts.
- **Cost:** STT (continuous) + LLM (per decision + per turn) + TTS (per turn) every game.
- **Voice naturalness / latency within the slot** (low risk given the 50s budget).

## Build order
0. Spike (mouth). → 1. `agents/shared/` (+ TTS, + publish). → 2. LLMBrain (API-only).
→ 3. Ears (STT + mechanics memory). → 4. Mouth on-turn. → 5. Polish + config + end-to-end.
→ 6. Long-term memory + persona (enhancement).
