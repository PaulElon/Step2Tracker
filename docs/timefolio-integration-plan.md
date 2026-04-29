# WARNING: Historical document.

This plan is historical. The TimeFolio merge portions are mostly complete, and the Auto-Tracker Phase 6 / 52340 / sidecar / backend ingestion direction described here is superseded.

Current Auto-Tracker source of truth:
- `docs/autotracker-v2-architecture.md`
- `docs/autotracker-v2-state-machine.md`
- `docs/autotracker-v2-entitlement-and-sync.md`

Do not use this file to implement Auto-Tracker V2.

# TimeFolio Integration Plan

_Generated 2026-04-26. Authoritative over all prior planning docs in space-study-quest-1._

---

## 1. Executive Decision

**Strategy: Adapt (additive merge) — single quarantined `TimeFolio` page.**

Add **one** new top-level navigation tab called `TimeFolio`, hidden behind a **single** feature
flag `VITE_FF_TIMEFOLIO`. All TimeFolio surfaces — Session Log, Allocation, Summary,
Analytics, Heatmap, Tracker Settings, Account/Billing — live as **internal subtabs of that
page**, not as separate sidebar items. Do not fork, do not port the Vanilla JS script chain,
do not rewrite the current study tabs.

**Why a single quarantined tab (revised 2026-04-26):**
- The merge is unstable until proven. One sidebar entry, one flag, one placeholder file is
  the minimum diff against the working app. The existing 6 study tabs cannot be affected
  while the merge is in flight.
- The current app's exhaustive `switch (activeSection)` at `src/App.tsx:748` and the
  exhaustive `sectionCopy: Record<SectionId, …>` at `src/App.tsx:82` mean every new
  `SectionId` member forces matching code in `App.tsx`. Adding **one** member instead of
  three triples-down the blast radius of every refactor.
- All TimeFolio internal subfeature flags (`VITE_FF_SESSION_LOG`, `VITE_FF_ANALYTICS`,
  `VITE_FF_TRACKER`, `VITE_FF_ACCOUNT`) are deferred to **optional internal toggles inside
  the TimeFolio page** — not initial sidebar gates. They only become useful once the
  TimeFolio page itself exists and stabilises.
- Final placement (whether features ultimately ship as their own sidebar tabs, get folded
  into Settings, or remain inside TimeFolio) is deferred to a dedicated **promotion phase**
  after the merge is proven green.

**Why Adapt (vs. fork or port verbatim):**
- The current app has zero React Router — navigation is a plain `SectionId` string in
  Context. Adding **one** new `SectionId` value (`"timefolio"`) is a one-line type change
  with zero impact on existing tabs.
- Tauri persistence (`load_state` / `upsert_study_block`) is already abstracted behind
  `native-persistence.ts`. New TimeFolio data can get parallel Rust commands without
  touching existing ones.
- All TimeFolio Vanilla JS is rewritten as idiomatic React — the logic (grouping
  functions, scheduling math, heatmap computations) is ported as pure TypeScript utility
  functions; the DOM-manipulation layer is discarded and replaced with React components.

---

## 2. Target Product Architecture

### Top-Level Navigation Shell

The `SectionId` union in `src/types/models.ts:3` gains exactly **one** new member:
`"timefolio"`. The `navigationItems` array in `src/App.tsx:49` gains exactly **one**
new entry, gated by `FF.timefolio`.

**Final initial nav order (left sidebar):**
```
Today           (dashboard)          ← UNCHANGED
Planner         (planner)            ← UNCHANGED
Weak Topics     (weakTopics)         ← UNCHANGED
Practice Tests  (tests)              ← UNCHANGED
Exam Error Log  (errorLog)           ← UNCHANGED
Settings        (settings)           ← UNCHANGED
────────────────────────────────────
TimeFolio       (timefolio)          ← NEW, hidden unless VITE_FF_TIMEFOLIO=true
```

No `Session Log`, `Analytics`, `Account`, or `Settings → Tracker` is added at the sidebar
or Settings level during the initial merge. Those surfaces only exist as **internal
subtabs of the TimeFolio page**.

### Internal Layout of the TimeFolio Page

The single `TimeFolio` page hosts an internal subtab strip (its own sub-router; **not**
another `SectionId`). Subtabs:

| Internal subtab | Source feature | Phase introduced |
|---|---|---|
| Overview | Landing summary tiles + recent sessions snapshot | 1 (placeholder) → 4 |
| Session Log | Live timer + session CRUD + heatmap | 3 |
| Allocation | Method/category breakdown chart | 4 |
| Summary | Daily/weekly/monthly summary text + sharing | 4 |
| Analytics | Plotly trend / focus-rate / distraction charts | 4 |
| Heatmap | Calendar heatmap with month nav and drill-down | 3 |
| Tracker Settings | Custom apps/websites, distraction rules | 5 |
| Account / Billing | Login, signup, Pro plan, Stripe checkout | 7 |

Subtab rendering lives entirely inside `src/features/timefolio-view.tsx` and a small
`src/features/timefolio/` folder. Subtabs that are not yet implemented render
`"<Subtab> — coming soon"`.

### Where Each Feature Lives (revised)

| TimeFolio Feature | Location in merged app | Phase |
|---|---|---|
| Session Log + live timer | `src/features/timefolio/session-log-panel.tsx` (internal subtab) | 3 |
| Heatmap calendar | `src/features/timefolio/heatmap-panel.tsx` + `src/components/timefolio-heatmap.tsx` | 3 |
| Allocation breakdown | `src/features/timefolio/allocation-panel.tsx` | 4 |
| Summary (weekly/monthly) | `src/features/timefolio/summary-panel.tsx` | 4 |
| Analytics charts | `src/features/timefolio/analytics-panel.tsx` (Plotly via existing `lazy-plot.tsx`) | 4 |
| Tracker settings | `src/features/timefolio/tracker-settings-panel.tsx` | 5 |
| Auto-tracker pairing UI | Modal launched from Tracker settings panel | 6 |
| Account / login / signup | `src/features/timefolio/account-panel.tsx` | 7 |
| Plan & billing | Sub-section of account panel or modal | 7 |

### What Remains Unchanged During the Merge

All of: `dashboard-view.tsx`, `planner-view.tsx`, `weak-topics-view.tsx`,
`practice-tests-view.tsx`, `error-log-view.tsx`, `settings-view.tsx`, `app-store.tsx`,
`storage.ts`, `native-persistence.ts`, `models.ts` (existing fields), `persistence.rs`,
all existing Tauri commands. No edit to Settings during the initial merge — the Tracker
sub-tab lives inside TimeFolio first, and only later (optional Phase 8 promotion) may
move into Settings if the merge is judged stable.

---

## 3. Data Architecture

### Current App Storage Model

- **Runtime:** React Context (`src/state/app-store.tsx`)
- **Browser persistence:** IndexedDB + localStorage, schema version 6, keys
  `step2-command-center:*` (`src/lib/storage.ts`)
- **Desktop persistence:** Rust commands via `invoke("load_state")`,
  `invoke("upsert_study_block")`, etc. (`src/lib/native-persistence.ts`)
- **Schema root:** `AppState` — `studyBlocks[]`, `practiceTests[]`, `weakTopicEntries[]`,
  `errorLogEntries[]`, `preferences`

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

- `src/lib/tf-storage.ts` (new) — IndexedDB store `tf-state` (separate from
  `step2-command-center:*`) + localStorage fallback. Never touches existing keys.
- `src/lib/tf-session-adapters.ts` (new) — pure functions: `studyBlockToSession`,
  `mergeByDate`, `totalsByDay`, `allocationByMethod`. Used inside the TimeFolio page only.
- `src/state/tf-store.tsx` (new) — separate React Context for TimeFolio state.
  `AppStoreProvider` stays untouched.

### Feature Flags

**Initial flag (only one needed for the quarantined merge):**

```
VITE_FF_TIMEFOLIO=true
```

Checked via `src/lib/feature-flags.ts` (new, ~5 lines). Missing = false. Zero cost when
disabled. This is the only flag added in Phase 1.

**Optional later internal-subfeature flags (deferred):**

```
VITE_FF_SESSION_LOG=true   # gates Session Log subtab inside TimeFolio
VITE_FF_ANALYTICS=true     # gates Allocation / Summary / Analytics subtabs
VITE_FF_TRACKER=true       # gates Tracker Settings subtab
VITE_FF_ACCOUNT=true       # gates Account / Billing subtab
```

These flags are only introduced when the relevant internal subtab is implemented. They
gate **panels inside the TimeFolio page**, never the sidebar. They are optional — if a
phase ships a stable subtab, the flag may be removed in the same commit.

### Backup / Restore

- Existing `BackupPayload` format and `persistence.rs` backup/restore commands are
  **not changed**.
- `TfAppState` gets its own backup command (`invoke("tf_export_state")`) and its own JSON
  export format (`app: "timefolio-tracker"`, `version: 1`). Restore flows are separate.
- The Storage Safety dialog in `App.tsx` is **not edited** during the initial merge. A
  dedicated TimeFolio backup affordance lives inside the TimeFolio page (Phase 3+). Cross-
  wiring into the existing Storage Safety dialog is a candidate for the later promotion
  phase only.

---

## 4. Runtime Architecture

### Desktop / Tauri Bridge

- New Rust commands needed in a new file `src-tauri/src/tf_persistence.rs` (preferred to
  avoid merge conflicts with `persistence.rs`):
  - `tf_load_state` → returns `TfAppState` JSON
  - `tf_save_session_log` → upsert single `TfSessionLog`
  - `tf_delete_session_log`
  - `tf_save_prefs`
  - `tf_export_state` / `tf_import_state`
  - (Phase 7) `tf_save_account` / `tf_load_account`
- Storage file: separate `timefolio-tracker.json` in the same app data dir as the
  existing `state.json`. Never the same file.
- Tauri capabilities (`src-tauri/capabilities/default.json`) need no new OS permissions
  until Phase 6 (accessibility API for auto-tracker).

### Browser Mode Limitations

- Session Log, Allocation, Summary, Analytics, Heatmap: fully functional in browser mode
  via `tf-storage.ts` (IndexedDB).
- Auto-tracker (Phase 6): **Tauri-only**. The Tracker Settings subtab must check
  `isTauri()` at runtime and show "Desktop app required" otherwise.
- Account/Auth (Phase 7): functional in both modes (HTTP fetch to Cloudflare Worker).
  Tauri uses `invoke("open_url")` for OAuth / Stripe flows.

### Native Auto-Tracker Dependencies

The TimeFolio Swift (macOS) and C# (Windows) binaries use a **loopback HTTP server** on
port 52340. They are separate executables, not embeddable in Tauri.

Options (human decision required — see Open Questions #2):
- **Option A (recommended short-term):** Reuse existing binaries. Tauri spawns or detects
  them via `Command::new_sidecar()`. Binary lives in `src-tauri/binaries/`. Pairing flow
  becomes a Tauri IPC call instead of browser loopback.
- **Option B (long-term):** Rewrite in Rust using `accessibility-rs` / `rdev`. Higher
  effort, single binary, no pairing needed.

Phase 6 defers this decision — the pairing UI can be built first with a stub native
bridge.

### Account / Auth / Billing Dependencies

> ⚠️ **ASSUMPTION — requires fresh verification before Phase 7.** The details below are
> design intentions, not proven by any live file in this repo. Verify Worker endpoints,
> KV namespaces, Stripe webhook config, and `tauri-plugin-keychain` availability against
> the live TimeFolio backend source before starting Phase 7.

- **Auth:** Custom email/password flow backed by Cloudflare Worker at
  `timefolio-payments.paulfreedman3.workers.dev`. No Firebase/Supabase. Credentials
  stored in localStorage (`accounts[]`). In Tauri, prefer OS Keychain via
  `tauri-plugin-keychain` (to add as dep in Phase 7) — confirm crate availability before
  committing.
- **Billing:** Stripe Checkout launched via `invoke("open_url", { url: checkoutUrl })`
  — no embedding needed. Webhook updates cloud KV; app polls plan status on launch.
- **Cloud sync:** Cloudflare KV via Worker proxy. App fetches on auth'd launch, pushes on
  write. Not required until Phase 7.

---

## 5. Phased Implementation Plan

---

### Phase 0 — Safety Baseline

**Goal:** Snapshot the working app, establish test commands, no code changes.

**Files touched:** none (docs only).
**Files forbidden:** everything in `src/`, `src-tauri/`.

**Steps:**
1. Run `npm run typecheck` — confirm clean (zero errors). _Confirmed clean 2026-04-26._
2. Run `npm run build` — confirm clean build. _Confirmed clean 2026-04-26._
3. Run `npm run lint || true` — informational only; **22 pre-existing errors** known
   (mostly unnecessary type assertions and two misused-promise warnings in
   `settings-view.tsx`). These do **not** block the gate.
4. Tag: `git tag pre-timefolio-integration`.
5. Export a manual app backup via the Storage Safety dialog.

**Verification commands:**
```bash
npm run typecheck
npm run build
npm run lint || true   # informational — 22 pre-existing errors expected
git tag pre-timefolio-integration
```

**Rollback:** `git checkout pre-timefolio-integration` restores everything.
**Model/effort:** n/a — human checklist only.
**Risk:** Low.

---

### Phase 1 — Single Quarantined TimeFolio Tab

**Goal:** Add the single `timefolio` `SectionId`, the single `FF.timefolio` flag, and a
single placeholder view. Nothing renders unless `VITE_FF_TIMEFOLIO=true`. The 6 existing
tabs are completely unaffected. **No internal subtab logic yet** — just a placeholder
page.

**Files touched (allowlist):**
- `src/lib/feature-flags.ts` (new) — exports `FF` with **only** `timefolio` initially
- `src/types/models.ts` — extend `SectionId` union to include `"timefolio"`
- `src/features/timefolio-view.tsx` (new) — placeholder, returns
  `<div className="p-8 text-slate-400">TimeFolio — coming soon</div>`
- `src/App.tsx` — add `Briefcase` (or similar) to lucide import; append one
  conditionally-spread nav entry; add one entry to `sectionCopy`; add one case in the
  `switch (activeSection)` at line 748

**Files forbidden / do-not-touch:**
- `src/state/app-store.tsx`
- `src/lib/storage.ts`
- `src/lib/native-persistence.ts`
- All existing view files in `src/features/` (other than App.tsx routing edits)
- Any file under `src-tauri/`

**Dependency order:** Phase 0 complete.

**Verification:**
```bash
npm run typecheck   # must pass clean
npm run build       # must pass clean
npm run lint || true   # informational; no NEW errors beyond the 22 pre-existing
# With VITE_FF_TIMEFOLIO unset (default): TimeFolio tab must not appear; the 6 study
#   tabs render unchanged.
# With VITE_FF_TIMEFOLIO=true: TimeFolio tab appears at the bottom of the sidebar and
#   renders the placeholder; the 6 study tabs still render unchanged.
```

**Rollback:** `git revert HEAD` (single commit). No data impact.
**Model/effort:** Sonnet, ~45m.
**Risk:** Low.

---

### Phase 2 — TimeFolio Subtab Shell + Data Model & Adapters (read-only)

**Goal:** Build the subtab strip inside the TimeFolio page (Overview, Session Log,
Allocation, Summary, Analytics, Heatmap, Tracker Settings, Account placeholders). Add
`TfSessionLog` / `TfAppState` types, `tf-storage.ts`, `tf-session-adapters.ts`, and
`tf-store.tsx`. All read-only; no writes to existing storage.

**Files touched (allowlist):**
- `src/features/timefolio-view.tsx` — render subtab strip + active-subtab placeholder
- `src/features/timefolio/` (new folder) — one `*-panel.tsx` placeholder per subtab
- `src/types/models.ts` — additive new interfaces only
- `src/lib/tf-storage.ts` (new)
- `src/lib/tf-session-adapters.ts` (new)
- `src/state/tf-store.tsx` (new)

**Files forbidden:**
- `src/lib/storage.ts` (existing storage must not be touched)
- `src/state/app-store.tsx`
- `src/types/models.ts` existing field changes (additive only)
- `src-tauri/src/persistence.rs`

**Dependency order:** Phase 1 complete.

**Verification:**
```bash
npm run typecheck   # no new errors
npm run build
# With VITE_FF_TIMEFOLIO=true: TimeFolio page shows subtab strip; each panel renders
#   "<Name> — coming soon"; subtab navigation is internal to the page (no SectionId
#   change).
```

**Rollback:** Delete the new files; revert `timefolio-view.tsx` to placeholder.
**Model/effort:** Sonnet, ~2.5h.
**Risk:** Low.

---

### Phase 3a — Session Log + Heatmap Subtabs (browser-mode, no Rust)

**Goal:** Functional Session Log subtab (CRUD + timer state machine) and enriched Heatmap
subtab inside the TimeFolio page. Browser-mode only; localStorage / IndexedDB persistence.
No Rust changes.

**Files touched (allowlist):**
- `src/features/timefolio/session-log-panel.tsx` — full implementation
- `src/features/timefolio/heatmap-panel.tsx` — full implementation
- `src/components/timefolio-heatmap.tsx` (new) — pure heatmap component (does not touch
  existing `consistency-heatmap.tsx`)
- `src/lib/tf-session-adapters.ts` — extend with `studyBlockToSession`
- `src/lib/tf-storage.ts` — localStorage / IndexedDB path only (no Tauri invoke)

**Files forbidden:**
- `src-tauri/` (deferred to Phase 3b)
- `src/components/consistency-heatmap.tsx` (still used by `dashboard-view.tsx`)
- `src/features/dashboard-view.tsx`
- `src/state/app-store.tsx`
- `src/lib/storage.ts`

**Dependency order:** Phase 2 complete.

**Verification:**
```bash
npm run typecheck
npm run build
npm run dev
# Inside TimeFolio → Session Log: create / edit / delete a session; timer starts /
#   pauses / stops correctly.
# Inside TimeFolio → Heatmap: month nav works, color intensity matches hours.
# Existing Dashboard heatmap unchanged.
```

**Rollback:** `VITE_FF_TIMEFOLIO=false` hides the entire surface. No existing data
touched.
**Model/effort:** Sonnet, ~3h.
**Risk:** Low (browser-only; no Rust; quarantined).

---

### Phase 3b — Rust / Tauri Persistence for TimeFolio

**Goal:** Wire the Phase 3a browser UI to Tauri native persistence. Session log and
heatmap data survive app restarts in desktop build.

**Files touched (allowlist):**
- `src-tauri/src/tf_persistence.rs` (new) — `tf_load_state`, `tf_save_session_log`,
  `tf_delete_session_log`
- `src-tauri/src/main.rs` — register new commands only (no edits to existing
  registrations)
- `src-tauri/Cargo.toml` — only if a new Rust dep is needed (justify each)
- `src/lib/tf-storage.ts` — add Tauri `invoke` path alongside the existing localStorage
  path

**Files forbidden:**
- `src-tauri/src/persistence.rs` (existing commands must not be edited)
- `src/components/consistency-heatmap.tsx`
- `src/features/dashboard-view.tsx`
- `src/state/app-store.tsx`
- `src/lib/storage.ts`

**Dependency order:** Phase 3a complete and verified in browser mode.

**Verification:**
```bash
npm run typecheck
npm run tauri:dev
# Create a session log entry — persists after a full app restart.
# Delete an entry — gone after restart.
# Heatmap data survives restart.
# Browser mode (npm run dev) still works via the localStorage path.
# Existing study-app data load/save unaffected (open Today / Planner — data intact).
```

**Rollback:** `VITE_FF_TIMEFOLIO=false` hides the surface. Rust commands are additive (no
existing command changed). `timefolio-tracker.json` can be deleted.
**Model/effort:** Sonnet, ~2h.
**Risk:** Medium (first Rust changes; Tauri invoke wiring).

---

### Phase 4 — Allocation / Summary / Analytics Subtabs

**Goal:** Three internal subtabs implemented: Allocation (Plotly bar/pie), Summary
(weekly/monthly text generation), Analytics (trend charts). All derived from
`TfSessionLog[]` + `StudyBlock[]` via adapters.

**Files touched (allowlist):**
- `src/features/timefolio/allocation-panel.tsx`
- `src/features/timefolio/summary-panel.tsx`
- `src/features/timefolio/analytics-panel.tsx`
- `src/lib/tf-analytics.ts` (new) — ported grouping/rollup logic from
  `chart-session-helpers.js`, `progress-stats-runtime.js`,
  `summary-scheduling-helpers.js` (pure TypeScript, no Chart.js)
- `src/lib/tf-summary.ts` (new) — ported summary text generation (pure functions)
- `src-tauri/src/tf_persistence.rs` — add `tf_save_summary`, `tf_list_summaries`

**Files forbidden:**
- `src/lib/analytics.ts` (existing — do not change)
- `src/components/lazy-plot.tsx` (use as-is via import; do not edit)
- All non-TimeFolio feature files

**Source reference (logic to port):**
- `space-study-quest-1/app/lib/chart-session-helpers.js` → `tf-analytics.ts`
- `space-study-quest-1/app/lib/summary-scheduling-helpers.js` → `tf-summary.ts`

**Dependency order:** Phase 3b complete.

**Verification:**
```bash
npm run typecheck
# In TimeFolio → Allocation: pie/bar renders with seeded session data.
# In TimeFolio → Summary: weekly summary text generates from the last 7 days.
# In TimeFolio → Analytics: trend / focus-rate charts render.
# Existing practice-test trend chart (lazy-plot.tsx in dashboard) unaffected.
```

**Rollback:** `VITE_FF_TIMEFOLIO=false` (or, optionally, the internal `VITE_FF_ANALYTICS`
flag once introduced). New files deletable. No existing data changed.
**Model/effort:** Sonnet, ~3h.
**Risk:** Medium (chart data mapping; date math in summary).

---

### Phase 5 — Tracker Settings Subtab (inside TimeFolio)

**Goal:** Implement the Tracker Settings subtab: daily goal, category labels, custom
app/website rules (CRUD), distraction rules. **Lives inside the TimeFolio page**, not in
the existing Settings view. No auto-tracker pairing yet.

**Files touched (allowlist):**
- `src/features/timefolio/tracker-settings-panel.tsx`
- `src/lib/tf-storage.ts` — persist `TfTrackerPrefs`
- `src-tauri/src/tf_persistence.rs` — add `tf_save_prefs`

**Files forbidden:**
- `src/features/settings-view.tsx` — **must remain bit-for-bit unchanged**. Tracker
  settings do not enter the existing Settings view during the merge. (Possible later
  promotion in Phase 8.)
- All other existing feature files
- `src-tauri/src/persistence.rs`

**Dependency order:** Phase 2 complete (TfTrackerPrefs type exists).

**Verification:**
```bash
npm run typecheck
# In TimeFolio → Tracker Settings: custom app rule CRUD works; rules persist across
#   restart.
# Existing Settings view (theme, daily goal, reminders, backup) is unchanged — open
#   Settings and confirm every existing control still behaves identically.
```

**Rollback:** `VITE_FF_TIMEFOLIO=false` hides the surface. The existing settings-view is
never touched, so there is nothing to revert there.
**Model/effort:** Sonnet, ~2h.
**Risk:** Low–Medium (no edit to existing settings-view; risk drops vs. previous plan).

---

### Phase 6 — Auto-Tracker Native Bridge

**Goal:** Wire the macOS Swift / Windows C# binary to Tauri. Pairing UI, device status,
live activity span ingestion. Session Log subtab gains auto-populated spans.

**Files touched (allowlist):**
- `src-tauri/src/autotracker.rs` (new) — Rust sidecar spawn, loopback HTTP polling, span
  ingestion commands
- `src-tauri/src/main.rs` — register new commands only
- `src-tauri/capabilities/default.json` — add `accessibility` permission (macOS) only
- `src-tauri/Cargo.toml` — `reqwest` or `tauri-plugin-http` for loopback HTTP
- `src-tauri/binaries/` — bundled native binary (sidecar)
- `src/features/timefolio/tracker-settings-panel.tsx` — add pairing stepper section
- `src/lib/tf-autotracker.ts` (new) — IPC wrappers for auto-tracker commands

**Files forbidden:**
- `autotracker/macos/Sources/**/*.swift` (read-only reference; recompile separately)
- All existing Rust commands in `persistence.rs`
- `src/features/settings-view.tsx`

**Dependency order:** Phase 5 complete; native binary must be pre-compiled and available
in `src-tauri/binaries/`.

**Verification:**
```bash
npm run tauri:dev
# Pairing stepper launches inside TimeFolio → Tracker Settings.
# Native binary spawns and registers (curl http://localhost:52340/health → 200).
# Activity spans appear in Session Log.
# Crash of native binary does not crash Tauri app (graceful disconnect UI).
```

**Rollback:** `VITE_FF_TIMEFOLIO=false`. Remove sidecar binary from bundle. No user data
deleted.
**Model/effort:** Opus (native bridge complexity), ~8h.
**Risk:** High (OS accessibility permissions, binary pairing, cross-platform divergence,
sidecar bundling).

---

### Phase 7 — Account / Login / Signup + Plan / Billing Subtab

**Goal:** Account subtab inside TimeFolio (login, signup, email verification). Pro plan
check gates auto-tracker and advanced analytics. Stripe Checkout via
`invoke("open_url")`.

**Files touched (allowlist):**
- `src/features/timefolio/account-panel.tsx` — full auth forms
- `src/lib/tf-auth.ts` (new) — HTTP calls to Cloudflare Worker auth API
- `src/lib/tf-billing.ts` (new) — plan check, checkout URL construction
- `src/state/tf-store.tsx` — account state hydration on launch
- `src-tauri/src/tf_persistence.rs` — `tf_save_account`, `tf_load_account` (OS Keychain
  preferred; verify crate availability before adding)
- `src-tauri/Cargo.toml` — `tauri-plugin-keychain` or `keyring` crate (only after
  verification)

**Files forbidden:**
- `src/features/settings-view.tsx`, `src/state/app-store.tsx`, `src/lib/storage.ts`,
  `src-tauri/src/persistence.rs`
- All study-app auth-free flows must work unchanged for unauthenticated users.

**Open questions (must resolve before Phase 7):**
- Auth model decision (see inventory §4 question 1)
- Cloud sync decision (question 3)
- Billing surface decision (question 5)
- `tauri-plugin-keychain` crate availability

**Verification:**
```bash
npm run typecheck
# Sign up → email verification code → logged in.
# Log out → account subtab shows login form.
# Free tier: Tracker Settings shows upgrade CTA; auto-tracker pairing gated.
# Pro tier: auto-tracker fully accessible.
# Study-app tabs work identically whether logged in or not.
```

**Rollback:** `VITE_FF_TIMEFOLIO=false` (or internal `VITE_FF_ACCOUNT=false` once
introduced). No local study data touched.
**Model/effort:** Opus, ~8h.
**Risk:** High (custom auth, Cloudflare Workers integration, Keychain storage, Stripe
webhook sync).

---

### Phase 8 — Promotion / Final Placement (decision phase, optional)

**Goal:** Once the TimeFolio page has been green for ≥1 release cycle and ≥1 manual
backup-and-restore round-trip, decide where each subfeature **finally** lives. This is
the only phase where the existing 6 study tabs / Settings view / sidebar layout may be
edited.

**Possible promotions (each is a separate, optional, reversible decision):**

| Subfeature | Promote to | Decision criteria |
|---|---|---|
| Session Log | Standalone sidebar tab `Session Log` | Used daily; users want one-click access |
| Analytics (Allocation + Summary + Analytics) | Standalone sidebar tab `Analytics` | Charts are stable; analytics demand outweighs nav clutter |
| Tracker Settings | Sub-tab inside the existing `Settings` view | Settings view is judged stable enough to absorb a new sub-tab |
| Account / Billing | Sidebar tab `Account` or footer affordance | Auth ships and is judged stable |
| Heatmap | Merged into Today/dashboard hero, or kept inside TimeFolio | UX call only |
| Storage Safety dialog | Cross-wired with TimeFolio backups | Backup parity proven across both stacks |

**Each promotion = its own bounded slice with its own Phase 0-equivalent baseline,
allowlist, forbidden-list, verification, and rollback.** No promotion is required; the
quarantined `TimeFolio` tab is a stable terminal state if desired.

**Files possibly touched (only if a promotion is approved):**
- `src/types/models.ts` — additional `SectionId` members (one per promoted feature)
- `src/App.tsx` — additional nav entries, `sectionCopy` entries, switch cases
- `src/features/settings-view.tsx` — only if Tracker Settings promotion is approved

**Verification:** every promotion must run the full Phase 0 verification suite plus a
manual regression of every existing study tab.

**Rollback:** revert the specific promotion commit; the `TimeFolio` page absorbs the
feature again.
**Model/effort:** Sonnet per promotion, ~1–2h each.
**Risk:** Medium (first edits to existing tabs / Settings; one promotion at a time).

---

### Phase 9 — Polish / Release Packaging

**Goal:** Onboarding flow, error states, empty states, Tauri bundle metadata, code
signing, auto-update wiring for the new TimeFolio surfaces.

**Files touched (allowlist):**
- `src-tauri/tauri.conf.json` — bundle identifier, version bump
- `src-tauri/src/updater.rs` — ensure update endpoint covers new commands
- New TimeFolio feature files — UI polish, loading states, error boundaries
- `src/App.tsx` — onboarding wizard gate (first-launch detection) only if scoped here

**Verification:**
```bash
npm run tauri:build
# dmg / msi installs cleanly.
# Auto-update checks correctly.
# All Phase 0 verification commands still pass.
```

**Rollback:** Tag before build; revert version bump.
**Model/effort:** Sonnet, ~4h.
**Risk:** Low–Medium.

---

## 6. Implementation Queue

Ordered by dependency. Each prompt = one atomic git commit.

| # | Title | Model | Effort | Allowed files | Forbidden files | Stop condition | Verification |
|---|---|---|---|---|---|---|---|
| 1 | Add feature-flags module (timefolio only) | Sonnet | 15m | `src/lib/feature-flags.ts` (new) | Everything else | File created with single `timefolio` flag; typecheck passes | `npm run typecheck` |
| 2 | Extend SectionId with `"timefolio"` only + App.tsx exhaustiveness | Sonnet | 25m | `src/types/models.ts`, `src/App.tsx` | All other files | Union compiles; sectionCopy + switch updated; existing 6 tabs render unchanged | `npm run typecheck && npm run build` |
| 3 | Add TimeFolio nav item behind FF guard + placeholder view | Sonnet | 30m | `src/App.tsx`, `src/features/timefolio-view.tsx` (new) | All other files | TimeFolio nav hidden when FF off; visible when on; placeholder renders; existing tabs unchanged | `npm run typecheck && npm run build` + visual check in `npm run dev` |
| 4 | Add internal subtab strip + panel placeholders | Sonnet | 1h | `src/features/timefolio-view.tsx`, `src/features/timefolio/*-panel.tsx` (new) | All other files | Subtab strip renders; each panel shows "coming soon" | `npm run typecheck && npm run build` |
| 5 | Add TfSessionLog + TfAppState types | Sonnet | 20m | `src/types/models.ts` (additive only) | Existing type shapes | Types compile; zero changes to existing interfaces | `npm run typecheck` |
| 6 | Add tf-storage.ts (IndexedDB + localStorage) | Sonnet | 45m | `src/lib/tf-storage.ts` (new) | `src/lib/storage.ts` | CRUD round-trip tested in browser console | `npm run typecheck` |
| 7 | Add tf-session-adapters.ts (pure functions) | Sonnet | 45m | `src/lib/tf-session-adapters.ts` (new) | All state/storage files | `studyBlockToSession`, `totalsByDay`, `allocationByMethod` pass inline tests | `npm run typecheck` |
| 8 | Add TfStore React Context | Sonnet | 45m | `src/state/tf-store.tsx` (new) | `src/state/app-store.tsx` | Context provides empty TfAppState; wraps app without breaking existing Context | `npm run typecheck && npm run build` |
| 9 | Add Rust tf_persistence.rs (load/save session) | Sonnet | 1.5h | `src-tauri/src/tf_persistence.rs` (new), `src-tauri/src/main.rs`, `src-tauri/Cargo.toml` | `src-tauri/src/persistence.rs` | `invoke("tf_load_state")` / `invoke("tf_save_session_log")` succeed | `npm run tauri:dev` + devtools |
| 10 | Implement Session Log subtab (CRUD + timer) | Sonnet | 3h | `src/features/timefolio/session-log-panel.tsx` | Other panels, all existing features | Create/edit/delete sessions; timer transitions correct; persists across reload | Manual test in `tauri:dev` |
| 11 | Add timefolio-heatmap component + Heatmap subtab | Sonnet | 2.5h | `src/components/timefolio-heatmap.tsx` (new), `src/features/timefolio/heatmap-panel.tsx` | `src/components/consistency-heatmap.tsx` | Month nav works; color intensity matches hours; click → day drilldown | Manual test |
| 12 | Add tf-analytics.ts (pure grouping) | Sonnet | 1h | `src/lib/tf-analytics.ts` (new) | `src/lib/analytics.ts` | Weekly/daily rollups correct on fixture data | `npm run typecheck` |
| 13 | Add tf-summary.ts (summary generation) | Sonnet | 45m | `src/lib/tf-summary.ts` (new) | All state files | `generateWeeklySummary(logs)` returns valid `TfSummaryPayload` | `npm run typecheck` |
| 14 | Implement Allocation + Summary + Analytics subtabs | Sonnet | 3h | `src/features/timefolio/allocation-panel.tsx`, `…/summary-panel.tsx`, `…/analytics-panel.tsx` | `src/lib/analytics.ts`, `src/components/lazy-plot.tsx` (import only) | All three panels render with seeded data | Manual test |
| 15 | Implement Tracker Settings subtab | Sonnet | 2h | `src/features/timefolio/tracker-settings-panel.tsx`, `src/lib/tf-storage.ts` | `src/features/settings-view.tsx` | Custom app rule CRUD; rules persist across restart | `npm run typecheck` + manual |
| 16 | Add tf_save_prefs Rust command | Sonnet | 45m | `src-tauri/src/tf_persistence.rs` | `src-tauri/src/persistence.rs` | Prefs persist across restart | `npm run tauri:dev` |
| 17 | Autotracker Rust sidecar + IPC | Opus | 4h | `src-tauri/src/autotracker.rs` (new), `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json` | All persistence commands | `health_check` invoke succeeds; spawn/kill binary | `npm run tauri:dev` + curl loopback |
| 18 | Autotracker pairing UI inside Tracker Settings | Sonnet | 2h | `src/features/timefolio/tracker-settings-panel.tsx`, `src/lib/tf-autotracker.ts` (new) | All other files | Pairing stepper renders; advances on native health signal | Manual test |
| 19 | Span ingestion → Session Log subtab | Sonnet | 1h | `src/features/timefolio/session-log-panel.tsx`, `src/lib/tf-autotracker.ts` | All other files | Auto spans appear in Session Log; manual sessions unaffected | Manual test |
| 20 | Add tf-auth.ts + Account subtab forms | Opus | 3h | `src/features/timefolio/account-panel.tsx`, `src/lib/tf-auth.ts` (new) | All study-app files | Signup → email verify → login flow against Worker | Manual test + network |
| 21 | Add tf-billing.ts + plan check + Stripe | Opus | 2h | `src/lib/tf-billing.ts` (new), `src/features/timefolio/account-panel.tsx` | All study-app files | Free tier sees upgrade CTA; pro tier full access | Manual test |
| 22 | Account state → pro feature gates | Sonnet | 1h | `src/state/tf-store.tsx`, `src/features/timefolio/tracker-settings-panel.tsx` | All study-app files | Gates correctly reflect plan status | `npm run typecheck` + manual |
| 23 | (Optional) Promotion phase — one slice at a time | Sonnet | 1–2h each | Per-promotion allowlist (see Phase 8) | Per-promotion forbidden-list | Promoted feature behaves identically; existing tabs unchanged | Full Phase 0 suite + regression |
| 24 | Tauri bundle metadata + version bump | Sonnet | 30m | `src-tauri/tauri.conf.json` | All source files | `tauri:build` produces valid dmg/msi | `npm run tauri:build` |
| 25 | Final regression pass + release tag | Human | — | — | — | All Phase 0 checks pass; backup/restore works; all 6 study tabs functional | `npm run typecheck && npm run build && npm run tauri:build` |

---

## 7. First 3 Prompts Ready to Paste

---

### Prompt 1 — Add feature-flags module (timefolio only)

```
You are working in /Users/paul/Desktop/step2-ck-godtier-react.

TASK: Create src/lib/feature-flags.ts — a tiny module that reads Vite env vars
to control whether the quarantined TimeFolio tab is visible at runtime.

DO NOT modify any existing file. Create only src/lib/feature-flags.ts.

Content to write:

```ts
// Checked at runtime. Missing env var → false. No existing code is affected.
// Only the single TimeFolio quarantine flag is introduced here. Internal
// subfeature flags (sessionLog / analytics / tracker / account) will be added
// later, once their corresponding subtabs inside the TimeFolio page exist.
export const FF = {
  timefolio: import.meta.env.VITE_FF_TIMEFOLIO === "true",
} as const;
```

STOP when:
- src/lib/feature-flags.ts exists with the content above
- npm run typecheck passes with zero new errors
- No other file was modified

VERIFICATION:
npm run typecheck
git diff --stat   # must show only 1 new file
```

---

### Prompt 2 — Extend SectionId with `"timefolio"` only + App.tsx exhaustiveness fixes

```
You are working in /Users/paul/Desktop/step2-ck-godtier-react.

TASK: Add exactly ONE new string literal — "timefolio" — to the SectionId union
in src/types/models.ts. Then fix the two exhaustiveness sites in src/App.tsx
that this break (sectionCopy and the activeSection switch). DO NOT add any
other SectionId members. DO NOT add a sidebar nav item yet — that is Prompt 3.

FILE 1: src/types/models.ts, line 3.

Current line 3:
  export type SectionId = "dashboard" | "planner" | "weakTopics" | "tests" | "settings" | "errorLog";

Replace with:
  export type SectionId = "dashboard" | "planner" | "weakTopics" | "tests" | "settings" | "errorLog" | "timefolio";

FILE 2: src/App.tsx — exhaustiveness only.

1. In `sectionCopy: Record<SectionId, { title: string }>` (around line 82), add:
     timefolio: { title: "TimeFolio" },

2. In the `switch (activeSection)` block (around line 748), add a case BEFORE
   the closing brace:
     case "timefolio":
       sectionContent = <div className="p-8 text-slate-400">TimeFolio — coming soon</div>;
       break;

DO NOT change any other line in App.tsx. DO NOT add nav items, FF guards, icon
imports, or new view file imports — those are Prompt 3's job.

DO NOT modify any other file in the repo.

STOP when:
- src/types/models.ts line 3 matches the new union exactly
- src/App.tsx sectionCopy has the timefolio entry
- src/App.tsx activeSection switch has the timefolio case
- npm run typecheck passes with zero errors
- npm run build passes
- Only src/types/models.ts and src/App.tsx were modified

VERIFICATION:
npm run typecheck
npm run build
git diff --stat
```

---

### Prompt 3 — Add hidden TimeFolio nav item behind FF.timefolio + placeholder view

```
You are working in /Users/paul/Desktop/step2-ck-godtier-react.

CONTEXT: src/lib/feature-flags.ts now exports FF.timefolio (single flag).
SectionId now includes "timefolio". src/App.tsx already has an exhaustiveness
case rendering a placeholder for "timefolio".

TASK: Add a single navigation item for TimeFolio, gated by FF.timefolio, and
move the placeholder JSX into a dedicated file. The existing 6 nav items must
NOT be touched. No internal subtab logic yet — just the placeholder page.

ALLOWED FILES:
- src/App.tsx
- src/features/timefolio-view.tsx (NEW)

FORBIDDEN FILES:
- All existing view files (dashboard-view.tsx, planner-view.tsx, weak-topics-view.tsx,
  practice-tests-view.tsx, error-log-view.tsx, settings-view.tsx)
- src/state/app-store.tsx
- src/lib/storage.ts
- src/lib/native-persistence.ts
- All files under src-tauri/

CHANGES:

1. Create src/features/timefolio-view.tsx:

```tsx
export function TimeFolioView() {
  return (
    <div className="p-8 text-slate-400">
      TimeFolio — coming soon
    </div>
  );
}
```

2. Edit src/App.tsx:

   a. Add this import after the existing lib imports:
        import { FF } from "./lib/feature-flags";
        import { TimeFolioView } from "./features/timefolio-view";

   b. Add `Briefcase` (or another existing lucide icon already in use elsewhere
      — confirm by grepping the file rather than guessing) to the lucide-react
      import at the top.

   c. In the `navigationItems` array (around line 49), append exactly ONE entry
      at the end of the array, inside a conditional spread so it disappears
      when the flag is off:
        ...(FF.timefolio
          ? [{ id: "timefolio" as const, label: "TimeFolio", icon: Briefcase }]
          : []),

   d. Replace the inline `timefolio` switch case body (added in Prompt 2) so
      it renders the new view component:
        case "timefolio":
          sectionContent = <TimeFolioView />;
          break;

DO NOT modify any of the 6 existing nav items, their icons, their routing,
their labels, or any other part of App.tsx. DO NOT add any other SectionId
flags, sub-flags, or panels.

STOP when:
- npm run typecheck passes with zero errors
- npm run build passes with zero errors
- With VITE_FF_TIMEFOLIO unset (default), the TimeFolio tab does NOT appear
  in the sidebar; the 6 study tabs render and behave identically.
- With VITE_FF_TIMEFOLIO=true, the TimeFolio tab appears at the bottom of
  the sidebar and renders the placeholder; the 6 study tabs still render
  and behave identically.

VERIFICATION:
npm run typecheck
npm run build
npm run lint || true   # informational — pre-existing lint errors expected
# Run dev server and visually confirm the existing 6 tabs are unchanged.
npm run dev
```

---

## 8. Open Questions (Must Resolve Before Relevant Phase)

| # | Question | Blocks | Default assumption |
|---|---|---|---|
| 1 | Auth model in Tauri (Cloudflare Worker vs Keychain vs local-only) | Phase 7 | Keep Cloudflare Worker; store token in OS Keychain via `tauri-plugin-keychain` (verify crate availability first) |
| 2 | Native tracker binary strategy (reuse Swift/C# vs Rust rewrite) | Phase 6 | Reuse existing binaries as Tauri sidecar (Option A) |
| 3 | Cloud sync vs local-only for session logs | Phases 3–7 | Local-only until auth ships (Phase 7), then opt-in sync |
| 4 | Chart library (Chart.js vs Plotly vs both) | Phase 4 | Plotly only (already in app via `lazy-plot.tsx`; no Chart.js) |
| 5 | Billing surface in desktop app (App Store vs direct Stripe) | Phase 7 | Direct Stripe Checkout via `invoke("open_url")` — avoid App Store |
| 6 | Next.js marketing layer (`apps/web/`) in scope? | Phase 9 | Out of scope for this integration |
| 7 | Final placement of each TimeFolio subfeature | Phase 8 | Decide per subfeature only after merge proven; may stay inside TimeFolio indefinitely |

---

## 9. Risk Register

| Risk | Phase | Severity | Mitigation |
|---|---|---|---|
| Quarantined TimeFolio page leaks state into existing Context (`app-store.tsx`) | 2–7 | High | Strictly separate `tf-store.tsx`; lint rule (or PR review checklist) forbidding TimeFolio panels from importing `app-store.tsx` |
| Adding new `SectionId` breaks the exhaustive switch / sectionCopy | 1 | Medium | Prompt 2 explicitly fixes both sites; typecheck must pass before merging |
| Rust sidecar binary pairing breaks on macOS permissions changes (Sequoia) | 6 | High | Implement graceful degradation UI; loopback health check before any span ingestion |
| Custom auth Cloudflare Worker unavailable / rate-limited | 7 | High | Cache credentials locally; show offline mode; never block study-app launch on auth |
| TfAppState schema migration needed between Phase 2 and release | 3–7 | Medium | Embed `tfVersion` field; write forward-migration function in `tf-storage.ts` before Phase 3 |
| Plotly chart rendering performance on low-end hardware | 4 | Low | Use `plotly.js-basic-dist-min` (already in package.json); lazy-load charts |
| Bundle size regression (Plotly + new TimeFolio panels) | 4–9 | Medium | Existing `index-*.js` already 793 kB and `plotly-basic.min` 1077 kB; budget before/after sizes per phase |
| Pre-existing lint errors (22) mask new lint regressions | all | Low | Treat lint as informational; rely on typecheck/build as the gate; do not opportunistically fix unrelated lint inside TimeFolio commits |
| Tracker-settings promotion later breaks `settings-view.tsx` | 8 | Medium | Promotion is a dedicated, separately-scoped slice; baseline-and-rollback per promotion |
| `tauri-plugin-keychain` crate may not exist / not be maintained | 7 | Medium | Verify on crates.io / Tauri docs before Phase 7; fallback to `keyring` crate or encrypted JSON in app data dir |
