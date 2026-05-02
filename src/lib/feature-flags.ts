// Checked at runtime. Missing env var → false. No existing code is affected.
export const FF = {
  timefolio:
    import.meta.env.VITE_FF_TIMEFOLIO === "true" ||
    (import.meta.env.DEV && import.meta.env.VITE_FF_TIMEFOLIO !== "false"),
  notebook: import.meta.env.VITE_FF_NOTEBOOK !== "false",
  tiptapEditor:
    import.meta.env.VITE_FF_TIPTAP_EDITOR === "true" ||
    (import.meta.env.DEV && import.meta.env.VITE_FF_TIPTAP_EDITOR !== "false"),
} as const;
