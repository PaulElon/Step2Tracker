import { rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const bundleDir = resolve("src-tauri/target/release/bundle/macos");

if (existsSync(bundleDir)) {
  rmSync(bundleDir, { recursive: true, force: true });
  console.log(`Removed stale bundle output: ${bundleDir}`);
} else {
  console.log(`No existing bundle output to remove: ${bundleDir}`);
}
