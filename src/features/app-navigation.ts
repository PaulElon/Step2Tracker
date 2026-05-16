import {
  AlertCircle,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  Clock,
  Flame,
  House,
  LayoutDashboard,
  PieChart,
  Settings2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { SectionId } from "../types/models";

type NavigationGroupId = "core" | "portfolio" | "workspace" | "system";
type DesktopNavigationItemId = SectionId | "portfolioOverview";

type FeatureFlags = {
  notebookEnabled: boolean;
  timefolioEnabled: boolean;
};

type BaseNavigationItem<TId extends string> = {
  id: TId;
  label: string;
  icon: LucideIcon;
};

export type DesktopNavigationItem = BaseNavigationItem<DesktopNavigationItemId>;
export type MobileNavigationItem = BaseNavigationItem<SectionId>;

export type NavigationGroup = {
  id: NavigationGroupId;
  label: string;
  items: DesktopNavigationItem[];
};

export function resolveAppSection(
  activeSection: SectionId,
  { notebookEnabled, timefolioEnabled }: FeatureFlags,
): SectionId {
  if (activeSection === "timefolio") {
    return timefolioEnabled ? "sessionLog" : "dashboard";
  }

  if (activeSection === "heatmap") {
    return timefolioEnabled ? "analytics" : "dashboard";
  }

  if (
    !timefolioEnabled &&
    (activeSection === "sessionLog" || activeSection === "analytics")
  ) {
    return "dashboard";
  }

  if (!notebookEnabled && activeSection === "notebook") {
    return "dashboard";
  }

  return activeSection;
}

export function getDesktopNavigationGroups({
  notebookEnabled,
  timefolioEnabled,
}: FeatureFlags): NavigationGroup[] {
  const groups: NavigationGroup[] = [
    {
      id: "core",
      label: "Core",
      items: [
        { id: "dashboard", label: "Today", icon: House },
        { id: "planner", label: "Plan", icon: CalendarDays },
      ],
    },
    {
      id: "portfolio",
      label: "Portfolio",
      items: [
        { id: "portfolioOverview", label: "Overview", icon: LayoutDashboard },
        { id: "tests", label: "Practice Tests", icon: ClipboardCheck },
        { id: "weakTopics", label: "Weak Topics", icon: Flame },
        { id: "errorLog", label: "Error Log", icon: AlertCircle },
      ],
    },
    {
      id: "workspace",
      label: "Workspace",
      items: notebookEnabled ? [{ id: "notebook", label: "Notebook", icon: BookOpen }] : [],
    },
    {
      id: "system",
      label: "System",
      items: [{ id: "settings", label: "Settings", icon: Settings2 }],
    },
  ];

  if (timefolioEnabled) {
    groups[0].items.push({ id: "sessionLog", label: "Session Log", icon: Clock });
    groups[1].items.push({ id: "analytics", label: "Analytics", icon: PieChart });
  }

  return groups.filter((group) => group.items.length > 0);
}

export function getMobileNavigationItems({
  notebookEnabled,
  timefolioEnabled,
}: FeatureFlags): MobileNavigationItem[] {
  const items: MobileNavigationItem[] = [
    { id: "dashboard", label: "Today", icon: House },
    { id: "planner", label: "Plan", icon: CalendarDays },
  ];

  if (timefolioEnabled) {
    items.push({ id: "sessionLog", label: "Session Log", icon: Clock });
  }

  items.push(
    { id: "tests", label: "Practice Tests", icon: ClipboardCheck },
    { id: "weakTopics", label: "Weak Topics", icon: Flame },
    { id: "errorLog", label: "Error Log", icon: AlertCircle },
  );

  if (timefolioEnabled) {
    items.push({ id: "analytics", label: "Analytics", icon: PieChart });
  }

  if (notebookEnabled) {
    items.push({ id: "notebook", label: "Notebook", icon: BookOpen });
  }

  items.push({ id: "settings", label: "Settings", icon: Settings2 });
  return items;
}
