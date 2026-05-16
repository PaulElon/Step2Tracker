import { rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const bundleDirs = [
  resolve("src-tauri/target/release/bundle/macos"),
  resolve("src-tauri/target/aarch64-apple-darwin/release/bundle/macos"),
  resolve("src-tauri/target/x86_64-apple-darwin/release/bundle/macos"),
];

for (const bundleDir of bundleDirs) {
  if (existsSync(bundleDir)) {
    rmSync(bundleDir, { recursive: true, force: true });
    console.log(`Removed stale bundle output: ${bundleDir}`);
  } else {
    console.log(`No existing bundle output to remove: ${bundleDir}`);
  }
}
