# agents/

Two **independent** Node projects that act on games on your behalf. They share no
code today (each has its own `package.json`, `Dockerfile`, and dependencies) — they're
grouped here purely for clarity, so `agent` vs `agents` stops being confusing.

| Dir | What it is | Compose service | Build context |
|---|---|---|---|
| [`bot-supervisor/`](bot-supervisor/) | **Bot players.** Watches for rooms with `agent_count > 0` and spawns one rule-based agent process per bot seat. The agents sign into Supabase and play full games via the HTTP API. | `bot-supervisor` | `./agents/bot-supervisor` |
| [`reviewer/`](reviewer/) | **AI post-game reviewer.** Joins games via LiveKit, records discussion audio, transcribes (Azure STT), and generates LLM summaries (Gemini). | `reviewer` | `./agents/reviewer` |

Each subdir has its own `README.md` with details.

## Future: smarter (LLM) bots

When the bots gain an LLM "brain" — a new `LLMBrain` dropping in next to
`bot-supervisor/src/brains/RuleBrain/` — the reviewer already has the pieces it would
reuse: the Gemini client (`reviewer/src/reviewer/llm.ts`), prompt helpers, and retry logic.
At that point, hoist those into a shared `agents/shared/` workspace package that both
projects import (and convert `agents/` to npm workspaces).

Until that day, keeping the two **independent** is intentional — they don't yet share
enough to justify the workspace machinery.
