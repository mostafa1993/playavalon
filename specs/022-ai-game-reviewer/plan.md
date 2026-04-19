# Implementation Plan: AI Game Reviewer / Summarizer

**Branch**: `022-ai-game-reviewer` | **Date**: 2026-04-19

## Summary

An agentic post-game reviewer that produces a rich narrative report of an Avalon match. For every quest, the report names the leader, the proposed team, summarizes each speaker's talk (key points, suspicions, defenses, stance), the vote breakdown, and — when accepted — the mission picks (red/blue) and result. A final "who was who" section reveals roles. Report is produced in **both Persian and English** (language tab).

Two input streams feed the agent:

- **Structured game state** already in Supabase: proposals, votes, mission picks, role assignments, quest outcomes.
- **Per-speaker transcripts** captured server-side by a headless LiveKit bot during each player's speaking turn, transcribed by Azure Speech-to-Text (`fa-IR`).

Agent is LLM-driven (Gemini 3.5 Pro on GCP Vertex AI — chosen for strong Persian quality, huge context window, and cost fit with available GCP credits). Multi-stage pipeline with long-term per-player memory ("dossiers") that evolves across turns, yielding high-quality final narrative.

## Technical Context

**Language/Version**:
- Web app (existing): TypeScript 5.x, React 18+, Next.js 14+ App Router.
- Agent (new): TypeScript 5.x on Node.js 20+, standalone service.

**Primary Dependencies (agent)**:
- `@livekit/rtc-node` — LiveKit server-side RTC client for subscribing to participant audio.
- Azure Speech REST endpoint (`fa-IR`) via `fetch` — no heavy SDK needed.
- `@google-cloud/vertexai` — Gemini 3.5 Pro client.
- `@supabase/supabase-js` (service-role, read-only for game state).
- `js-yaml` for prompt files.

**Storage**:
- **Disk** (Docker volume) for all transcripts, dossiers, per-quest summaries, and final narratives. One directory per game under `/data/games/<game_id>/`. Atomic writes.
- **Supabase Postgres** for only: `rooms.ai_review_enabled` toggle, `room_ai_consents` per-player, and a lightweight `game_reviews` status row. No transcripts or summaries in DB.

**Services**:
- Azure Speech-to-Text (language: `fa-IR`, format: detailed, confidence, words).
- GCP Vertex AI (Gemini 3.5 Pro).
- Existing LiveKit server (running in-compose, `network_mode: host`).

**Target Platform**: Web (desktop-first), same as main app.

**Project Type**: Next.js full-stack app + new standalone Node agent service (both in same repo, both containerized by the same `docker-compose.yml`).

**Scale/Scope**: Single concurrent game on this VM (10-12 fixed players). One long-lived agent process that joins whichever game is currently active.

**Performance Goals**:
- Recorder bot memory: < 200MB per active game.
- STT latency: ≤ 10s per turn (Azure fast path).
- Per-turn summarization LLM call fires in parallel with the next turn's speech; invisible to game flow.
- Final narrative generation at `game end`: under 60s total (two language passes + role reveal).

**Constraints**:
- All transcription + LLM + storage happens on the VM (not on player devices).
- Audio is never persisted — only transcripts.
- Nothing AI-related is visible to any player (including manager) during the game.
- Consent-gated: every player must agree before a game can start with AI review enabled.

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| TypeScript strict mode | ✅ | Agent uses strict TS; shared types. |
| Domain logic in `lib/domain/` | ✅ | Web-app logic changes (toggle/consent/gate) live in existing domain. Agent domain is its own package. |
| Component size < 150 lines | ✅ | `AIReviewToggle` and `AIConsentModal` are small. |
| RLS / server-side security | ✅ | Toggle + consent writes happen in Next.js API routes with service-role checks. Agent only reads DB. |
| Spec-driven development | ✅ | This document. |
| Consent + privacy | ✅ | Explicit toggle + per-player opt-in required before recording. |

## Architecture overview

```
┌──────────────────────────────────────────────────────────┐
│                       Next.js app                         │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ Lobby UI     │  │ API routes     │  │ Review page  │  │
│  │ - toggle     │  │ - ai-review    │  │ /game/[id]/  │  │
│  │ - consent    │  │ - ai-consent   │  │   review     │  │
│  └──────┬───────┘  │ - distribute   │  └──────┬───────┘  │
│         │           │   (gated)      │         │          │
│         └───────────┴──┬─────────────┘         │          │
│                        ▼                       ▼          │
└──────────────────────┬───────────────────┬────────────────┘
                       │                   │ reads JSON
                       ▼                   │
             ┌──────────────────┐          │
             │    Supabase      │◄─────────┤
             │ rooms / games /  │   reads  │
             │ game_reviews /   │          │
             │ consents         │          │
             └─────┬────────────┘          │
                   │ status watcher         │
                   ▼                        │
┌────────────────────────────────────────┐  │
│             agent service (Node)        │  │
│  ┌───────────────────────────────────┐  │  │
│  │ gamestate/watcher.ts              │  │  │
│  │  - detects status='started'       │  │  │
│  │  - detects status='completed'     │  │  │
│  └─────────────┬─────────────────────┘  │  │
│                ▼                         │  │
│  ┌───────────────────────────────────┐  │  │
│  │ bot/livekitBot.ts  (joins room)   │──┼──┼──► LiveKit
│  │ bot/timerListener.ts              │  │  │   (same VM)
│  │ bot/turnSegmenter.ts              │  │  │
│  └─────────────┬─────────────────────┘  │  │
│                ▼ audio clip per turn     │  │
│  ┌───────────────────────────────────┐  │  │
│  │ stt/azureSpeech.ts                │──┼──┼──► Azure Speech
│  └─────────────┬─────────────────────┘  │  │
│                ▼ transcript              │  │
│  ┌───────────────────────────────────┐  │  │
│  │ reviewer/turnSummarizer.ts        │──┼──┼──► Gemini (Vertex)
│  │ reviewer/playerDossier.ts         │──┼──┤
│  │ reviewer/questSynthesizer.ts      │──┼──┤
│  │ reviewer/roleRevealRenderer.ts    │──┼──┤
│  │ reviewer/finalNarrative.ts (fa+en)│──┼──┘
│  └─────────────┬─────────────────────┘  │
│                ▼                         │
│  ┌───────────────────────────────────┐  │
│  │ storage/atomicWrite.ts → disk     │──┼──► /data/games/<id>/
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Data flow for a single game

1. Manager toggles "AI Game Review" ON in lobby → `POST /api/rooms/[code]/ai-review { enabled: true }` → `rooms.ai_review_enabled = true`, existing `room_ai_consents` for this room cleared.
2. Every player (including manager) sees an `AIConsentModal` because `ai_review_enabled=true` AND their consent row is absent.
3. Each player clicks "I agree" → `POST /api/rooms/[code]/ai-consent { accepted: true }` → row inserted.
4. Manager clicks Distribute → `POST /api/rooms/[code]/distribute` validates `count(accepted consents) == player_count` (if toggle on). If missing, 412. Otherwise proceeds as today. A `game_reviews` row is created with `status='pending'`.
5. Game starts. Agent watcher detects the new `games` row with `ai_review_enabled=true` and `status='started'`. Updates `game_reviews.status='recording'`.
6. Agent's LiveKit bot joins the room, subscribes to every remote participant's `Track.Source.Microphone`.
7. Agent subscribes to the `speaking-timer` LiveKit data channel (already broadcast by `useSpeakingTimer`). Parses turn boundaries.
8. On each `TurnEnded` event: `turnSegmenter` produces PCM16 clip for that speaker → `azureSpeech.transcribe(clip, 'fa-IR')` → transcript returned → `writeJsonAtomic(turnPath(...), { speaker, transcript, ... })`.
9. Immediately after transcript persists, `turnSummarizer` LLM call runs, then `dossier-update` LLM call runs. Both write to disk.
10. On each `QuestCompleted` event: `questSynthesizer` reads all turn files + DB state (votes, picks, outcome) + all dossiers → writes `quest_<n>.json`.
11. On `games.status='completed'`: agent updates `game_reviews.status='generating'`, runs `roleRevealRenderer` once per language, then `finalNarrative` once per language. Writes `summary.fa.json` and `summary.en.json`. Sets `game_reviews.status='ready'`, populates path columns.
12. Review page `/game/[id]/review` polls `game_reviews` status until `ready`, then renders the summary from disk (via a read-only volume mount and a tiny Next.js API route).

## Project Structure

### New top-level directory

```
agent/
├── package.json
├── tsconfig.json
├── Dockerfile
├── README.md
├── src/
│   ├── index.ts                     # entrypoint, wires watcher → session lifecycle
│   ├── config.ts                    # env-var resolution + constants
│   ├── bot/
│   │   ├── livekitBot.ts            # connects as reviewer-<gameId>, subscribes to mics
│   │   ├── timerListener.ts         # parses 'speaking-timer' data-channel messages
│   │   └── turnSegmenter.ts         # slices each participant buffer on turn boundaries
│   ├── stt/
│   │   ├── azureSpeech.ts           # REST client, PCM16→WAV wrapper
│   │   └── silence.ts               # RMS-based "is silent" filter (optional M5)
│   ├── reviewer/
│   │   ├── llm.ts                   # Vertex client + prompt-file loader + JSON parse
│   │   ├── turnSummarizer.ts
│   │   ├── playerDossier.ts
│   │   ├── questSynthesizer.ts
│   │   ├── roleRevealRenderer.ts
│   │   └── finalNarrative.ts
│   ├── gamestate/
│   │   ├── db.ts                    # read-only Supabase client
│   │   ├── watcher.ts               # status transition detector (3s poll)
│   │   └── eventMap.ts              # DB rows → canonical event shapes
│   ├── storage/
│   │   ├── layout.ts                # path conventions
│   │   ├── atomicWrite.ts           # tmp-write + fsync + rename
│   │   └── schema.ts                # TypeScript types for each JSON file shape
│   └── types.ts
├── prompts/
│   ├── turn-summarizer.yml
│   ├── dossier-update.yml
│   ├── quest-synthesizer.yml
│   ├── role-reveal-fa.yml
│   ├── role-reveal-en.yml
│   ├── final-narrative-fa.yml
│   └── final-narrative-en.yml
└── test/
    └── fixtures/
        ├── sample-game-state.json
        ├── sample-transcripts/
        └── golden-summaries/
```

### New Next.js pieces

```
src/
├── app/
│   ├── api/
│   │   ├── rooms/[code]/ai-review/route.ts      # POST toggle, GET state
│   │   ├── rooms/[code]/ai-consent/route.ts     # POST accept
│   │   └── reviews/[gameId]/route.ts            # GET { status, fa?, en? }
│   └── game/[gameId]/review/page.tsx            # tabbed narrative page
└── components/
    └── lobby/
        ├── AIReviewToggle.tsx
        └── AIConsentModal.tsx
```

Modifications:

- `src/components/Lobby.tsx` — render `AIReviewToggle` (manager only) + `AIConsentModal` (all players, when needed). Disable Distribute button with an explanatory message when consents incomplete.
- `src/app/api/rooms/[code]/distribute/route.ts` — add consent-count gate.
- `src/app/api/rooms/[code]/route.ts` — include `ai_review_enabled`, per-caller consent row, and `consent_count` in response so `useRoom` polling already carries the state.
- `src/app/game/[gameId]/page.tsx` — add "View AI Game Report" button visible only when `game_reviews.status='ready'`.

### On-disk layout (per game)

```
/data/games/<game_id>/
├── meta.json                           # players, roles, seating, start/end ts
├── turn_<quest>_<idx>.json             # one per speaking turn
├── dossier_<player_identity>.json      # evolving long-term memory
├── quest_<n>.json                      # per-quest structured synthesis
├── summary.fa.json                     # final narrative (Persian)
└── summary.en.json                     # final narrative (English)
```

### DB migration: `supabase/migrations/<timestamp>_ai_review.sql`

```sql
-- Manager-controlled toggle
ALTER TABLE rooms
  ADD COLUMN ai_review_enabled boolean NOT NULL DEFAULT false;

-- Per-player consent for a given room; cleared on toggle flip
CREATE TABLE room_ai_consents (
  room_id    uuid REFERENCES rooms(id)   ON DELETE CASCADE,
  player_id  uuid REFERENCES players(id) ON DELETE CASCADE,
  accepted   boolean     NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, player_id)
);

-- Status tracker for the agent's output (no transcripts)
CREATE TABLE game_reviews (
  game_id        uuid PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  status         text NOT NULL CHECK (status IN ('pending','recording','generating','ready','failed')),
  summary_fa_path text,
  summary_en_path text,
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- RLS (read: participants of the game; write: service role only)
ALTER TABLE room_ai_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_reviews     ENABLE ROW LEVEL SECURITY;
-- (policies follow existing patterns in the codebase)
```

## Prompt files

All prompts follow one shape:

```yaml
name: <string id>
model: gemini-2.5-pro
temperature: <float>
max_output_tokens: <int>
response_mime_type: application/json | text/plain
system: |
  <English system instructions>
  # Example in target language where relevant (for narrative prompts)
user: |
  <English user template with {{placeholders}}>
```

Initial files (all instructions in English; Persian narrative prompts include in-line Persian style examples):

1. **`turn-summarizer.yml`** — JSON out. Extracts `{ key_points[], suspicions[], defenses[], stance: 'supports'|'opposes'|'neutral', notable_quotes[] }` from one turn's transcript + context.
2. **`dossier-update.yml`** — JSON out. Inputs: current dossier + new turn summary. Outputs: updated dossier `{ behavior_arc[], stated_claims[], contradictions[], alliance_patterns[], key_moments[] }`.
3. **`quest-synthesizer.yml`** — JSON out. Inputs: all turn summaries + votes + picks + outcome + all dossiers. Outputs: `{ narrative_summary, turning_points[], mvp, suspicious_players[] }` in a language-agnostic shape.
4. **`role-reveal-fa.yml` / `role-reveal-en.yml`** — text out. Natural-language "who was who" section.
5. **`final-narrative-fa.yml` / `final-narrative-en.yml`** — text out. Full narrative assembling per-quest syntheses + role reveal + outcome + overall arc.

## Docker compose additions

```yaml
# add to existing docker-compose.yml
services:
  agent:
    build:
      context: ./agent
    env_file: .env
    volumes:
      - game_reviews_data:/data/games
      - ./agent/prompts:/app/prompts:ro    # edit prompts without rebuild (optional)
    depends_on:
      - livekit
      - redis
    restart: unless-stopped

  app:
    # (existing service) — add read-only mount so review API can read summaries
    volumes:
      - game_reviews_data:/data/games:ro

volumes:
  letsencrypt:
  redis_data:
  game_reviews_data:       # ← new
```

## Environment variables

New entries in `.env` / `.env.example`:

```
# Agent-only (shared with app only where noted)
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=eastus
AZURE_SPEECH_LANGUAGE=fa-IR

GCP_PROJECT_ID=
GCP_VERTEX_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/vertex-sa.json
GEMINI_MODEL=gemini-2.5-pro

# Agent needs service-role DB access
SUPABASE_SERVICE_ROLE_KEY=

# Agent LiveKit identity
LIVEKIT_BOT_IDENTITY_PREFIX=reviewer-
```

## Coordination details

- **Bot participant filtering**: the recorder bot joins LiveKit with identity `reviewer-<gameId>`. `VideoGrid` and any participant-count UI must filter out identities starting with `reviewer-` so the bot never shows as a tile.
- **Turn boundary source**: the `useSpeakingTimer` hook already publishes state on the `speaking-timer` LiveKit data topic with `SpeakingTimerState`. The agent subscribes to the same topic — one source of truth, no DB polling for timer state.
- **Game status detection**: 3s poll of `games` table by the agent. Matches existing 3s polling cadence elsewhere. Supabase realtime is *not* used here (the app doesn't use it either; keep consistent).
- **Review page readiness**: the review page polls `GET /api/reviews/<gameId>` every 10s while `status ∈ {pending, recording, generating}`. When `status='ready'`, renders summary. When `status='failed'`, shows the error message.

## Milestones

Each milestone is independently shippable and produces visible output.

### M1 — Lobby UX + DB (no agent running)

**Scope:**
- Migration applied.
- `AIReviewToggle` wired.
- `AIConsentModal` wired (English copy only).
- Distribute endpoint gated on consent count.
- `useRoom` response extended.

**Exit criteria:**
- Manager can toggle the feature in the lobby.
- All players (including manager) see the consent modal when the feature is on.
- Manager cannot distribute until all players consent; they see a clear blocking message otherwise.
- No recording, no agent, no summary yet — this milestone changes only UX and gating.

### M2 — Recorder bot + STT pipeline (transcripts on disk)

**Scope:**
- `agent/` scaffold + Dockerfile + compose service.
- LiveKit bot joins active games, subscribes to audio.
- `speaking-timer` listener.
- Turn segmenter.
- Azure Speech integration.
- Disk layout + atomic writes.
- `game_reviews.status` advances to `recording` while game runs.

**Exit criteria:**
- After a complete real game with AI review enabled, every turn has a correct `turn_*.json` under `/data/games/<id>/` with a reasonable Persian transcript.
- No summaries yet.

### M3 — Turn summaries + dossiers + quest synthesis

**Scope:**
- Vertex/Gemini client wiring.
- Prompt loader (YAML).
- `turnSummarizer`, `dossier-update`, `questSynthesizer` implementations.
- Per-turn files gain `summary` block; dossiers and quest files land on disk.

**Exit criteria:**
- Full intermediate artifacts on disk after a real game. Content is inspected manually.

### M4 — Final narrative + review page

**Scope:**
- `roleRevealRenderer` (fa + en).
- `finalNarrative` (fa + en).
- `game_reviews.status='ready'` on completion.
- `/game/[id]/review` page with language tabs.
- "View AI Game Report" button on game-over screen.

**Exit criteria:**
- Play one short end-to-end test game; final Persian + English narratives are available via the review page with acceptable quality.

### M5 — Polish

**Scope:**
- Better error paths (`status='failed'` + UI treatment).
- Silence detection (skip STT for near-silent clips; saves cost).
- Regression fixtures + snapshot tests for prompt outputs under `agent/test/fixtures/`.
- Prompt tuning based on first few real games.
- `agent/README.md` operator guide.

**Exit criteria:**
- Agent survives malformed / unexpected inputs without crashing.
- Prompts produce stable outputs on fixtures.

## Resolved decisions

- **Bot participant filtering** — `VideoGrid` and any participant-count UI filter out identities starting with `reviewer-`. Implemented in M2.
- **Consent modal copy** — **English only** (single-language modal, no Persian translation). Drafted in M1.
- **Prompt iteration** — expected to evolve post-launch; YAML is volume-mounted for rapid tuning without rebuilds.
- **Long-transcript safety** — not a concern. `TIMER_DURATION (50s) + AUTO_MUTE_DELAY (5s) = 55s` is the hard ceiling per turn (auto-mute + auto-advance at 55s is already implemented in `useSpeakingTimer`). Always within Azure's ~60s single-shot cap. No batch endpoint needed.
- **Multi-host scaling** — out of scope (single VM by product decision).
- **Cleanup policy** — data kept forever; backup/deletion is a manual ops concern (Docker volume persists).

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Azure Speech Persian accuracy on noisy audio | Medium | Medium | Per-participant subscription isolates each mic; echo-cancellation on client already helps. Inspect early outputs and adjust profanity/format options. |
| LLM hallucination in narrative | Medium | High | Low-temperature extraction prompts; `final-narrative` receives structured inputs (not raw transcripts only); include instruction to cite quote excerpts from transcripts. |
| Bot reconnection drops | Low | Medium | For v1 we don't handle mid-game bot crashes (per product decision). Log loudly. |
| Cost surprise | Low | Low | Azure + Gemini with GCP/Azure credits; silence skip in M5 cuts waste. |
| Consent UX friction | Medium | Low | Toggle off is always an escape hatch for the manager. |

## Dependencies on existing code

- `src/hooks/useSpeakingTimer.ts` — `TIMER_TOPIC = 'speaking-timer'` data channel payload shape is the contract between the existing timer and the new `timerListener`.
- `src/hooks/useRoom.ts` — 3s polling, reused as the transport for consent state to the lobby UI.
- `src/app/api/rooms/[code]/distribute/route.ts` — add consent gate.
- `src/components/Lobby.tsx` — toggle and consent modal insertion points.
- `supabase/migrations/` — one new migration file.
- `docker-compose.yml` — new service + new volume + new mount on `app` service.

## Out of scope for this spec

- Mid-game live transcripts.
- Per-player different narrative views.
- Search across games.
- Public sharing / social previews of reviews.
- On-device / offline STT.
- Multi-language beyond Persian + English.

---

**When this plan is approved, start with M1.**
