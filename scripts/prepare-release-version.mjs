#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const allowDirty = args.includes("--allow-dirty");

function runCommand(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${cmdArgs.join(" ")}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function parseVersion(versionString) {
  const parts = versionString.split(".").map((p) => parseInt(p, 10));
  return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
}

function formatVersion(major, minor, patch) {
  return `${major}.${minor}.${patch}`;
}

function getLatestAppTag() {
  try {
    const output = runCommand("git", ["tag", "-l", "app-v*"]);
    const tags = output
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

    if (tags.length === 0) {
      console.error("❌ Error: No app-v* tags exist in the repository.");
      console.error("   Create the first release tag manually: git tag app-v0.0.1");
      process.exit(1);
    }

    return tags[tags.length - 1];
  } catch (error) {
    console.error("❌ Error: Failed to read git tags.");
    console.error(`   ${error.message}`);
    process.exit(1);
  }
}

function checkWorkingTree() {
  try {
    const status = runCommand("git", ["status", "--short"]);
    if (status.length > 0 && !allowDirty) {
      console.error("❌ Error: Working tree has untracked or modified files.");
      console.error("   Commit or stash changes, or use --allow-dirty to proceed anyway.");
      console.error("\nCurrent status:");
      console.error(status);
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Error: Failed to check working tree status.");
    console.error(`   ${error.message}`);
    process.exit(1);
  }
}

function updatePackageJson(version) {
  const pkgPath = resolve(root, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.version = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function updatePackageLockJson(version) {
  const lockPath = resolve(root, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.version = version;
  if (lock.packages && lock.packages[""] && lock.packages[""].version) {
    lock.packages[""].version = version;
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

function updateTauriConfig(version) {
  const tauriPath = resolve(root, "src-tauri/tauri.conf.json");
  const tauri = JSON.parse(readFileSync(tauriPath, "utf8"));
  tauri.version = version;
  writeFileSync(tauriPath, `${JSON.stringify(tauri, null, 2)}\n`);
}

function updateCargoToml(version) {
  const cargoPath = resolve(root, "src-tauri/Cargo.toml");
  let cargo = readFileSync(cargoPath, "utf8");
  cargo = cargo.replace(/^version = ".*?"$/m, `version = "${version}"`);
  writeFileSync(cargoPath, cargo);
}

function updateCargoLock(version) {
  const lockPath = resolve(root, "src-tauri/Cargo.lock");
  let lock = readFileSync(lockPath, "utf8");
  const lines = lock.split("\n");
  let inPackage = false;
  const updated = lines.map((line, idx) => {
    if (line === '[[package]]') {
      const nextLine = lines[idx + 1] || "";
      if (nextLine.includes('name = "step2_ck_command_center"')) {
        inPackage = true;
      }
    } else if (inPackage && line.startsWith('version = ')) {
      inPackage = false;
      return `version = "${version}"`;
    }
    return line;
  });
  writeFileSync(lockPath, updated.join("\n"));
}

function tagExists(tag) {
  const result = spawnSync("git", ["rev-parse", tag], { stdio: "ignore" });
  return result.status === 0;
}

checkWorkingTree();

const latestVersion = getLatestAppTag();
const parsed = parseVersion(latestVersion);
const nextVersion = formatVersion(parsed.major, parsed.minor, parsed.patch + 1);
const nextTag = `app-v${nextVersion}`;

if (tagExists(nextTag)) {
  console.error(`❌ Error: Tag ${nextTag} already exists.`);
  process.exit(1);
}

console.log(`📝 Preparing release version...\n`);
console.log(`Latest tag: app-v${latestVersion}`);
console.log(`Next version: ${nextVersion}`);

updatePackageJson(nextVersion);
updatePackageLockJson(nextVersion);
updateTauriConfig(nextVersion);
updateCargoToml(nextVersion);
updateCargoLock(nextVersion);

console.log(`\n✅ Updated version files to ${nextVersion}`);
console.log(`\nNext steps:`);
console.log(`1. Review changes: git diff`);
console.log(`2. Commit: git add -A && git commit -m "release ${nextVersion}"`);
console.log(`3. Tag: git tag ${nextTag}`);
console.log(`4. Push: git push origin main && git push origin ${nextTag}`);
