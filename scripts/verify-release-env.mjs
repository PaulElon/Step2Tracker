const requiredTrueFlags = [
  "VITE_FF_TIMEFOLIO",
  "VITE_FF_AUTOTRACKER_V2_USER_MODE",
];

const devOnlyFlags = [
  "VITE_FF_AUTOTRACKER_V2_NATIVE_INSPECTOR",
  "VITE_FF_AUTOTRACKER_V2_MANUAL_WRITE",
  "VITE_FF_AUTOTRACKER_V2_CONTINUOUS_WRITE",
  "VITE_FF_AUTOTRACKER_V2_NATIVE_SAMPLER",
];

const report = Object.fromEntries(
  [...requiredTrueFlags, ...devOnlyFlags].map((key) => [key, process.env[key] ?? null]),
);

const failures = [];

for (const key of requiredTrueFlags) {
  if (process.env[key] !== "true") {
    failures.push(`${key} must be set to "true" for release builds.`);
  }
}

for (const key of devOnlyFlags) {
  if (process.env[key] === "true") {
    failures.push(`${key} must not be enabled in release builds.`);
  }
}

if (failures.length > 0) {
  console.error("Release feature-flag environment is not valid:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(report, null, 2));
