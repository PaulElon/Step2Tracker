# WARNING: Historical inventory.

This document is a historical inventory and may still be useful for code archaeology. Any Auto-Tracker port 52340 / old sidecar / browser-cloud-span assumptions are superseded by the Auto-Tracker V2 docs.

Live repo code and the Auto-Tracker V2 docs override this inventory for new implementation.

# TimeFolio Live-File Inventory

_Generated 2026-04-26. Source of truth: live import/script chains, not docs._

> **Integration architecture note (2026-04-26):** the merge into the current React/Tauri app
> uses a **single quarantined top-level tab `TimeFolio`** behind one feature flag
> (`VITE_FF_TIMEFOLIO`). All TimeFolio surfaces listed below are integrated as **internal
> subtabs of that page**, not as new sidebar tabs. The existing 6 study tabs
> (Today / Planner / Weak Topics / Practice Tests / Exam Error Log / Settings) stay
> bit-for-bit unchanged for the entire merge. Final placement decisions are deferred to a
> later promotion phase. See `timefolio-integration-plan.md` for execution detail.

---

## 1. Current App Architecture — TimeFolio Study Tracker

**Repo:** `/Users/paul/Desktop/step2-ck-godtier-react`  
**Stack:** React 19 + Vite 8 + TypeScript 6 + Tailwind v4 + Tauri v2 (Rust)

### Entrypoints
| File | Role |
|------|------|
| `index.html` | Vite HTML entry |
| `src/main.tsx` | `ReactDOM.createRoot` → `<App />` |
| `src/App.tsx` | Single-page tab router (no React Router), mounts all views, wires Tauri `listen`/`invoke` |
| `src-tauri/src/main.rs` | Tauri app init, registers commands |

### Major Views (tab-gated in `App.tsx`)
| Tab ID | File |
|--------|------|
| `dashboard` | `src/features/dashboard-view.tsx` |
| `planner` | `src/features/planner-view.tsx` |
| `weakTopics` | `src/features/weak-topics-view.tsx` |
| `tests` | `src/features/practice-tests-view.tsx` |
| `errorLog` | `src/features/error-log-view.tsx` |
| `settings` | `src/features/settings-view.tsx` |

### State / Storage
| File | Role |
|------|------|
| `src/state/app-store.tsx` | React Context wrapping all app state; delegates persistence to native or browser |
| `src/lib/storage.ts` | IndexedDB + localStorage (`APP_STATE_VERSION=6`, keys `step2-command-center:*`) |
| `src/lib/native-persistence.ts` | Tauri IPC wrappers (`invoke("load_state")`, `invoke("upsert_study_block")`, etc.) |
| `src/types/models.ts` | All TypeScript types (`AppState`, `StudyBlock`, `PracticeTest`, etc.) |
| `src/data/bootstrap-schedule.json` | Seed schedule used on first launch |

### Support Libs
`src/lib/analytics.ts` · `src/lib/datetime.ts` · `src/lib/practice-tests.ts`  
`src/lib/reminders.ts` · `src/lib/study-workflow.ts` · `src/lib/themes.ts`  
`src/lib/excel.ts` · `src/lib/ui.ts`

### UI Components
`src/components/consistency-heatmap.tsx` · `src/components/focus-orbit.tsx`  
`src/components/lazy-plot.tsx` (Plotly) · `src/components/mini-calendar.tsx`  
`src/components/modal-shell.tsx` · `src/components/momentum-ribbon.tsx`  
`src/components/rich-text-editor.tsx` · `src/components/study-task-card.tsx`  
`src/components/study-task-editor.tsx` · `src/components/task-launch-button.tsx`  
`src/components/ui.tsx`

### Tauri / Native
| File | Role |
|------|------|
| `src-tauri/src/persistence.rs` | All Rust commands: `load_state`, `save_preferences`, `upsert_study_block`, trash, backup, restore, export |
| `src-tauri/src/updater.rs` | Auto-updater |
| `src-tauri/tauri.conf.json` | App bundle config |
| `src-tauri/capabilities/default.json` | Permission scopes |
| `src-tauri/Cargo.toml` | Rust dependencies |

### Build / Test Commands
```
npm run dev            # Vite dev (browser)
npm run tauri:dev      # Tauri dev (desktop)
npm run build          # tsc + vite build
npm run tauri:build    # Tauri bundle (dmg/exe/deb)
npm run typecheck      # tsc -b
npm run lint           # eslint
```

---

## 2. TimeFolio Live Feature Inventory

**Repo:** `/Users/paul/space-study-quest-1`  
**Architecture:** Vanilla JS, 120+ global scripts loaded in order from `src/app-entry-script-chain.json` → `app/lib/*.js`. TypeScript files in `src/lib/*.ts` are _typed declarations only_ — the `.js` counterparts (compiled to `app/lib/`) are the actual runtime. Plus a Next.js read-only portfolio layer at `apps/web/`.

---

### Feature Table

| Feature | Live source files | Proof live | Main dependencies | Data contract | Reuse rating | Notes / risks |
|---------|------------------|-----------|-------------------|---------------|-------------|---------------|
| **Auto-tracker (native)** | `autotracker/macos/Sources/**/*.swift` · `autotracker/windows/src/**/*.cs` | Script chain loads bridge files; native binary distributed in `app/downloads/` | `app/lib/native-guard-transport-runtime.js` · `app/lib/pull-native-spans.js` · `app/lib/push-rules-to-native.js` · `app/lib/native-span-reconciler.js` | ActivitySpan: `{id, startISO, endISO, appName, bundleId, category, windowTitle, hours}` | **Rewrite** | Loopback server model (port 52340); separate binary pairing flow. Tauri can provide similar native hooks; Swift/C# binaries are separate executables, not embeddable. |
| **Auto-tracker (web UI/pairing)** | `app/lib/pro-panel-runtime.js` · `app/lib/render-tracker-setup-stepper.js` · `app/lib/pro-tracker-pair-modal.js` · `app/lib/pro-tracker-pair-status.js` · `app/lib/pro-tracker-pair-submit.js` · `app/lib/pro-tracker-pair-verification-code.js` · `app/lib/pro-tracker-pairing-helpers.js` · `app/lib/pro-tracker-devices.js` · `app/lib/pro-tracker-diagnostics.js` | In script chain; `window.TimeFolioPro*` globals used by `app-runtime.js` | `app/lib/billing-runtime.js` (plan check) · Loopback HTTP to native | Pairing token, device list, health signal | **Rewrite** | Pro-plan gated. All DOM manipulation via IDs; no React components. |
| **Session log** | `app/lib/timer-session-core.js` · `app/lib/day-sessions-runtime.js` · `app/lib/log-flow-group-runtime.js` · `app/lib/chart-session-helpers.js` | Script chain; `mergeAndSave()` is write path; `logsAll()` is read path | Luxon (datetime) · cloud snapshot `logs[]` array | `SessionLog: {id, date, method, methodKey, hours, startISO, endISO, notes, isDistraction, isLive}` | **Adapt** | Data shape is close to current app's StudyBlock. Timer state machine (`running`, `paused`, `timerTick`) is complex but separable. `day-sessions-runtime` edit modal is DOM-heavy → rewrite UI, keep logic. |
| **Allocation (method breakdown)** | `app/lib/chart-session-helpers.js` · `app/lib/progress-stats-runtime.js` · `app/lib/analytics-charts-runtime.js` | Used by dashboard + analytics flow groups | Chart.js · Luxon | Derived from `logs[]` grouped by `methodKey`; `totalsByDay()`, `totalsByDayAllowedResources()` | **Adapt** | No dedicated "allocation" component — derived from session logs. Chart.js charts → can swap to Plotly (current app already has Plotly). |
| **Summary** | `app/lib/summary-sharing-runtime.js` · `app/lib/render-summary-text.js` · `app/lib/summary-prefs-storage-helpers.js` · `app/lib/summary-history-storage-helpers.js` · `app/lib/summary-scheduling-helpers.js` | Script chain; exports `window.TimeFolioSummarySharing*` | Luxon · cloud snapshot `summaries[]` · `html-to-image` (export) | `SummaryPayload: {kind, label, generatedAtISO, voice, text, caption, metrics: {streak, studyHours, focusRate, ...}}` | **Adapt** | Scheduling + sharing logic is reusable as pure functions. Export (html-to-image shim) is web-only; Tauri can use native screenshot instead. |
| **Analytics** | `app/lib/analytics-charts-runtime.js` · `app/lib/insights-flow-group-runtime.js` · `app/lib/chart-session-helpers.js` | Script chain; `window.TimeFolioAnalyticsChartsRuntime` registered | Chart.js · Luxon · `logs[]` | Input: `SessionLog[]`; output: Chart.js config objects | **Adapt** | Current app already has `src/lib/analytics.ts` + Plotly. Analytics logic (grouping, weekly rollups, distraction breakdowns) can port; chart rendering layer needs swap from Chart.js → Plotly. |
| **Heatmap calendar** | `app/lib/calendar-heatmap-runtime.js` | Script chain; `window.TimeFolioCalendarHeatmapRuntime`; `renderCalendar()` called on date change | Luxon · `dashboardRenderLogs()` · `totalsByDayAllowedResources()` · CSS custom props for color | `Record<YYYY-MM-DD, hours>` computed from `logs[]` | **Adapt** | Current app has `src/components/consistency-heatmap.tsx` (React, different heat model). TimeFolio version is richer (month nav, click-to-drilldown, color mixing). Extract pure data logic; rewrite DOM layer as React. |
| **Settings → Tracker tab** | `app/lib/settings-modal-runtime.js` · `app/lib/tracking-settings-runtime.js` · `app/lib/pro-panel-runtime.js` | Script chain; `window.TimeFolioSettingsModalRuntime`, `window.TimeFolioTrackingSettingsRuntime` | `app/lib/billing-runtime.js` (plan check) · `localStorage` for custom app/website rules | `customAutoApps[]`, `customAutoWebsites[]`, `customDistractionApps[]`, `customDistractionWebsites[]` stored in cloud snapshot | **Adapt** | Rule CRUD logic is extractable. UI is DOM; rewrite as React. Current app has `src/features/settings-view.tsx` — add Tracker section there. |
| **Auth (sign-up / login)** | `app/lib/auth-ui-runtime.js` · `app/lib/auth-verification-runtime.js` · `app/lib/auth-account-security-runtime.js` · `app/lib/account-system.ts` (runtime: `account-system-runtime.js`) | Script chain; `window.TimeFolioAuth*` globals | Custom email/password + verification code flow · `functions/app/api/sync/[[path]].js` (Cloudflare proxy) | `AccountRecord: {id, email, username, salt, passwordHash, emailVerified, syncId, ...}` stored in localStorage `accounts[]` | **Rewrite** | No OAuth/Supabase/Firebase — fully custom. Moving to Tauri means account state could be Rust-native or kept in a web-view layer. Decision required. |
| **Plan & billing** | `app/lib/billing-runtime.js` · `functions/app/api/billing/[[path]].js` | Script chain; billing proxy hit on plan check; Cloudflare Worker proxies to `timefolio-payments.paulfreedman3.workers.dev` (Stripe) | Stripe (via Worker) · `PRO_SUBSCRIPTION`, `THEME_UNLOCKS`, `BILLING_CUSTOMER_ID` in cloud snapshot | Subscription status + theme unlock list in cloud snapshot | **Rewrite** | Cloudflare-hosted payment proxy. Tauri app needs different billing surface (app-store, web checkout, or keep same Worker proxy via `invoke("open_url")`). |

---

## 3. Legacy / Ignore List

| Path | Reason to ignore |
|------|-----------------|
| `docs/migration/` | Planning docs generated by agent sessions; not runtime |
| `agent_context_archive/` | Chat context dumps; not code |
| `Prompt results for each phase in timefolio_migration_execution_plan/` | Agent execution logs |
| `TIMEFOLIO_MASTERPLAN_FINAL.md`, `TIMEFOLIO_MIGRATION_EXECUTION_PLAN.md`, `TIMEFOLIO_MIGRATION_MASTERPLAN.md` | Stale planning docs |
| `plans/` (entire directory) | Spec/planning markdown; not runtime |
| `apps/web/` | Next.js read-only marketing layer; `TrackerProvider` uses mock data only (`tracker-bridge.ts` explicitly notes mock); not a source of feature logic |
| `app/chunks/` | Vite build artifacts |
| `app/vendor/` | Vendored third-party libs (Chart.js, Luxon, Sortable, particles.js, confetti) |
| `app/downloads/` | Pre-built installer binaries and scripts for distribution |
| `app/auto-tracker.swift` (root) | Stub launcher script, not the real Swift source (real source: `autotracker/macos/`) |
| `auto-tracker.swift` (repo root) | Same stub |
| `auto-tracker-setup.sh` | Shell installer, not source logic |
| `src/app-entry-script-chain.json` → `app/app-entry.js` | Build artifact (compiled from `src/app-entry.ts`); read `src/` TS files instead |
| `README.md`, `brand-kit.txt`, `privacy.html`, `refund.html`, `security.html`, `sitemap.xml`, `plans.html` | Marketing/legal pages, not feature code |
| `.agents/`, `.claude/` | Claude agent skill files; not app code |
| `ci/` | CI scripts only |

---

## 4. Open Questions (Human Decision Required)

1. **Auth model in Tauri:** TimeFolio uses a custom email/password account system backed by a Cloudflare Worker + KV. The current app has no auth at all. Target decision: (a) embed same Cloudflare-backed auth in a web-view, (b) move to a Tauri-native account (OS Keychain), (c) keep local-only with optional cloud backup. This drives the entire sync and billing architecture.

2. **Native tracker binary strategy:** The auto-tracker is a separate Swift (macOS) / C# (Windows) binary that pairs over loopback HTTP. Options: (a) reuse the same existing binaries (just update pairing to talk to Tauri instead of a browser), (b) rewrite tracking natively in Rust inside Tauri, (c) embed the browser-extension tracker model. Affects scope of the native work dramatically.

3. **Cloud sync vs. local-only:** TimeFolio stores all logs in a cloud snapshot (Cloudflare KV, sync Worker). Current app is Tauri-native local-first. Does the migrated app need cloud sync, and if so, which backend hosts it?

4. **Chart library:** TimeFolio analytics uses Chart.js; current app uses Plotly (`react-plotly.js`). Keep both, unify on one, or replace both? Affects all analytics/heatmap work.

5. **Billing surface in desktop app:** Stripe checkout is today hosted on the web. App Store billing, direct Stripe web-checkout in a `tauri::webview::Window`, or in-app purchase? Legal and pricing implications differ per platform.

6. **`apps/web` (Next.js portfolio) scope:** Is the Next.js marketing/portfolio layer in scope for migration at all, or is it maintained separately?
