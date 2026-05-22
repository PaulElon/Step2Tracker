#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const args = process.argv.slice(2);

let requestedVersion = null;
let mustEqualNextTag = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--version") {
    requestedVersion = args[i + 1];
    i++;
  } else if (arg === "--must-equal-next-tag") {
    mustEqualNextTag = true;
  }
}

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

function readCargoLockVersion(filePath) {
  const contents = readFileSync(filePath, "utf8");
  const lines = contents.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '[[package]]' && lines[i + 1]?.includes('name = "step2_ck_command_center"')) {
      const match = lines[i + 2]?.match(/^version = "([^"]+)"$/);
      if (match) return match[1];
    }
  }
  throw new Error(`Unable to find version for step2_ck_command_center in ${filePath}`);
}

function getLatestAppTagVersion() {
  const result = spawnSync("git", ["tag", "-l", "app-v*"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Failed to read git tags");

  const tags = result.stdout
    .trim()
    .split("\n")
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/^app-v/, ""))
    .sort((a, b) => {
      const aParts = a.split(".").map((p) => parseInt(p, 10));
      const bParts = b.split(".").map((p) => parseInt(p, 10));
      for (let i = 0; i < 3; i++) {
        const aVal = aParts[i] || 0;
        const bVal = bParts[i] || 0;
        if (aVal !== bVal) return aVal - bVal;
      }
      return 0;
    });

  return tags.length > 0 ? tags[tags.length - 1] : null;
}

function parseVersion(versionString) {
  const parts = versionString.split(".").map((p) => parseInt(p, 10));
  return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
}

function compareVersions(v1, v2) {
  const a = parseVersion(v1);
  const b = parseVersion(v2);
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

const pkgPath = resolve(root, "package.json");
const lockPath = resolve(root, "package-lock.json");
const tauriPath = resolve(root, "src-tauri/tauri.conf.json");
const cargoTomlPath = resolve(root, "src-tauri/Cargo.toml");
const cargoLockPath = resolve(root, "src-tauri/Cargo.lock");

const pkg = readJson(pkgPath);
const lock = readJson(lockPath);
const tauri = readJson(tauriPath);
const cargoTomlVersion = readTomlVersion(cargoTomlPath);
const cargoLockVersion = readCargoLockVersion(cargoLockPath);

const packageJsonVersion = pkg.version;
const packageLockVersion = lock.version;
const packageLockRootVersion = lock.packages?.[""]?.version;
const tauriVersion = tauri.version;

const currentVersion = requestedVersion || packageJsonVersion;
const errors = [];

if (!packageJsonVersion) {
  errors.push("package.json missing version field");
}

if (!packageLockVersion) {
  errors.push("package-lock.json missing version field");
}

if (!packageLockRootVersion) {
  errors.push('package-lock.json missing packages[""].version field');
}

if (!tauriVersion) {
  errors.push("src-tauri/tauri.conf.json missing version field");
}

if (!cargoTomlVersion) {
  errors.push("src-tauri/Cargo.toml missing version field");
}

if (!cargoLockVersion) {
  errors.push("src-tauri/Cargo.lock missing version field");
}

if (errors.length > 0) {
  console.error("❌ Error: Missing version fields:");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

const mismatches = [];

if (packageJsonVersion !== currentVersion) {
  mismatches.push(`package.json (${packageJsonVersion}) ≠ expected (${currentVersion})`);
}

if (packageLockVersion !== currentVersion) {
  mismatches.push(`package-lock.json root (${packageLockVersion}) ≠ expected (${currentVersion})`);
}

if (packageLockRootVersion !== currentVersion) {
  mismatches.push(`package-lock.json packages[""] (${packageLockRootVersion}) ≠ expected (${currentVersion})`);
}

if (tauriVersion !== currentVersion) {
  mismatches.push(`src-tauri/tauri.conf.json (${tauriVersion}) ≠ expected (${currentVersion})`);
}

if (cargoTomlVersion !== currentVersion) {
  mismatches.push(`src-tauri/Cargo.toml (${cargoTomlVersion}) ≠ expected (${currentVersion})`);
}

if (cargoLockVersion !== currentVersion) {
  mismatches.push(`src-tauri/Cargo.lock (${cargoLockVersion}) ≠ expected (${currentVersion})`);
}

if (mismatches.length > 0) {
  console.error("❌ Version mismatch:");
  for (const mismatch of mismatches) {
    console.error(`  - ${mismatch}`);
  }
  console.error(`\n💡 Fix with: npm run release:prepare`);
  process.exit(1);
}

const latestTagVersion = getLatestAppTagVersion();
if (latestTagVersion && compareVersions(currentVersion, latestTagVersion) < 0) {
  console.error(`❌ Error: Current version (${currentVersion}) is less than latest tag (app-v${latestTagVersion})`);
  console.error(`\n💡 Fix with: npm run release:prepare`);
  process.exit(1);
}

if (mustEqualNextTag) {
  if (!latestTagVersion) {
    console.error("❌ Error: No app-v* tags exist; cannot verify next-tag version.");
    process.exit(1);
  }
  const parsed = parseVersion(latestTagVersion);
  const expectedNextVersion = `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  if (currentVersion !== expectedNextVersion) {
    console.error(`❌ Error: Current version (${currentVersion}) does not equal next tag version (${expectedNextVersion})`);
    console.error(`\n💡 Latest tag: app-v${latestTagVersion}`);
    console.error(`   Expected current version: ${expectedNextVersion}`);
    process.exit(1);
  }
}

console.log(`✅ PASS: All version files are consistent at ${currentVersion}`);
if (latestTagVersion) {
  console.log(`   Latest tag: app-v${latestTagVersion}`);
}
