# Auto-Tracker V2 Architecture Contract

Generated 2026-04-29.

## Executive Decision

Auto-Tracker V2 uses architecture D: hybrid local-first tracking with optional cloud sync later.

The local desktop tracker is the source of truth for foreground detection, session lifecycle, open session persistence, pause/resume semantics, and finalized local study sessions. Cloud services are not part of the first runtime contract. When added later, cloud services exist for paid entitlement, an active-device lease, a cross-device live status mirror, and optional finalized-session sync.

This document is docs-only. It does not authorize runtime implementation, backend ingestion, polling, billing, auth bootstrap, pairing actions, sidecar spawning, rule push, or UI changes.

## Current Safe Checkpoint

- The Auto-Tracker Status card is read-only.
- The native-span reconciler scaffold exists.
- "Import latest auto-tracker spans" is a placeholder/no-op.
- There is no backend or cloud span import.
- There is no polling.
- There is no auth/session bootstrap.
- There are no pairing actions.
- There is no rule push.
- Funding and donation work remains paused.

## Retired V1 Assumptions

Browser-timer-as-authority is retired. A browser timer, page timer, React timer, or cloud timer must never decide whether a native Auto-Tracker session exists, continues, pauses, or finalizes.

Missing-event timeout as session-ending authority is retired. A missing native heartbeat, missing poll response, delayed event batch, transport gap, or stale UI refresh must not finalize a session by itself. Finalization requires state-machine evidence that the user left the tracked target for the configured away grace, or an explicit stop/shutdown path that persists recoverable state.

Backend span ingestion is not part of V2 yet. No endpoint, worker, cloud snapshot, billing service, account service, or sync service should receive authoritative raw activity spans until a later contract explicitly designs that flow.

The older TimeFolio integration plan's Auto-Tracker Phase 6 and port 52340 sidecar direction is stale for V2. Do not revive port 52340, the old browser-timer/cloud-span model, or the old pairing-first bridge unless later live repo evidence proves a current product reason.

## Runtime Ownership

The V2 ownership model is:

1. Native layer emits normalized activity events.
2. Local state machine owns session lifecycle.
3. Durable local persistence owns active, open, paused, and finalized session records.
4. UI reads local state and may request explicit user actions, but does not infer session truth.
5. Cloud remains optional later for entitlement, active-device lease, live status mirror, and sync.

Local tracker/session state is the source of truth. A tracked-target session continues indefinitely while the target remains active, including beyond 10 minutes and beyond any display timer boundary.

## Native Event Contract

The native layer must normalize platform-specific signals into a shared schema before they reach the state machine. macOS and Windows emit the same normalized event shape even though their platform APIs differ.

Normalized event categories:

- Foreground app/window changed.
- Tracked target focused.
- Untracked app/window focused.
- User idle.
- User active.
- Window metadata changed.
- Browser tab or URL metadata changed when available and locally permitted.
- Heartbeat or tick.
- App shutdown.
- Manual stop.

The native layer observes foreground, away, idle, window, and browser events. It does not own business entitlement, account state, cloud sync, billing, or final session lifecycle decisions.

## Local State Machine Contract

The local state machine decides whether a session is focused, away-pending, paused within an open session, or finalized. It must preserve the following invariant:

A continuous tracked-target session continues indefinitely while the target remains active. Save/reset happens only after the user leaves the tracked target for at least 60 seconds, or after an explicit stop path.

If the user leaves a tracked target for less than 60 seconds and returns, the state machine treats the interval as pause/resume inside the same session. It must not split the session into separate finalized records.

## Local Persistence Contract

Durable local persistence owns:

- Open active session state.
- Away-pending state, including previous target and left-at timestamp.
- Pause/resume intervals inside the same session.
- Finalized session records.
- Crash or app-shutdown recovery data.

App shutdown must persist recoverable open state instead of converting uncertainty into a finalized session. On next launch, the app can recover, reconcile, or ask for user confirmation according to a future implementation plan.

## Cloud Boundary

Cloud is later optional and must not be required for local tracking correctness once Auto-Tracker is activated on a device.

Allowed later cloud responsibilities:

- Server-side Auto-Tracker entitlement.
- Active-device lease and heartbeat.
- Minimal cross-device live timer mirror.
- Optional finalized-session sync.
- Server-side admin override records.

Cloud is not currently responsible for raw local activity ingestion, local session finalization, foreground detection, pause/resume decisions, or rule execution.

## Privacy Contract

Raw app names, window titles, document titles, URLs, and browser tab details stay local by default. Future sync must be opt-in or explicitly designed, and should prefer minimized labels, categories, elapsed time, and device metadata over raw titles or URLs.

Live timer mirror payloads should use minimal data such as category, safe display label, elapsed duration, active device name, and coarse status. Raw URLs and window titles do not sync by default.

## Cross-Platform Parity

macOS and Windows must feed the same local state machine with the same normalized event schema. Platform-specific adapters may differ internally, but reducer behavior, away grace, finalization rules, persistence semantics, entitlement boundaries, and privacy defaults must remain consistent.
