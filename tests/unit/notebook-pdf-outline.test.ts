import assert from "node:assert/strict";
import test from "node:test";

import {
  generateNotebookPdfOutline,
  type NotebookPdfOutlineTextPage,
} from "../../src/lib/notebook-pdf-outline.ts";

function line(text: string, y: number, scale: number) {
  return {
    text,
    x: 10,
    y,
    fontSize: scale,
    transformScaleY: scale,
  };
}

test("generateNotebookPdfOutline prefers larger short heading lines", () => {
  const pages: NotebookPdfOutlineTextPage[] = [
    {
      pageIndex: 0,
      items: [
        line("Introduction", 760, 18),
        line("This is paragraph body text with normal scale", 740, 10),
      ],
    },
    {
      pageIndex: 1,
      items: [
        line("Renal Physiology", 760, 17),
        line("Another body line with normal scale", 740, 10),
      ],
    },
  ];

  const outline = generateNotebookPdfOutline(pages, {
    maxPagesToScan: 8,
    maxGeneratedEntries: 10,
  });

  assert.deepEqual(outline, [
    { title: "Introduction", pageIndex: 0 },
    { title: "Renal Physiology", pageIndex: 1 },
  ]);
});

test("generateNotebookPdfOutline filters page numbers, repeated headers, and duplicates", () => {
  const pages: NotebookPdfOutlineTextPage[] = [
    {
      pageIndex: 0,
      items: [
        line("USMLE Step 2 CK Notes", 790, 18),
        line("Cardiology", 760, 17),
        line("1", 20, 17),
        line("Body text", 730, 10),
      ],
    },
    {
      pageIndex: 1,
      items: [
        line("USMLE Step 2 CK Notes", 790, 18),
        line("Cardiology", 760, 17),
        line("2", 20, 17),
        line("Body text", 730, 10),
      ],
    },
    {
      pageIndex: 2,
      items: [
        line("USMLE Step 2 CK Notes", 790, 18),
        line("Cardiology", 760, 17),
        line("3", 20, 17),
        line("Body text", 730, 10),
      ],
    },
  ];

  const outline = generateNotebookPdfOutline(pages, {
    repeatedLineMinPages: 3,
  });

  assert.deepEqual(outline, []);
});

test("generateNotebookPdfOutline obeys scan and generation caps", () => {
  const pages: NotebookPdfOutlineTextPage[] = [
    {
      pageIndex: 0,
      items: [line("Heading One", 760, 18), line("Body", 730, 10)],
    },
    {
      pageIndex: 1,
      items: [line("Heading Two", 760, 18), line("Body", 730, 10)],
    },
    {
      pageIndex: 2,
      items: [line("Heading Three", 760, 18), line("Body", 730, 10)],
    },
  ];

  const outline = generateNotebookPdfOutline(pages, {
    maxPagesToScan: 2,
    maxGeneratedEntries: 1,
  });

  assert.deepEqual(outline, [{ title: "Heading One", pageIndex: 0 }]);
});

test("generateNotebookPdfOutline ignores body-sized lines", () => {
  const pages: NotebookPdfOutlineTextPage[] = [
    {
      pageIndex: 0,
      items: [
        line("normal body text line without heading signal", 760, 10),
        line("another normal sentence", 740, 10),
      ],
    },
  ];

  const outline = generateNotebookPdfOutline(pages);
  assert.deepEqual(outline, []);
});
