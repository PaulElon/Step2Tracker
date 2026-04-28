import { useState } from "react";
import { cn } from "../lib/ui";
import { TimeFolioStoreProvider } from "../state/tf-store";
import { AccountPanel } from "./timefolio/account-panel";
import { AllocationPanel } from "./timefolio/allocation-panel";
import { AnalyticsPanel } from "./timefolio/analytics-panel";
import { HeatmapPanel } from "./timefolio/heatmap-panel";
import { OverviewPanel } from "./timefolio/overview-panel";
import { SessionLogPanel } from "./timefolio/session-log-panel";
import { SummaryPanel } from "./timefolio/summary-panel";
import { TrackerSettingsPanel } from "./timefolio/tracker-settings-panel";

type TimeFolioTab =
  | "overview"
  | "session-log"
  | "allocation"
  | "summary"
  | "analytics"
  | "heatmap"
  | "tracker-settings"
  | "account";

const TABS: { id: TimeFolioTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "session-log", label: "Session Log" },
  { id: "allocation", label: "Allocation" },
  { id: "summary", label: "Summary" },
  { id: "analytics", label: "Analytics" },
  { id: "heatmap", label: "Heatmap" },
  { id: "tracker-settings", label: "Tracker Settings" },
  { id: "account", label: "Account / Billing" },
];

function ActivePanel({ tab }: { tab: TimeFolioTab }) {
  switch (tab) {
    case "overview":
      return <OverviewPanel />;
    case "session-log":
      return <SessionLogPanel />;
    case "allocation":
      return <AllocationPanel />;
    case "summary":
      return <SummaryPanel />;
    case "analytics":
      return <AnalyticsPanel />;
    case "heatmap":
      return <HeatmapPanel />;
    case "tracker-settings":
      return <TrackerSettingsPanel />;
    case "account":
      return <AccountPanel />;
  }
}

export function TimeFolioView() {
  const [activeTab, setActiveTab] = useState<TimeFolioTab>("overview");

  return (
    <TimeFolioStoreProvider>
      <div className="flex h-full flex-col gap-4 overflow-hidden p-4">
        <div className="glass-panel flex shrink-0 gap-1 overflow-x-auto p-1">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={cn(
                "rounded-[10px] px-4 py-2 text-sm font-medium transition whitespace-nowrap",
                activeTab === id
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="glass-panel min-h-0 flex-1 overflow-y-auto">
          <ActivePanel tab={activeTab} />
        </div>
      </div>
    </TimeFolioStoreProvider>
  );
}
