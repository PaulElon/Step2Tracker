import { spawnSync } from "node:child_process";

const releaseEnv = {
  ...process.env,
  VITE_FF_TIMEFOLIO: "true",
  VITE_FF_AUTOTRACKER_V2_USER_MODE: "true",
};

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: releaseEnv,
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npm", ["run", "verify:release-env"]);
run("npm", ["run", "build"]);
