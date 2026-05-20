import { useAppStore } from "../state/app-store";

export function DemoBanner() {
  const { isDemoMode, exitDemo } = useAppStore();

  if (!isDemoMode) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[9999] flex items-center justify-between gap-4 bg-amber-500 px-6 py-3">
      <span className="text-sm font-semibold text-white">
        Demo mode · You&apos;re viewing sample data, not your real data.
      </span>
      <button
        type="button"
        onClick={() => {
          void exitDemo();
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-white/30 bg-white/15 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/25"
      >
        Exit Demo
      </button>
    </div>
  );
}
