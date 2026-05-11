# Post-Release Smoke Checklist

- Confirm the latest GitHub release via `latest.json` and the release list.
- Verify the updater metadata still points at the latest published release.
- Run `npm run smoke:release` from a clean shell to verify the release env is injected internally.
- Run `npm run verify:tauri-bundle-version` after a fresh release bundle build; if it fails, assume a stale local bundle artifact before assuming source version drift.

## Coverage Map

- Auto-Tracker V2: verify the reducer/session tests, preview-span mapping tests, session-control copy tests, and native Rust probe tests remain green.
- Notebook: verify notebook storage, import/export, and highlight tests remain green.
- Session Log: confirm Auto-Tracker V2 preview output still maps to Session Log payloads and the session repository/persistence tests remain green.
- Tracker Settings: confirm the tracker-settings panel and Auto-Tracker V2 user-mode/session-control tests still cover setup and copy paths.
- Dashboard / Planner / Practice / Error Log: run the existing unit coverage if it exists, and manually smoke the visible basics if there is no direct automation.
- Updater / version metadata: verify `verify:release-env`, `verify:tauri-bundle-version`, and the release manifest version all match the current tagged release.

## Manual Smoke

- Confirm the TimeFolio tab is visible.
- Exercise Session Log add, edit, delete, and timer flows.
- Exercise TimeFolio export, import, and reset flows.
- Exercise Study Settings export and import.
- Open the Practice Tests edit modal and delete an item.
- Confirm local Auto-Tracking stores sessions in the Session Log.
- Confirm cloud/backend/auth/span-ingestion/sync is not enabled for this release.
- Verify the repo is clean after the checks.
