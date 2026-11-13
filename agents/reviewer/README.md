# Playavalon AI Reviewer Agent

Standalone Node.js service that records per-player speech during an Avalon game,
transcribes each turn via Azure Speech-to-Text (`fa-IR`), and — in later milestones —
produces a narrative post-game summary via an LLM.

Runs as a Docker Compose service alongside the Next.js app and LiveKit server.
Single-VM deployment, single concurrent game.

## Milestones

- **M2**: recorder bot + STT pipeline. Produces `turn_<quest>_<round>_<idx>.json` under
  `/data/games/<game_id>/`.
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
  turn_<quest>_<round>_<idx>.json  # raw + corrected transcript + summary
  dossier_<playerId>.json          # evolving per-player memory
  quest_<n>.json                   # LLM synthesis of one quest
  discussion.json                  # the assassin-phase discussion, if any
  guess_log.json                   # blind mode: the detective's guesses per round
  record.json                      # the game record (written at game end)
  summary.fa.json, summary.en.json # the final report
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

## Replay

`npm run replay` runs every step after speech-to-text again on stored games, with
the same code the service runs (`src/pipeline.ts`), each step as of the time it ran
live. It is how the report's accuracy is measured
(`.plans/2026-11-13-1640-reviewer-report-accuracy.md`, row B).

```
GCP_PROJECT_ID=… GCP_LLM_LOCATION=global GOOGLE_APPLICATION_CREDENTIALS=… \
npm run replay -- --export export.json --folders folders/ --games <id>,<id> \
  --out out/ [--runs N] [--mode god|blind] [--concurrency N]
```

Inputs:

- `--export` — a JSON array of games, each `{game, room, players, roles, proposals,
  votes, lady, events, review}`: the game's rows (`ExportedGame` in
  `src/gamestate/recordSource.ts`). They stand in for the database
  (`src/gamestate/gameReads.ts`).
- `--folders` — one folder per game id, as the service left it. Only the turn files
  and `discussion.json` are read, reduced to what speech-to-text produced: the raw
  transcript, confidence, timing, speaker and indices. A folder with turn files
  named without a round segment (`turn_<quest>_<idx>.json`) is refused.
- `--games` — comma-separated game ids.
- `--mode` — default: the game's mode (`rooms.ai_review_mode`), except god for a game
  whose shipped `summary.fa.json` has no `mode` key (reviewed before migration 025).
  In blind mode the roster comes from the export's `players` rows only.
- `--runs` (default 1), `--concurrency` — turns in flight (default 6).
- Environment: what the service reads for the model — `GCP_PROJECT_ID`,
  `GCP_LLM_LOCATION` (`global` for the preview models), `GCP_LLM_MODEL`,
  `GOOGLE_APPLICATION_CREDENTIALS`, `TRANSCRIPT_CORRECTION_ENABLED`, `RETRY_*`,
  `PROMPTS_DIR`. No database, LiveKit or Azure.

Outputs: each run in `<out>/<gameId>/<mode>/run-<k>/` (k = 1…N), which must be new
or empty; every run folder is checked before the first model call. It starts with
only the inputs — the turn files and `discussion.json` as speech-to-text left them,
and a `meta.json` built from the export (role-free in blind mode). The pipeline
then writes what the service writes: turn files with the corrected transcript and
summary, dossiers, `quest_<n>.json`, `guess_log.json` (blind), `discussion.json`,
`record.json` (in the run's mode), `summary.fa.json` and `summary.en.json`. Last
comes `record.god.json`, the god record with roles that the judge
(`agents/review-judge`) scores every report against, written after every model
step so no blind step can see it. Each run's log ends with its time and its LLM
calls and failures (after the client's retries, which are logged as
`[llm] retry`).

As of the time:

- a turn's summary is grounded on the proposal standing when the turn ended — the
  latest of its quest created by then, as `getLatestProposal` gave it live;
- each player's dossier takes their turns in order;
- in blind mode the detective updates after each round of talk, in order — a round
  per proposal, and the intro — once that round's turn files are written;
- a quest is synthesized once its turn files are written, from its rows;
- then the discussion, `record.json` and the final report, as at game end.

## Local development

```
npm install
npm run dev
```

## Tests

Regression tests verify prompt YAML files parse, declare the right
`response_mime_type`, and reference exactly the variables the agent code
passes in — catching drift between a prompt and its caller. Plus unit tests
for the silence detector, the game record, the watcher, and the replay (on a
stub model).

```
npm test
```

Tests hit no external services (no Azure, no Vertex) so they run in CI
without secrets.
