import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PREFERENCES, normalizeAppState } from "../../src/lib/storage.ts";

test("normalizePreferences seeds one notebook page from notesHtml when notebookPages is undefined", () => {
  const normalized = normalizeAppState({
    preferences: {
      notesHtml: "<p>hi</p>",
    },
  });

  assert.equal(normalized.preferences.notebookPages.length, 1);
  assert.equal(normalized.preferences.notebookPages[0]?.title, "Study Notes");
  assert.equal(normalized.preferences.notebookPages[0]?.contentHtml, "<p>hi</p>");
  assert.equal(normalized.preferences.notebookPages[0]?.order, 0);
});

test("normalizePreferences does not reseed when existing notebookPages are present", () => {
  const normalized = normalizeAppState({
    preferences: {
      notesHtml: "<p>seed me</p>",
      notebookPages: [
        {
          id: "existing-1",
          title: "Existing",
          contentHtml: "<p>keep me</p>",
          order: 4,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(normalized.preferences.notebookPages.length, 1);
  assert.equal(normalized.preferences.notebookPages[0]?.id, "existing-1");
  assert.equal(normalized.preferences.notebookPages[0]?.title, "Existing");
  assert.equal(normalized.preferences.notebookPages[0]?.contentHtml, "<p>keep me</p>");
});

test("normalizePreferences keeps notebookPages empty when malformed and notesHtml is empty", () => {
  const normalized = normalizeAppState({
    preferences: {
      notesHtml: "   ",
      notebookPages: { nope: true },
    },
  });

  assert.deepEqual(normalized.preferences.notebookPages, []);
});

test("normalizePreferences sorts notebookPages by ascending order", () => {
  const normalized = normalizeAppState({
    preferences: {
      notebookPages: [
        {
          id: "late",
          title: "Late",
          contentHtml: "",
          order: 10,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "early",
          title: "Early",
          contentHtml: "",
          order: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  });

  assert.deepEqual(
    normalized.preferences.notebookPages.map((page) => page.id),
    ["early", "late"],
  );
});

test("normalizePreferences applies safe defaults for missing notebook page fields", () => {
  const normalized = normalizeAppState({
    preferences: {
      notebookPages: [{}],
    },
  });

  assert.equal(normalized.preferences.notebookPages.length, 1);
  const page = normalized.preferences.notebookPages[0];
  assert.ok(page);
  assert.equal(page?.title, "Untitled");
  assert.equal(page?.contentHtml, "");
  assert.equal(page?.favorited, false);
  assert.equal(page?.order, 0);
  assert.ok(page?.id);
  assert.ok(page?.createdAt);
  assert.ok(page?.updatedAt);
});

test("normalizePreferences preserves favorited true on notebook pages", () => {
  const normalized = normalizeAppState({
    preferences: {
      notebookPages: [
        {
          id: "fav-1",
          title: "Favorited",
          contentHtml: "",
          favorited: true,
          order: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(normalized.preferences.notebookPages[0]?.favorited, true);
});

test("normalizePreferences coerces non-boolean notebook page favorited to false", () => {
  const normalized = normalizeAppState({
    preferences: {
      notebookPages: [
        {
          id: "fav-2",
          title: "Invalid Favorite",
          contentHtml: "",
          favorited: "true" as unknown as boolean,
          order: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(normalized.preferences.notebookPages[0]?.favorited, false);
});

test("DEFAULT_PREFERENCES initializes notebookPages to an empty array", () => {
  assert.deepEqual(DEFAULT_PREFERENCES.notebookPages, []);
});
