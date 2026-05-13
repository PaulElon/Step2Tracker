import assert from "node:assert/strict";
import test from "node:test";

import {
  capNotebookPdfTocPreviewEntries,
  countNotebookPdfTocEntries,
  generateNotebookPdfOutlineFromTocLines,
} from "../../src/lib/notebook-pdf-toc.ts";

test("generateNotebookPdfOutlineFromTocLines builds hierarchy from printed TOC rows", () => {
  const result = generateNotebookPdfOutlineFromTocLines(
    [
      { text: "Table of Contents", pageIndex: 4, x: 20 },
      { text: "Surgery .................. p.367", pageIndex: 4, x: 20 },
      { text: "Psychiatry ............... p.783", pageIndex: 4, x: 20 },
      { text: "27-1 Diagnosis of... .... p.784", pageIndex: 4, x: 48 },
      { text: "27-2 Psychology,... ..... p.785", pageIndex: 4, x: 48 },
      { text: "27-3 Personality... ..... p.787", pageIndex: 4, x: 48 },
      { text: "783", pageIndex: 4, x: 20 },
    ],
    {
      totalPages: 1200,
      maxGeneratedEntries: 100,
    },
  );

  assert.equal(result.isStrong, true);
  assert.equal(result.mappingMode, "approximate");
  assert.equal(typeof result.warning, "string");
  assert.deepEqual(result.entries, [
    {
      title: "Surgery",
      pageIndex: 366,
      depth: 0,
    },
    {
      title: "Psychiatry",
      pageIndex: 782,
      depth: 0,
      children: [
        { title: "27-1 Diagnosis of...", pageIndex: 783, depth: 1 },
        { title: "27-2 Psychology,...", pageIndex: 784, depth: 1 },
        { title: "27-3 Personality...", pageIndex: 786, depth: 1 },
      ],
    },
  ]);
});

test("generateNotebookPdfOutlineFromTocLines ignores non-TOC text, duplicates, and page-number-only lines", () => {
  const result = generateNotebookPdfOutlineFromTocLines(
    [
      { text: "This chapter reviews emergency airway management in detail.", pageIndex: 8, x: 24 },
      { text: "367", pageIndex: 8, x: 24 },
      { text: "Surgery p.367", pageIndex: 8, x: 24 },
      { text: "Surgery .... 367", pageIndex: 8, x: 24 },
      { text: "Psychiatry 783", pageIndex: 8, x: 24 },
    ],
    {
      totalPages: 1000,
      maxGeneratedEntries: 100,
    },
  );

  assert.equal(result.isStrong, false);
  assert.equal(result.mappingMode, "approximate");
  assert.equal(typeof result.warning, "string");
  assert.deepEqual(result.entries, [
    {
      title: "Surgery",
      pageIndex: 366,
      depth: 0,
    },
    {
      title: "Psychiatry",
      pageIndex: 782,
      depth: 0,
    },
  ]);
});

test("generateNotebookPdfOutlineFromTocLines applies deterministic safe page mapping", () => {
  const lines = [
    { text: "Preface .... p.1", pageIndex: 10, x: 20 },
    { text: "How to Use This Book .... p.2", pageIndex: 11, x: 20 },
    { text: "Core Concepts .... p.20", pageIndex: 11, x: 20 },
    { text: "Appendix .... p.9999", pageIndex: 11, x: 20 },
  ];

  const first = generateNotebookPdfOutlineFromTocLines(lines, {
    totalPages: 40,
    maxGeneratedEntries: 100,
  });
  const second = generateNotebookPdfOutlineFromTocLines(lines, {
    totalPages: 40,
    maxGeneratedEntries: 100,
  });

  assert.deepEqual(first, second);
  assert.equal(first.mappingMode, "offset");
  assert.equal(first.pageNumberOffset, 10);
  assert.equal(first.warning, undefined);
  assert.deepEqual(first.entries, [
    {
      title: "Preface",
      pageIndex: 10,
      depth: 0,
    },
    {
      title: "How to Use This Book",
      pageIndex: 11,
      depth: 0,
    },
    {
      title: "Core Concepts",
      pageIndex: 29,
      depth: 0,
    },
    {
      title: "Appendix",
      pageIndex: 39,
      depth: 0,
    },
  ]);
});

test("generateNotebookPdfOutlineFromTocLines infers direct mapping from matching scanned headings", () => {
  const result = generateNotebookPdfOutlineFromTocLines(
    [
      { text: "Table of Contents", pageIndex: 1, x: 20 },
      { text: "Introduction .... p.5", pageIndex: 1, x: 20 },
      { text: "Methods .... p.6", pageIndex: 1, x: 20 },
    ],
    {
      totalPages: 20,
      maxGeneratedEntries: 100,
      textPages: [
        {
          pageIndex: 1,
          items: [{ text: "Introduction .... p.5", x: 20, y: 760, fontSize: 12 }],
        },
        {
          pageIndex: 4,
          items: [{ text: "Introduction", x: 40, y: 760, fontSize: 18 }],
        },
        {
          pageIndex: 5,
          items: [{ text: "Methods", x: 40, y: 760, fontSize: 18 }],
        },
      ],
    },
  );

  assert.equal(result.mappingMode, "direct");
  assert.equal(result.pageNumberOffset, 0);
  assert.equal(result.warning, undefined);
  assert.deepEqual(result.entries, [
    { title: "Introduction", pageIndex: 4, depth: 0 },
    { title: "Methods", pageIndex: 5, depth: 0 },
  ]);
});

test("countNotebookPdfTocEntries counts deeply nested children", () => {
  const count = countNotebookPdfTocEntries([
    {
      title: "Root 1",
      pageIndex: 0,
      depth: 0,
      children: [
        {
          title: "Child 1",
          pageIndex: 1,
          depth: 1,
          children: [{ title: "Grandchild 1", pageIndex: 2, depth: 2 }],
        },
      ],
    },
    {
      title: "Root 2",
      pageIndex: 3,
      depth: 0,
      children: [{ title: "Child 2", pageIndex: 4, depth: 1 }],
    },
  ]);

  assert.equal(count, 5);
});

test("capNotebookPdfTocPreviewEntries preserves nesting and reports remaining entries", () => {
  const result = capNotebookPdfTocPreviewEntries(
    [
      {
        title: "Root 1",
        pageIndex: 0,
        depth: 0,
        children: [
          {
            title: "Child 1",
            pageIndex: 1,
            depth: 1,
            children: [{ title: "Grandchild 1", pageIndex: 2, depth: 2 }],
          },
        ],
      },
      {
        title: "Root 2",
        pageIndex: 3,
        depth: 0,
      },
    ],
    3,
  );

  assert.equal(result.totalCount, 4);
  assert.equal(result.shownCount, 3);
  assert.equal(result.remainingCount, 1);
  assert.deepEqual(result.entries, [
    {
      title: "Root 1",
      pageIndex: 0,
      depth: 0,
      children: [
        {
          title: "Child 1",
          pageIndex: 1,
          depth: 1,
          children: [{ title: "Grandchild 1", pageIndex: 2, depth: 2 }],
        },
      ],
    },
  ]);
});
