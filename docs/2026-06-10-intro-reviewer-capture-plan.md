# Intro round → reviewer capture (turn-based)

**Date:** 2026-06-10
**Status:** planned

## Goal
Make the intro round **turn-based** (drive the existing speaking timer) so the reviewer
records it like a quest round — feeding the per-player dossiers and the blind detective's
**opening read** before Quest 1. **Decision (locked):** reuse the 50s-per-speaker timer.

Good news: `generateSpeakingOrder` already returns `[leader, ...others, leader]` — exactly the
intro's "leader opens, others in order, leader closes" — so the order is reused as-is.

## The collision problem
The intro and Quest 1's first proposal would otherwise both be **quest 1, round 0, same
speakers** → identical `turn_1_0_<idx>.json` filenames → the proposal overwrites the intro.
Fix: tag intro broadcasts with `isIntro`, and the reviewer files them under **effective quest 0**.

## 1. Broadcast type
- Add `isIntro: boolean` to `SpeakingTimerState` (the app hook `useSpeakingTimer` **and** the
  reviewer's mirror type in `agents/reviewer/src/types.ts`).

## 2. Frontend
- `useSpeakingTimer` gains an `inIntroPhase` option:
  - sets `isIntro` on the broadcast;
  - **regenerates a fresh order when crossing the intro→play boundary** (same leader, so the
    existing leader-keyed regen won't fire — key the regen on `leader + intro-flag` instead).
- `GameBoard` intro block renders the **speaking-timer panel** (reuse the proposal speaking UI,
  minus the propose-team form) + keeps the manager's **End intro** button.

## 3. Reviewer (collision-safe filing + integration)
- `TimerListener`: when `isIntro`, use **effective quest 0** for filing (`turn_0_*`). Change the
  initial `lastQuestNumber` sentinel from `0` → `-1` so quest 0 is a real "intro quest", not the
  no-quest sentinel.
- Fire **`onRoundChanged` for the intro round** when it ends (the quest `0 → 1` transition) →
  the detective's **opening guess-update**. `onQuestChanged` stays quest ≥ 1 (no quest-synthesis
  for the intro).
- Intro turns update **dossiers** as usual, so god narrative + the detective both see them.

## 4. Verify
- app + reviewer typecheck; 49 reviewer tests + the blind-purity test; sanity-check that intro
  turns land as `turn_0_*` and don't clobber `turn_1_*`.

## Risk
Edits `useSpeakingTimer` and `TimerListener` — both **core and shared** with existing flows.
Keep each change tight; lean on typecheck + the reviewer tests after every step.

## Build order
1. `isIntro` on both `SpeakingTimerState` types.
2. `useSpeakingTimer` (intro flag + boundary regen).
3. `GameBoard` intro speaking UI.
4. Reviewer `TimerListener` (effective quest 0 + intro round-changed) + filing.
5. Verify.
