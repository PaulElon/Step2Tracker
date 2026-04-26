# TimeFolio Integration Plan

_Generated 2026-04-26. Authoritative over all prior planning docs in space-study-quest-1._

---

## 1. Executive Decision

**Strategy: Adapt (additive merge)**

Add TimeFolio features as new routes/sections behind feature flags inside the existing React app. Do not fork, do not port the Vanilla JS script chain, do not rewrite the current study tabs.

**Why this is safe:**
- The current app has zero React Router — navigation is a plain `SectionId` string in Context. Adding new `SectionId` values is a one-line type change with zero impact on existing tabs.
- Tauri persistence (`load_state` / `upsert_study_block`) is already abstracted behind `native-persistence.ts`. New TimeFolio data can get parallel Rust commands without touching existing ones.
- Feature flags (`VITE_FF_*` env vars checked at runtime) make every new surface invisible until deliberately enabled. No existing user data is touched.
- All TimeFolio Vanilla JS is rewritten as idiomatic React — the logic (grouping functions, scheduling math, heatmap computations) is ported as pure TypeScript utility functions; the DOM-manipulation layer is discarded and replaced with React components.

---

## 2. Target Product Architecture

### Navigation Shell

Current `SectionId` union in `src/types/models.ts:3` gets new members. `navigationItems` array in `src/App.tsx:49` gets new entries behind a `FF_TIMEFOLIO` flag guard.

**Proposed final nav order (left sidebar):**
```
Today           (dashboard)          ← UNCHANGED
Planner         (planner)            ← UNCHANGED
Weak Topics     (weakTopics)         ← UNCHANGED
Practice Tests  (tests)              ← UNCHANGED
Exam Error Log  (errorLog)           ← UNCHANGED
────────────────────────────────────
Session Log     (sessionLog)         ← NEW  [Phase 3]
Analytics       (analytics)          ← NEW  [Phase 4]
────────────────────────────────────
Settings        (settings)           ← UNCHANGED (gains Tracker sub-tab in Phase 5)
Account         (account)            ← NEW  [Phase 7]
```

### Where Each Feature Lives

| TimeFolio Feature | Location in merged app | Phase |
|---|---|---|
| Session Log + live timer | `src/features/session-log-view.tsx` (new) | 3 |
| Heatmap calendar | `src/components/timefolio-heatmap.tsx` (new); replaces/extends `consistency-heatmap.tsx` | 3 |
| Allocation breakdown | `src/features/analytics-view.tsx` section | 4 |
| Summary (weekly/monthly) | `src/features/analytics-view.tsx` section | 4 |
| Analytics charts | `src/features/analytics-view.tsx` (new, Plotly) | 4 |
| Settings → Tracker tab | Sub-tab added to `src/features/settings-view.tsx` | 5 |
| Auto-tracker pairing UI | Modal within Settings → Tracker tab | 6 |
| Account / login / signup | `src/features/account-view.tsx` (new) | 7 |
| Plan & billing | Sub-section of account-view or modal | 7 |

### What Remains Unchanged

All of: `dashboard-view.tsx`, `planner-view.tsx`, `weak-topics-view.tsx`, `practice-tests-view.tsx`, `error-log-view.tsx`, `app-store.tsx`, `storage.ts`, `native-persistence.ts`, `models.ts` (existing fields), `persistence.rs`, all existing Tauri commands.

---

## 3. Data Architecture

### Current App Storage Model

- **Runtime:** React Context (`src/state/app-store.tsx`)
- **Browser persistence:** IndexedDB + localStorage, schema version 6, keys `step2-command-center:*` (`src/lib/storage.ts`)
- **Desktop persistence:** Rust commands via `invoke("load_state")`, `invoke("upsert_study_block")`, etc. (`src/lib/native-persistence.ts`)
- **Schema root:** `AppState` — `studyBlocks[]`, `practiceTests[]`, `weakTopicEntries[]`, `errorLogEntries[]`, `preferences`

### TimeFolio Tracker Data Model (to add)

```typescript
// New types to add to src/types/models.ts (additive only)

export interface TfSessionLog {
  id: string;
  date: string;           // YYYY-MM-DD
  method: string;         // human label, e.g. "UWorld"
  methodKey: string;      // slug, e.g. "uworld"
  hours: number;
  startISO: string;
  endISO: string;
  notes: string;
  isDistraction: boolean;
  isLive: boolean;        // true while timer running
}

export interface TfSummaryPayload {
  id: string;
  kind: "daily" | "weekly" | "monthly";
  label: string;
  generatedAtISO: string;
  voice: string;
  text: string;
  caption: string;
  metrics: {
    streak: number;
    studyHours: number;
    focusRate: number;
    topMethod: string;
  };
}

export interface TfTrackerPrefs {
  customAutoApps: string[];
  customAutoWebsites: string[];
  customDistractionApps: string[];
  customDistractionWebsites: string[];
}

export interface TfAccountState {
  userId: string | null;
  email: string | null;
  username: string | null;
  emailVerified: boolean;
  syncId: string | null;
  planTier: "free" | "pro";
  themeUnlocks: string[];
  billingCustomerId: string | null;
}

// Extend AppState in a separate interface (don't touch existing AppState fields):
export interface TfAppState {
  tfVersion: number;
  sessionLogs: TfSessionLog[];
  summaries: TfSummaryPayload[];
  trackerPrefs: TfTrackerPrefs;
  account: TfAccountState | null;
}
```

### Migration / Adapter Layer

- `src/lib/tf-storage.ts` (new) — IndexedDB store `tf-state` (separate from `step2-command-center:*`) + localStorage fallback. Never touches existing keys.
- `src/lib/tf-session-adapters.ts` (new) — pure functions: `studyBlockToSession(block: StudyBlock): TfSessionLog`, `mergeByDate()`, `totalsByDay()`, `allocationByMethod()`. Used by analytics and heatmap; study blocks appear as sessions in the Session Log read-only view.
- `src/state/tf-store.tsx` (new) — separate React Context for TimeFolio state. `AppStoreProvider` stays untouched.

### Feature Flags

All new surfaces gated by:
```
VITE_FF_SESSION_LOG=true
VITE_FF_ANALYTICS=true
VITE_FF_TRACKER=true
VITE_FF_ACCOUNT=true
```

Checked via `src/lib/feature-flags.ts` (new, 10 lines). Missing = false. Zero cost when disabled.

### Backup / Restore

- Existing `BackupPayload` format and `persistence.rs` backup/restore commands are **not changed**.
- `TfAppState` gets its own backup command (`invoke("tf_export_state")`) and its own JSON export format (`app: "timefolio-tracker"`, `version: 1`). Restore flows are separate.
- The Storage Safety dialog in `App.tsx` gains a second section for TimeFolio backups (Phase 3+).

---

## 4. Runtime Architecture

### Desktop / Tauri Bridge

- New Rust commands needed in `src-tauri/src/persistence.rs` (new file `src-tauri/src/tf_persistence.rs` preferred to avoid merge conflicts):
  - `tf_load_state` → returns `TfAppState` JSON
  - `tf_save_session_log` → upsert single `TfSessionLog`
  - `tf_delete_session_log`
  - `tf_save_prefs`
  - `tf_export_state` / `tf_import_state`
  - (Phase 7) `tf_save_account` / `tf_load_account`
- Storage file: separate `timefolio-tracker.json` in same app data dir as existing `state.json`. Never same file.
- Tauri capabilities (`src-tauri/capabilities/default.json`) need no new OS permissions until Phase 6 (accessibility API for auto-tracker).

### Browser Mode Limitations

- Session Log, Allocation, Summary, Analytics, Heatmap: fully functional in browser mode via `tf-storage.ts` (IndexedDB).
- Auto-tracker (Phase 6): **Tauri-only**. Feature flag `VITE_FF_TRACKER=true` should also check `isTauri()` at runtime and show "Desktop app required" otherwise.
- Account/Auth (Phase 7): functional in both modes (HTTP fetch to Cloudflare Worker). Tauri uses `invoke("open_url")` for OAuth / Stripe flows.

### Native Auto-Tracker Dependencies

The TimeFolio Swift (macOS) and C# (Windows) binaries use a **loopback HTTP server** on port 52340. They are separate executables, not embeddable in Tauri.

Options (human decision required — see Open Questions #2):
- **Option A (recommended short-term):** Reuse existing binaries. Tauri spawns or detects them via `Command::new_sidecar()`. Binary lives in `src-tauri/binaries/`. Pairing flow becomes a Tauri IPC call instead of browser loopback.
- **Option B (long-term):** Rewrite in Rust using `accessibility-rs` / `rdev`. Higher effort, single binary, no pairing needed.

Phase 6 defers this decision — the pairing UI can be built first with a stub native bridge.

### Account / Auth / Billing Dependencies

- **Auth:** Custom email/password flow backed by Cloudflare Worker at `timefolio-payments.paulfreedman3.workers.dev`. No Firebase/Supabase. Credentials stored in localStorage (`accounts[]`). In Tauri, store in OS Keychain via `tauri-plugin-keychain` (to add as dep in Phase 7).
- **Billing:** Stripe Checkout launched via `invoke("open_url", { url: checkoutUrl })` — no embedding needed. Webhook updates cloud KV; app polls plan status on launch.
- **Cloud sync:** Cloudflare KV via Worker proxy. App fetches on auth'd launch, pushes on write. Not required until Phase 7.

---

## 5. Phased Implementation Plan

---

### Phase 0 — Safety Baseline

**Goal:** Snapshot the working app, establish test commands, no code changes.

**Files touched:** none (docs only)
**Files forbidden:** everything in `src/`, `src-tauri/`

**Steps:**
1. Run `npm run typecheck && npm run lint` — confirm clean.
2. Run `npm run tauri:build` (or `npm run build`) — confirm clean build.
3. Tag: `git tag pre-timefolio-integration`
4. Export a manual app backup via the Storage Safety dialog.

**Verification commands:**
```bash
npm run typecheck
npm run lint
git tag pre-timefolio-integration
```

**Rollback:** `git checkout pre-timefolio-integration` restores everything.

**Model/effort:** n/a — human checklist only.
**Risk:** Low.

---

### Phase 1 — Route / Nav Scaffolding Behind Feature Flags

**Goal:** Add new `SectionId` values and empty placeholder views. Nothing renders unless flag is set. Existing tabs completely unaffected.

**Files likely touched:**
- `src/types/models.ts` — extend `SectionId` union
- `src/App.tsx` — add nav items and view routing behind flag check
- `src/lib/feature-flags.ts` (new)
- `src/features/session-log-view.tsx` (new, returns `<div>Session Log coming soon</div>`)
- `src/features/analytics-view.tsx` (new, placeholder)
- `src/features/account-view.tsx` (new, placeholder)

**Files forbidden / do-not-touch:**
- `src/state/app-store.tsx`
- `src/lib/storage.ts`
- `src/lib/native-persistence.ts`
- All existing view files

**Dependency order:** Phase 0 complete.

**Verification:**
```bash
npm run typecheck
npm run lint
# With VITE_FF_SESSION_LOG=false (default): new tabs must not appear
# With VITE_FF_SESSION_LOG=true: placeholder renders, existing tabs work
```

**Rollback:** `git revert HEAD` (single commit). No data impact.
**Model/effort:** Sonnet, ~1h.
**Risk:** Low.

---

### Phase 2 — TimeFolio Data Model & Adapters (read-only)

**Goal:** Add `TfSessionLog` / `TfAppState` types, `tf-storage.ts`, `tf-session-adapters.ts`, and `tf-store.tsx`. All read-only; no writes to existing storage.

**Files likely touched:**
- `src/types/models.ts` — additive new interfaces only
- `src/lib/tf-storage.ts` (new)
- `src/lib/tf-session-adapters.ts` (new)
- `src/state/tf-store.tsx` (new)

**Files forbidden:**
- `src/lib/storage.ts` (existing storage must not be touched)
- `src/state/app-store.tsx`
- `src-tauri/src/persistence.rs`

**Dependency order:** Phase 1 complete (SectionId types in place).

**Verification:**
```bash
npm run typecheck   # no new errors
# Import tf-store in a test component and verify TfAppState initializes to empty
```

**Rollback:** Delete the 3–4 new files. Zero impact on existing data.
**Model/effort:** Sonnet, ~2h.
**Risk:** Low.

---

### Phase 3 — Session Log + Heatmap Calendar

**Goal:** Functional Session Log view (CRUD) and enriched heatmap showing both StudyBlocks and TfSessionLogs. Timer state machine (running/paused/stopped) for manual sessions.

**Files likely touched:**
- `src/features/session-log-view.tsx` — full implementation
- `src/components/timefolio-heatmap.tsx` (new) — replaces/wraps `consistency-heatmap.tsx`
- `src/lib/tf-session-adapters.ts` — extend with `studyBlockToSession`
- `src-tauri/src/tf_persistence.rs` (new) — `tf_load_state`, `tf_save_session_log`, `tf_delete_session_log`
- `src-tauri/src/main.rs` — register new commands
- `src-tauri/Cargo.toml` — if new Rust deps needed

**Files forbidden:**
- `src/components/consistency-heatmap.tsx` (keep, still used by dashboard-view)
- `src/features/dashboard-view.tsx`
- `src/state/app-store.tsx`
- `src/lib/storage.ts`

**Dependency order:** Phase 2 complete.

**Verification:**
```bash
npm run typecheck
npm run tauri:dev
# 1. Create a session log entry — persists after reload
# 2. Delete an entry — gone from list
# 3. Heatmap shows existing study blocks + new sessions
# 4. Existing Dashboard heatmap (consistency-heatmap.tsx) unchanged
```

**Rollback:** Feature flag `VITE_FF_SESSION_LOG=false` hides view. Rust commands are additive (no existing command changed). `tf-state.json` can be deleted.
**Model/effort:** Sonnet, ~4h.
**Risk:** Medium (first Rust changes; timer state machine is non-trivial).

---

### Phase 4 — Allocation / Summary / Analytics

**Goal:** Analytics view showing: session allocation by method (Plotly bar/pie), weekly summary panel, trend charts. All derived from `TfSessionLog[]` + `StudyBlock[]` via adapters.

**Files likely touched:**
- `src/features/analytics-view.tsx` — full implementation
- `src/lib/tf-analytics.ts` (new) — ported grouping/rollup logic from `chart-session-helpers.js`, `progress-stats-runtime.js`, `summary-scheduling-helpers.js` (pure TypeScript, no Chart.js)
- `src/lib/tf-summary.ts` (new) — ported summary text generation (pure functions)
- `src-tauri/src/tf_persistence.rs` — add `tf_save_summary`, `tf_list_summaries`

**Files forbidden:**
- `src/lib/analytics.ts` (existing — do not change)
- `src/components/lazy-plot.tsx` (use as-is via import)

**Source reference (logic to port):**
- `space-study-quest-1/app/lib/chart-session-helpers.js` → `tf-analytics.ts`
- `space-study-quest-1/app/lib/summary-scheduling-helpers.js` → `tf-summary.ts`

**Dependency order:** Phase 3 complete.

**Verification:**
```bash
npm run typecheck
# 1. Analytics tab visible with VITE_FF_ANALYTICS=true
# 2. Plotly charts render (not blank) with seeded session data
# 3. Weekly summary panel generates text from last 7 days
# 4. Existing practice test score trend chart (lazy-plot.tsx) unaffected
```

**Rollback:** Feature flag off. New files deletable. No existing data changed.
**Model/effort:** Sonnet, ~3h.
**Risk:** Medium (chart data mapping from JS to TypeScript types; summary logic has date math).

---

### Phase 5 — Settings → Tracker Tab

**Goal:** Add a "Tracker" sub-tab inside the existing Settings view. Contains: daily goal, category labels, custom app/website rules (CRUD), distraction rules. No auto-tracker pairing yet.

**Files likely touched:**
- `src/features/settings-view.tsx` — add sub-tab and Tracker panel (careful edit)
- `src/lib/tf-storage.ts` — persist `TfTrackerPrefs`
- `src-tauri/src/tf_persistence.rs` — add `tf_save_prefs`

**Files forbidden:**
- All other features in `settings-view.tsx` must remain bit-for-bit identical

**Dependency order:** Phase 2 complete (TfTrackerPrefs type exists).

**Verification:**
```bash
npm run typecheck
# 1. All existing settings (theme, goal, reminders, backup) still work
# 2. New Tracker tab appears only when VITE_FF_TRACKER=true
# 3. Custom app rule CRUD persists across restart
```

**Rollback:** Revert settings-view.tsx edit. All other state unaffected.
**Model/effort:** Sonnet, ~2h.
**Risk:** Medium (editing the existing settings-view.tsx is the highest-risk file touch so far; isolate to sub-tab addition only).

---

### Phase 6 — Auto-Tracker Native Bridge

**Goal:** Wire the macOS Swift / Windows C# binary to Tauri. UI for pairing, device status, live activity span ingestion. Session Log gains auto-populated spans.

**Files likely touched:**
- `src-tauri/src/autotracker.rs` (new) — Rust sidecar spawn, loopback HTTP polling, span ingestion commands
- `src-tauri/src/main.rs` — register commands
- `src-tauri/capabilities/default.json` — add `accessibility` permission (macOS)
- `src-tauri/Cargo.toml` — `reqwest` or `tauri-plugin-http` for loopback HTTP
- `src-tauri/binaries/` — bundled native binary (sidecar)
- `src/features/settings-view.tsx` — Tracker tab gains pairing stepper
- `src/lib/tf-autotracker.ts` (new) — IPC wrappers for auto-tracker commands

**Files forbidden:**
- `autotracker/macos/Sources/**/*.swift` (read-only reference; recompile separately)
- All existing Rust commands in `persistence.rs`

**Dependency order:** Phase 5 complete; native binary must be pre-compiled and available in `src-tauri/binaries/`.

**Verification:**
```bash
npm run tauri:dev
# 1. Pairing stepper launches in Settings → Tracker
# 2. Native binary spawns and registers (check loopback ping: curl http://localhost:52340/health)
# 3. Activity spans appear in Session Log
# 4. Crash of native binary does not crash Tauri app (graceful disconnect UI)
```

**Rollback:** Feature flag `VITE_FF_TRACKER=false`. Remove sidecar binary from bundle. No user data deleted.
**Model/effort:** Opus (native bridge complexity), ~8h.
**Risk:** High (OS accessibility permissions, binary pairing, cross-platform divergence, sidecar bundling in Tauri).

---

### Phase 7 — Account Login / Signup + Plan / Billing

**Goal:** Account view (login, signup, email verification). Pro plan check gates auto-tracker and advanced analytics. Stripe Checkout via `invoke("open_url")`.

**Files likely touched:**
- `src/features/account-view.tsx` — full auth forms
- `src/lib/tf-auth.ts` (new) — HTTP calls to Cloudflare Worker auth API
- `src/lib/tf-billing.ts` (new) — plan check, checkout URL construction
- `src/state/tf-store.tsx` — account state hydration on launch
- `src-tauri/src/tf_persistence.rs` — `tf_save_account`, `tf_load_account` (OS Keychain preferred)
- `src-tauri/Cargo.toml` — `tauri-plugin-keychain` or `keyring` crate

**Files forbidden:**
- All study-app auth-free flows must work unchanged for unauthenticated users

**Open questions (must resolve before Phase 7):**
- Auth model decision (see inventory §4 question 1)
- Cloud sync decision (question 3)
- Billing surface decision (question 5)

**Verification:**
```bash
npm run typecheck
# 1. Sign up → email verification code → logged in
# 2. Log out → account view shows login form
# 3. Free tier: auto-tracker pairing shows upgrade CTA
# 4. Pro tier: auto-tracker fully accessible
# 5. Study app tabs work identically whether logged in or not
```

**Rollback:** Feature flag `VITE_FF_ACCOUNT=false`. No local study data touched.
**Model/effort:** Opus, ~8h.
**Risk:** High (custom auth, Cloudflare Workers integration, Keychain storage, Stripe webhook sync).

---

### Phase 8 — Polish / Release Packaging

**Goal:** Onboarding flow, error states, empty states, Tauri bundle metadata, code signing, auto-update wiring for new features.

**Files likely touched:**
- `src-tauri/tauri.conf.json` — bundle identifier, version bump
- `src-tauri/updater.rs` — ensure update endpoint covers new commands
- All new feature files — UI polish, loading states, error boundaries
- `src/App.tsx` — onboarding wizard gate (first-launch detection)

**Verification:**
```bash
npm run tauri:build
# 1. dmg / msi installs cleanly
# 2. Auto-update checks correctly
# 3. All Phase 0 verification commands still pass
```

**Rollback:** Tag before build; revert version bump.
**Model/effort:** Sonnet, ~4h.
**Risk:** Low–Medium.

---

## 6. Implementation Queue

Ordered by dependency. Each prompt = one atomic git commit.

| # | Title | Model | Effort | Allowed files | Forbidden files | Stop condition | Verification |
|---|---|---|---|---|---|---|---|
| 1 | Add feature-flags module | Sonnet | 15m | `src/lib/feature-flags.ts` (new) | Everything else | File created, typecheck passes | `npm run typecheck` |
| 2 | Extend SectionId for new views | Sonnet | 15m | `src/types/models.ts` | All other files | Union compiles, no other type errors | `npm run typecheck` |
| 3 | Add nav items behind FF guard | Sonnet | 30m | `src/App.tsx` | All view files, store, storage | Nav items hidden when FF off; visible when on; existing tabs unchanged | `npm run typecheck && npm run lint` |
| 4 | Add placeholder view files | Sonnet | 20m | `src/features/session-log-view.tsx` (new), `src/features/analytics-view.tsx` (new), `src/features/account-view.tsx` (new) | All existing files | Views render "coming soon" text | `npm run typecheck` |
| 5 | Add TfSessionLog + TfAppState types | Sonnet | 20m | `src/types/models.ts` (additive only) | Existing type shapes | Types compile; zero changes to existing interfaces | `npm run typecheck` |
| 6 | Add tf-storage.ts (IndexedDB + localStorage) | Sonnet | 45m | `src/lib/tf-storage.ts` (new) | `src/lib/storage.ts` | CRUD round-trip tested in browser console | `npm run typecheck` |
| 7 | Add tf-session-adapters.ts (pure functions) | Sonnet | 45m | `src/lib/tf-session-adapters.ts` (new) | All state/storage files | `studyBlockToSession`, `totalsByDay`, `allocationByMethod` pass inline tests | `npm run typecheck` |
| 8 | Add TfStore React Context | Sonnet | 45m | `src/state/tf-store.tsx` (new) | `src/state/app-store.tsx` | Context provides empty TfAppState; wraps app without breaking existing Context | `npm run typecheck && npm run lint` |
| 9 | Add Rust tf_persistence.rs (load/save session) | Sonnet | 1.5h | `src-tauri/src/tf_persistence.rs` (new), `src-tauri/src/main.rs`, `src-tauri/Cargo.toml` | `src-tauri/src/persistence.rs` | `invoke("tf_load_state")` and `invoke("tf_save_session_log")` return without panic | `npm run tauri:dev` + devtools console |
| 10 | Implement Session Log view (CRUD + timer) | Sonnet | 3h | `src/features/session-log-view.tsx` | All other feature files | Create/edit/delete sessions; timer starts/stops; persists across reload | Manual test in `tauri:dev` |
| 11 | Add timefolio-heatmap component | Sonnet | 2h | `src/components/timefolio-heatmap.tsx` (new) | `src/components/consistency-heatmap.tsx` | Month nav works; color intensity matches hours; click shows day drilldown | Manual test |
| 12 | Wire heatmap into Session Log view | Sonnet | 30m | `src/features/session-log-view.tsx` | All other files | Heatmap renders below session list; existing dashboard heatmap unchanged | `npm run typecheck` + visual check |
| 13 | Add tf-analytics.ts (pure grouping functions) | Sonnet | 1h | `src/lib/tf-analytics.ts` (new) | `src/lib/analytics.ts` | Weekly/daily rollups return correct totals from fixture data | `npm run typecheck` |
| 14 | Add tf-summary.ts (summary generation) | Sonnet | 45m | `src/lib/tf-summary.ts` (new) | All state files | `generateWeeklySummary(logs)` returns valid `TfSummaryPayload` | `npm run typecheck` |
| 15 | Implement Analytics view (Plotly charts) | Sonnet | 2.5h | `src/features/analytics-view.tsx` | `src/lib/analytics.ts`, `src/components/lazy-plot.tsx` (import only) | Allocation pie, daily bar, trend line render with session data | Manual test |
| 16 | Add Tracker sub-tab to Settings view | Sonnet | 1.5h | `src/features/settings-view.tsx` | All other feature files | New sub-tab visible under FF; existing settings tabs pass functional check | `npm run typecheck` + Settings regression |
| 17 | Add tf_save_prefs Rust command | Sonnet | 45m | `src-tauri/src/tf_persistence.rs` | `src-tauri/src/persistence.rs` | Custom app rule persists across restart | `npm run tauri:dev` |
| 18 | Autotracker Rust sidecar + IPC | Opus | 4h | `src-tauri/src/autotracker.rs` (new), `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json` | All persistence commands | `health_check` invoke succeeds; spawn/kill binary | `npm run tauri:dev` + curl loopback |
| 19 | Autotracker pairing UI in Settings | Sonnet | 2h | `src/features/settings-view.tsx` (Tracker sub-tab only), `src/lib/tf-autotracker.ts` (new) | All other files | Pairing stepper renders; step advance gated on native health signal | Manual test |
| 20 | Span ingestion → Session Log | Sonnet | 1h | `src/features/session-log-view.tsx`, `src/lib/tf-autotracker.ts` | All other files | Auto spans appear in Session Log; manual sessions unaffected | Manual test |
| 21 | Add tf-auth.ts + Account view forms | Opus | 3h | `src/features/account-view.tsx`, `src/lib/tf-auth.ts` (new) | All study-app files | Signup → email verify → login flow completes against Worker | Manual test + network tab |
| 22 | Add tf-billing.ts + plan check + Stripe | Opus | 2h | `src/lib/tf-billing.ts` (new), `src/features/account-view.tsx` | All study-app files | Free tier sees upgrade CTA; pro tier has full access | Manual test |
| 23 | Account state → pro feature gates | Sonnet | 1h | `src/state/tf-store.tsx`, `src/features/settings-view.tsx` (Tracker tab only) | All study-app files | Feature gates correctly reflect plan status from account state | `npm run typecheck` + manual test |
| 24 | Tauri bundle metadata + version bump | Sonnet | 30m | `src-tauri/tauri.conf.json` | All source files | `tauri:build` produces valid dmg/msi | `npm run tauri:build` |
| 25 | Final regression pass + release tag | Human | — | — | — | All Phase 0 checks pass; backup/restore works; all 6 study tabs functional | `npm run typecheck && npm run lint && npm run tauri:build` |

---

## 7. First 3 Prompts Ready to Paste

---

### Prompt 1 — Add feature-flags module

```
You are working in /Users/paul/Desktop/step2-ck-godtier-react.

TASK: Create src/lib/feature-flags.ts — a tiny module that reads Vite env vars
to control which new TimeFolio features are visible at runtime.

DO NOT modify any existing file. Create only src/lib/feature-flags.ts.

Content to write:

```ts
// Checked at runtime. Missing env var → false. No existing code is affected.
export const FF = {
  sessionLog: import.meta.env.VITE_FF_SESSION_LOG === "true",
  analytics:  import.meta.env.VITE_FF_ANALYTICS  === "true",
  tracker:    import.meta.env.VITE_FF_TRACKER     === "true",
  account:    import.meta.env.VITE_FF_ACCOUNT     === "true",
} as const;
```

STOP when:
- src/lib/feature-flags.ts exists with the content above
- npm run typecheck passes with zero new errors
- No other file was modified

VERIFICATION:
npm run typecheck
git diff --stat  # must show only 1 new file
```

---

### Prompt 2 — Extend SectionId for new views

```
You are working in /Users/paul/Desktop/step2-ck-godtier-react.

TASK: Add three new string literals to the SectionId union type in
src/types/models.ts. This is an additive, non-breaking change.

FILE: src/types/models.ts, line 3.

Current line 3:
  export type SectionId = "dashboard" | "planner" | "weakTopics" | "tests" | "settings" | "errorLog";

Replace with:
  export type SectionId = "dashboard" | "planner" | "weakTopics" | "tests" | "settings" | "errorLog" | "sessionLog" | "analytics" | "account";

DO NOT change any other line. DO NOT change any other file.

STOP when:
- Line 3 of src/types/models.ts matches the new union exactly
- npm run typecheck passes (may see exhaustiveness errors in App.tsx switch — fix only those, nowhere else)
- No other file was modified except App.tsx if required for exhaustiveness

VERIFICATION:
npm run typecheck
git diff --stat
```

---

### Prompt 3 — Add nav items behind feature flag guard

```
You are working in /Users/paul/Desktop/step2-ck-godtier-react.

CONTEXT: src/lib/feature-flags.ts now exports FF.sessionLog, FF.analytics,
FF.account. SectionId now includes "sessionLog", "analytics", "account".

TASK: Edit src/App.tsx to add nav items and view routing for the three new
sections, gated by FF flags. The existing 6 nav items must not be touched.

ALLOWED files: src/App.tsx only.

CHANGES REQUIRED:

1. At the top of App.tsx, add this import after the existing lib imports:
   import { FF } from "./lib/feature-flags";

2. In the `navigationItems` array (around line 49), append new items at the end
   of the array, inside a conditional spread:
   ...(FF.sessionLog ? [{ id: "sessionLog" as const, label: "Session Log", icon: Clock }] : []),
   ...(FF.analytics  ? [{ id: "analytics"  as const, label: "Analytics",   icon: BarChart2 }] : []),
   ...(FF.account    ? [{ id: "account"    as const, label: "Account",     icon: User }] : []),
   
   Add Clock, BarChart2, User to the lucide-react import at the top.

3. In sectionCopy, add:
   sessionLog: { title: "Session Log" },
   analytics:  { title: "Analytics" },
   account:    { title: "Account" },

4. In the view-routing switch/conditional (around line 750), add cases:
   if (activeSection === "sessionLog") sectionContent = <div className="p-8 text-slate-400">Session Log — coming soon</div>;
   if (activeSection === "analytics")  sectionContent = <div className="p-8 text-slate-400">Analytics — coming soon</div>;
   if (activeSection === "account")    sectionContent = <div className="p-8 text-slate-400">Account — coming soon</div>;

DO NOT modify any of the 6 existing nav items, their icons, their routing,
or any other part of App.tsx.

STOP when:
- npm run typecheck passes with zero errors
- npm run lint passes
- With VITE_FF_SESSION_LOG=false (default), new tabs do not appear in the sidebar
- With VITE_FF_SESSION_LOG=true, "Session Log" tab appears and renders placeholder

VERIFICATION:
npm run typecheck
npm run lint
# Run dev server and visually confirm existing tabs work identically
npm run dev
```

---

## 8. Open Questions (Must Resolve Before Relevant Phase)

| # | Question | Blocks | Default assumption |
|---|---|---|---|
| 1 | Auth model in Tauri (Cloudflare Worker vs Keychain vs local-only) | Phase 7 | Keep Cloudflare Worker; store token in OS Keychain via `tauri-plugin-keychain` |
| 2 | Native tracker binary strategy (reuse Swift/C# vs Rust rewrite) | Phase 6 | Reuse existing binaries as Tauri sidecar (Option A) |
| 3 | Cloud sync vs local-only for session logs | Phases 3–7 | Local-only until auth ships (Phase 7), then opt-in sync |
| 4 | Chart library (Chart.js vs Plotly vs both) | Phase 4 | Plotly only (already in app; no Chart.js) |
| 5 | Billing surface in desktop app (App Store vs direct Stripe) | Phase 7 | Direct Stripe Checkout via `invoke("open_url")` — avoid App Store |
| 6 | Next.js marketing layer (`apps/web/`) in scope? | Phase 8 | Out of scope for this integration |

---

## 9. Risk Register

| Risk | Phase | Severity | Mitigation |
|---|---|---|---|
| `settings-view.tsx` edit breaks existing settings tabs | 5 | High | Edit only the sub-tab section; write regression test for all 3 existing sub-tabs before PR |
| Rust sidecar binary pairing breaks on macOS permissions changes (Sequoia) | 6 | High | Implement graceful degradation UI; loopback health check before any span ingestion |
| Custom auth Cloudflare Worker unavailable / rate-limited | 7 | High | Cache credentials locally; show offline mode; never block study-app launch on auth |
| TfAppState schema migration needed between Phase 2 and release | 3–7 | Medium | Embed `tfVersion` field; write forward-migration function in `tf-storage.ts` before Phase 3 |
| Plotly chart rendering performance on low-end hardware | 4 | Low | Use `plotly.js-basic-dist-min` (already in package.json); lazy-load charts |
