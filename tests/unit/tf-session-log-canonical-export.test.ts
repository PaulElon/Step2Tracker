import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanonicalSessionLogExport,
  classifyTfSessionLogForCanonicalExport,
} from "../../src/lib/tf-session-log-canonical-export.ts";
import type { TfSessionLog } from "../../src/types/models.ts";

function buildSession(overrides: Partial<TfSessionLog> = {}): TfSessionLog {
  return {
    id: overrides.id ?? "manual-1",
    date: overrides.date ?? "2026-05-06",
    method: overrides.method ?? "Manual Review",
    methodKey: overrides.methodKey ?? "manual-review",
    hours: overrides.hours ?? 1.5,
    startISO: overrides.startISO ?? "2026-05-06T12:00:00.000Z",
    endISO: overrides.endISO ?? "2026-05-06T13:30:00.000Z",
    notes: overrides.notes ?? "Focused renal review.",
    isDistraction: overrides.isDistraction ?? false,
    isLive: overrides.isLive ?? false,
    updatedAt: overrides.updatedAt ?? "2026-05-06T13:35:00.000Z",
  };
}

test("canonical export includes safe manual rows with canonical fields", () => {
  const exported = buildCanonicalSessionLogExport([buildSession()]);

  assert.deepEqual(exported, [
    {
      schemaVersion: 1,
      id: "manual-1",
      date: "2026-05-06",
      title: "Manual Review",
      category: "manual-review",
      source: "manual",
      durationMinutes: 90,
      startAt: "2026-05-06T12:00:00.000Z",
      endAt: "2026-05-06T13:30:00.000Z",
      notes: "Focused renal review.",
      isDistraction: false,
      updatedAt: "2026-05-06T13:35:00.000Z",
    },
  ]);
});

test("canonical export excludes privacy-unsafe auto and native rows", () => {
  const sessions: TfSessionLog[] = [
    buildSession({
      id: "nat-device-1-span-1",
      method: "UWorld",
      notes: "[AUTO] Google Chrome — UWorld Step 2",
    }),
    buildSession({
      id: "auto-preview-1",
      method: "UWorld [Auto]",
      notes: "",
    }),
    buildSession({
      id: "manual-unsafe-notes",
      method: "Manual Review",
      notes: "browserUrl=https://apps.uworld.com/courseapp/step2 browserTitle=UWorld",
    }),
  ];

  assert.deepEqual(buildCanonicalSessionLogExport(sessions), []);
  assert.equal(classifyTfSessionLogForCanonicalExport(sessions[0]).reason, "nativeSession");
  assert.equal(classifyTfSessionLogForCanonicalExport(sessions[1]).reason, "autoDerivedMethod");
  assert.equal(classifyTfSessionLogForCanonicalExport(sessions[2]).reason, "autoDerivedNotes");
});

test("canonical export never leaks raw native/browser identifiers", () => {
  const exported = buildCanonicalSessionLogExport([
    buildSession(),
    buildSession({
      id: "nat-device-2-span-2",
      method: "Resource [Auto]",
      notes:
        "[AUTO] Google Chrome — browserTitle=Question Bank browserUrl=https://resource.example.com/course previewSessionId=website:resource sourceEventIds=event-1",
    }),
  ]);

  const serialized = JSON.stringify(exported);
  assert.doesNotMatch(serialized, /Google Chrome|Question Bank|https:\/\/resource\.example\.com|previewSessionId|sourceEventIds/);
});
