# Plan: Rule-Based Agentic Players

## Table of contents

1. [Why](#1-why)
2. [Out of scope](#2-out-of-scope-for-this-plan)
3. [Scope](#3-scope-what-this-plan-delivers)
4. [Architecture at a glance](#4-architecture-at-a-glance)
5. [Directory layout](#5-directory-layout)
6. [YAML config schema](#6-yaml-config-schema)
7. [Engine internals](#7-engine-internals)
8. [Rule-based decision logic (outline)](#8-rule-based-decision-logic-outline)
9. [CLI usage](#9-cli-usage)
10. [Phased delivery](#10-phased-delivery)
11. [Migration of existing scripts](#11-migration-of-existing-scripts)
12. [Risks & mitigations](#12-risks--mitigations)
13. [What to verify on day one](#13-what-to-verify-on-day-one)
14. [Appendix A — P0 file checklist](#appendix-a--p0-file-checklist)

## 1. Why

The current "bots" are either dead (`scripts/bot-players.ts` — broken against
Supabase Auth, header-only) or just DB pokes (`scripts/confirm-bots.ts` —
useful for one specific UI test, no game play). We want **agentic players**:
independent processes that sign into Supabase as real users, subscribe to the
same realtime channels the human UI uses, and drive a full game by calling
the public HTTP API — indistinguishable from a human at the API layer.

Each agent is defined by a small YAML file (`agents/configs/alice.yaml`).
Decision logic is rule-based for now. The architecture has one clean swap
point (a `Brain` interface) so an LLM brain can replace the rules later
without touching the engine.

## 2. Out of scope (for this plan)

- ❌ LLM-based decision making
- ❌ Audio / video / LiveKit participation (agents are silent in voice)
- ❌ Cross-game memory or opponent modelling
- ❌ Chat messages or emoji reactions
- ❌ Agents creating or managing rooms (humans create; agents only join+play)
- ❌ Agents auto-joining *arbitrary* rooms — agents only join rooms whose
  creator explicitly opted in via `agent_count > 0` (Phase 4)

Everything in this list has a designed escape hatch (Brain interface,
config flags, separate process model), so adding any of them later is
additive, not a rewrite.

## 3. Scope (what this plan delivers)

A new top-level `agents/` workspace containing:

- An **engine** that handles auth, realtime subscriptions, observation
  fetching, action dispatch, idempotency, retries, jitter, and a clean
  shutdown.
- A **rule-based brain** with one small module per game phase.
- A **YAML config schema** that defines an agent's identity, credentials,
  brain choice, brain parameters, and timing preferences.
- Two **CLIs**: `run` (one agent) and `populate` (spawn many agents for one
  room, optionally with a real human as manager) — for dev and ad-hoc use.
- A **bot supervisor service** (Phase 4) that runs in production and
  spawns agents into rooms whose creator opted in via the new
  `agent_count` field on room creation.
- A **clean interface for swapping in an LLM brain later** (the only thing
  that needs to change is one factory and one new file under `brains/`).

## 4. Architecture at a glance

```
   Supabase Realtime              HTTP API (Next.js)
        │                                ▲
        │ (postgres-changes              │ (Bearer token from Supabase Auth)
        │  + broadcast)                  │
        ▼                                │
┌──────────────────────────────────────────────────┐
│                  Agent Engine                     │   (one process per agent)
│                                                   │
│  RealtimeBridge ──▶ Observer ──▶ Brain ──▶ Executor
│   (subscribe)       (re-fetch)   (decide)   (POST)
│                                                   │
│  SessionManager (signin, refresh, expose JWT)    │
└──────────────────────────────────────────────────┘
        ▲
        │ alice.yaml
        │
   ConfigLoader
```

**Key decisions** (one-line justification each):

| Decision | Choice | Why |
|---|---|---|
| Process model | **One process per agent** | Crash/auth isolation; `supabase.realtime.setAuth()` is global per client so two RLS-scoped subs in one process is impossible. ~50MB×9 = 500MB at max, fine. |
| Auth mechanism | **`Authorization: Bearer <jwt>`** | One header beats hand-constructing `sb-<project>-auth-token` cookie chunks. Cookie jar is the fallback if `getCurrentUser()` rejects Bearer. |
| State source | **`GET /api/games/[gameId]`** | Single fetch returns the full observation. Re-fetch after every event = simplest correctness story. |
| Trigger | **Realtime events** + 30s safety poll | Server already broadcasts on `game:<id>`; using it is free and sub-second. Polling is belt-and-suspenders only. |
| Decision contract | **`Brain.decide(ctx) → Action \| null`** | One interface = the only thing P4's LLM brain needs to implement. |
| Staleness handling | **Executor re-checks observation before firing** | Brain stays naive; staleness is the engine's problem. |
| Brain location | `agents/src/brains/RuleBrain/` — one file per phase | ~50-100 lines per phase, trivially testable, no monster switch. |
| Config | **One YAML per agent** in `agents/configs/` | Cleanest "I want to add a bot named X" workflow. |
| Workspace location | Top-level `agents/` (sibling to `src/`, `agent/`) | Not in Next.js bundle; mirrors the existing `agent/` reviewer pattern. |

## 5. Directory layout

```
agents/                              # NEW top-level workspace
├── package.json                     # own deps: yaml, zod, pino, commander
├── tsconfig.json                    # extends ../tsconfig.json
├── README.md                        # quickstart, examples
│
├── configs/                         # agent definitions (user-editable, committed)
│   ├── alice.yaml
│   ├── bob.yaml
│   ├── charlie.yaml
│   ├── diana.yaml
│   ├── erin.yaml
│   ├── frank.yaml
│   ├── grace.yaml
│   ├── henry.yaml
│   └── iris.yaml
│
├── src/
│   ├── cli/
│   │   ├── run.ts                  # entry: run one agent against a room
│   │   └── populate.ts             # entry: spawn N agents (subprocess fan-out)
│   │
│   ├── engine/
│   │   ├── AgentEngine.ts          # main loop: subscribe → observe → decide → act
│   │   ├── ApiClient.ts            # typed fetch wrapper, Bearer auth, retries
│   │   ├── SessionManager.ts       # signin, refresh, JWT lifecycle
│   │   ├── RealtimeBridge.ts       # Supabase Realtime → engine events
│   │   ├── Observer.ts             # fetches+caches observation
│   │   └── ActionExecutor.ts       # validates Action then dispatches
│   │
│   ├── brains/
│   │   ├── Brain.ts                # THE swap point (interface)
│   │   ├── factory.ts              # type → Brain instance
│   │   ├── RuleBrain/
│   │   │   ├── index.ts            # phase dispatch
│   │   │   ├── confirmRole.ts
│   │   │   ├── teamBuilding.ts
│   │   │   ├── voting.ts
│   │   │   ├── quest.ts
│   │   │   ├── ladyOfLake.ts
│   │   │   ├── assassin.ts
│   │   │   ├── merlinQuiz.ts
│   │   │   └── heuristics.ts       # shared scoring + suspicion
│   │   └── NoopBrain.ts            # for tests
│   │
│   ├── config/
│   │   ├── schema.ts               # zod schema for AgentConfig
│   │   └── loader.ts               # readYaml + validate + env interpolation
│   │
│   ├── types/
│   │   ├── Action.ts               # discriminated union of all possible actions
│   │   ├── Observation.ts          # the shape the Brain sees
│   │   └── Identity.ts
│   │
│   └── util/
│       ├── logger.ts               # pino, agent-name prefix
│       ├── jitter.ts               # randomized delays
│       └── credentials.ts          # shared with scripts/add-fake-players.ts
│
└── tests/
    ├── ruleBrain.test.ts
    └── apiClient.test.ts
```

We do **not** put this under `src/` — agents are not part of the Next.js
bundle. We **do** import from `src/lib/domain/` (quest sizes, role rules,
vote thresholds, state machine transitions) so game rules stay single-sourced.

The existing top-level `agent/` directory is the post-game **AI Reviewer**
(LiveKit recorder + STT + LLM narrative). Different concern. Keep separate.

## 6. YAML config schema

**Minimal P0 example** — `agents/configs/alice.yaml`:

```yaml
name: alice                              # must match Supabase Auth user bot_alice@playavalon.local
order: 1                                 # used by the P4 supervisor to pick which N bots join first
brain: { type: rule }                    # defaults are sane; nothing else needed for P0
```

That's it. Everything below is optional and only matters once later phases ship.

The `order` field is irrelevant for P0–P3 (which spawn agents manually
via CLI). It becomes load-bearing in P4 when the supervisor needs to
pick the first N available bots — lower `order` is picked first;
alphabetical by `name` tie-breaks. If a bot is already in another
active room, supervisor skips them and uses the next one in order.

**Full example with every field** — `agents/configs/alice-full.yaml`:

```yaml
# Identity
name: alice                              # required; maps to bot_<name>@playavalon.local
display_name: Alice                      # optional; falls back to DB value
order: 1                                 # supervisor pick-order in P4 (lower = picked first)

# Credentials — any ONE of (default: password_env: BOT_PASSWORD)
credentials:
  password_env: BOT_PASSWORD
  # password: bot_password_dev_only      # dev-only inline; do not commit
  # password_file: ./secrets/alice.password

# Which brain runs the agent (THE swap point)
brain:
  type: rule                             # 'rule' | 'noop'  (future: 'llm')
  options:                               # rule-brain knobs; all optional
    evil_fail_strategy: minimum_to_win   # 'minimum_to_win' | 'aggressive' | 'random'
    assassin_guess_strategy: most_proposed_good  # 'most_proposed_good' | 'random'

# Human-feel jitter — [min_ms, max_ms]; engine picks uniformly. All optional.
timing:
  confirm_role_ms:    [2000, 8000]
  propose_team_ms:    [4000, 15000]
  vote_ms:            [2000, 7000]
  quest_action_ms:    [3000, 10000]
  continue_ms:        [500, 2500]
  assassin_guess_ms:  [10000, 25000]

# Runtime
runtime:
  base_url: http://localhost:3000        # override via --base-url
  heartbeat_interval_ms: 20000           # keeps is_connected=true in UI
  observation_safety_poll_ms: 30000      # fires only if realtime is silent
```

**Field rules:**
- `name` maps to existing `bot_<name>@playavalon.local` accounts created
  by `scripts/add-fake-players.ts`. Creating a YAML "just works" if that
  row exists; if not, the engine creates it on first sign-in attempt.
- Defaults are coded in `agents/src/config/schema.ts`; you only specify what
  you want to deviate from defaults.
- Unknown keys cause a load-time error (catches typos).
- Loader fails fast with file path + JSONPath on validation errors.

## 7. Engine internals

### 7.1 Authentication

The Node engine cannot use cookies easily and shouldn't try. Instead:

1. On startup: `supabase.auth.signInWithPassword({email, password})`.
2. Capture `session.access_token` (JWT, ~1h lifetime).
3. Every fetch to the Next.js API sends `Authorization: Bearer <jwt>`.
4. `SessionManager` schedules `supabase.auth.refreshSession()` 5 minutes
   before expiry. On refresh failure, retries `signInWithPassword`.
5. On 401 from the API, `ApiClient` triggers an immediate refresh + 1 retry.

**Day-one verification step (P0 first task):** `GET /api/auth/me` with the
Bearer header must return our user. If `getCurrentUser()` rejects Bearer
tokens for any reason, we fall back to a cookie jar (set `sb-<project>-auth-token`
manually). This is the only architectural risk in the entire plan; verify
in the first hour of work.

### 7.2 Realtime subscriptions

Two channels matter (mirroring `useRoom` and `useBroadcastChannel`):

1. **Postgres-changes** on `rooms`, `room_players`, `player_roles` — pre-game
   lobby transitions (`waiting` → `roles_distributed`, role assignments,
   confirmations).
2. **Broadcast** on `game:<gameId>` — in-game events (`phase_transition`,
   `vote_submitted`, `action_submitted`, `draft_update`, `game_over`).

Critically: `supabase.realtime.setAuth(accessToken)` MUST be called after
sign-in. Without it, RLS-restricted postgres-changes (like our own
`player_roles` row) silently never arrive.

Payloads are intentionally thin. **Every event triggers an Observer.fetch()**,
never trying to apply the event payload directly. The fetch is cheap (~50ms)
and the canonical state is always right.

Safety net: every `observation_safety_poll_ms` (default 30s), the engine
re-fetches even without any event. This protects against silently-dropped
WebSocket scenarios.

### 7.3 Observer

Single method: `Observer.fetch() → Observation`. Internally:

- `GET /api/games/[gameId]` (when game exists) — the main observation source.
- `GET /api/rooms/[code]/role` — fetched **once** after `roles_distributed`,
  then cached. Has our role + visibility intel (Merlin's view, Percival's
  candidates, evil teammates).
- Cached `quest_requirement` for all 5 quests (static per-player-count, from
  `src/lib/domain/quest-config.ts`).

Returns one combined `Observation` object: phase, game state, players,
my role, current proposal, my vote, who's on the team, who's submitted
actions, last results, history.

### 7.4 Brain interface

```ts
// agents/src/brains/Brain.ts

export interface BrainContext {
  identity: Identity;          // user_id, display_name, role, special_role, role_intel
  observation: Observation;    // current game state (from Observer)
  config: BrainOptions;        // from yaml: brain.options
  rng: () => number;           // injectable for determinism in tests
  logger: Logger;
}

export interface Brain {
  /** Decide what to do right now. Return null if no action is appropriate. */
  decide(ctx: BrainContext): Promise<Action | null>;
}
```

```ts
// agents/src/types/Action.ts

export type Action =
  | { kind: 'noop' }
  | { kind: 'consent_ai' }
  | { kind: 'confirm_role' }
  | { kind: 'propose'; team: string[] }
  | { kind: 'vote'; choice: 'approve' | 'reject' }
  | { kind: 'quest_action'; choice: 'success' | 'fail' }
  | { kind: 'continue' }
  | { kind: 'lady_investigate'; target_id: string }
  | { kind: 'assassin_guess'; target_id: string }
  | { kind: 'merlin_quiz'; target_id: string | null };
```

This interface IS the swap point. The factory in `brains/factory.ts`:

```ts
export function makeBrain(cfg: AgentConfig['brain']): Brain {
  switch (cfg.type) {
    case 'rule': return new RuleBrain(cfg.options);
    case 'noop': return new NoopBrain();
    // future:
    // case 'llm': return new LlmBrain(cfg.options);
  }
}
```

### 7.5 Main loop

```ts
// agents/src/engine/AgentEngine.ts (sketch)

async run() {
  await this.session.signIn();
  await this.realtime.subscribe();
  await this.maybeJoinRoom();

  // Initial fetch to react to any state we joined into mid-flight.
  this.events.push({ kind: 'boot' });

  while (this.alive) {
    const event = await this.events.next();        // realtime OR safety-poll OR boot
    const obs   = await this.observer.fetch();

    if (this.shouldExit(obs)) break;
    if (this.alreadyActedThisTurn(obs)) continue;

    await jitter(this.timingForPhase(obs.phase));   // human-feel

    const action = await this.brain.decide({ identity, observation: obs, config, rng, logger });
    if (action && action.kind !== 'noop') {
      await this.executor.execute(action);
    }
  }

  await this.cleanup();
}
```

`alreadyActedThisTurn(obs)` is the **idempotency guard**, critical because
realtime events can fire multiple times and brains shouldn't worry about it:

- `voting` phase + `my_vote != null` → skip
- `quest` phase + `has_submitted_action` → skip
- `team_building` phase + (am_leader && already_proposed_this_turn) → skip
- `quest_result`/`merlin_quiz` → fire once per (gameId, quest_number) tuple

For one-shot phases (propose, lady-investigate, assassin-guess) the phase
itself moves on after success. If we somehow fire twice and get a 400
"wrong phase", we treat that as a non-error (debug-log + drop).

### 7.6 ActionExecutor

Before dispatching any action, executor re-checks the observation it was
built from. If the phase has moved on while we were sleeping in jitter,
drop the action. This means the Brain never needs to care about staleness.

### 7.7 Error handling

| Failure | Response |
|---|---|
| 401 from API | Trigger refresh, retry once. Repeated: re-sign-in, retry once. Triple-fail: exit fatal. |
| 400 "wrong phase" / "already voted" | Debug log, drop. Expected. |
| 5xx from API | Exponential backoff: 500ms, 1.5s, 4.5s. Then drop. |
| Realtime drop | Supabase JS auto-reconnects. On `SUBSCRIBED` after gap, force re-fetch to catch up. |
| Brain throws | Log error, continue main loop. Single bad decision shouldn't kill the agent. |
| `game_over` observed | Handle `merlin_quiz` if applicable, then exit clean (code 0). |
| SIGINT / SIGTERM | Stop loop, unsubscribe, cleanup, exit 0. |

## 8. Rule-based decision logic (outline)

Each phase is a small module that exports `decide(ctx) → Action | null`.
`RuleBrain.decide` is a thin dispatcher on `ctx.observation.phase`.

| Phase | Ships in | Outline |
|---|---|---|
| `roles_distributed` | **P0** | If room has AI review enabled and not consented → `consent_ai`. Else if `!is_confirmed` → `confirm_role`. |
| `team_building` | P1 | Not leader → `noop`. Leader good → team of `quest_requirement.size`, prefer known-good (Merlin) / Merlin-candidate (Percival) / non-rejected players, include self if config says so. Leader evil → include `1+` evil teammates (or self if Oberon), fill rest with plausible non-evil, avoid obvious evil from Merlin's view. |
| `voting` | P1 | Good: approve if team contains no known evil; reject otherwise. Evil: approve if ≥1 evil on team OR rejecting helps; reject otherwise. **`vote_track === 4` → always approve** (5th rejection = evil auto-wins, so only evil prefers that — good MUST approve to survive). |
| `quest` | P2 | Good → `success`. Lunatic → `fail` (server enforces, we send `fail` to avoid 400). Brute on Q4/Q5 → `success` (same). Other evil → `fail` per `fail_strategy`. |
| `quest_result` | P2 | Any agent fires `continue`. Server handles the herd; later callers get a no-op. |
| `lady_of_lake` | P3 | Holder only. Investigate the most-proposed player not yet investigated. |
| `assassin` | P3 | Only if I'm the assassin. Pick the most-frequently-on-successful-good-teams player (or random per config). |
| `game_over` | P3 | Vote on merlin quiz unless we're Merlin. Heuristic same as assassin. Exit afterward. |

This is intentionally an **outline**. Each phase file ends up ~50-100 lines.
Heuristics live in `RuleBrain/heuristics.ts` (player suspicion scoring,
team-history queries) and are shared across phase modules.

## 9. CLI usage

```bash
# === P0: run a single agent (one terminal per agent) ===
npx tsx agents/src/cli/run.ts agents/configs/alice.yaml --room ABC123

# === P1+: spawn N agents in one command (subprocess fan-out) ===
npx tsx agents/src/cli/populate.ts \
  --bots alice,bob,charlie,diana \
  --room ABC123                          # join existing room

# === P2+: same but bots play to game-over (no human needed) ===
npx tsx agents/src/cli/populate.ts \
  --bots alice,bob,charlie,diana,erin \
  --room ABC123 \
  --auto
```

Top-level npm scripts for discoverability:

```json
"scripts": {
  "agents:run":      "tsx agents/src/cli/run.ts",
  "agents:populate": "tsx agents/src/cli/populate.ts"
}
```

`populate.ts` works by spawning one `tsx agents/src/cli/run.ts <yaml>`
subprocess per agent, piping stdout through a label-prefixed multiplexer,
and propagating `SIGINT` to all children on Ctrl-C. Feels like one command
to the user, but each agent is a real isolated OS process.

## 10. Phased delivery

> **🛑 STOP — before starting Phase 0**, run the three verifications in §13.
> Each takes ~30 minutes. If any fail, the plan has small adjustments
> ready (cookie jar instead of Bearer, polling instead of realtime,
> process-group kill instead of default SIGINT). If all three pass,
> Phase 0 implementation is mechanical from there.

Each phase is independently shippable and demoable. Don't start the next
until the previous is verified.

### P0 — Foundations + Confirm Role (smallest end-to-end slice)

**Goal:** an agent signs in, joins a room, confirms its role. Replaces
`scripts/confirm-bots.ts` with a real-API path.

- `agents/` workspace skeleton (package.json, tsconfig, README).
- `util/credentials.ts` (extracted from `scripts/add-fake-players.ts`).
- `SessionManager` (signin + refresh + JWT). **Day-one test: `GET /api/auth/me`
  succeeds with Bearer.** If not, fall to cookie jar.
- `ApiClient` (stub all endpoints; only `/auth/me`, `/rooms/[code]`,
  `/rooms/[code]/role`, `/rooms/[code]/confirm`, `/rooms/[code]/ai-consent`,
  `/players/heartbeat` implemented).
- `ConfigLoader` + zod schema.
- `RealtimeBridge` subscribes to `rooms` + `room_players` + `player_roles`.
- `RuleBrain` with only `confirmRole.ts` implemented.
- Heartbeat loop (`POST /api/players/heartbeat` every 20s) so agents don't
  show as "offline" in your new lobby dashboard.
- `cli/run.ts` end-to-end working.
- Quickstart in `agents/README.md`.

**Acceptance test** (concrete commands):

```bash
# Terminal 1: app
npm run dev

# Browser: sign up real account, create room with expected_players=5,
# copy the 6-char code.

# Terminal 2: populate the room with 4 bot rows (existing script)
npx tsx scripts/add-fake-players.ts <CODE>

# Browser: refresh, distribute roles.

# Terminals 3-6 (one per agent — populate.ts is P1):
npx tsx agents/src/cli/run.ts agents/configs/alice.yaml --room <CODE>
npx tsx agents/src/cli/run.ts agents/configs/bob.yaml   --room <CODE>
npx tsx agents/src/cli/run.ts agents/configs/charlie.yaml --room <CODE>
npx tsx agents/src/cli/run.ts agents/configs/diana.yaml --room <CODE>
```

Within 8s each agent's tile should flip from ⏳ waiting → ✓ confirmed in the
manager's lobby dashboard (the one shipped in commit 3a6e515). Manager
clicks their own confirm last → game auto-starts. **No code in `src/` is
modified.**

### P1 — Lobby joins + Team building + Voting

**Goal:** agents play through the proposal/vote loop. Game deadlocks at
first quest action.

- `cli/populate.ts` subprocess fan-out.
- `RealtimeBridge` adds `game:<id>` broadcast subscription.
- `Observer.fetch()` extended for in-game state.
- `teamBuilding.ts` + `voting.ts` decision modules.
- `ActionExecutor.preCheck()` to drop stale actions.
- `alreadyActedThisTurn()` for voting + propose idempotency.

**Acceptance test:** Full 5-bot game advances through ≥1 successful proposal
to the `quest` phase, then deadlocks. The deadlock proves the prior phases
handed off cleanly.

### P2 — Quest actions + Quest result + Game over

**Goal:** complete games (good or evil wins) with no human intervention.

- `quest.ts` (role-aware: good=success, evil=heuristic, lunatic forced,
  brute Q4/5 forced).
- `quest_result` → `continue` handler.
- `game_over` exit logic.
- Decision-log JSONL output (toggle via `--log-decisions`).

**Acceptance test:** `populate.ts --players 5 --all-bots --auto` runs from
create-room to game-over. Run 10 games; verify both win conditions occur
in proportions roughly matching role distribution (evil wins more often
because the rule brain doesn't know how to defend).

### P3 — Special phases (Lady, Assassin, Merlin Quiz) + Polish

**Goal:** every game configuration completes correctly.

- `ladyOfLake.ts`, `assassin.ts`, `merlinQuiz.ts`.
- Chaos test: kill realtime mid-game, verify recovery via safety poll.
- Delete `scripts/bot-players.ts` (the old broken one — already deprecated
  in its header). Mark `scripts/confirm-bots.ts` deprecated in header;
  remove after one week of P3 stability.

**Acceptance test:** Game with `{percival:true, morgana:true, mordred:true,
lady_of_lake:true}` runs to merlin-quiz screen and exits cleanly. Run 20
games; verify assassin guesses Merlin correctly ~25% of the time.

### P4 — Production integration: opt-in agents at room creation

**Goal:** the manager can fill empty seats with agents when creating a
live room (default: 0 agents — current behaviour). When a room has
`agent_count = N`, agents auto-join once `(expected_players − N)` humans
have joined.

What lands:
- **Schema:**
  - `rooms.agent_count INT NOT NULL DEFAULT 0 CHECK (agent_count >= 0)`
  - `room_players.is_bot BOOLEAN NOT NULL DEFAULT FALSE` (or derive from
    a `bot_*` username prefix — design decision deferred)
- **UI:**
  - Number input in `CreateRoomModal` next to player count: "Bots
    (auto-fill empty seats)", default 0, max `expected_players − 1`.
  - 🤖 badge on bot tiles in the lobby and game board so it's obvious
    which players are agents.
- **Bot supervisor service** (new): a small persistent Node service added
  to `docker-compose.yml` under `profiles: [prod]`. Polls (or subscribes
  via realtime) for rooms that have `agent_count > 0` and unfilled bot
  slots; spawns child agent processes (using the same `cli/run.ts` from
  P0) to fill them. Tracks per-process state, restarts on crash.
- **Bot account pool**: the existing 9 `bot_alice`…`bot_iris` accounts
  cover one concurrent game. Adding more accounts later is a one-line
  change in `add-fake-players.ts`'s `BOT_NAMES`.
- **Identity strategy** (default, override later if needed): the
  supervisor picks the next available `bot_<name>` not currently in any
  active room.

What stays the same:
- Agent engine code from P0–P3 needs **zero changes**. The supervisor
  just spawns the same CLI that a developer would run manually.
- Existing CLI workflows (`cli/run.ts`, `cli/populate.ts`) continue to
  work for dev use.

Decided design choices (no longer open):

- **Bot picker — order field in each YAML.** One YAML per agent (10 max
  for the initial pool, expandable later). Each has an `order: N`
  field. When a room needs M bots, the supervisor lists all configs,
  filters to bots not currently in any active room, sorts by `order`
  ascending (tie-break: alphabetical by `name`), and takes the first M.
  Manager controls who plays first by editing the YAML files; no UI
  needed beyond the count input. The order field is added to the YAML
  schema in §6.
- **🤖 badge visible to all players** — transparency over surprise.
  Bots are clearly marked in lobby and game board for everyone, not
  just the manager.
- **Mid-game crash policy — auto-restart up to 3 times per bot per
  game, then dormant + manager alert.** Supervisor watches its spawned
  child processes; on exit it respawns the bot (same identity, rejoins
  the same room). Counter resets on game start. After 3 crashes for
  the same bot in the same game, supervisor stops restarting and
  surfaces a UI banner to the manager ("Bot Alice has crashed 3 times
  — consider restarting the game"). Game state on the server is
  unaffected by restarts because the bot rejoins with the same Supabase
  identity and reconnects to its same `room_players` row.

Still genuinely open (resolved later):
- **Concurrent games at scale.** 9–10 bot accounts is enough for one
  concurrent game with all-bot seats. For multi-game concurrency,
  either expand the pool (one-line change in `add-fake-players.ts`'s
  `BOT_NAMES`) or generate ephemeral bot accounts per game.

**Acceptance test:**
1. Create a room with `expected_players=6, agent_count=3`.
2. Three humans join.
3. Within ~5s the supervisor spawns 3 bot processes that auto-join.
4. Lobby shows 6/6 (3 humans + 3 bots with 🤖 badges).
5. Manager distributes roles → bots confirm automatically.
6. Game runs to completion with bots playing through all phases.
7. After game ends, bot processes exit cleanly; supervisor returns to
   watching for new rooms.

### Out of this plan but obvious next steps

- **P5 (future):** `LlmBrain` implementation. Same `Brain` interface,
  new factory branch, prompt template under `agents/prompts/`. No
  engine changes expected.
- **P6 (future):** scenario YAMLs (`agents/scenarios/2024-12-01-evil-stomp.yaml`)
  that pin RNG seed + bot list + role config for reproducible test runs.

## 11. Migration of existing scripts

| Script | Action | When |
|---|---|---|
| `scripts/add-fake-players.ts` | **Keep.** Extract `ensureBot` into `agents/src/util/credentials.ts`; script imports from there. Header pointer to `agents/`. | P0 |
| `scripts/confirm-bots.ts` | **Mark deprecated** in header, pointer to `agents/`. Delete after P3 stability. | P0 (mark), P3+1wk (delete) |
| `scripts/bot-players.ts` | **Delete.** Already deprecated, fully superseded by engine. | P2 |
| `scripts/reset-db.ts` | **Untouched.** Different concern. | — |

## 12. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `getCurrentUser()` doesn't honor `Authorization: Bearer` | Low | Day-one P0 test against `/auth/me`. Cookie-jar fallback designed but not built unless needed. |
| `supabase.realtime.setAuth()` not enough for RLS | Low | P0 verify role-distribute event fires for the agent. Polling fallback already in plan. |
| Thundering herd on phase transitions | Medium | Per-phase jitter from config + executor pre-check + server idempotency for `continue`. |
| AI consent gate blocks distribute | High if room enables AI | P0 includes `consent_ai` before `confirm_role`. `populate.ts --ai-review=false` default. |
| Token expiry mid-action | Low | `SessionManager` refreshes 5min before expiry; `ApiClient` retries 401 once after refresh. |
| Agent leaves a `roles_distributed` room → wipes everyone's roles | High if buggy | Engine **never** calls `leave` until `game_over`. SIGINT also doesn't call leave. |
| `merlin_quiz` timeout (60s) | Medium | `merlin_quiz_vote_ms` ceiling capped at 30s in default config. |
| Per-process memory at scale (>9 agents) | Out of scope | Punt. If we ever need 100+ concurrent agents, revisit multiplex. |

## 13. What to verify on day one

Three things, in order. Each is <30 minutes. **Do NOT start the rest of P0
until all three pass** — they are the only assumptions in this plan that
could invalidate the architecture.

1. **Bearer auth works against `getCurrentUser()`.**
   Hand-write a 20-line Node script: sign in with `signInWithPassword`,
   take the access_token, send `Authorization: Bearer <jwt>` to
   `GET /api/auth/me`. Expect a 200 with our user. If 401: fall back to
   cookie jar (~50 lines extra, no architectural ripple).
2. **`supabase.realtime.setAuth(jwt)` delivers RLS-scoped postgres-changes
   to a Node client.** Subscribe to `player_roles` changes in Node, have the
   human-manager distribute roles in the browser, verify the agent receives
   the INSERT event. If not: fall back to a 2s polling loop on
   `/api/rooms/[code]/role` during the distribution window (~5 lines).
3. **Subprocess fan-out under SIGINT cleanly stops all children.**
   `cli/populate.ts` spawns 5 `tsx cli/run.ts` children, Ctrl-C the
   parent, verify all 5 exit within 1s. If Node's default doesn't
   propagate, use process-group kill (`process.kill(-pgid, 'SIGTERM')`).

Everything else is either a standard pattern or already verified by
reading the existing code.

---

## Appendix A — P0 file checklist

```
agents/package.json                              (NEW)
agents/tsconfig.json                             (NEW)
agents/README.md                                 (NEW: 50-line quickstart)
agents/configs/alice.yaml                        (NEW: example)
agents/configs/bob.yaml                          (NEW: example)
agents/src/cli/run.ts                            (NEW: ~80 lines)
agents/src/engine/AgentEngine.ts                 (NEW: ~150 lines)
agents/src/engine/ApiClient.ts                   (NEW: ~120 lines, stub most endpoints)
agents/src/engine/SessionManager.ts              (NEW: ~80 lines)
agents/src/engine/RealtimeBridge.ts              (NEW: ~100 lines)
agents/src/engine/Observer.ts                    (NEW: ~60 lines)
agents/src/engine/ActionExecutor.ts              (NEW: ~80 lines, stub for P0)
agents/src/brains/Brain.ts                       (NEW: interface only)
agents/src/brains/factory.ts                     (NEW: ~30 lines)
agents/src/brains/RuleBrain/index.ts             (NEW: phase switch only)
agents/src/brains/RuleBrain/confirmRole.ts       (NEW: ~30 lines)
agents/src/brains/NoopBrain.ts                   (NEW: 10 lines)
agents/src/config/schema.ts                      (NEW: zod schema)
agents/src/config/loader.ts                      (NEW: ~50 lines)
agents/src/types/Action.ts                       (NEW: discriminated union)
agents/src/types/Observation.ts                  (NEW: type from app GET response)
agents/src/types/Identity.ts                     (NEW)
agents/src/util/logger.ts                        (NEW: ~20 lines)
agents/src/util/jitter.ts                        (NEW: 10 lines)
agents/src/util/credentials.ts                   (NEW: extracted from script)

scripts/add-fake-players.ts                      (REFACTOR: use credentials.ts)
scripts/confirm-bots.ts                          (HEADER: deprecation note)
```

Total: ~25 new files, ~1000 lines of TypeScript. ~2-3 days of focused work
for P0. P1-P3 are similar scope each.
