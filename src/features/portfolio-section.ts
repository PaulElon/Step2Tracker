import { FF } from "../lib/feature-flags";
import type { SectionId } from "../types/models";

export type PortfolioSectionId = "tests" | "weakTopics" | "errorLog" | "analytics" | "heatmap";

export function isTimefolioPortfolioSection(section: SectionId): section is Extract<PortfolioSectionId, "analytics" | "heatmap"> {
  return section === "analytics" || section === "heatmap";
}

export function isPortfolioSection(section: SectionId): section is PortfolioSectionId {
  if (section === "tests" || section === "weakTopics" || section === "errorLog") {
    return true;
  }
  if (isTimefolioPortfolioSection(section) && FF.timefolio) {
    return true;
  }
  return false;
}
