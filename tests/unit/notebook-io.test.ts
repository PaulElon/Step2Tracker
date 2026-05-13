import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNotebookExportFileName,
  createNotebookHtmlExport,
  createNotebookMarkdownExport,
  createNotebookTxtExport,
  parseNotebookImport,
  sanitizeNotebookFileNameSegment,
  validateNotebookImportFile,
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

function makeFile(name: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name);
}

function makeTextFile(name: string, content: string): File {
  return new File([content], name);
}

test("validateNotebookImportFile accepts .txt", async () => {
  const result = await validateNotebookImportFile(makeTextFile("notes.txt", "hello"));
  assert.deepEqual(result, { ok: true });
});

test("validateNotebookImportFile accepts .md", async () => {
  const result = await validateNotebookImportFile(makeTextFile("notes.md", "# Hello"));
  assert.deepEqual(result, { ok: true });
});

test("validateNotebookImportFile accepts .html", async () => {
  const result = await validateNotebookImportFile(makeTextFile("page.html", "<html></html>"));
  assert.deepEqual(result, { ok: true });
});

test("validateNotebookImportFile accepts .docx when bytes are a docx/zip container", async () => {
  const result = await validateNotebookImportFile(makeFile("report.docx", [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]));
  assert.deepEqual(result, { ok: true });
});

test("validateNotebookImportFile rejects invalid .docx bytes", async () => {
  const result = await validateNotebookImportFile(makeTextFile("report.docx", "not a zip container"));
  assert.equal(result.ok, false);
  assert.ok((result as { ok: false; reason: string }).reason.includes("invalid"));
});

test("validateNotebookImportFile rejects legacy .doc with a clear message", async () => {
  const result = await validateNotebookImportFile(makeTextFile("report.doc", "legacy"));
  assert.equal(result.ok, false);
  assert.ok((result as { ok: false; reason: string }).reason.includes("convert"));
});

test("validateNotebookImportFile rejects .pdf by extension", async () => {
  const result = await validateNotebookImportFile(makeTextFile("report.pdf", "fake content"));
  assert.equal(result.ok, false);
  assert.ok((result as { ok: false; reason: string }).reason.includes("PDF"));
});

test("validateNotebookImportFile rejects unknown extension", async () => {
  const result = await validateNotebookImportFile(makeTextFile("report.xyz", "data"));
  assert.equal(result.ok, false);
  assert.ok((result as { ok: false; reason: string }).reason.includes("Unsupported"));
});

test("validateNotebookImportFile rejects DOCX ZIP magic bytes even with .txt extension", async () => {
  // PK\x03\x04 — ZIP/DOCX signature
  const result = await validateNotebookImportFile(makeFile("tricks.txt", [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]));
  assert.equal(result.ok, false);
  assert.ok((result as { ok: false; reason: string }).reason.includes("binary"));
});

test("validateNotebookImportFile rejects PDF magic bytes even with .md extension", async () => {
  // %PDF
  const result = await validateNotebookImportFile(makeFile("tricks.md", [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]));
  assert.equal(result.ok, false);
});

test("validateNotebookImportFile rejects PNG magic bytes", async () => {
  const result = await validateNotebookImportFile(makeFile("img.txt", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
  assert.equal(result.ok, false);
  assert.ok((result as { ok: false; reason: string }).reason.includes("binary"));
});

test("validateNotebookImportFile rejects JPEG magic bytes", async () => {
  const result = await validateNotebookImportFile(makeFile("img.txt", [0xff, 0xd8, 0xff, 0xe0]));
  assert.equal(result.ok, false);
  assert.ok((result as { ok: false; reason: string }).reason.includes("binary"));
});
