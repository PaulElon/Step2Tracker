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
