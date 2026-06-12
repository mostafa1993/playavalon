# agents/

The Node projects that act on games on your behalf, organized as an **npm workspace**
(`agents/package.json` is the root; one `package-lock.json` for the workspace members).

| Dir | What it is | Compose service | Build context |
|---|---|---|---|
| [`shared/`](shared/) | **`@avalon/shared`** — common library: Gemini LLM client + YAML prompt loader, retry/backoff, Azure Speech (STT `transcribe` + TTS `synthesize`), silence detection, and LiveKit audio publish (`publishAudioTrack`, the proven "mouth"). | — (library) | — |
| [`reviewer/`](reviewer/) | **AI post-game reviewer.** Joins games via LiveKit, records discussion audio, transcribes (Azure STT), and generates LLM reports (god: reveal + performance; blind: evolving role guesses). Imports `@avalon/shared`. | `reviewer` | `./agents` + `reviewer/Dockerfile` |
| [`bot-supervisor/`](bot-supervisor/) | **Bot players.** Watches for rooms with `agent_count > 0` and spawns one rule-based agent process per bot seat. The agents sign into Supabase and play full games via the HTTP API. *Not yet a workspace member* — joins when it adopts `@avalon/shared` for the LLM voice player. | `bot-supervisor` | `./agents/bot-supervisor` |

Each subdir has its own `README.md` with details.

## Dev notes
- Install/build from `agents/`: `npm install`, then `npm run build` (shared builds before reviewer).
- Reviewer tests: `npm test -w playavalon-agent` (its `pretest` rebuilds `shared/` first).
- The reviewer's Docker build context is **`agents/`** (so the image can see `shared/`);
  `agents/.dockerignore` keeps that context lean.

## Next: the LLM voice player
`shared/` exists because of it — see `docs/2026-06-10-llm-voice-player-plan.md`. The bots
gain an `LLMBrain` (`mode: smart | stupid` per bot yaml) + ears (STT memory) + a mouth
(`synthesize` → `publishAudioTrack`) to speak on their speaking-timer turns.
