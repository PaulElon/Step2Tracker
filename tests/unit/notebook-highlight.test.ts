import assert from "node:assert/strict";
import test from "node:test";

import { getHighlightHtmlAttributes } from "../../src/components/tiptap-highlight";

test("getHighlightHtmlAttributes emits a readable foreground color for saved highlights", () => {
  assert.deepEqual(getHighlightHtmlAttributes({ color: "#fef08a" }), {
    "data-color": "#fef08a",
    style: "background-color: #fef08a; color: #1e293b",
  });
});

test("getHighlightHtmlAttributes leaves empty highlight color untouched", () => {
  assert.deepEqual(getHighlightHtmlAttributes({ color: null }), {});
});
