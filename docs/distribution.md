# Distribution Guide

TimeFolio Study Tracker is free and open source. It is also local-first: your data stays on the Mac unless you choose to move it.

## Current macOS Status

The current macOS app bundle is unsigned and not notarized for now.

That means macOS may warn before opening the app, especially on first launch or after downloading a fresh release artifact. The warning is expected and comes from Gatekeeper because the app has not gone through Apple notarization yet.

## Safe Install And Open On macOS

1. Download the release artifact from GitHub Releases.
2. If macOS blocks the first open, right-click the app and choose Open.
3. Confirm the prompt once to allow the app to launch.
4. If quarantine still blocks the app, you can remove the quarantine attribute manually:

```bash
xattr -dr com.apple.quarantine "/Applications/TimeFolio Study Tracker.app"
```

## Verify A Release Or Update

For release and update verification, check the updater manifest and signature files published with the release:

- `https://github.com/PaulElon/Step2Tracker/releases/latest/download/latest.json`
- the updater-signed `.app.tar.gz.sig`
- checksum files, if they are added later

If the release includes a checksum file later, verify it before installing or distributing the app bundle.

## Build From Source

Clone the repository, install dependencies, and run the app locally:

```bash
git clone https://github.com/PaulElon/Step2Tracker.git
cd Step2Tracker
npm install
npm run tauri:dev
```

To build a local release artifact:

```bash
VITE_FF_TIMEFOLIO=true npm run tauri:build
```

## Current Product Notes

- Auto-Tracker ingestion is intentionally paused for now.
- The status card and reconciler are scaffolded, but ingestion is not expected yet.
- Some technical identifiers still use legacy Step 2 naming for compatibility, including the repository URL, updater environment variables, and signing key path.
