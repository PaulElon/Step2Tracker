import assert from "node:assert/strict";
import test from "node:test";

import {
  convertWebBackupToDesktopArtifact,
  isWebBackupArtifact,
} from "../../src/lib/storage.ts";

const webBackupSample = {
  metadata: {
    exportedAt: "2026-05-22T12:00:00.000Z",
    app: "TimeFolio-Web",
    schemaVersion: 1,
  },
  state: {
    studyBlocks: [
      {
        id: "wb-1",
        date: "2026-05-22",
        day: "Friday",
        order: 0,
        category: "Review",
        task: "Practice block from web",
        durationMinutes: 95,
        durationHours: 1.58,
        completed: false,
        status: "Not Started",
        startTime: "08:00",
        endTime: "09:35",
        isOvernight: false,
        notes: "",
        createdAt: "2026-05-20T10:00:00.000Z",
        updatedAt: "2026-05-22T10:00:00.000Z",
      },
    ],
    sessionLogs: [],
    practiceTests: [
      {
        id: "wt-1",
        date: "2026-05-21",
        source: "NBME",
        form: "Form 30",
        questionCount: 200,
        scorePercent: 72,
        weakTopics: ["DKA"],
        strongTopics: ["MI"],
        reflections: "",
        actionPlan: "",
        minutesSpent: 240,
        createdAt: "2026-05-21T14:00:00.000Z",
        updatedAt: "2026-05-21T14:00:00.000Z",
      },
    ],
    weakTopicEntries: [
      {
        id: "ww-1",
        topic: "DKA mgmt",
        entryType: "manual",
        priority: "High",
        status: "Active",
        sourceLabel: "Manual",
        lastSeenAt: "2026-05-19",
        notes: "Watch for K replacement",
        manualOccurrenceCount: 1,
        createdAt: "2026-05-19T10:00:00.000Z",
        updatedAt: "2026-05-19T10:00:00.000Z",
      },
    ],
    errorLogEntries: [
      {
        id: "we-1",
        source: "UWorld",
        examBlock: "Block 1",
        system: "IM/FM",
        topic: "Acid-base",
        errorType: "Knowledge Gap",
        missedPattern: "Mixed disorder",
        fix: "Review nomogram",
        whyPickedWrongAnswer: "",
        whyCorrectAnswerIsCorrect: "",
        whyTemptingWrongAnswerIsWrong: "",
        decisionRule: "",
        isRepeatMiss: false,
        followUpAction: "",
        isGuessedCorrect: false,
        addToFinalSheet: false,
        priority: "medium",
        entryDate: "2026-05-22",
        createdAt: "2026-05-22T11:00:00.000Z",
        updatedAt: "2026-05-22T11:00:00.000Z",
      },
    ],
    notebook: {
      folders: [
        {
          id: "wf-1",
          name: "Web Folder",
          order: 0,
          favorited: false,
          createdAt: "2026-05-10T10:00:00.000Z",
          updatedAt: "2026-05-10T10:00:00.000Z",
        },
      ],
      documents: [
        {
          id: "wd-1",
          title: "Web Doc",
          folderId: "wf-1",
          order: 0,
          favorited: false,
          createdAt: "2026-05-10T10:00:00.000Z",
          updatedAt: "2026-05-10T10:00:00.000Z",
          pages: [
            {
              id: "wp-1",
              documentId: "wd-1",
              title: "Page 1",
              contentHtml: "<p>hi</p>",
              kind: "note",
              order: 0,
              createdAt: "2026-05-10T10:00:00.000Z",
              updatedAt: "2026-05-10T10:00:00.000Z",
            },
            {
              id: "wp-2",
              documentId: "wd-1",
              title: "Unsupported PDF page",
              contentHtml: "",
              kind: "pdf",
              order: 1,
              createdAt: "2026-05-10T10:00:00.000Z",
              updatedAt: "2026-05-10T10:00:00.000Z",
            },
          ],
        },
      ],
    },
    preferences: {
      dailyGoalMinutes: 360,
      themeId: "paulblue",
      enhancedThemeIds: ["paulblue"],
      examTimers: [
        {
          id: "exam-step2",
          label: "Step 2 CK",
          examDate: "2026-08-01",
          examTime: "08:00",
        },
      ],
      plannerFocusDate: "2026-05-22",
      customCategories: [
        { id: "cat-1", label: "Anki" },
        { id: "cat-2", label: "Review" },
      ],
      resourceLinks: [
        {
          id: "rl-1",
          label: "UWorld",
          url: "https://uworld.com",
          type: "Website",
        },
      ],
    },
  },
};

test("isWebBackupArtifact detects TimeFolio-Web metadata", () => {
  assert.equal(isWebBackupArtifact(webBackupSample), true);
  assert.equal(
    isWebBackupArtifact({ app: "step2-command-center", state: {} }),
    false,
  );
  assert.equal(isWebBackupArtifact("not-an-object"), false);
});

test("convertWebBackupToDesktopArtifact translates a web backup into a desktop artifact", () => {
  const raw = JSON.stringify(webBackupSample);
  const converted = convertWebBackupToDesktopArtifact(raw);
  assert.ok(converted, "expected a non-null translated artifact");
  const artifact = JSON.parse(converted!) as {
    app: string;
    formatVersion: number;
    schemaVersion: number;
    appVersion: string;
    counts: {
      studyBlocks: number;
      practiceTests: number;
      weakTopicEntries: number;
      trashedStudyBlocks: number;
      trashedPracticeTests: number;
      trashedWeakTopicEntries: number;
    };
    state: {
      version: number;
      studyBlocks: Array<{
        durationHours: number;
        durationMinutes: number;
        date: string;
        task: string;
        status: string;
      }>;
      practiceTests: Array<{ id: string }>;
      weakTopicEntries: Array<{ id: string }>;
      errorLogEntries: Array<{ id: string }>;
      preferences: {
        themeId: string;
        dailyGoalMinutes: number;
        customCategories: string[];
        resourceLinks: Array<{ kind: string; label: string }>;
        examTimers: Array<{ examTime: string; displayMode: string }>;
        notebookFolders: Array<{ id: string }>;
        notebookDocuments: Array<{ id: string; pages: Array<{ kind?: string }> }>;
        notebookPages: unknown[];
        plannerFocusDate: string;
      };
    };
  };

  assert.equal(artifact.app, "step2-command-center");
  assert.equal(artifact.formatVersion, 1);
  assert.equal(artifact.counts.studyBlocks, 1);
  assert.equal(artifact.counts.practiceTests, 1);
  assert.equal(artifact.counts.weakTopicEntries, 1);
  assert.equal(artifact.counts.trashedStudyBlocks, 0);

  const [block] = artifact.state.studyBlocks;
  assert.ok(block);
  // 95 total minutes → 1h 35m on desktop
  assert.equal(block.durationHours, 1);
  assert.equal(block.durationMinutes, 35);
  assert.equal(block.date, "2026-05-22");
  assert.equal(block.task, "Practice block from web");
  assert.equal(block.status, "Not Started");

  assert.equal(artifact.state.preferences.themeId, "paulblue");
  assert.equal(artifact.state.preferences.dailyGoalMinutes, 360);
  assert.deepEqual(artifact.state.preferences.customCategories, ["Anki", "Review"]);
  assert.equal(artifact.state.preferences.resourceLinks[0]?.kind, "website");
  assert.equal(artifact.state.preferences.examTimers[0]?.examTime, "08:00");
  assert.equal(artifact.state.preferences.examTimers[0]?.displayMode, "days");
  assert.equal(artifact.state.preferences.notebookFolders.length, 1);
  assert.equal(artifact.state.preferences.notebookDocuments.length, 1);
  // PDF page must not carry "pdf" kind through since web does not supply pdfFilename.
  for (const page of artifact.state.preferences.notebookDocuments[0]?.pages ?? []) {
    assert.notEqual(page.kind, "pdf");
  }
  assert.equal(artifact.state.preferences.notebookPages.length, 0);
  assert.equal(artifact.state.preferences.plannerFocusDate, "2026-05-22");
});

test("convertWebBackupToDesktopArtifact returns null for desktop and invalid payloads", () => {
  assert.equal(
    convertWebBackupToDesktopArtifact(
      JSON.stringify({ app: "step2-command-center", version: 6, state: {} }),
    ),
    null,
  );
  assert.equal(convertWebBackupToDesktopArtifact("{not json}"), null);
  assert.equal(convertWebBackupToDesktopArtifact("{}"), null);
});

test("convertWebBackupToDesktopArtifact safely degrades missing arrays", () => {
  const minimal = {
    metadata: { app: "TimeFolio-Web", exportedAt: "2026-05-22T12:00:00.000Z", schemaVersion: 1 },
    state: {
      preferences: {
        dailyGoalMinutes: 120,
        themeId: "dark",
        examTimers: [],
        plannerFocusDate: "2026-05-22",
      },
    },
  };
  const converted = convertWebBackupToDesktopArtifact(JSON.stringify(minimal));
  assert.ok(converted);
  const parsed = JSON.parse(converted!) as {
    state: {
      studyBlocks: unknown[];
      practiceTests: unknown[];
      weakTopicEntries: unknown[];
      errorLogEntries: unknown[];
      preferences: { notebookFolders: unknown[]; notebookDocuments: unknown[] };
    };
  };
  assert.equal(parsed.state.studyBlocks.length, 0);
  assert.equal(parsed.state.practiceTests.length, 0);
  assert.equal(parsed.state.weakTopicEntries.length, 0);
  assert.equal(parsed.state.errorLogEntries.length, 0);
  assert.equal(parsed.state.preferences.notebookFolders.length, 0);
  assert.equal(parsed.state.preferences.notebookDocuments.length, 0);
});
