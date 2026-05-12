import html2canvas from "html2canvas";
import { PDFDocument, rgb } from "pdf-lib";
import type { RGB } from "pdf-lib";
import { embedNotebookImagesInHtml } from "./notebook-images";
import { readNotebookPdfBytes } from "./notebook-pdf";
import type { NotebookPage } from "../types/models";

const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const PDF_MARGIN = 36;
const FALLBACK_EDITOR_WIDTH = 900;

export interface NotebookPdfExportResult {
  bytes: Uint8Array;
  missingImages: string[];
  embeddedHighlights: number;
}

export async function createNotebookPdfExport(
  page: NotebookPage,
  editorElement?: HTMLElement | null,
): Promise<NotebookPdfExportResult> {
  if (page.kind === "pdf") {
    return createImportedPdfExport(page);
  }

  return createTiptapPdfExport(page, editorElement ?? null);
}

async function createImportedPdfExport(page: NotebookPage): Promise<NotebookPdfExportResult> {
  if (!page.pdfFilename) {
    throw new Error("This PDF page is missing its stored PDF file.");
  }

  const sourceBytes = await readNotebookPdfBytes(page.pdfFilename);
  const annotations = (page.pdfAnnotations ?? []).filter(
    (annotation) => annotation.kind === "highlight" && annotation.quads.length > 0,
  );

  if (annotations.length === 0) {
    return { bytes: sourceBytes, missingImages: [], embeddedHighlights: 0 };
  }

  const pdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const pages = pdf.getPages();
  let embeddedHighlights = 0;

  for (const annotation of annotations) {
    const pdfPage = pages[annotation.pageIndex];
    if (!pdfPage) {
      continue;
    }
    const color = parseHighlightColor(annotation.color);
    for (const quad of annotation.quads) {
      if (
        !Number.isFinite(quad.x) ||
        !Number.isFinite(quad.y) ||
        !Number.isFinite(quad.width) ||
        !Number.isFinite(quad.height) ||
        quad.width <= 0 ||
        quad.height <= 0
      ) {
        continue;
      }
      pdfPage.drawRectangle({
        x: quad.x,
        y: quad.y,
        width: quad.width,
        height: quad.height,
        color,
        opacity: 0.35,
        borderOpacity: 0,
      });
      embeddedHighlights += 1;
    }
  }

  return {
    bytes: await pdf.save(),
    missingImages: [],
    embeddedHighlights,
  };
}

async function createTiptapPdfExport(
  page: NotebookPage,
  editorElement: HTMLElement | null,
): Promise<NotebookPdfExportResult> {
  const preparedHtml = editorElement
    ? prepareLiveEditorHtml(editorElement)
    : prepareStoredEditorHtml(page.contentHtml);
  const embedded = await embedNotebookImagesInHtml(preparedHtml);
  const renderRoot = createRenderRoot(embedded.html, editorElement);

  try {
    document.body.appendChild(renderRoot);
    await waitForFonts();
    await waitForImages(renderRoot);

    const target = renderRoot.querySelector<HTMLElement>(".ProseMirror") ?? renderRoot;
    includeFreeformImageBounds(target);
    const highlightOverlayCount = addHighlightOverlayLayer(target);
    const canvas = await html2canvas(target, {
      backgroundColor: getCanvasBackground(editorElement),
      logging: false,
      scale: Math.min(Math.max(window.devicePixelRatio || 1, 1), 2),
      useCORS: true,
    });

    return {
      bytes: await buildPdfFromCanvas(canvas),
      missingImages: embedded.missingImages,
      embeddedHighlights: highlightOverlayCount,
    };
  } finally {
    renderRoot.remove();
  }
}

function prepareLiveEditorHtml(editorElement: HTMLElement): string {
  const clone = editorElement.cloneNode(true) as HTMLElement;
  clone.removeAttribute("contenteditable");
  clone.removeAttribute("data-placeholder");
  clone.querySelectorAll("[contenteditable]").forEach((element) => element.removeAttribute("contenteditable"));
  clone.querySelectorAll(
    [
      ".notebook-image-node__toolbar",
      ".notebook-image-node__handle",
      ".notebook-image-node__width-badge",
      ".ProseMirror-gapcursor",
    ].join(","),
  ).forEach((element) => element.remove());
  clone.querySelectorAll(".notebook-image-node--selected").forEach((element) => {
    element.classList.remove("notebook-image-node--selected");
  });
  clone.querySelectorAll(".ProseMirror-selectednode").forEach((element) => {
    element.classList.remove("ProseMirror-selectednode");
  });
  return clone.innerHTML.trim() || "<p></p>";
}

function prepareStoredEditorHtml(contentHtml: string): string {
  const template = document.createElement("template");
  template.innerHTML = contentHtml.trim() || "<p></p>";
  decorateStoredImages(template.content);
  return template.innerHTML.trim() || "<p></p>";
}

function decorateStoredImages(root: DocumentFragment) {
  root.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    if (image.closest(".notebook-image-node")) {
      return;
    }
    const align = image.getAttribute("data-align") || "inline";
    const isFree = image.getAttribute("data-position-mode") === "free";
    const wrapper = document.createElement("span");
    wrapper.className = [
      "notebook-image-node",
      isFree ? "notebook-image-node--free" : `notebook-image-node--align-${align}`,
    ].join(" ");
    if (isFree) {
      const x = parseFiniteNumber(image.getAttribute("data-x")) ?? 0;
      const y = parseFiniteNumber(image.getAttribute("data-y")) ?? 0;
      wrapper.setAttribute("style", `position:absolute;left:${x}px;top:${y}px;margin:0;`);
    }
    const inner = document.createElement("span");
    inner.className = "notebook-image-node__inner";
    image.replaceWith(wrapper);
    inner.appendChild(image);
    wrapper.appendChild(inner);
  });
}

function createRenderRoot(html: string, editorElement: HTMLElement | null): HTMLDivElement {
  const width = getExportWidth(editorElement);
  const root = document.createElement("div");
  root.className = "notebook-pdf-export-root notebook-editor-shell tiptap-editor tiptap-editor--pageless";
  root.style.position = "fixed";
  root.style.left = "-100000px";
  root.style.top = "0";
  root.style.width = `${width}px`;
  root.style.pointerEvents = "none";
  root.style.zIndex = "-1";

  const computed = editorElement ? window.getComputedStyle(editorElement) : null;
  if (computed?.color) {
    root.style.color = computed.color;
  }

  const style = document.createElement("style");
  style.textContent = `
    .notebook-pdf-export-root .ProseMirror mark[data-color] {
      background-color: transparent !important;
      color: inherit !important;
    }
  `;

  root.innerHTML = [
    '<div class="tiptap-editor__content">',
    `<div class="ProseMirror notebook-tiptap-prosemirror" style="position:relative;width:${width}px;max-width:none;min-height:1px;">`,
    html,
    "</div>",
    "</div>",
  ].join("");
  root.prepend(style);
  return root;
}

interface HighlightOverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
}

function addHighlightOverlayLayer(target: HTMLElement): number {
  const rects = collectHighlightOverlayRects(target);
  if (rects.length === 0) {
    return 0;
  }

  const overlayLayer = document.createElement("div");
  overlayLayer.setAttribute("aria-hidden", "true");
  overlayLayer.style.position = "absolute";
  overlayLayer.style.inset = "0";
  overlayLayer.style.pointerEvents = "none";

  for (const rect of rects) {
    const highlight = document.createElement("div");
    highlight.style.position = "absolute";
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    highlight.style.backgroundColor = rect.color;
    highlight.style.opacity = "1";
    highlight.style.borderRadius = "1px";
    overlayLayer.appendChild(highlight);
  }

  target.prepend(overlayLayer);
  return rects.length;
}

function collectHighlightOverlayRects(target: HTMLElement): HighlightOverlayRect[] {
  const targetRect = target.getBoundingClientRect();
  const rects: HighlightOverlayRect[] = [];

  target.querySelectorAll<HTMLElement>("mark[data-color]").forEach((mark) => {
    const color = getHighlightColor(mark);
    if (!color) {
      return;
    }

    Array.from(mark.getClientRects()).forEach((clientRect) => {
      if (clientRect.width <= 0 || clientRect.height <= 0) {
        return;
      }

      rects.push({
        left: clientRect.left - targetRect.left,
        top: clientRect.top - targetRect.top,
        width: clientRect.width,
        height: clientRect.height,
        color,
      });
    });
  });

  return rects;
}

function getHighlightColor(mark: HTMLElement): string | null {
  const color =
    mark.getAttribute("data-color")?.trim() ||
    mark.style.backgroundColor.trim() ||
    window.getComputedStyle(mark).backgroundColor.trim();
  if (
    !color ||
    color === "transparent" ||
    color === "rgba(0, 0, 0, 0)" ||
    color.endsWith(", 0)")
  ) {
    return null;
  }
  return color;
}

async function buildPdfFromCanvas(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const contentWidth = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
  const contentHeight = PDF_PAGE_HEIGHT - PDF_MARGIN * 2;
  const pageSliceHeight = Math.max(1, Math.floor((contentHeight / contentWidth) * canvas.width));
  const sliceCanvas = document.createElement("canvas");
  const context = sliceCanvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context unavailable.");
  }

  for (let offsetY = 0; offsetY < canvas.height; offsetY += pageSliceHeight) {
    const sliceHeight = Math.min(pageSliceHeight, canvas.height - offsetY);
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceHeight;
    context.clearRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    context.drawImage(
      canvas,
      0,
      offsetY,
      canvas.width,
      sliceHeight,
      0,
      0,
      canvas.width,
      sliceHeight,
    );
    const imageBytes = dataUrlToBytes(sliceCanvas.toDataURL("image/png"));
    const image = await pdf.embedPng(imageBytes);
    const imageHeight = (sliceHeight / canvas.width) * contentWidth;
    const page = pdf.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
    page.drawImage(image, {
      x: PDF_MARGIN,
      y: PDF_PAGE_HEIGHT - PDF_MARGIN - imageHeight,
      width: contentWidth,
      height: imageHeight,
    });
  }

  if (pdf.getPageCount() === 0) {
    pdf.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
  }

  return pdf.save();
}

function getExportWidth(editorElement: HTMLElement | null): number {
  const rectWidth = editorElement?.getBoundingClientRect().width ?? 0;
  const clientWidth = editorElement?.clientWidth ?? 0;
  const width = Math.max(rectWidth, clientWidth);
  return Math.round(width > 0 ? width : FALLBACK_EDITOR_WIDTH);
}

function getCanvasBackground(editorElement: HTMLElement | null): string {
  const candidates = [
    editorElement,
    editorElement?.closest<HTMLElement>(".notebook-editor-shell"),
    editorElement?.closest<HTMLElement>(".glass-panel"),
  ].filter(Boolean) as HTMLElement[];

  for (const element of candidates) {
    const color = window.getComputedStyle(element).backgroundColor;
    if (
      color &&
      color !== "transparent" &&
      color !== "rgba(0, 0, 0, 0)" &&
      !color.endsWith(", 0)")
    ) {
      return color;
    }
  }

  return "#ffffff";
}

function includeFreeformImageBounds(target: HTMLElement) {
  let maxBottom = target.scrollHeight;
  target.querySelectorAll<HTMLElement>(".notebook-image-node--free, img[data-position-mode='free']").forEach((element) => {
    const bottom = element.offsetTop + element.offsetHeight;
    if (Number.isFinite(bottom)) {
      maxBottom = Math.max(maxBottom, bottom + 24);
    }
  });
  if (maxBottom > target.scrollHeight) {
    target.style.minHeight = `${Math.ceil(maxBottom)}px`;
  }
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parseHighlightColor(value: string): RGB {
  const normalized = value.trim();
  const match = normalized.match(/^#?([0-9a-f]{6})$/i);
  if (!match) {
    return rgb(0.99, 0.88, 0.28);
  }
  const raw = match[1];
  const red = Number.parseInt(raw.slice(0, 2), 16) / 255;
  const green = Number.parseInt(raw.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(raw.slice(4, 6), 16) / 255;
  return rgb(red, green, blue);
}

function parseFiniteNumber(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

async function waitForFonts() {
  const fonts = "fonts" in document ? document.fonts : undefined;
  if (fonts) {
    await fonts.ready.catch(() => undefined);
  }
}

async function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          image.onload = () => resolve();
          image.onerror = () => resolve();
        }),
    ),
  );
}
