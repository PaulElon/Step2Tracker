// Checked at runtime. Missing env var → false. No existing code is affected.
export const FF = {
  timefolio:
    import.meta.env.VITE_FF_TIMEFOLIO === "true" ||
    (import.meta.env.DEV && import.meta.env.VITE_FF_TIMEFOLIO !== "false"),
  notebook: import.meta.env.VITE_FF_NOTEBOOK !== "false",
  tiptapEditor: import.meta.env.VITE_FF_TIPTAP_EDITOR !== "false",
  // Shadow diagnostic only. Never enabled in production unless env var is explicitly "true".
  autotrackerV2NativeInspector: import.meta.env.VITE_FF_AUTOTRACKER_V2_NATIVE_INSPECTOR === "true",
  autotrackerV2ManualWrite: import.meta.env.VITE_FF_AUTOTRACKER_V2_MANUAL_WRITE === "true",
  autotrackerV2ContinuousWrite:
    import.meta.env.VITE_FF_AUTOTRACKER_V2_CONTINUOUS_WRITE === "true",
  autotrackerV2NativeSampler:
    import.meta.env.VITE_FF_AUTOTRACKER_V2_NATIVE_SAMPLER === "true",
  autotrackerV2UserMode: import.meta.env.VITE_FF_AUTOTRACKER_V2_USER_MODE === "true",
} as const;
