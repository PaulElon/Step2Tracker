# Auto-Tracker V2 Entitlement And Sync Contract

Generated 2026-04-29.

## Purpose

This document defines the later paid entitlement, active-device lease, admin override, and optional sync contract for Auto-Tracker V2.

It is docs-only. It does not implement auth, billing, backend calls, cloud sync, span import, polling, native sidecar spawning, pairing, rule push, or UI changes.

## Product Model

The free local app remains available. Auto-Tracker is intended to become a paid feature later.

Paid Auto-Tracker should be purchased once per account. The account owns the entitlement; individual devices do not own permanent standalone licenses.

Each paid account may register at most two Auto-Tracker computers. Only one registered computer may actively run Auto-Tracker at a time.

Paul/admin has god-mode/full access.

## Server-Owned Entitlement

The backend owns entitlement decisions. The client app must never be trusted for entitlement, billing, registered-device count, active-device status, admin override state, or paid unlock validity.

Required server-side checks later:

- Account has active Auto-Tracker entitlement or valid admin-granted access.
- Account has no more than two registered Auto-Tracker computers.
- Account has no more than one active Auto-Tracker device lease.
- Active lease is current according to server-side heartbeat rules.
- Device takeover is explicitly requested and server-authorized.

Local tracking correctness must not depend on cloud/auth after a device is activated for a valid lease. Cloud/license/sync exists for entitlement, active-device lease, live timer mirror, and optional sync later.

## Registered Devices

Later backend model:

- Account owns entitlement.
- Account may register max two Auto-Tracker computers.
- Registered computer records are server-side.
- Client-provided computer names are display labels only and are not trusted identifiers.
- Server issues or validates device identity material according to a future security design.

The two-device cap is an account policy, not a local preference.

## Active Device Lease

Only one registered computer may actively run Auto-Tracker at a time.

Later backend model:

- Starting Auto-Tracker requests an active-device lease.
- Lease ownership is server-side.
- Active device sends a lease heartbeat.
- The backend expires stale leases according to a future duration.
- A second registered computer cannot silently run Auto-Tracker while another lease is active.

Expected takeover UX:

"Auto-Tracker is active on [Computer A]. Use it on this computer instead?"

If the user confirms, the current computer requests server-side lease takeover. The backend records the lease change and the previous computer must stop Auto-Tracker when it next checks lease state or loses heartbeat authorization.

## Cross-Device Live Timer Mirror

Cross-device live timer display is desired later. The mirror is informational and must not become the authority for session lifecycle.

Allowed minimal live mirror fields:

- Account id or server-side subject reference.
- Active device id and safe display name.
- Safe label or category.
- Elapsed focused duration.
- Paused/running status.
- Last heartbeat timestamp.

Raw URLs, raw window titles, document titles, and detailed foreground history do not sync by default.

## Optional Finalized-Session Sync

Finalized local sessions may sync later if explicitly designed. Sync is optional and separate from local tracking correctness.

Privacy defaults:

- Raw URLs do not sync by default.
- Raw window titles do not sync by default.
- Raw foreground event streams do not sync by default.
- Sync should prefer finalized session summaries, categories, elapsed time, device metadata, and user-approved labels.

Backend span ingestion is not part of the current contract. Any future sync plan must define schema, consent, retention, encryption, conflict handling, deletion, and account export behavior before implementation.

## Offline Behavior

There is no indefinite offline paid unlock.

Limited offline grace may be allowed later only if explicitly designed. That design must define:

- Maximum grace duration.
- What local proof is cached.
- How cached proof expires.
- How the client behaves when grace expires.
- How device lease conflicts are resolved after reconnect.

The free local app remains usable without Auto-Tracker paid features.

## Admin And God-Mode

Paul/admin gets full access.

Admin can grant or revoke free Auto-Tracker access for specific accounts server-side. Admin overrides are server-side records and must not rely on client-local flags.

Admin override audit log entries must include:

- Admin actor.
- Target user/account.
- Action.
- Timestamp.
- Reason.

Audit logs should also record revocations, lease resets, device removals, entitlement grants, entitlement denials, and any manual correction that affects paid access.

## Security Rules

Required rules:

- Never trust client entitlement claims.
- Backend owns entitlement and device lease state.
- Backend/license logic must be closed-source/server-side.
- Client app must not contain durable paid-unlock logic that can be treated as authoritative.
- No indefinite offline paid unlock.
- Limited offline grace is allowed only after an explicit future design.
- Admin override actions are auditable.
- Active-device lease decisions are server-authorized.
- Local session correctness does not depend on cloud once a valid activated run is underway.

## Non-Goals For Current Work

Do not implement:

- Auth/session bootstrap.
- Billing checkout.
- Entitlement API calls.
- Device registration.
- Device lease heartbeat.
- Device takeover.
- Cross-device live timer mirror.
- Cloud sync.
- Backend span ingestion.
- Native sidecar spawning.
- Polling.
- Rule push.
- UI changes.
