import { TimeFolioStoreProvider } from "../state/tf-store";
import { HeatmapPanel } from "./timefolio/heatmap-panel";

export function TimeFolioHeatmapView() {
  return (
    <TimeFolioStoreProvider>
      <div className="flex flex-col gap-4 pb-2">
        <div className="space-y-1">
          <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white">Heatmap</h2>
          <p className="text-sm text-slate-400">
            Inspect your study cadence day by day, then drill into the sessions behind each block.
          </p>
        </div>
        <HeatmapPanel showHeader={false} />
      </div>
    </TimeFolioStoreProvider>
  );
}
