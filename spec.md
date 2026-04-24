# Step 2 Command Center Spec

## Visual thesis
- A dark, clinical command surface with cold cyan telemetry, restrained magenta accents, glass depth, and high-density information that still reads cleanly at a glance.

## Content plan
- Dashboard: flagship command center for daily task load, progress, upcoming focus, and performance.
- Study Planner: app-first daily task board with search, reordering, CRUD, checkbox completion, and Excel migration.
- Practice Tests: direct logging workflow with reflections and action plans.
- Analytics: consistency, category volume, completion mix, and score trends driven by app data.

## Interaction thesis
- Slide-over editors for fast add/edit without leaving context.
- Dense but smooth planner interactions with deferred search and instant local persistence.
- Charts load lazily so the app shell stays responsive while visuals stream in.

## Architecture
- Single-page React + TypeScript + Vite app with Tailwind CSS and a small set of shared UI primitives.
- Local-first state lives in a reducer-backed context provider with schema-versioned `localStorage` persistence.
- Legacy Excel files are only used for bootstrap/import; normalized app state is the long-term source of truth.
- Derived analytics stay in pure utility functions so dashboard, planner, and analytics views share the same computations.

## Data model
- `StudyBlock`
  - `id`, `date`, `day`, `durationHours`, `durationMinutes`, `category`, `task`, `completed`, `order`, `createdAt`, `updatedAt`
- `PracticeTest`
  - `id`, `date`, `source`, `form`, `questionCount`, `scorePercent`, `weakTopics[]`, `strongTopics[]`, `reflections`, `actionPlan`, `minutesSpent`, `createdAt`, `updatedAt`
- `Preferences`
  - `activeSection`, planner filters, planner sort, `dailyGoalMinutes`
- `AppState`
  - `version`, `studyBlocks`, `practiceTests`, `preferences`

## Component structure
- `AppShell`
  - sidebar navigation, top header, and section switching
- `DashboardView`
  - KPI rail, study trend, category mix, upcoming queue, mini calendar, weekly pulse, practice summary
- `PlannerView`
  - toolbar, compact date rail, daily task list, reorder controls, slide-over editor, import dialog
- `PracticeTestsView`
  - metrics, score trend, topic signals, history table, slide-over editor
- `AnalyticsView`
  - category volume, status breakdown, study trend, consistency heatmap, test analytics
- Shared UI
  - glass panels, metric cards, pills/chips, chart wrapper, modal/sheet, empty states

## State management
- `useReducer` + context for explicit mutations and predictable persistence.
- Lazy initial load hydrates from `localStorage`, falling back to a blank daily planner.
- Persistence writes after every mutation through a versioned serializer.
- Import actions support `merge` and `replace`, keyed by normalized task identity (`date + startTime + category + task`) so legacy workbook rows can still map cleanly.

## Import rules
- Accept `.xlsx` / `.xls`.
- Detect the best sheet by header aliases, not exact workbook structure.
- Normalize Excel serial dates, string dates, and time fractions.
- Fill missing `day` from `date`; derive task duration from legacy time windows when present; preserve optional notes when present.
