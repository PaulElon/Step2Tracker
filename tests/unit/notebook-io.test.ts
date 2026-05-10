import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNotebookExportFileName,
  createNotebookHtmlExport,
  createNotebookMarkdownExport,
  createNotebookTxtExport,
  parseNotebookImport,
  sanitizeNotebookFileNameSegment,
} from "../../src/lib/notebook-io.ts";

test("sanitizeNotebookFileNameSegment removes dangerous characters and collapses spacing", () => {
  assert.equal(
    sanitizeNotebookFileNameSegment('  Renal / endocrine: "metabolism"?  '),
    "Renal-endocrine-metabolism",
  );
});

test("buildNotebookExportFileName uses document and page titles with the requested extension", () => {
  assert.equal(
    buildNotebookExportFileName({ title: "Step 2 CK" }, { title: "GI / liver" }, "markdown"),
    "Step-2-CK-GI-liver.md",
  );
});

test("createNotebookTxtExport keeps titles and body separated", () => {
  assert.equal(
    createNotebookTxtExport("Cardiology", "Page 1", "Murmur\n\nNext step"),
    "Cardiology\nPage 1\n\nMurmur\n\nNext step\n",
  );
});

test("createNotebookMarkdownExport keeps titles and plain body text", () => {
  assert.equal(
    createNotebookMarkdownExport("Cardiology", "Page 1", "Murmur\nNext step"),
    "# Cardiology\n\n## Page 1\n\nMurmur\nNext step\n",
  );
});

test("parseNotebookImport round-trips the notebook HTML export format", () => {
  const exported = createNotebookHtmlExport(
    "Cardiology & Renal",
    "Week 1 <focus>",
    '<p><strong>High yield</strong> exam note.</p>',
  );

  assert.deepEqual(parseNotebookImport("cardiology-week.html", exported), {
    documentTitle: "Cardiology & Renal",
    pageTitle: "Week 1 <focus>",
    contentHtml: '<p><strong>High yield</strong> exam note.</p>',
  });
});

test("parseNotebookImport reads markdown exports into a new notebook page draft", () => {
  const imported = parseNotebookImport(
    "cardiology-note.md",
    createNotebookMarkdownExport("Cardiology", "Page 2", "Line one\nLine two"),
  );

  assert.equal(imported.documentTitle, "Cardiology");
  assert.equal(imported.pageTitle, "Page 2");
  assert.equal(imported.contentHtml, "<p>Line one<br />Line two</p>");
});

test("parseNotebookImport reads plain text exports into a new notebook page draft", () => {
  const imported = parseNotebookImport("cardiology.txt", createNotebookTxtExport("Cardiology", "Page 3", "Line one"));

  assert.equal(imported.documentTitle, "Cardiology");
  assert.equal(imported.pageTitle, "Page 3");
  assert.equal(imported.contentHtml, "<p>Line one</p>");
});
