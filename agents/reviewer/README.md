# Playavalon AI Reviewer Agent

Standalone Node.js service that records per-player speech during an Avalon game,
transcribes each turn via Azure Speech-to-Text (`fa-IR`), and — in later milestones —
produces a narrative post-game summary via an LLM.

Runs as a Docker Compose service alongside the Next.js app and LiveKit server.
Single-VM deployment, single concurrent game.

## Milestones

- **M2 (this code)**: recorder bot + STT pipeline. Produces `turn_<quest>_<idx>.json` under
  `/data/games/<game_id>/`. No summaries yet.
- **M3**: per-turn summaries + per-player dossiers + per-quest synthesis.
- **M4**: final narrative (fa + en) + review UI.

## Architecture

```
Supabase (games table)  →  watcher  →  gameSession
                                         │
                            speaking-timer data channel (LiveKit)
                                         │
LiveKit room  →  bot (audio tracks)  →  turnSegmenter  →  STT (Azure)  →  disk
```

## Environment

See repo-root `.env.example`. Required vars:

- `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY` — read-only DB access.
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — same values the Next.js app uses.
- `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` — e.g. `eastus`.
- `AZURE_SPEECH_LANGUAGE` — defaults to `fa-IR`.
- `GCP_PROJECT_ID` — GCP project for Vertex AI.
- `GCP_LLM_LOCATION` — region for the LLM model, defaults to `us-central1`.
  Separate from any future embedding-model location.
- `GCP_LLM_MODEL` — defaults to `gemini-3.1-pro-preview`. Must currently be
  a Gemini model ID (the SDK is Google's). Renamed from `GEMINI_MODEL` for
  future flexibility if the code is later adapted to another Vertex-hosted
  model. Individual prompts can override this via a `model:` field in their
  YAML.
- `GOOGLE_APPLICATION_CREDENTIALS` — path to a service-account JSON file
  with the `Vertex AI User` role. In Docker, mount the file as a volume:
  `./secrets/vertex-sa.json:/run/secrets/vertex-sa.json:ro` and set
  `GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/vertex-sa.json` in `.env`.
- Optional overrides:
  - `DATA_DIR` — on-disk output root (default `/data/games`).
  - `PROMPTS_DIR` — YAML prompts dir (default `./prompts`).
  - `LIVEKIT_BOT_IDENTITY_PREFIX` — default `reviewer-`.
  - `GAME_WATCHER_INTERVAL_MS` — polling cadence (default `3000`).
  - `AUDIO_SAMPLE_RATE` — PCM sample rate delivered to STT (default `16000`).
  - `SILENCE_RMS_THRESHOLD` — clips with RMS below this skip STT entirely
    (default `250`). Raise to skip more, lower to transcribe more.
  - `RETRY_MAX_ATTEMPTS` — total attempts for transient-failure retries on
    STT and LLM calls (default `3`).
  - `RETRY_BASE_DELAY_MS` — base exponential-backoff delay (default `500`).
  - `TRANSCRIPT_CORRECTION_ENABLED` — if `true` (default), every non-silent
    STT transcript goes through an LLM proofreading pass
    (`prompts/correct-transcript.yml`) before reaching the summarizer.
    Fixes Persian STT's common error classes (misheard words, wrong verb
    persons, homophones, Persian half-space / number glitches). The
    turn JSON preserves both `transcript` (corrected) and `transcript_raw`.

## Output layout

```
$DATA_DIR/<game_id>/
  meta.json                        # players, roles, seating (written at game start)
  turn_<quest>_<idx>.json          # raw + corrected transcript + summary
  dossier_<playerId>.json          # evolving per-player memory
  quest_<n>.json                   # LLM synthesis of one quest
  record.json                      # the game record (written at game end)
```

`record.json` holds every fact of the game, built in code from the database and
the turn files (`src/gamestate/record.ts`): the roster and seats; each proposal
with its leader, team, each player's vote and its times; each mission's team and
card counts; who used Lady of the Lake on whom; the assassin's pick; the outcome;
and every turn and assassin-phase transcript in order, each turn joined to the
proposal it was about (the first of its quest whose vote closed after the turn
started). A god-mode record adds the roles and the Lady results. A blind-mode
record holds public play only: its build never reads `player_roles` or the Lady
`result`. No record holds who played a fail card (`quest_actions` is never
read). Nothing reads `record.json` yet.

M4 will add `summary.fa.json`, `summary.en.json` + a review UI page.

## Local development

```
npm install
npm run dev
```

## Tests

Regression tests verify prompt YAML files parse, declare the right
`response_mime_type`, and reference exactly the variables the agent code
passes in — catching drift between a prompt and its caller. Plus a few
unit tests for the silence detector.

```
npm test
```

Tests hit no external services (no Azure, no Vertex) so they run in CI
without secrets.
