import type { JSX } from "react";
import { ErrorLogView } from "./error-log-view";
import { PortfolioOverview } from "./portfolio/portfolio-overview";
import { PracticeTestsView } from "./practice-tests-view";
import { TimeFolioView } from "./timefolio-view";
import { WeakTopicsView } from "./weak-topics-view";
import { FF } from "../lib/feature-flags";
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

export function PortfolioView({
  activeSection,
  showOverview,
  onSelectSection,
}: {
  activeSection: PortfolioSectionId;
  showOverview?: boolean;
  onSelectSection: (section: PortfolioSectionId) => void;
}) {
  if (showOverview) {
    return (
      <div className="h-full min-h-0">
        <PortfolioOverview onNavigate={onSelectSection} />
      </div>
    );
  }

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

  return <div className="h-full min-h-0">{content}</div>;
}
