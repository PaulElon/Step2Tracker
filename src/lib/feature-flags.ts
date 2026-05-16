const env = ((import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env ?? {}) as Record<
  string,
  string | boolean | undefined
>;

// Checked at runtime. Missing env var → false. No existing code is affected.
export const FF = {
  timefolio:
    env.VITE_FF_TIMEFOLIO === "true" ||
    (env.DEV === true && env.VITE_FF_TIMEFOLIO !== "false"),
  notebook: env.VITE_FF_NOTEBOOK !== "false",
  tiptapEditor: env.VITE_FF_TIPTAP_EDITOR !== "false",
  // Shadow diagnostic only. Never enabled in production unless env var is explicitly "true".
  autotrackerV2NativeInspector: env.VITE_FF_AUTOTRACKER_V2_NATIVE_INSPECTOR === "true",
  autotrackerV2ManualWrite: env.VITE_FF_AUTOTRACKER_V2_MANUAL_WRITE === "true",
  autotrackerV2ContinuousWrite:
    env.VITE_FF_AUTOTRACKER_V2_CONTINUOUS_WRITE === "true",
  autotrackerV2NativeSampler:
    env.VITE_FF_AUTOTRACKER_V2_NATIVE_SAMPLER === "true",
  autotrackerV2UserMode: env.VITE_FF_AUTOTRACKER_V2_USER_MODE === "true",
} as const;
