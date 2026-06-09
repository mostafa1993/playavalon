# Agentic Players (rule-based)

Independent processes that play playavalon games like real humans by hitting
the public HTTP API. Each agent is a Node process that signs into Supabase as
a real user, polls the game state, and makes decisions via a pluggable Brain.

Currently Phase 0 — agents sign in, join, get their role, and confirm. See
[`specs/023-rule-based-agents/plan.md`](../specs/023-rule-based-agents/plan.md)
for the full architecture and phased delivery plan.

## Quickstart

```bash
# 1. Install agent-only deps (separate from the Next.js app)
cd agents && npm install

# 2. Bootstrap bot accounts (one-time per Supabase project)
#    Run from the project root, not from agents/:
cd .. && npx tsx scripts/add-fake-players.ts <SOME_ROOM_CODE>
# This creates bot_alice@playavalon.local … bot_iris@playavalon.local
# with password 'bot_password_dev_only', and adds them to the given room.

# 3. Make sure the dev server is running so the agent has an API to hit
npm run dev

# 4. In another terminal, run an agent against a room:
cd agents && npx tsx src/cli/run.ts configs/alice.yaml --room <ROOM_CODE>
```

## How to define an agent

Each agent is a small YAML file in `agents/bot-supervisor/configs/`:

```yaml
# agents/bot-supervisor/configs/alice.yaml
name: alice                      # must match Supabase user bot_alice@playavalon.local
display_name: Alice              # optional; falls back to DB value
order: 1                         # (Phase 4) supervisor pick order — lower picked first
brain:
  type: rule                     # 'rule' | 'noop'  (future: 'llm')
```

That's all you need. Everything else has sane defaults — see the loader
schema in [`src/config/schema.ts`](src/config/schema.ts) for the full set.

## Architecture (one-paragraph)

One Node process per agent. The process signs in via Supabase Auth and
attaches the resulting JWT as `Authorization: Bearer <jwt>` on every API
call. It polls `GET /api/games/[gameId]` (or `/api/rooms/[code]` pre-game)
every ~2 seconds to observe game state. On every observation, it passes
the state into a `Brain` (currently rule-based), which returns an `Action`
or `null`. The Action goes through an Executor that re-checks staleness
before firing the matching API call. Per-phase jitter delays make timing
feel human.

We do NOT use Supabase Realtime in the agent — see
[`specs/023-rule-based-agents/plan.md`](../specs/023-rule-based-agents/plan.md)
§13 verification #2 for why. Polling is the documented fallback.

## What's NOT in this workspace

- Audio/video (agents are silent in voice; they only act)
- LLM brains (Phase 5 — the Brain interface is the swap point)
- A supervisor service that auto-spawns agents (Phase 4)

## Layout

```
agents/
├── package.json            # own deps, kept out of the Next.js bundle
├── tsconfig.json
├── configs/                # one YAML per agent (user-editable)
├── src/
│   ├── cli/run.ts          # entry point: run one agent against a room
│   ├── engine/             # Session, ApiClient, Observer, Executor, AgentEngine
│   ├── brains/             # Brain interface + RuleBrain + NoopBrain
│   │   └── RuleBrain/      # one file per game phase
│   ├── config/             # zod schema + YAML loader
│   ├── types/              # Action, Observation, Identity
│   └── util/               # logger (pino), jitter, credentials helper
```
