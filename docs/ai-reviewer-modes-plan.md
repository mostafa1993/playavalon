# AI Reviewer — Blind vs God mode (implementation plan)

**Status:** aligned — ready to implement (decisions locked, see §9)

## Goal

When the room manager enables the AI reviewer, they also pick a **mode**:

- **Blind** — the reviewer **never sees player roles** (not during the game, not at the
  end). It plays **active detective**: after each round of talk it updates a running guess
  memory, so its read **evolves round to round**. Final output: a **game summary** + the
  **evolution timeline** + **final role guesses** with **reasoning**. No truth reveal, no
  scoring, no self-evaluation.
- **God** — roles are visible to the reviewer. Its output is: a **game summary** +
  the **role reveal** + a **per-player performance evaluation** (how well each player
  played their actual role).

The live recording path (LiveKit → STT → per-turn summaries) is **already role-blind and is
unchanged**. Blind mode **adds** a per-round guess-update step alongside it (kept internal —
not shown to players until the game ends). The rest of the work is: a mode flag, the
reviewer's *end* phase, the prompts, the report shape, the toggle UI, and the rendering.

---

## 1. Data model

- Add one column:
  ```sql
  ALTER TABLE rooms
    ADD COLUMN ai_review_mode text NOT NULL DEFAULT 'blind'
      CHECK (ai_review_mode IN ('blind','god'));
  ```
- New migration: **`025_ai_review_mode.sql`** (latest on disk is `024_agentic_players.sql`).
- Only meaningful when `ai_review_enabled = true`.
- **Default mode: `'blind'`** (locked).

## 2. Reviewer behavior (the core change)

Today: `loadMetaSnapshot()` reads `player_roles` at session start, so roles live in
`session.meta` for the whole game; `endSession()` uses them for role-reveal + narrative.

New behavior, branched on `rooms.ai_review_mode` (the reviewer's `findActiveReviewGame`
query selects it when it claims the game):

- **Blind** — *active, incremental detective*
  - `loadMetaSnapshot()` builds the roster (display_name + seat number) **without
    touching `player_roles`** — sourced from `room_players` + `players` + `seating_order`.
    `session.meta.players[].role` is **absent/unknown**. The process literally never reads
    roles for that game → every guess is honest by construction.
  - **Live, per discussion phase** (hooks the existing `onDiscussionFinished`): run a
    *guess-update* pass and append a structured entry to a **running guess memory**,
    persisted incrementally to `<gameId>/guess_log.json` (so a reviewer crash/restart
    mid-game resumes from the last round, not from scratch). Each update is fed a **compact
    prior memory** (current guesses + recent deltas — *not* the full transcript, to bound
    tokens) + that round's discussion summary + **public** votes/quest state → updated
    per-player guesses + brief reasoning. The memory carries forward, so guesses **evolve
    round to round**. A silent/near-empty round — or a failed guess-update (LLM/parse
    error) — carries the prior guesses forward unchanged; recording is never interrupted.
  - **Not shown live.** The memory is internal during play; nothing reaches players until
    the game ends (`game_reviews.status='ready'`), so the live game is never influenced.
  - `endSession()` runs: a **freeform end summary** (game recap + final guesses, bilingual)
    written into `summary.<lang>.json`, and folds the **evolution timeline** (the full
    memory) into the report.
- **God** (unchanged data access)
  - `loadMetaSnapshot()` reads roles as today.
  - `endSession()` runs: **narrative** + **role-reveal** + **performance-eval**.

## 3. Prompts (fa + en; the per-round guess-update is base-language only)

- **Blind**
  - `role-guess-update.yml` — the **per-round** incremental pass (once per discussion
    phase). Input: prior guess memory + this round's discussion summary + votes/proposals +
    quest state (no roles). Output (structured): per player `guessed_role`, `confidence`,
    and a brief `reasoning`/delta. *Bilingual strategy:* the structured guess is
    language-neutral (role names + confidence); brief per-round reasoning is generated in
    one base language during the game — the rich bilingual prose is the end summary.
  - `final-narrative-blind-fa.yml` / `-en.yml` — the **end summary** (locked dedicated
    prompt): freeform game summary + final guesses, fa + en. Safer than reusing the
    role-aware narrative prompt (no role-leak phrasing).
- **God**
  - Keep `role-reveal-*` (exists).
  - `performance-eval-fa.yml` / `performance-eval-en.yml` — per player: how well they
    played their real role, best plays, mistakes. **Dedicated section** (locked).
  - Keep `final-narrative-*`.

## 4. Report shape (`agents/reviewer/src/types.ts` + `src/types/review.ts`)

Per-language report (`summary.<lang>.json`) gains a `mode` and a mode-specific block:

```ts
mode: 'blind' | 'god'
// shared: outcome
// blind:
guess_timeline: Array<{                       // the incremental memory, one entry per discussion phase
  round: number;                              // discussion-phase index
  quest?: number;                             // which quest it fell under
  guesses: Array<{ player: string; guessed_role: string; confidence: 'low'|'med'|'high'; reasoning: string }>;
}>
final_guesses: Array<{ player: string; guessed_role: string; confidence: 'low'|'med'|'high'; reasoning: string }>
final_summary: string                         // freeform end summary (game recap + final guesses)
//   NOTE: players[] carry NO role field in blind output.
// god:
role_reveal: string                           // existing
performance: Array<{ player: string; role: string; assessment: string }>   // new
narrative: string                             // existing game summary/story
```

- **Guess granularity: specific roles** (locked) — Merlin, Assassin, Percival, Morgana,
  etc. per player (with reasoning), not just good/evil.
- **Bilingual boundary:** `guess_timeline` is written **once** with base-language brief
  reasoning and appears identically in both `summary.fa.json` and `summary.en.json`;
  `final_summary` and `final_guesses[].reasoning` are generated **per language** at game end.
- **Recap field differs by mode:** blind uses `final_summary`, god uses `narrative` — both
  the freeform recap, named apart because each pairs with different extras (guesses vs reveal).

## 5. API

- `src/app/api/rooms/[code]/ai-review/route.ts` — accept `{ enabled, mode }`; update both
  columns; validate `mode ∈ {blind,god}`.
- `src/app/api/rooms/[code]/route.ts` — return `ai_review_mode` so the UI reflects the
  current selection.
- `src/app/api/reviews/[gameId]/route.ts` — passes the report JSON through; minor (new
  fields ride along).

## 6. Frontend

- **Room page** (`src/app/rooms/[code]/page.tsx`) — a mode selector (Blind / God) next to
  the existing AI-review tick, enabled only when the tick is on. Posts `{ enabled, mode }`.
- **Review page** (`src/app/game/[gameId]/review/page.tsx`) — render the mode-specific
  block: **blind →** the **evolution timeline** (per-round guesses + reasoning) + the
  **final guesses** + the **freeform end summary**; **god →** narrative + role reveal +
  the per-player performance section.
- **Types** — `src/types/review.ts` (report), `src/types/database.ts` (the column).

## 7. Blind-mode purity (the guarantee)

- "Blind" means blind to the **secret roles only**. The reviewer still reads — and the
  guess legitimately uses — all **public** game state: discussion transcripts, team
  proposals, votes, and quest pass/fail outcomes. That's exactly what a human spectator
  sees. Only `player_roles` (the hidden alignment + special role) is withheld.
- Concretely: the blind path issues **zero queries to `player_roles`** for that game, and
  neither the LLM context nor the on-disk artifacts (`meta.json`, per-round input,
  `guess_log.json`, the report) **ever contain a role**. The roster comes from a role-free
  source (`room_players` + `players`).
- Add a test asserting the blind path makes no `player_roles` read (guards regressions).

## 8. Consent interaction

- Audio consent (`ai-consent`) is about **recording**, independent of mode — unchanged.
- **Mode editing: editable until the game starts** (locked), then locked once the
  reviewer claims the game.

## 9. Decisions (locked)

1. Default mode — **blind**.
2. Blind narrative — **dedicated prompt** (`final-narrative-blind-*`).
3. God performance — **dedicated section** (`performance-eval-*`).
4. Guess granularity — **specific roles** (Merlin / Assassin / Percival / …).
5. Mode — **editable until game start**, locked after.
6. Blind guessing cadence — **per discussion phase** (live, incremental).
7. Guess memory — **structured running log** during the game + a **freeform end-summary** file.
8. Blind report — **full evolution timeline + final verdict**.

## 10. Implementation order

1. Migration (the column).
2. Reviewer: read mode → blind roster (no roles) → **per-discussion guess-update + running
   memory** (blind) → `endSession` branch (blind end-summary / god reveal + performance) →
   new prompts.
3. Report shape (both `types.ts` sides).
4. API (toggle accepts+stores mode; room read returns it).
5. Frontend (selector + mode-specific rendering).
6. Verify: a **blind** game (no `player_roles` read; a guess entry per discussion phase;
   evolution timeline + freeform end-summary) and a **god** game (reveal + performance),
   both fa + en.
