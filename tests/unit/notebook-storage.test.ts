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
  assert.equal(page?.folderId, undefined);
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

test("DEFAULT_PREFERENCES initializes notebookFolders to an empty array", () => {
  assert.deepEqual(DEFAULT_PREFERENCES.notebookFolders, []);
});

test("DEFAULT_PREFERENCES initializes notebookDocuments to an empty array", () => {
  assert.deepEqual(DEFAULT_PREFERENCES.notebookDocuments, []);
});

test("normalizePreferences preserves notebookFolders and sorts by ascending order", () => {
  const normalized = normalizeAppState({
    preferences: {
      notebookFolders: [
        {
          id: "late-folder",
          name: "Late Folder",
          order: 5,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "early-folder",
          name: "Early Folder",
          parentFolderId: "root-folder",
          order: 1,
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    },
  });

  assert.deepEqual(
    normalized.preferences.notebookFolders.map((folder) => folder.id),
    ["early-folder", "late-folder"],
  );
  assert.equal(normalized.preferences.notebookFolders[0]?.name, "Early Folder");
  assert.equal(normalized.preferences.notebookFolders[0]?.parentFolderId, "root-folder");
});

test("normalizePreferences coerces missing or malformed notebookFolders to []", () => {
  const missing = normalizeAppState({
    preferences: {},
  });
  assert.deepEqual(missing.preferences.notebookFolders, []);

  const malformed = normalizeAppState({
    preferences: {
      notebookFolders: { nope: true },
    },
  });
  assert.deepEqual(malformed.preferences.notebookFolders, []);
});

test("normalizePreferences drops missing, null, empty, or non-string notebook folder parentFolderId", () => {
  const normalized = normalizeAppState({
    preferences: {
      notebookFolders: [
        {
          id: "missing-parent",
          name: "Missing Parent",
          order: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "null-parent",
          name: "Null Parent",
          parentFolderId: null as unknown as string,
          order: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "empty-parent",
          name: "Empty Parent",
          parentFolderId: "   ",
          order: 2,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "non-string-parent",
          name: "Non String Parent",
          parentFolderId: 42 as unknown as string,
          order: 3,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  });

  assert.deepEqual(normalized.preferences.notebookFolders.map((folder) => folder.parentFolderId), [
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

test("normalizePreferences preserves valid notebook page folderId values", () => {
  const normalized = normalizeAppState({
    preferences: {
      notebookPages: [
        {
          id: "page-in-folder",
          title: "Has Folder",
          contentHtml: "<p>content</p>",
          folderId: "folder-1",
          order: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(normalized.preferences.notebookPages[0]?.folderId, "folder-1");
});

test("normalizePreferences drops missing, null, non-string, or empty notebook page folderId", () => {
  const normalized = normalizeAppState({
    preferences: {
      notebookPages: [
        {
          id: "missing-folder",
          title: "Missing",
          contentHtml: "",
          order: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "null-folder",
          title: "Null",
          contentHtml: "",
          folderId: null as unknown as string,
          order: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "number-folder",
          title: "Number",
          contentHtml: "",
          folderId: 123 as unknown as string,
          order: 2,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "empty-folder",
          title: "Empty",
          contentHtml: "",
          folderId: "   ",
          order: 3,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(normalized.preferences.notebookPages[0]?.folderId, undefined);
  assert.equal(normalized.preferences.notebookPages[1]?.folderId, undefined);
  assert.equal(normalized.preferences.notebookPages[2]?.folderId, undefined);
  assert.equal(normalized.preferences.notebookPages[3]?.folderId, undefined);
});

test("normalizePreferences preserves notebookDocuments and sorts by ascending order", () => {
  const normalized = normalizeAppState({
    preferences: {
      notebookDocuments: [
        {
          id: "late-doc",
          title: "Late",
          order: 4,
          pages: [
            {
              id: "late-page",
              title: "Page",
              contentHtml: "<p>late</p>",
              order: 0,
              createdAt: "2026-01-02T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
          ],
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "early-doc",
          title: "Early",
          order: 1,
          pages: [
            {
              id: "early-page",
              title: "Page",
              contentHtml: "<p>early</p>",
              order: 0,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  });

  assert.deepEqual(
    normalized.preferences.notebookDocuments.map((document) => document.id),
    ["early-doc", "late-doc"],
  );
  assert.equal(normalized.preferences.notebookDocuments[0]?.title, "Early");
});

test("normalizePreferences coerces missing or malformed notebookDocuments to []", () => {
  const missing = normalizeAppState({
    preferences: {
      notebookPages: [],
    },
  });
  assert.deepEqual(missing.preferences.notebookDocuments, []);

  const malformed = normalizeAppState({
    preferences: {
      notebookPages: [],
      notebookDocuments: { nope: true } as unknown as [],
    },
  });
  assert.deepEqual(malformed.preferences.notebookDocuments, []);
});

test("normalizePreferences migrates notebookPages to one notebookDocument per page", () => {
  const normalized = normalizeAppState({
    preferences: {
      notebookPages: [
        {
          id: "page-2",
          title: "Second",
          contentHtml: "<p>2</p>",
          order: 2,
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "page-1",
          title: "First",
          contentHtml: "<p>1</p>",
          order: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(normalized.preferences.notebookDocuments.length, 2);
  assert.deepEqual(
    normalized.preferences.notebookDocuments.map((document) => document.title),
    ["First", "Second"],
  );
});

test("normalizePreferences migration copies notebook page title/content/folder/favorite/order", () => {
  const normalized = normalizeAppState({
    preferences: {
      notebookPages: [
        {
          id: "legacy-page",
          title: "Legacy Title",
          contentHtml: "<p>legacy</p>",
          folderId: "folder-1",
          favorited: true,
          order: 7,
          createdAt: "2026-01-07T00:00:00.000Z",
          updatedAt: "2026-01-08T00:00:00.000Z",
        },
      ],
    },
  });

  const [document] = normalized.preferences.notebookDocuments;
  assert.ok(document);
  assert.equal(document?.title, "Legacy Title");
  assert.equal(document?.folderId, "folder-1");
  assert.equal(document?.favorited, true);
  assert.equal(document?.order, 7);
  assert.equal(document?.createdAt, "2026-01-07T00:00:00.000Z");
  assert.equal(document?.updatedAt, "2026-01-08T00:00:00.000Z");
  assert.equal(document?.pages.length, 1);
  assert.equal(document?.pages[0]?.id, "legacy-page");
  assert.equal(document?.pages[0]?.title, "Legacy Title");
  assert.equal(document?.pages[0]?.contentHtml, "<p>legacy</p>");
  assert.equal(document?.pages[0]?.order, 0);
  assert.equal(document?.pages[0]?.createdAt, "2026-01-07T00:00:00.000Z");
  assert.equal(document?.pages[0]?.updatedAt, "2026-01-08T00:00:00.000Z");
});

test("normalizePreferences migration does not clear notebookPages", () => {
  const normalized = normalizeAppState({
    preferences: {
      notebookPages: [
        {
          id: "page-keep",
          title: "Keep",
          contentHtml: "<p>keep</p>",
          order: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(normalized.preferences.notebookPages.length, 1);
  assert.equal(normalized.preferences.notebookPages[0]?.id, "page-keep");
  assert.equal(normalized.preferences.notebookDocuments.length, 1);
});

test("normalizePreferences keeps existing notebookDocuments instead of reseeding from notebookPages", () => {
  const normalized = normalizeAppState({
    preferences: {
      notebookDocuments: [
        {
          id: "doc-existing",
          title: "Existing Doc",
          order: 0,
          pages: [
            {
              id: "doc-page",
              title: "Doc Page",
              contentHtml: "<p>doc</p>",
              order: 0,
              createdAt: "2026-01-03T00:00:00.000Z",
              updatedAt: "2026-01-03T00:00:00.000Z",
            },
          ],
          createdAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
      ],
      notebookPages: [
        {
          id: "legacy-page",
          title: "Legacy Page",
          contentHtml: "<p>legacy</p>",
          order: 4,
          createdAt: "2026-01-04T00:00:00.000Z",
          updatedAt: "2026-01-04T00:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(normalized.preferences.notebookDocuments.length, 1);
  assert.equal(normalized.preferences.notebookDocuments[0]?.id, "doc-existing");
  assert.equal(normalized.preferences.notebookDocuments[0]?.title, "Existing Doc");
});

test("normalizePreferences notebookDocument fallback creates a default Page 1 when pages are empty or missing", () => {
  const normalized = normalizeAppState({
    preferences: {
      notebookDocuments: [
        {
          id: "doc-empty-pages",
          title: "Doc",
          pages: [],
          order: 0,
          createdAt: "2026-01-10T00:00:00.000Z",
          updatedAt: "2026-01-11T00:00:00.000Z",
        },
        {
          id: "doc-missing-pages",
          title: "Doc 2",
          order: 1,
          createdAt: "2026-01-12T00:00:00.000Z",
          updatedAt: "2026-01-13T00:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(normalized.preferences.notebookDocuments.length, 2);
  const [emptyPagesDoc, missingPagesDoc] = normalized.preferences.notebookDocuments;
  assert.ok(emptyPagesDoc);
  assert.ok(missingPagesDoc);
  assert.equal(emptyPagesDoc?.pages.length, 1);
  assert.equal(emptyPagesDoc?.pages[0]?.title, "Page 1");
  assert.equal(emptyPagesDoc?.pages[0]?.contentHtml, "");
  assert.equal(emptyPagesDoc?.pages[0]?.order, 0);
  assert.equal(missingPagesDoc?.pages.length, 1);
  assert.equal(missingPagesDoc?.pages[0]?.title, "Page 1");
});
