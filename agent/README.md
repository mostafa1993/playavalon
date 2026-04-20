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

See repo-root `.env.example`. Required for M2:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — read-only DB access.
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — same values the Next.js app uses.
- `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` — e.g. `eastus`.
- `AZURE_SPEECH_LANGUAGE` — defaults to `fa-IR`.
- `DATA_DIR` — defaults to `/data/games`.
- `LIVEKIT_BOT_IDENTITY_PREFIX` — defaults to `reviewer-`.

## Output layout

```
$DATA_DIR/<game_id>/
  meta.json                     # written at game start
  turn_<quest>_<idx>.json       # one per speaking turn
```

M3+ will add `dossier_<player>.json`, `quest_<n>.json`, `summary.fa.json`, `summary.en.json`.

## Local development

```
npm install
npm run dev
```
