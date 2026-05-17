import assert from "node:assert/strict";
import test from "node:test";

import {
  allocationByMethodDisplay,
  displayMethodLabel,
  splitAutoSessionMethodLabel,
} from "../../src/lib/tf-session-adapters.ts";
import type { TfSessionLog } from "../../src/types/models.ts";

test("splitAutoSessionMethodLabel removes the Auto suffix for display only", () => {
  assert.deepEqual(splitAutoSessionMethodLabel("UWorld [Auto]"), {
    label: "UWorld",
    isAuto: true,
  });

  assert.deepEqual(splitAutoSessionMethodLabel("Manual Review"), {
    label: "Manual Review",
    isAuto: false,
  });

  assert.deepEqual(splitAutoSessionMethodLabel(""), {
    label: "Other",
    isAuto: false,
  });
});

test("displayMethodLabel returns the method without any Auto suffix", () => {
  assert.equal(displayMethodLabel("Anki [Auto]"), "Anki");
  assert.equal(displayMethodLabel("Anki"), "Anki");
  assert.equal(displayMethodLabel("Truelearn [Auto]"), "Truelearn");
});

test("allocationByMethodDisplay merges auto and manual rows under the same label", () => {
  const sessions: TfSessionLog[] = [
    {
      id: "a",
      date: "2026-05-01",
      method: "Anki",
      methodKey: "anki",
      hours: 1,
      startISO: "2026-05-01T09:00:00",
      endISO: "2026-05-01T10:00:00",
      notes: "",
      isDistraction: false,
      isLive: false,
    },
    {
      id: "b",
      date: "2026-05-01",
      method: "Anki [Auto]",
      methodKey: "anki-auto",
      hours: 0.5,
      startISO: "2026-05-01T10:00:00",
      endISO: "2026-05-01T10:30:00",
      notes: "",
      isDistraction: false,
      isLive: false,
    },
    {
      id: "c",
      date: "2026-05-01",
      method: "UWorld [Auto]",
      methodKey: "uworld-auto",
      hours: 2,
      startISO: "2026-05-01T11:00:00",
      endISO: "2026-05-01T13:00:00",
      notes: "",
      isDistraction: false,
      isLive: false,
    },
  ];

  const allocation = allocationByMethodDisplay(sessions);
  assert.equal(allocation.length, 2);
  assert.equal(allocation[0].method, "UWorld");
  assert.equal(allocation[0].hours, 2);
  assert.equal(allocation[0].sessionCount, 1);
  assert.equal(allocation[1].method, "Anki");
  assert.equal(allocation[1].hours, 1.5);
  assert.equal(allocation[1].sessionCount, 2);
});
