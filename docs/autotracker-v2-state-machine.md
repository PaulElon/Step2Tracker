# Auto-Tracker V2 State Machine Contract

Generated 2026-04-29.

## Purpose

This document defines the local-first session lifecycle contract for Auto-Tracker V2. It is docs-only and does not implement runtime reducer code.

The state machine prevents the old Auto-Tracker bug where a session could stop, save, and reset at exactly 10 minutes while the user was still continuously in the tracked app.

## Definitions

Tracked target means an app, website, bundle, process, window, or browser context that local rules classify as Auto-Tracker eligible.

Untracked focus means foreground activity that is not classified as the current tracked target.

Away grace is 60 seconds. The grace starts when the user leaves the tracked target.

Open session means a session that has not finalized and may contain focused time plus pause/resume intervals.

## States

### Focused(target)

The user is currently focused on a tracked target. The open session continues accumulating focused time for that target.

Invariants:

- The session does not finalize because elapsed time reached 10 minutes.
- The session does not finalize because a UI timer ticked.
- The session does not finalize because a native heartbeat is late or missing.
- A target change to another tracked target is handled by explicit transition rules, not by a fixed duration timeout.

### AwayPending(previousTarget, leftAt)

The user has left the tracked target, but the 60-second away grace has not elapsed.

Invariants:

- The previous session remains open.
- If the user returns to the same target before 60 seconds elapse, the state returns to Focused(previousTarget).
- The away interval is recorded as a pause/resume interval inside the same open session.
- The session finalizes only if the user remains away for at least 60 seconds or an explicit finalizing event occurs.

### PausedWithinSession

The session remains open while the user is temporarily away from the tracked target and the pause is part of the same continuous session.

Invariants:

- Paused time is not counted as focused tracked time unless a later implementation explicitly defines a different metric.
- Returning before the 60-second away grace expires resumes the same session.
- The state must preserve enough information to reconstruct the continuous session, including pause start and resume time.

### Finalized

The session is closed and durable local persistence may expose it as a completed session.

Invariants:

- A finalized session is not mutated by later foreground events except through explicit edit/reconciliation flows.
- Finalization is caused by leaving the tracked target for at least 60 seconds, manual stop, or an implementation-defined shutdown recovery decision.
- Missing native heartbeat alone is not a finalization cause.

## Event Types

### targetFocused

The current foreground context matches a tracked target.

Expected behavior:

- From Focused(target), continue the same session when the target is unchanged.
- From AwayPending(previousTarget, leftAt), return to Focused(previousTarget) if the same target returns before 60 seconds.
- From PausedWithinSession, resume the same open session when the return is within the grace contract.
- From Finalized, begin a new open session only through a future explicit reducer rule.

### targetChanged

The current foreground context moved from one tracked target to another tracked target.

Expected behavior:

- Future implementation must define whether this creates a new session or finalizes the previous one after grace.
- It must not finalize solely because the previous target reached 10 minutes.
- It must preserve local state enough to test the transition as a pure reducer.

### untrackedFocused

The current foreground context is not tracked.

Expected behavior:

- From Focused(target), enter AwayPending(target, leftAt).
- From AwayPending(previousTarget, leftAt), remain away-pending until the grace expires.
- From PausedWithinSession, continue the pause.

### userIdle

The platform reports the user as idle.

Expected behavior:

- Idle may enter or extend away-pending/pause semantics.
- Idle alone does not finalize until the state machine observes at least 60 seconds away from the tracked target.
- Idle does not override the tracked target if the foreground target remains active and the future implementation defines idle as a pause rather than a target exit.

### userActive

The platform reports the user as active again.

Expected behavior:

- If the tracked target is still focused or immediately refocused within the away grace, resume the same session.
- If the user returns after the grace elapsed and the previous session finalized, a later targetFocused event may start a new session.

### tick

A local monotonic time event used to evaluate grace windows and elapsed display time.

Expected behavior:

- Tick can finalize AwayPending only after now - leftAt is at least 60 seconds.
- Tick must never finalize Focused(target) because focused elapsed time reached 10 minutes, 600000 ms, or any other display interval.
- Tick must not substitute for missing foreground evidence.

### appShutdown

The app is closing or the process is exiting.

Expected behavior:

- Persist recoverable open state.
- Do not convert an uncertain open session into a finalized session solely because the app is shutting down.
- Future startup recovery may reconcile open state, prompt the user, or apply explicit shutdown rules.

### manualStop

The user explicitly stops the active Auto-Tracker session.

Expected behavior:

- Finalize or discard according to a future explicit product rule.
- Manual stop is distinct from timeout-driven save/reset behavior.
- Manual stop must be auditable locally and must not be confused with the 10-minute bug.

## Away Grace Contract

The away grace is exactly 60 seconds for V2 unless a future contract changes it.

Required behavior:

- Leave tracked target for less than 60 seconds, then return: same session with pause/resume semantics.
- Leave tracked target for 60 seconds or more: finalize the previous session.
- Continue in tracked target for longer than 10 minutes: session remains Focused(target) and open.

Example:

Anki 10m15s -> away 59s -> back to Anki 10m -> leave for at least 60 seconds = one continuous Anki session with an internal pause/resume interval, finalized only after the final away grace elapses.

## 10-Minute Bug Prevention Contract

The old Auto-Tracker behavior could stop, save, and reset at exactly 10 minutes while the user was still continuously in the tracked app. V2 forbids that behavior.

Required rules:

- 10 minutes is not a save boundary.
- 600000 ms is not a finalization boundary.
- Display timer rollover is not a reducer event that can finalize a session.
- Missing-event timeout is not a session-ending authority.
- Continuous tracked focus can continue indefinitely.
- Save/reset happens only after leaving the tracked target for at least 60 seconds, manual stop, or a future explicitly designed shutdown recovery path.

## Acceptance Criteria For Future Pure Reducer Tests

Future reducer tests must cover at least:

- Continuous tracked target for more than 10 minutes never finalizes.
- Anki 10m15s -> away 59s -> Anki 10m -> leave for at least 60 seconds produces one session with pause/resume semantics.
- Away for at least 60 seconds finalizes the previous session.
- App shutdown persists recoverable open state.
- Missing native heartbeat alone does not finalize a session.

The tests should run without native APIs, cloud services, browser preview, polling, auth, billing, or backend span ingestion.
