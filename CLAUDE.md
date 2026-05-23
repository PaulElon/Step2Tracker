# TimeFolio Desktop App

## Source of truth
- Live repo truth overrides all prior notes, uploaded docs, and plans.
- Re-anchor before any coding task:
  - `git branch --show-current`
  - `git log --oneline --decorate --max-count=12`
  - `git status --short`

## Non-negotiables
- User data safety first. Local SQLite is the user's primary data store.
- No blind rewrites. Read exact live code before proposing edits.
- No silent storage/persistence contract changes.
- No Tauri command signature changes without checking all callers.
- Inspect first, patch second.
- No destructive changes without a recovery path.
- No claims of success without running `npm run typecheck`.
- Do not push main if typecheck or lint fails.

## Desktop Release Rule
**Every desktop commit pushed to `main` must be followed by a signed Tauri release with a higher `app-v*` version.**

- Do not report desktop main work as complete until the release tag is created and the GitHub Actions publish workflow succeeds.
- **Installed desktop apps do not auto-update from `main` alone.** They only auto-update when a new release with a higher app version is published to GitHub Releases. A commit to main without a release means no change reaches installed users.
- The .github/workflows/release.yml runs automatically on every main push and creates the signed release. Monitor the workflow to confirm successful completion (check GitHub Actions status and GitHub Releases page for the new app-v* tag).
- If you need to prevent automatic release (exceptional cases only), pause the workflow or roll back the commit—never push work to main that you don't want released.
- If the user explicitly says "no release," state that installed users will not receive the changes and mark the work as pending release.

## High-risk files / areas
Always inspect exact live code before editing:
- `src-tauri/src/persistence.rs` — SQLite schema, migration logic
- `src-tauri/src/tf_autotracker_v2_native.rs` — Auto-Tracker V2 native events
- `src-tauri/src/tf_autotracker.rs` — Auto-Tracker Tauri commands
- `src/lib/native-persistence.ts` — all Tauri command invocations
- `src/lib/tf-autotracker-v2-session-machine.ts` — session state machine
- `src/state/app-store.tsx` and `src/state/tf-store.tsx` — React state contexts
- `src/lib/storage.ts` — AppState migration logic

## Global UI layout containment rule (permanent)

The left sidebar card establishes absolute vertical barriers for every page:
- **Top y-limit** = top of sidebar card
- **Bottom y-limit** = bottom of sidebar card

**Rules:**
- Main-page boxes/cards must never visually extend beyond these limits.
- If a card's content would exceed the lower y-limit, the card must stop at that y-limit and its content must scroll internally inside the rounded card.
- Separate boxes must expand/shrink independently. A tall box must never force a neighboring box to stretch vertically — use `items-start` on the grid row.
- Cards in a bounded flex column must use `min-h-0` so they don't overflow their flex parent.
- Use `overflow-hidden` on the card shell and `overflow-y-auto scrollbar-subtle` on the inner scroll area.
- Never use a fixed `max-h-[Npx]` when a viewport-relative `max-h-[calc(100vh-Nrem)]` is appropriate.

**Note:** The same rule applies to TimeFolio-Web (to be enforced separately).

## Auto-Tracker rule
- Away grace period is exactly 60,000 ms. Do not change this without explicit instruction.
- Session machine states: idle → focused → awayPending → recoverableOpen.
- Do not mix Auto-Tracker work with unrelated feature work.

## Required verification
```bash
npm run typecheck && npm run lint
```

## Worker/model routing
- Use Claude for: risky persistence changes, Auto-Tracker work, state machine changes, cross-file refactors.
- Use Codex for: bounded UI component additions, mechanical style changes, additive feature work on proven seams.

---

## Coding Guidelines (Karpathy)

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```
