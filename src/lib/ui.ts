export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export const fieldClassName = "field";
export const primaryButtonClassName = "primary-button";
export const secondaryButtonClassName = "secondary-button";
export const iconButtonClassName =
  "icon-button inline-flex h-10 w-10 items-center justify-center rounded-[18px] border border-white/10 bg-slate-900/70 text-slate-200 transition hover:border-white/20 hover:bg-slate-900 hover:text-white";
