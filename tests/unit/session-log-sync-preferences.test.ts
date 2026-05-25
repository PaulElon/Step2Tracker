import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAppState } from "../../src/lib/storage.ts";

test("normalizeAppState defaults syncAutoTrackerSessionLogs to false for older preferences", () => {
  const normalized = normalizeAppState({
    version: 6,
    studyBlocks: [],
    practiceTests: [],
    weakTopicEntries: [],
    errorLogEntries: [],
    preferences: {
      activeSection: "dashboard",
      lastActiveDate: "2026-05-25",
      themeId: "dark",
      dailyGoalMinutes: 480,
      plannerFilters: {
        search: "",
        category: "All",
        status: "All",
        fromDate: "",
        toDate: "",
      },
      plannerSort: {
        field: "date",
        direction: "asc",
      },
      plannerMode: "week",
      plannerFocusDate: "2026-05-25",
      enhancedThemeIds: [],
      customCategories: ["Test", "Review"],
      resourceLinks: [],
      examTimers: [],
      notesHtml: "",
      notebookFolders: [],
      notebookPages: [],
      notebookDocuments: [],
      scoreTrendOptions: {
        showConnectionLine: false,
        showBestFitLine: true,
        showBestFitRSquared: false,
      },
    },
  });

  assert.equal(normalized.preferences.syncAutoTrackerSessionLogs, false);
});

test("normalizeAppState preserves syncAutoTrackerSessionLogs when enabled", () => {
  const normalized = normalizeAppState({
    version: 6,
    studyBlocks: [],
    practiceTests: [],
    weakTopicEntries: [],
    errorLogEntries: [],
    preferences: {
      activeSection: "dashboard",
      lastActiveDate: "2026-05-25",
      themeId: "dark",
      dailyGoalMinutes: 480,
      plannerFilters: {
        search: "",
        category: "All",
        status: "All",
        fromDate: "",
        toDate: "",
      },
      plannerSort: {
        field: "date",
        direction: "asc",
      },
      plannerMode: "week",
      plannerFocusDate: "2026-05-25",
      enhancedThemeIds: [],
      customCategories: ["Test", "Review"],
      resourceLinks: [],
      examTimers: [],
      notesHtml: "",
      notebookFolders: [],
      notebookPages: [],
      notebookDocuments: [],
      scoreTrendOptions: {
        showConnectionLine: false,
        showBestFitLine: true,
        showBestFitRSquared: false,
      },
      syncAutoTrackerSessionLogs: true,
    },
  });

  assert.equal(normalized.preferences.syncAutoTrackerSessionLogs, true);
});
