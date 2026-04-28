// Checked at runtime. Missing env var → false. No existing code is affected.
// Only the single TimeFolio quarantine flag is introduced here. Internal
// subfeature flags (sessionLog / analytics / tracker / account) will be added
// later, once their corresponding subtabs inside the TimeFolio page exist.
export const FF = {
  timefolio: import.meta.env.VITE_FF_TIMEFOLIO === "true",
} as const;
