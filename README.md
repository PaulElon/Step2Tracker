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

Run npm install.

### 2. Run the web app in development

Run npm run dev.

### 3. Run the desktop app in development

Run npm run tauri:dev.

### 4. Build the macOS desktop app

Run npm run tauri:build.

The signed app bundle is produced under src-tauri/target/release/bundle/macos/.

## Required Environment

- macOS for the desktop app features
- Node.js 20+ and npm
- Rust toolchain for Tauri builds
- Xcode command line tools on macOS

If Tauri is missing system dependencies, install the usual macOS build tools first:

xcode-select --install

## Where Data Lives

The app is local-first. All state is stored on the Mac in the app data directory for the bundle identifier:

~/Library/Application Support/com.paul.step2ckcommandcenter/

The SQLite database used by the app lives under that folder. Deleting the app bundle does not delete data; deleting the app data folder does.

## Notifications

Desktop reminders use the native macOS notification plugin.

- The first reminder action may prompt for notification permission.
- If permission is blocked, the app opens macOS Notification settings.
- To test reminders, set a reminder on a task and wait until it becomes due, or use the test alert button in Settings.

If alerts do not appear:

1. Open System Settings.
2. Go to Notifications.
3. Find Step 2 Command Center.
4. Enable notifications and alert style.

## Updater

Release builds check for signed updates on launch.

Installed builds default to the GitHub Releases feed for this repository:

https://github.com/PaulElon/Step2Tracker/releases/latest/download/latest.json

You can still override that at runtime with either of these environment variables:

- STEP2_UPDATER_ENDPOINT
- STEP2_UPDATER_ENDPOINTS

Build release artifacts locally with the updater signing key:

TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/step2-command-center.key)" npm run tauri:build

The matching public key is embedded in:

- src-tauri/tauri.conf.json
- src-tauri/src/updater.rs

## Automatic Releases From main

The repository includes .github/workflows/release.yml.

Every push to main publishes a signed Apple Silicon macOS release and uploads the latest.json updater manifest that Tauri expects.

Required GitHub repository secrets:

- TAURI_SIGNING_PRIVATE_KEY
- TAURI_SIGNING_PRIVATE_KEY_PASSWORD

Use TAURI_SIGNING_PRIVATE_KEY_PASSWORD only if your updater key is encrypted. An empty value is acceptable if the key has no password.

Important constraints:

- Auto-update only works for installed release builds, not npm run tauri:dev.
- Tauri only installs an update when the published version is newer than the installed version.
- The workflow stamps a unique CI version per main push before building release artifacts.
- The repository or release artifact host must be publicly reachable by the installed app, because the app cannot authenticate to private GitHub release assets.

## Standard Verification

Run these checks before shipping:

- npm run typecheck
- npm run lint
- npm run build
- cargo check --manifest-path src-tauri/Cargo.toml

## Notes

- The app uses native persistence, so browser storage clearing does not reset data.
- Practice test data, reminders, weak topics, planner tasks, settings, and backups are persisted together in the local database.
- If you need a full reset, remove the app data directory only after backing it up.
- Deleting /Applications/Step 2 Command Center.app removes the app bundle only. It does not remove user data.
