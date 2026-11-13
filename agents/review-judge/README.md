# Report judge

Scores an AI game review against the game's record. A measurement tool for the
reviewer's accuracy: it is built into no image and never runs in production.

```
npm run judge -w review-judge -- --record <record.god.json> --fa <summary.fa.json> [--en <summary.en.json>] --out <new dir>
```

- `--record` is the god-mode record the reviewer writes (`record.json` in a god game, or
  `record.god.json` next to a replay's blind run). The judge always needs the roles.
- `--out` must be a new or empty folder. It receives `verdicts.json` (every sentence of the
  Persian report with its kind and verdict, and the English–Persian differences) and
  `measures.json`.
- Needs Vertex AI: `GCP_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, and `GCP_LLM_LOCATION`
  (default `global`, where the preview models are served).

## What it measures

Code splits the Persian report into numbered sentences: the per-quest facts (leader, proposals,
mission) one per line, the prose at sentence ends. The model gives each sentence exactly one
kind and verdict: a **fact** is supported, contradicted or not in the record; an
**attribution** (what a player said or claimed) is correct, misattributed or not found; anything
else (opinion, a guess about a role) is none. From those:

1. contradicted facts as a share of fact sentences — overall, in the prose, and in the quest facts;
2. misattributed or unfound attributions as a share;
3. blind reports only: the share of players whose guessed team is right and whether Merlin was
   named, from the detective's final guesses and the true roles, in code;
4. statements in the English report the Persian one doesn't make or contradicts.

The detective's guesses and their reasons are not fact-checked: measure 3 scores the guesses,
and the reasons are notes about one round that a checker can't place reliably.

Tests: `npm test -w review-judge` (no model calls).
