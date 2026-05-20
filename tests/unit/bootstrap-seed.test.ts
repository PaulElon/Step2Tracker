import assert from "node:assert/strict";
import test from "node:test";

import {
  createBootstrapState,
  matchesBootstrapSeed,
  normalizeErrorLogEntry,
} from "../../src/lib/storage.ts";

test("matchesBootstrapSeed returns true for the bootstrap state", () => {
  assert.equal(matchesBootstrapSeed(createBootstrapState()), true);
});

test("matchesBootstrapSeed returns false when bootstrap state has an error log entry", () => {
  const state = createBootstrapState();
  state.errorLogEntries = [
    normalizeErrorLogEntry(
      {
        id: "error-log-1",
        source: "UWorld",
        examBlock: "Block 1",
        system: "IM/FM",
        topic: "Cardiology",
        errorType: "Knowledge Gap",
        missedPattern: "Missed a key clue",
        fix: "Review the concept",
        whyPickedWrongAnswer: "Rushed",
        whyCorrectAnswerIsCorrect: "It was the best choice",
        whyTemptingWrongAnswerIsWrong: "It looked familiar",
        decisionRule: "Slow down and identify the stem",
        isRepeatMiss: false,
        followUpAction: "",
        isGuessedCorrect: false,
        addToFinalSheet: false,
        priority: "medium",
        entryDate: "2026-05-19",
        createdAt: "2026-05-19T12:00:00.000Z",
        updatedAt: "2026-05-19T12:00:00.000Z",
      },
      "error-log-1",
    ),
  ];

  assert.equal(matchesBootstrapSeed(state), false);
});
