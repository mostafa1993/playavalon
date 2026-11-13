# Playavalon AI Reviewer Agent

Standalone Node.js service that records per-player speech during an Avalon game,
transcribes each turn via Azure Speech-to-Text (`fa-IR`), builds the game record from
the database and the transcripts, and writes the post-game report from that record
via an LLM.

Runs as a Docker Compose service alongside the Next.js app and LiveKit server.
Single-VM deployment, single concurrent game.

## Milestones

- **M2**: recorder bot + STT pipeline. Produces `turn_<quest>_<round>_<idx>.json` under
  `/data/games/<game_id>/`.
- **M3**: per-turn summaries + per-player dossiers + per-quest synthesis (all since removed).
- **M4**: final narrative (fa + en) + review UI.
- **The report from the record** (`.plans/2026-11-13-1640-reviewer-report-accuracy.md`,
  row C): the game record (`record.json`) is the source of every fact, and the report
  reads it whole, transcripts included. Dossiers, quest syntheses, the model-written
  role reveal and the discussion's per-speaker summaries are gone. The page renders the
  facts from the record; the model writes only the story and the commentary.

## Architecture

```
Supabase (games table)  →  watcher  →  gameSession
                                         │
                            speaking-timer data channel (LiveKit)
                                         │
LiveKit room  →  bot (audio tracks)  →  turnSegmenter  →  STT (Azure)  →  proofreading  →  turn files
                                                                                              │
         assassin-phase discussion  →  STT  →  proofreading  →  discussion.json               │
                                                                     │                        │
game end:  database rows + turn files + discussion.json  →  record.json  →  final report  →  check  →  summary.<lang>.json
```

- **Per turn** (`src/pipeline.ts`): STT, the proofreading pass, the turn file.
- **Blind mode, per round of talk**: the detective (`src/reviewer/guessTracker.ts`,
  plan row E) gives its read of every player's role from the public record so far:
  the blind record (no role, no Lady result) cut at the round that just ended
  (`cutRecord`) — that round's talk and everything before it, the proposal it led to
  with its vote, a settled quest's mission and Lady of the Lake — never the whole
  blind record, whose assassin-phase discussion (only the evil players speak in it),
  pick and outcome give the answer away. It also reads the setup with how many players
  have each role (`src/gamestate/roleConfig.ts`). Each read is made afresh from the
  record so far, not from the read before, so an early guess doesn't carry itself
  forward. Code checks each read against the roster and the setup — every player guessed once,
  only roles in play, no role given to more players than the setup deals — and asks
  once more, with what broke, on a break; a second break or a failed call keeps the
  read before. Every read is from before the assassin phase; the last is the scored
  read, which the report shows as the detective's (`final_guesses`). A session starts
  with no reads: `guess_log.json` is written each round, never read back.
- **At the game's end**: the assassin-phase discussion is proofread into
  `discussion.json`; `record.json` is built in code (`src/gamestate/record.ts`); then
  the final report (`src/reviewer/finalReport.ts`) — one model call per language
  (`prompts/report-god.yml` or `prompts/report-blind.yml`, no tools) over the whole
  record as text: the roster (roles in god mode), then, in order, each proposal with
  its leader and team, the talk about it turn by turn and its vote, each mission and
  Lady of the Lake (with the result in god mode only), the assassin phase's discussion
  and pick, and the outcome. A blind report reads the blind record (no role, no Lady
  result), the game's setup and the detective's guesses.
- **What the model writes**: the narrative (the whole game, the assassin phase
  included), a short commentary per quest, and in god mode a performance note per
  player. Everything else on the review page is the record's: the summary carries the
  record (without the turns' talk) and the page (`src/lib/review/summary-view.ts` in
  the app) renders the roles, each proposal's leader, team and votes, each mission,
  Lady of the Lake, the assassin's pick and each assassin-phase speaker's transcript.
- **The check** (`src/reviewer/checkReport.ts`, plan row D): once a report is written,
  code splits its text (narrative, quest commentary, performance notes) into numbered
  statements and numbers the lines of the record it was written from. One call
  (`prompts/check-report.yml`) ties each statement to the record lines it rests on:
  its kind (fact, attribution, opinion), the lines, and a verdict. A fact or
  attribution found wrong or unsupported, or tied to no line the record has, is
  flagged; the flagged statements get one rewrite in one call
  (`prompts/rewrite-report.yml`), and the report keeps the rewrites (an empty one
  removes the statement). A report with nothing flagged skips the rewrite; a rewrite
  is not checked again; a failed check keeps the report as written. The check's
  prompt is its own, not the judge's (`agents/review-judge`).

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
    (default `250`). Raise to skip more, lower to transcribe more. Clips over
    55 s (a speaker's whole assassin-phase discussion) are cut at their quietest
    points into pieces of at most 55 s, the STT endpoint's per-request limit
    being 60 s; silent pieces are skipped by the same threshold.
  - `RETRY_MAX_ATTEMPTS` — total attempts for transient-failure retries on
    STT and LLM calls (default `3`).
  - `RETRY_BASE_DELAY_MS` — base exponential-backoff delay (default `500`).
  - `TRANSCRIPT_CORRECTION_ENABLED` — if `true` (default), every non-silent
    STT transcript goes through an LLM proofreading pass
    (`prompts/correct-transcript.yml`) before it reaches the record and the report.
    Fixes Persian STT's common error classes (misheard words, wrong verb
    persons, homophones, Persian half-space / number glitches). The
    turn JSON preserves both `transcript` (corrected) and `transcript_raw`.

## Output layout

```
$DATA_DIR/<game_id>/
  meta.json                        # players, roles, seating (written at game start)
  turn_<quest>_<round>_<idx>.json  # raw + corrected transcript
  discussion.json                  # the assassin-phase discussion, if any (raw + corrected)
  guess_log.json                   # blind mode: the detective's read per round (never read back)
  record.json                      # the game record (written at game end)
  summary.fa.json, summary.en.json # the final report, from the record
  check.fa.json, check.en.json     # the report's check: each statement, what it rests on, rewrites
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
read). The final report is written from it.

`summary.<lang>.json` (`SummaryJson` in `src/types.ts`, `format: 2`) holds the
report's language, mode, room code and time; `record`, the record without the turns'
talk (the facts the page renders); `narrative`; `quest_commentary`, one
`{quest, commentary}` per quest of the record; and per mode, `performance` (god: one
`{playerId, assessment}` per player, in seat order) or `guess_timeline` and
`final_guesses` (blind). The review page reads only this format; any other summary
shows "This report is no longer available".

`check.<lang>.json` (`ReportCheck`) holds every statement of that report as written,
with the check's kind, record lines (as numbered in the check's prompt), verdict and
problem, and for a flagged statement the rewrite that took its place.

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
then writes what the service writes: turn files with the corrected transcript,
`guess_log.json` (blind), `discussion.json`, `record.json` (in
the run's mode), `summary.fa.json` and `summary.en.json`, and the checks
`check.fa.json` and `check.en.json`. Last
comes `record.god.json`, the god record with roles that the judge
(`agents/review-judge`) scores every report against, written after every model
step so no blind step can see it. Each run's log ends with its time and its LLM
calls and failures (after the client's retries, which are logged as
`[llm] retry`).

As of the time:

- in blind mode the detective updates after each round of talk, in order — a round
  per proposal, and the intro — once that round's turn files are written, from the
  record cut at that round;
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
for the silence detector, the game record, the final report (the record as its
prompt reads it, and the summary built around a stub model's answer), the
report's check (flagged statements rewritten, a clean report left alone), the
blind detective (its read checked against the setup's roles and counts, the re-ask,
the record cut per round), the watcher, and the replay (on a stub model).

```
npm test
```

Tests hit no external services (no Azure, no Vertex) so they run in CI
without secrets.
