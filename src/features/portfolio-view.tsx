import { AlertCircle, ClipboardCheck, Clock, Flame } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { startTransition } from "react";
import type { JSX } from "react";
import { ErrorLogView } from "./error-log-view";
import { PracticeTestsView } from "./practice-tests-view";
import { TimeFolioView } from "./timefolio-view";
import { WeakTopicsView } from "./weak-topics-view";
import { FF } from "../lib/feature-flags";
import { cn } from "../lib/ui";
import type { SectionId } from "../types/models";

export type PortfolioSectionId = "tests" | "weakTopics" | "errorLog" | "timefolio";

export function isPortfolioSection(section: SectionId): section is PortfolioSectionId {
  if (section === "tests" || section === "weakTopics" || section === "errorLog") {
    return true;
  }
  if (section === "timefolio" && FF.timefolio) {
    return true;
  }
  return false;
}

type PortfolioTab = { id: PortfolioSectionId; label: string; icon: LucideIcon };

function getPortfolioTabs(): PortfolioTab[] {
  const tabs: PortfolioTab[] = [
    { id: "tests", label: "Practice Tests", icon: ClipboardCheck },
    { id: "weakTopics", label: "Weak Topics", icon: Flame },
    { id: "errorLog", label: "Error Log", icon: AlertCircle },
  ];
  if (FF.timefolio) {
    tabs.push({ id: "timefolio", label: "Study Time", icon: Clock });
  }
  return tabs;
}

export function PortfolioView({
  activeSection,
  onSelectSection,
}: {
  activeSection: PortfolioSectionId;
  onSelectSection: (section: PortfolioSectionId) => void;
}) {
  const tabs = getPortfolioTabs();
  const activeTab = tabs.find((tab) => tab.id === activeSection);

  let content: JSX.Element;
  switch (activeSection) {
    case "tests":
      content = <PracticeTestsView />;
      break;
    case "weakTopics":
      content = <WeakTopicsView />;
      break;
    case "errorLog":
      content = <ErrorLogView />;
      break;
    case "timefolio":
      content = <TimeFolioView />;
      break;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="glass-panel flex shrink-0 flex-col gap-3 p-3">
        <div className="flex items-center gap-2 px-1">
          <p className="text-[0.6rem] uppercase tracking-[0.22em] text-slate-500">Portfolio</p>
          {activeTab ? (
            <>
              <span className="text-slate-600">·</span>
              <p className="text-sm font-medium text-slate-200">{activeTab.label}</p>
            </>
          ) : null}
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon }) => {
            const active = id === activeSection;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  startTransition(() => {
                    onSelectSection(id);
                  });
                }}
                className={cn(
                  "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] px-4 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-white/[0.06] text-white"
                    : "text-slate-400 hover:bg-white/[0.03] hover:text-slate-200",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4",
                    active ? "text-cyan-200" : "text-slate-500",
                  )}
                />
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1">{content}</div>
    </div>
  );
}
