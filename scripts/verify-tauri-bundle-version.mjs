import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readTomlVersion(filePath) {
  const contents = readFileSync(filePath, "utf8");
  const match = contents.match(/^version = "([^"]+)"$/m);
  if (!match) {
    throw new Error(`Unable to find version in ${filePath}`);
  }
  return match[1];
}

function readPlistVersion(filePath) {
  const contents = readFileSync(filePath, "utf8");
  const shortMatch = contents.match(
    /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/m,
  );
  const bundleMatch = contents.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/m);

  if (!shortMatch || !bundleMatch) {
    throw new Error(`Unable to read version fields from ${filePath}`);
  }

  return {
    shortVersion: shortMatch[1],
    bundleVersion: bundleMatch[1],
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  let target;
  let bundleDir;
  let expectedVersion;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target" || arg === "-t") {
      target = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--bundle-dir") {
      bundleDir = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expected-version") {
      expectedVersion = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/verify-tauri-bundle-version.mjs [--target <triple>] [--bundle-dir <path>] [--expected-version <version>]",
      );
      process.exit(0);
    }
  }

  return {
    target: target?.trim(),
    bundleDir: bundleDir?.trim(),
    expectedVersion: expectedVersion?.trim(),
  };
}

function uniquePaths(paths) {
  return Array.from(new Set(paths.map((candidate) => resolve(candidate))));
}

function resolveBundleDirs(root, bundleDirArg, target) {
  if (bundleDirArg) {
    return uniquePaths([resolve(root, bundleDirArg)]);
  }

  const candidates = [];
  if (target) {
    candidates.push(resolve(root, "src-tauri", "target", target, "release", "bundle", "macos"));
  }
  candidates.push(resolve(root, "src-tauri", "target", "aarch64-apple-darwin", "release", "bundle", "macos"));
  candidates.push(resolve(root, "src-tauri", "target", "release", "bundle", "macos"));
  return uniquePaths(candidates);
}

function findCanonicalBundleCandidates(bundleDirs, canonicalBundleName) {
  const candidates = [];
  const inspected = [];

  for (const dir of bundleDirs) {
    if (!existsSync(dir)) {
      inspected.push({ bundleDir: dir, exists: false, bundles: [] });
      continue;
    }

    const bundleApps = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
      .map((entry) => entry.name);

    inspected.push({ bundleDir: dir, exists: true, bundles: bundleApps });

    if (!bundleApps.includes(canonicalBundleName)) {
      continue;
    }

    const appPath = join(dir, canonicalBundleName);
    const plistPath = join(appPath, "Contents", "Info.plist");
    const plistStat = statSync(plistPath, { throwIfNoEntry: false });
    if (!plistStat) {
      throw new Error(`Canonical bundle exists but Info.plist is missing: ${plistPath}`);
    }

    candidates.push({
      bundleDir: dir,
      appPath,
      plistPath,
      bundleApps,
      plistMtimeMs: plistStat.mtimeMs,
    });
  }

  return { candidates, inspected };
}

const root = process.cwd();
const { target: targetArg, bundleDir: bundleDirArg, expectedVersion: expectedVersionArg } = parseArgs();
const target = targetArg || process.env.TAURI_TARGET?.trim();
const pkgPath = resolve(root, "package.json");
const tauriPath = resolve(root, "src-tauri/tauri.conf.json");
const cargoPath = resolve(root, "src-tauri/Cargo.toml");
const bundleDirs = resolveBundleDirs(root, bundleDirArg || process.env.TAURI_BUNDLE_MACOS_DIR?.trim(), target);

const packageJson = readJson(pkgPath);
const tauriConfig = readJson(tauriPath);
const cargoVersion = readTomlVersion(cargoPath);
const canonicalBundleName = `${tauriConfig.productName}.app`;
const sourceVersion = packageJson.version;
const expectedVersion = expectedVersionArg || process.env.APP_VERSION?.trim() || sourceVersion;
const tauriVersion = tauriConfig.version;

if (!sourceVersion || !tauriVersion || !expectedVersion) {
  throw new Error("Missing version in package.json or tauri.conf.json.");
}

const mismatches = [];
if (tauriVersion !== sourceVersion) {
  mismatches.push(`package.json version (${sourceVersion}) does not match tauri.conf.json version (${tauriVersion})`);
}
if (cargoVersion !== sourceVersion) {
  mismatches.push(`package.json version (${sourceVersion}) does not match Cargo.toml version (${cargoVersion})`);
}
if (sourceVersion !== expectedVersion) {
  mismatches.push(`package.json version (${sourceVersion}) does not match expected version (${expectedVersion})`);
}

if (mismatches.length > 0) {
  console.error("Source versions are inconsistent:");
  for (const mismatch of mismatches) {
    console.error(`- ${mismatch}`);
  }
  process.exit(1);
}

const { candidates, inspected } = findCanonicalBundleCandidates(bundleDirs, canonicalBundleName);
if (candidates.length === 0) {
  const inspectedSummary = inspected
    .map(({ bundleDir, exists, bundles }) => {
      if (!exists) return `- ${bundleDir} (missing)`;
      return `- ${bundleDir} (bundles: ${bundles.length ? bundles.join(", ") : "none"})`;
    })
    .join("\n");
  throw new Error(
    `Canonical bundle not found: ${canonicalBundleName}\nSearched:\n${inspectedSummary}`,
  );
}

const selectedBundle = target || bundleDirArg
  ? candidates[0]
  : [...candidates].sort((left, right) => right.plistMtimeMs - left.plistMtimeMs)[0];
const plistPath = selectedBundle.plistPath;
const { shortVersion, bundleVersion } = readPlistVersion(plistPath);

if (shortVersion !== expectedVersion || bundleVersion !== expectedVersion) {
  console.error(`Version mismatch in ${plistPath}`);
  console.error(`- expected version: ${expectedVersion}`);
  console.error(`- CFBundleShortVersionString: ${shortVersion}`);
  console.error(`- CFBundleVersion: ${bundleVersion}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      target: target || null,
      expectedVersion,
      sourceVersion,
      cargoVersion,
      tauriVersion,
      bundle: {
        appPath: selectedBundle.appPath,
        bundleDir: selectedBundle.bundleDir,
        shortVersion,
        bundleVersion,
      },
      searchedBundleDirs: bundleDirs,
      ignoredBundles: selectedBundle.bundleApps.filter((bundleName) => bundleName !== canonicalBundleName),
      ignoredCanonicalBundlesInOtherDirs: candidates
        .filter((candidate) => candidate.appPath !== selectedBundle.appPath)
        .map((candidate) => candidate.appPath),
    },
    null,
    2,
  ),
);
