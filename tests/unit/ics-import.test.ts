import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";

import { parseIcsImport } from "../../src/lib/ics-import.js";

async function parseCalendar(ics: string) {
  return parseIcsImport(new File([ics], "calendar.ics", { type: "text/calendar" }));
}

test("nested VALARM fields do not overwrite top-level VEVENT fields", async () => {
  const result = await parseCalendar(
    [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Event title",
      "DESCRIPTION:Main description",
      "UID:parent-1",
      "DTSTART;VALUE=DATE:20260430",
      "BEGIN:VALARM",
      "SUMMARY:Alarm title",
      "DESCRIPTION:Alarm description",
      "UID:alarm-1",
      "DTSTART:20260430T120000Z",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n"),
  );

  assert.equal(result.totalEvents, 1);
  assert.equal(result.importableCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.duplicateCount, 0);
  assert.deepEqual(result.issues, []);
  assert.equal(result.studyBlocks[0]?.task, "Event title");
  assert.equal(result.studyBlocks[0]?.notes, "Main description");
  assert.equal(result.studyBlocks[0]?.date, "2026-04-30");
  assert.equal(result.studyBlocks[0]?.importSourceId, "ics:parent-1");
});

test("folded lines still unfold and date-only DTSTART stays importable", async () => {
  const result = await parseCalendar(
    [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Folded title ",
      " continued",
      "DESCRIPTION:Folded note ",
      " continued",
      "UID:folded-1",
      "DTSTART;VALUE=DATE:20260501",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n"),
  );

  assert.equal(result.totalEvents, 1);
  assert.equal(result.importableCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.studyBlocks[0]?.task, "Folded title continued");
  assert.equal(result.studyBlocks[0]?.notes, "Folded note continued");
  assert.equal(result.studyBlocks[0]?.date, "2026-05-01");
});

test("timed events and events with missing or invalid DTSTART are skipped", async () => {
  const result = await parseCalendar(
    [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Timed event",
      "UID:timed-1",
      "DTSTART:20260502T090000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:missing-summary-1",
      "DTSTART;VALUE=DATE:20260503",
      "DESCRIPTION:Missing summary",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "SUMMARY:Missing DTSTART",
      "UID:missing-dtstart-1",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "SUMMARY:Invalid DTSTART",
      "UID:invalid-dtstart-1",
      "DTSTART;VALUE=DATE:20260231",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n"),
  );

  assert.equal(result.totalEvents, 4);
  assert.equal(result.importableCount, 0);
  assert.equal(result.skippedCount, 4);
  assert.equal(result.duplicateCount, 0);
  assert.deepEqual(result.issues, [
    "Event 1 skipped: DTSTART must be a date-only all-day value.",
    "Event 2 skipped: missing SUMMARY.",
    "Event 3 skipped: DTSTART must be a date-only all-day value.",
    "Event 4 skipped: DTSTART must be a date-only all-day value.",
  ]);
});
