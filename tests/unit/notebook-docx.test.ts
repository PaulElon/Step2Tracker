import assert from "node:assert/strict";
import test from "node:test";

import { createNotebookDocxExport, parseNotebookDocxImport } from "../../src/lib/notebook-docx.ts";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test("createNotebookDocxExport returns DOCX zip bytes", async () => {
  const bytes = await createNotebookDocxExport("Cardiology", "Page 1", "<p>Hello</p>");
  assert.ok(bytes.length > 4);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(bytes[2], 0x03);
  assert.equal(bytes[3], 0x04);
});

test("parseNotebookDocxImport reads .docx via arrayBuffer and does not touch text()", async () => {
  const bytes = await createNotebookDocxExport(
    "Renal",
    "Page 2",
    '<h3>High Yield</h3><p><strong>AKI</strong> + <em>electrolytes</em></p>',
  );

  let textWasCalled = false;
  const fakeDocxFile = {
    name: "renal.docx",
    async arrayBuffer() {
      return toArrayBuffer(bytes);
    },
    async text() {
      textWasCalled = true;
      throw new Error("text() should not be called for docx import");
    },
  } as unknown as File;

  const draft = await parseNotebookDocxImport(fakeDocxFile);
  assert.equal(textWasCalled, false);
  assert.equal(draft.documentTitle, "renal");
  assert.equal(draft.pageTitle, "Page 1");
  assert.match(draft.contentHtml, /AKI/i);
});

test("parseNotebookDocxImport rejects invalid docx bytes with a clear error", async () => {
  const fakeDocxFile = {
    name: "bad.docx",
    async arrayBuffer() {
      return new Uint8Array([0x6e, 0x6f, 0x74, 0x2d]).buffer;
    },
  } as unknown as File;

  await assert.rejects(
    async () => parseNotebookDocxImport(fakeDocxFile),
    /invalid|corrupted/i,
  );
});
