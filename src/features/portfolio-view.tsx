import type { JSX } from "react";
import { ErrorLogView } from "./error-log-view";
import { PortfolioOverview } from "./portfolio/portfolio-overview";
import type { PortfolioSectionId } from "./portfolio-section";
import { PracticeTestsView } from "./practice-tests-view";
import { TimeFolioView } from "./timefolio-view";
import { WeakTopicsView } from "./weak-topics-view";

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
