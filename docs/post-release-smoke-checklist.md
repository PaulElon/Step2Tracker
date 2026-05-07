# Post-Release Smoke Checklist

- Confirm the latest GitHub release via `latest.json`.
- Verify the updater installs the latest version.
- Confirm the TimeFolio tab is visible.
- Exercise Session Log add, edit, delete, and timer flows.
- Exercise TimeFolio export, import, and reset flows.
- Exercise Study Settings export and import.
- Open the Practice Tests edit modal and delete an item.
- Confirm local Auto-Tracking stores sessions in the Session Log.
- Confirm cloud/backend/auth/span-ingestion/sync is not enabled for this release.
- Verify the repo is clean after the checks.
