# Step 2 Command Center

Local-first Step 2 study OS for macOS. The app is a React + TypeScript + Vite frontend with a Tauri desktop shell and native SQLite persistence.

## What It Does

- Today dashboard for active work, reminders, and progress
- Practice test logging with score trends, weak/strong topic patterns, and follow-up actions
- Weak topics tracking with status, priority, and remediation history
- Analytics across tasks, tests, and topic trends
- Native desktop notifications for reminders on Mac
- Signed updater support for release builds

## Install And Run

### 1. Install dependencies

```bash
npm install
```

### 2. Run the web app in development

```bash
npm run dev
```

### 3. Run the desktop app in development

```bash
npm run tauri:dev
```

### 4. Build the macOS desktop app

```bash
npm run tauri:build
```

The signed app bundle is produced under `src-tauri/target/release/bundle/macos/`.

## Required Environment

- macOS for the desktop app features
- Node.js 20+ and npm
- Rust toolchain for Tauri builds
- Xcode command line tools on macOS

If Tauri is missing system dependencies, install the usual macOS build tools first:

```bash
xcode-select --install
```

## Where Data Lives

The app is local-first. All state is stored on the Mac in the app data directory for the bundle identifier:

`~/Library/Application Support/com.paul.step2ckcommandcenter/`

The SQLite database used by the app lives under that folder. Deleting the app bundle does not delete data; deleting the app data folder does.

## Notifications

Desktop reminders use the native macOS notification plugin.

- The first reminder action may prompt for notification permission.
- If permission is blocked, the app opens macOS Notification settings.
- To test reminders, set a reminder on a task and wait until it becomes due, or use the test alert button in Settings.

If alerts do not appear:

1. Open System Settings
2. Go to Notifications
3. Find `Step 2 Command Center`
4. Enable notifications and alert style

## Updater

Release builds can check for signed updates on launch.

Installed builds now default to the GitHub Releases feed for this repository:

- `https://github.com/PaulElon/Step2Tracker/releases/latest/download/latest.json`

You can still override that at runtime with either of these environment variables:

- `STEP2_UPDATER_ENDPOINT`
- `STEP2_UPDATER_ENDPOINTS`

Build release artifacts with the updater signing key:

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/step2-command-center.key)" npm run tauri:build
```

The matching public key is embedded in `src-tauri/tauri.conf.json`.

### Automatic Releases From `main`

The repository includes [`.github/workflows/release.yml`](/.github/workflows/release.yml), which publishes signed macOS release artifacts on every push to `main` and uploads the `latest.json` updater manifest that Tauri expects.

Required GitHub repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if your updater key is encrypted

Important constraints:

- Auto-update only works for installed release builds, not `npm run tauri:dev`.
- Tauri only installs an update when the published version is newer than the installed version.
- The workflow solves that by stamping a unique CI version per `main` push before building the release artifacts.

## Verification

Run the standard checks before shipping:

```bash
npm run typecheck
npm run lint
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Notes

- The app uses native persistence, so browser storage clearing does not reset data.
- Practice test data, reminders, weak topics, and settings are all persisted together in the local database.
- If you need a full reset, remove the app data directory after backing it up.
