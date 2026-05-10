import { readFileSync, readdirSync, statSync } from "node:fs";
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

const root = process.cwd();
const pkgPath = resolve(root, "package.json");
const tauriPath = resolve(root, "src-tauri/tauri.conf.json");
const cargoPath = resolve(root, "src-tauri/Cargo.toml");
const bundleDir = resolve(root, "src-tauri/target/release/bundle/macos");

const packageJson = readJson(pkgPath);
const tauriConfig = readJson(tauriPath);
const cargoVersion = readTomlVersion(cargoPath);
const sourceVersion = packageJson.version;
const tauriVersion = tauriConfig.version;

if (!sourceVersion || !tauriVersion) {
  throw new Error("Missing version in package.json or tauri.conf.json.");
}

const mismatches = [];
if (tauriVersion !== sourceVersion) {
  mismatches.push(`package.json version (${sourceVersion}) does not match tauri.conf.json version (${tauriVersion})`);
}
if (cargoVersion !== sourceVersion) {
  mismatches.push(`package.json version (${sourceVersion}) does not match Cargo.toml version (${cargoVersion})`);
}

if (mismatches.length > 0) {
  console.error("Source versions are inconsistent:");
  for (const mismatch of mismatches) {
    console.error(`- ${mismatch}`);
  }
  process.exit(1);
}

if (!statSync(bundleDir, { throwIfNoEntry: false })) {
  throw new Error(`Bundle output directory not found: ${bundleDir}`);
}

const bundleApps = readdirSync(bundleDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
  .map((entry) => join(bundleDir, entry.name));

if (bundleApps.length === 0) {
  throw new Error(`No .app bundles were found in ${bundleDir}`);
}

const bundleSummaries = [];
for (const appPath of bundleApps) {
  const plistPath = join(appPath, "Contents", "Info.plist");
  const { shortVersion, bundleVersion } = readPlistVersion(plistPath);
  bundleSummaries.push({ appPath, shortVersion, bundleVersion });

  if (shortVersion !== sourceVersion || bundleVersion !== sourceVersion) {
    console.error(`Version mismatch in ${plistPath}`);
    console.error(`- source version: ${sourceVersion}`);
    console.error(`- CFBundleShortVersionString: ${shortVersion}`);
    console.error(`- CFBundleVersion: ${bundleVersion}`);
    process.exit(1);
  }
}

console.log(
  JSON.stringify(
    {
      sourceVersion,
      cargoVersion,
      tauriVersion,
      bundles: bundleSummaries,
    },
    null,
    2,
  ),
);
