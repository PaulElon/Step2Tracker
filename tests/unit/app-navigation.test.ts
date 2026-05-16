import assert from "node:assert/strict";
import test from "node:test";

import {
  getDesktopNavigationGroups,
  getMobileNavigationItems,
  resolveAppSection,
} from "../../src/features/app-navigation.ts";
import { isPortfolioSection, isTimefolioPortfolioSection } from "../../src/features/portfolio-section.ts";

test("desktop navigation matches the left-sidebar information architecture", () => {
  const groups = getDesktopNavigationGroups({
    notebookEnabled: true,
    timefolioEnabled: true,
  });

  assert.deepEqual(
    groups.map((group) => ({
      label: group.label,
      items: group.items.map((item) => item.label),
    })),
    [
      { label: "Core", items: ["Today", "Plan", "Session Log"] },
      {
        label: "Portfolio",
        items: ["Overview", "Practice Tests", "Weak Topics", "Error Log", "Analytics", "Heatmap"],
      },
      { label: "Workspace", items: ["Notebook"] },
      { label: "System", items: ["Settings"] },
    ],
  );
});

test("mobile navigation exposes the new study time destinations", () => {
  const items = getMobileNavigationItems({
    notebookEnabled: true,
    timefolioEnabled: true,
  });

  assert.deepEqual(
    items.map((item) => item.id),
    [
      "dashboard",
      "planner",
      "sessionLog",
      "tests",
      "weakTopics",
      "errorLog",
      "analytics",
      "heatmap",
      "notebook",
      "settings",
    ],
  );
});

test("legacy study time sections resolve to session log", () => {
  assert.equal(
    resolveAppSection("timefolio", {
      notebookEnabled: true,
      timefolioEnabled: true,
    }),
    "sessionLog",
  );

  assert.equal(
    resolveAppSection("timefolio", {
      notebookEnabled: true,
      timefolioEnabled: false,
    }),
    "dashboard",
  );
});

test("timefolio portfolio sections are classified structurally and session log stays outside portfolio", () => {
  assert.equal(isTimefolioPortfolioSection("analytics"), true);
  assert.equal(isTimefolioPortfolioSection("heatmap"), true);
  assert.equal(isPortfolioSection("analytics"), false);
  assert.equal(isPortfolioSection("sessionLog"), false);
});
