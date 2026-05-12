import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PageViewport, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { readNotebookPdfBytes } from "../lib/notebook-pdf";
import type { PdfAnnotation, PdfAnnotationQuad, PdfOutlineItem, PdfViewMode } from "../types/models";

if (typeof pdfjs.GlobalWorkerOptions.workerSrc !== "string" || !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;
const DEFAULT_ZOOM_INDEX = 2; // 1.0
const MAX_SNIPPET_LENGTH = 500;
const MANUAL_OUTLINE_TITLE_MAX_LENGTH = 80;
const EMBEDDED_OUTLINE_TITLE_MAX_LENGTH = 160;
const OUTLINE_MAX_DEPTH = 12;

const HIGHLIGHT_COLORS = [
  { id: "yellow", value: "#fde047", label: "Yellow" },
  { id: "green", value: "#86efac", label: "Green" },
  { id: "cyan", value: "#67e8f9", label: "Cyan" },
  { id: "pink", value: "#f9a8d4", label: "Pink" },
  { id: "orange", value: "#fdba74", label: "Orange" },
] as const;

const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].value;
const EMPTY_OUTLINE: PdfOutlineItem[] = [];

export interface NotebookPdfViewerProps {
  filename: string;
  originalName?: string;
  className?: string;
  onPageCount?: (count: number) => void;
  annotations?: PdfAnnotation[];
  onAddAnnotation?: (annotation: PdfAnnotation) => void;
  onDeleteAnnotation?: (annotationId: string) => void;
  viewMode?: PdfViewMode;
  onChangeViewMode?: (next: PdfViewMode) => void;
  outline?: PdfOutlineItem[];
  onChangeOutline?: (next: PdfOutlineItem[]) => void;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; doc: PDFDocumentProxy }
  | { kind: "error"; message: string };

interface PdfRefProxy {
  num: number;
  gen: number;
}

interface PageInfo {
  pageIndex: number;
  viewport: PageViewport;
  textLayerEl: HTMLDivElement;
  containerEl: HTMLDivElement;
}

function createHighlightId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `nb-pdf-hl-${crypto.randomUUID()}`;
  }
  return `nb-pdf-hl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createOutlineId(source: PdfOutlineItem["source"]): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `nb-pdf-outline-${source}-${crypto.randomUUID()}`;
  }
  return `nb-pdf-outline-${source}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeOutlineTitle(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function quadToViewportRect(quad: PdfAnnotationQuad, viewport: PageViewport) {
  const rect = viewport.convertToViewportRectangle([
    quad.x,
    quad.y,
    quad.x + quad.width,
    quad.y + quad.height,
  ]);
  const x1 = Number(rect[0]);
  const y1 = Number(rect[1]);
  const x2 = Number(rect[2]);
  const y2 = Number(rect[3]);
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const right = Math.max(x1, x2);
  const bottom = Math.max(y1, y2);
  return { left, top, width: right - left, height: bottom - top };
}

function isRefProxy(value: unknown): value is PdfRefProxy {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PdfRefProxy>;
  return Number.isInteger(candidate.num) && Number.isInteger(candidate.gen);
}

function getDestinationTop(dest: unknown[]): number | undefined {
  const mode = dest[1];
  const modeName =
    mode && typeof mode === "object" && "name" in mode && typeof mode.name === "string"
      ? mode.name
      : "";
  const rawTop =
    modeName === "XYZ"
      ? dest[3]
      : modeName === "FitH" || modeName === "FitBH"
        ? dest[2]
        : modeName === "FitR"
          ? dest[5]
          : undefined;
  const top = typeof rawTop === "string" ? Number(rawTop.trim()) : Number(rawTop);
  return Number.isFinite(top) ? top : undefined;
}

async function resolvePdfDestination(
  pdfDoc: PDFDocumentProxy,
  rawDest: unknown,
): Promise<{ pageIndex: number; y?: number } | null> {
  let dest = rawDest;
  if (typeof dest === "string") {
    dest = await pdfDoc.getDestination(dest).catch(() => null);
  }
  if (!Array.isArray(dest) || dest.length === 0) {
    return null;
  }

  const target = dest[0];
  let pageIndex = Number.NaN;
  if (typeof target === "number" && Number.isFinite(target)) {
    pageIndex = Math.trunc(target);
  } else if (isRefProxy(target)) {
    pageIndex = await pdfDoc.getPageIndex(target).catch(() => Number.NaN);
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdfDoc.numPages) {
    return null;
  }
  const top = getDestinationTop(dest);
  return Number.isFinite(top) ? { pageIndex, y: top } : { pageIndex };
}

interface PdfJsOutlineNode {
  title?: unknown;
  dest?: unknown;
  items?: PdfJsOutlineNode[];
}

async function extractEmbeddedOutline(pdfDoc: PDFDocumentProxy): Promise<PdfOutlineItem[]> {
  const outline = await pdfDoc.getOutline().catch(() => null);
  if (!Array.isArray(outline) || outline.length === 0) {
    return [];
  }

  async function walk(nodes: PdfJsOutlineNode[], depth: number, path: string): Promise<PdfOutlineItem[]> {
    if (depth > OUTLINE_MAX_DEPTH) {
      return [];
    }
    const result: PdfOutlineItem[] = [];
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const nodePath = path ? `${path}-${index}` : String(index);
      const title = normalizeOutlineTitle(node.title, EMBEDDED_OUTLINE_TITLE_MAX_LENGTH);
      const childrenRaw = Array.isArray(node.items) ? node.items : [];
      const resolved = title ? await resolvePdfDestination(pdfDoc, node.dest) : null;
      if (!resolved) {
        if (childrenRaw.length > 0) {
          result.push(...(await walk(childrenRaw, depth, nodePath)));
        }
        continue;
      }
      const item: PdfOutlineItem = {
        id: `nb-pdf-outline-embedded-${nodePath}-${resolved.pageIndex}`,
        title,
        pageIndex: resolved.pageIndex,
        depth,
        source: "embedded",
      };
      if (resolved.y !== undefined) {
        item.y = resolved.y;
      }
      if (childrenRaw.length > 0) {
        const children = await walk(childrenRaw, depth + 1, nodePath);
        if (children.length > 0) {
          item.children = children;
        }
      }
      result.push(item);
    }
    return result;
  }

  return walk(outline as PdfJsOutlineNode[], 0, "");
}

function buildAnnotationFromSelection(
  selection: Selection,
  pageInfo: PageInfo,
  color: string,
): PdfAnnotation | null {
  const containerRect = pageInfo.textLayerEl.getBoundingClientRect();
  const viewport = pageInfo.viewport;
  const quads: PdfAnnotationQuad[] = [];
  let snippet = "";
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    const node = range.commonAncestorContainer;
    if (!node || !pageInfo.textLayerEl.contains(node)) {
      continue;
    }
    snippet += range.toString();
    const clientRects = range.getClientRects();
    for (let r = 0; r < clientRects.length; r += 1) {
      const rect = clientRects[r];
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      const x1 = rect.left - containerRect.left;
      const y1 = rect.top - containerRect.top;
      const x2 = rect.right - containerRect.left;
      const y2 = rect.bottom - containerRect.top;
      const [pdfX1, pdfY1] = viewport.convertToPdfPoint(x1, y1);
      const [pdfX2, pdfY2] = viewport.convertToPdfPoint(x2, y2);
      if (
        !Number.isFinite(pdfX1) ||
        !Number.isFinite(pdfY1) ||
        !Number.isFinite(pdfX2) ||
        !Number.isFinite(pdfY2)
      ) {
        continue;
      }
      const minX = Math.min(pdfX1, pdfX2);
      const minY = Math.min(pdfY1, pdfY2);
      const width = Math.abs(pdfX2 - pdfX1);
      const height = Math.abs(pdfY2 - pdfY1);
      if (width <= 0 || height <= 0) {
        continue;
      }
      quads.push({ x: minX, y: minY, width, height });
    }
  }
  if (quads.length === 0) {
    return null;
  }
  const now = new Date().toISOString();
  const annotation: PdfAnnotation = {
    id: createHighlightId(),
    kind: "highlight",
    pageIndex: pageInfo.pageIndex,
    color,
    quads,
    createdAt: now,
    updatedAt: now,
  };
  const trimmedSnippet = snippet.trim();
  if (trimmedSnippet.length > 0) {
    annotation.textSnippet = trimmedSnippet.slice(0, MAX_SNIPPET_LENGTH);
  }
  return annotation;
}

function buildManualOutlineFromSelection(
  selection: Selection,
  pageInfo: PageInfo,
): PdfOutlineItem | null {
  const title = normalizeOutlineTitle(selection.toString(), MANUAL_OUTLINE_TITLE_MAX_LENGTH);
  if (!title || selection.rangeCount === 0) {
    return null;
  }
  const item: PdfOutlineItem = {
    id: createOutlineId("manual"),
    title,
    pageIndex: pageInfo.pageIndex,
    source: "manual",
  };

  const containerRect = pageInfo.textLayerEl.getBoundingClientRect();
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    const node = range.commonAncestorContainer;
    if (!node || !pageInfo.textLayerEl.contains(node)) {
      continue;
    }
    const firstRect = Array.from(range.getClientRects()).find(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    if (!firstRect) {
      continue;
    }
    const viewportY = firstRect.top - containerRect.top;
    const [, pdfY] = pageInfo.viewport.convertToPdfPoint(0, viewportY);
    if (Number.isFinite(pdfY)) {
      item.y = pdfY;
    }
    break;
  }

  return item;
}

function findPageElement(node: Node | null): HTMLElement | null {
  if (!node) {
    return null;
  }
  let element: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  while (element) {
    if (element.dataset && element.dataset.pdfPageIndex !== undefined) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}

function countOutlineItems(items: PdfOutlineItem[], source?: PdfOutlineItem["source"]): number {
  return items.reduce((total, item) => {
    const ownCount = source === undefined || item.source === source ? 1 : 0;
    return total + ownCount + countOutlineItems(item.children ?? [], source);
  }, 0);
}

function outlineHasSource(items: PdfOutlineItem[], source: PdfOutlineItem["source"]): boolean {
  return items.some(
    (item) => item.source === source || outlineHasSource(item.children ?? [], source),
  );
}

function getOutlineFingerprint(items: PdfOutlineItem[]): string {
  return JSON.stringify(
    items.map((item) => ({
      id: item.id,
      title: item.title,
      pageIndex: item.pageIndex,
      y: item.y,
      depth: item.depth,
      source: item.source,
      children: item.children ? JSON.parse(getOutlineFingerprint(item.children)) : undefined,
    })),
  );
}

function removeOutlineItem(items: PdfOutlineItem[], itemId: string): PdfOutlineItem[] {
  return items
    .filter((item) => item.id !== itemId)
    .map((item) => {
      const children = item.children ? removeOutlineItem(item.children, itemId) : [];
      if (children.length === 0) {
        const withoutChildren = { ...item };
        delete withoutChildren.children;
        return withoutChildren;
      }
      return { ...item, children };
    });
}

function findOutlineItem(items: PdfOutlineItem[], itemId: string): PdfOutlineItem | null {
  for (const item of items) {
    if (item.id === itemId) {
      return item;
    }
    const child = findOutlineItem(item.children ?? [], itemId);
    if (child) {
      return child;
    }
  }
  return null;
}

interface PdfRenderedPageProps {
  doc: PDFDocumentProxy;
  pageIndex: number;
  zoom: number;
  annotations: PdfAnnotation[];
  onDeleteHighlight: (annotationId: string) => void;
  registerInfo: (pageIndex: number, info: PageInfo | null) => void;
  onRendered?: (pageIndex: number) => void;
  ariaLabel: string;
}

function PdfRenderedPage({
  doc,
  pageIndex,
  zoom,
  annotations,
  onDeleteHighlight,
  registerInfo,
  onRendered,
  ariaLabel,
}: PdfRenderedPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderTokenRef = useRef(0);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textLayer = textLayerRef.current;
    if (!canvas) {
      return;
    }
    const token = ++renderTokenRef.current;
    let activePage: PDFPageProxy | null = null;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;
    let textLayerInstance: pdfjs.TextLayer | null = null;

    (async () => {
      try {
        const page = await doc.getPage(pageIndex + 1);
        if (token !== renderTokenRef.current) {
          page.cleanup();
          return;
        }
        activePage = page;
        const dpr = window.devicePixelRatio || 1;
        const renderViewport = page.getViewport({ scale: zoom * dpr });
        const cssViewport = page.getViewport({ scale: zoom });
        const cssWidth = Math.floor(cssViewport.width);
        const cssHeight = Math.floor(cssViewport.height);
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvas 2D context unavailable.");
        }
        context.clearRect(0, 0, canvas.width, canvas.height);
        renderTask = page.render({ canvasContext: context, viewport: renderViewport });
        await renderTask.promise;
        if (token !== renderTokenRef.current) {
          return;
        }
        setRenderError(null);
        setDims({ width: cssWidth, height: cssHeight });
        setViewport(cssViewport);

        if (textLayer) {
          textLayer.replaceChildren();
          textLayer.style.width = `${cssWidth}px`;
          textLayer.style.height = `${cssHeight}px`;
          textLayer.style.setProperty("--scale-factor", String(cssViewport.scale));
          try {
            const textContent = await page.getTextContent();
            if (token !== renderTokenRef.current) {
              return;
            }
            textLayerInstance = new pdfjs.TextLayer({
              textContentSource: textContent,
              container: textLayer,
              viewport: cssViewport,
            });
            await textLayerInstance.render();
          } catch {
            // Text layer is optional; ignore failures.
          }
        }
        if (token !== renderTokenRef.current) {
          return;
        }
        onRendered?.(pageIndex);
      } catch (error) {
        if (token !== renderTokenRef.current) {
          return;
        }
        if (error instanceof Error && error.name === "RenderingCancelledException") {
          return;
        }
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Unable to render this PDF page.";
        setRenderError(message);
      } finally {
        if (token === renderTokenRef.current) {
          activePage?.cleanup();
        }
      }
    })();

    return () => {
      renderTask?.cancel();
      try {
        textLayerInstance?.cancel();
      } catch {
        // ignore
      }
    };
    // onRendered is informational only; intentionally excluded from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageIndex, zoom]);

  useEffect(() => {
    const container = containerRef.current;
    const textLayer = textLayerRef.current;
    if (!container || !textLayer || !viewport) {
      return;
    }
    const info: PageInfo = {
      pageIndex,
      viewport,
      textLayerEl: textLayer,
      containerEl: container,
    };
    registerInfo(pageIndex, info);
    return () => {
      registerInfo(pageIndex, null);
    };
  }, [pageIndex, registerInfo, viewport]);

  const pageAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.pageIndex === pageIndex),
    [annotations, pageIndex],
  );

  return (
    <div
      ref={containerRef}
      className="notebook-pdf-page-stack relative inline-block rounded-[8px] bg-white shadow-sm"
      style={dims ? { width: `${dims.width}px`, height: `${dims.height}px` } : undefined}
      data-pdf-page-index={pageIndex}
    >
      <canvas ref={canvasRef} className="notebook-pdf-canvas block" aria-label={ariaLabel} />
      <div ref={textLayerRef} className="notebook-pdf-text-layer" aria-hidden="true" />
      {viewport && pageAnnotations.length > 0 ? (
        <div className="notebook-pdf-annotation-layer" aria-hidden="false">
          {pageAnnotations.flatMap((annotation) =>
            annotation.quads.map((quad, quadIndex) => {
              const rect = quadToViewportRect(quad, viewport);
              return (
                <button
                  key={`${annotation.id}-${quadIndex}`}
                  type="button"
                  className="notebook-pdf-highlight"
                  style={{
                    left: `${rect.left}px`,
                    top: `${rect.top}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`,
                    backgroundColor: annotation.color,
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteHighlight(annotation.id);
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                  aria-label={
                    annotation.textSnippet
                      ? `Delete highlight: ${annotation.textSnippet}`
                      : "Delete highlight"
                  }
                  title={annotation.textSnippet ?? "Click to delete highlight"}
                />
              );
            }),
          )}
        </div>
      ) : null}
      {renderError ? (
        <div className="notebook-pdf-page-error">{renderError}</div>
      ) : null}
    </div>
  );
}

export function NotebookPdfViewer({
  filename,
  originalName,
  className,
  onPageCount,
  annotations,
  onAddAnnotation,
  onDeleteAnnotation,
  viewMode: viewModeProp,
  onChangeViewMode,
  outline,
  onChangeOutline,
}: NotebookPdfViewerProps) {
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [pageNumber, setPageNumber] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [internalViewMode, setInternalViewMode] = useState<PdfViewMode>("horizontal");
  const [isOutlineOpen, setIsOutlineOpen] = useState(true);
  const [outlineStatus, setOutlineStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [highlightMode, setHighlightMode] = useState(false);
  const [currentColor, setCurrentColor] = useState<string>(DEFAULT_HIGHLIGHT_COLOR);
  const [isColorMenuOpen, setIsColorMenuOpen] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [selectionPageIndex, setSelectionPageIndex] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pageInfosRef = useRef<Map<number, PageInfo>>(new Map());
  const colorMenuRef = useRef<HTMLDivElement | null>(null);
  const colorButtonRef = useRef<HTMLButtonElement | null>(null);
  const outlineRef = useRef<PdfOutlineItem[]>(outline ?? EMPTY_OUTLINE);
  const onChangeOutlineRef = useRef(onChangeOutline);

  const viewMode = viewModeProp ?? internalViewMode;
  const outlineItems = outline ?? EMPTY_OUTLINE;
  const readyDoc = load.kind === "ready" ? load.doc : null;
  const setViewMode = useCallback(
    (next: PdfViewMode) => {
      if (onChangeViewMode) {
        onChangeViewMode(next);
      } else {
        setInternalViewMode(next);
      }
    },
    [onChangeViewMode],
  );

  useEffect(() => {
    outlineRef.current = outline ?? EMPTY_OUTLINE;
  }, [outline]);

  useEffect(() => {
    onChangeOutlineRef.current = onChangeOutline;
  }, [onChangeOutline]);

  // Document load.
  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    setPageNumber(1);
    setHasSelection(false);
    setSelectionPageIndex(null);
    setHint(null);
    setOutlineStatus("idle");
    setOutlineError(null);
    pageInfosRef.current.clear();

    (async () => {
      try {
        const bytes = await readNotebookPdfBytes(filename);
        if (cancelled) {
          return;
        }
        const loadingTask = pdfjs.getDocument({ data: bytes });
        const doc = await loadingTask.promise;
        if (cancelled) {
          await doc.destroy().catch(() => undefined);
          return;
        }
        setLoad({ kind: "ready", doc });
        onPageCount?.(doc.numPages);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Unable to load this PDF.";
        setLoad({ kind: "error", message });
      }
    })();

    return () => {
      cancelled = true;
    };
    // onPageCount intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename]);

  // Destroy document on unmount or replace.
  useEffect(() => {
    return () => {
      if (load.kind === "ready") {
        load.doc.destroy().catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.kind === "ready" ? load.doc : null]);

  useEffect(() => {
    if (!readyDoc) {
      return;
    }
    if (outlineHasSource(outlineRef.current ?? [], "embedded")) {
      setOutlineStatus("ready");
      setOutlineError(null);
      return;
    }
    let cancelled = false;
    setOutlineStatus("loading");
    setOutlineError(null);

    (async () => {
      try {
        const embeddedOutline = await extractEmbeddedOutline(readyDoc);
        if (cancelled) {
          return;
        }
        setOutlineStatus("ready");
        if (embeddedOutline.length === 0) {
          return;
        }
        const changeOutline = onChangeOutlineRef.current;
        if (!changeOutline) {
          return;
        }
        const existingOutline = outlineRef.current ?? [];
        if (outlineHasSource(existingOutline, "embedded")) {
          return;
        }
        const manualOutline = existingOutline.filter((item) => item.source === "manual");
        const nextOutline = [...embeddedOutline, ...manualOutline];
        if (getOutlineFingerprint(existingOutline) !== getOutlineFingerprint(nextOutline)) {
          changeOutline(nextOutline);
        }
      } catch {
        if (!cancelled) {
          setOutlineStatus("error");
          setOutlineError("Unable to read PDF bookmarks.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [readyDoc]);

  const numPages = load.kind === "ready" ? load.doc.numPages : 0;
  const zoom = ZOOM_LEVELS[zoomIndex];

  const registerInfo = useCallback((pageIndex: number, info: PageInfo | null) => {
    if (info) {
      pageInfosRef.current.set(pageIndex, info);
    } else {
      pageInfosRef.current.delete(pageIndex);
    }
  }, []);

  // Watch selection state for the manual Highlight button enable/disable.
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setHasSelection(false);
        setSelectionPageIndex(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const pageEl = findPageElement(range.commonAncestorContainer);
      if (!pageEl) {
        setHasSelection(false);
        setSelectionPageIndex(null);
        return;
      }
      const pageIndex = Number(pageEl.dataset.pdfPageIndex);
      if (!Number.isInteger(pageIndex)) {
        setHasSelection(false);
        setSelectionPageIndex(null);
        return;
      }
      setHasSelection(true);
      setSelectionPageIndex(pageIndex);
      setHint(null);
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);

  const createHighlightFromCurrentSelection = useCallback(
    (color: string): boolean => {
      if (!onAddAnnotation) {
        return false;
      }
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return false;
      }
      const range = selection.getRangeAt(0);
      const pageEl = findPageElement(range.commonAncestorContainer);
      if (!pageEl) {
        return false;
      }
      const pageIndex = Number(pageEl.dataset.pdfPageIndex);
      if (!Number.isInteger(pageIndex)) {
        return false;
      }
      const info = pageInfosRef.current.get(pageIndex);
      if (!info) {
        return false;
      }
      const annotation = buildAnnotationFromSelection(selection, info, color);
      if (!annotation) {
        return false;
      }
      selection.removeAllRanges();
      setHasSelection(false);
      setSelectionPageIndex(null);
      onAddAnnotation(annotation);
      return true;
    },
    [onAddAnnotation],
  );

  // Auto-highlight on mouseup while highlight mode is ON.
  useEffect(() => {
    if (!highlightMode || !onAddAnnotation) {
      return;
    }
    const viewportEl = viewportRef.current;
    if (!viewportEl) {
      return;
    }
    function onPointerUp(event: PointerEvent) {
      const target = event.target as Element | null;
      // Skip if the pointerup lands on a highlight overlay button (delete) or any toolbar control.
      if (target && target.closest('.notebook-pdf-highlight, [data-pdf-no-autohighlight]')) {
        return;
      }
      // Defer so the selection state is finalized.
      window.setTimeout(() => {
        createHighlightFromCurrentSelection(currentColor);
      }, 0);
    }
    viewportEl.addEventListener("pointerup", onPointerUp);
    return () => {
      viewportEl.removeEventListener("pointerup", onPointerUp);
    };
  }, [highlightMode, currentColor, createHighlightFromCurrentSelection, onAddAnnotation]);

  // Close color menu when clicking outside.
  useEffect(() => {
    if (!isColorMenuOpen) {
      return;
    }
    function onDocClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (
        colorMenuRef.current?.contains(target) ||
        colorButtonRef.current?.contains(target)
      ) {
        return;
      }
      setIsColorMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsColorMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [isColorMenuOpen]);

  const goToPage = useCallback(
    (next: number, y?: number) => {
      if (load.kind !== "ready") {
        return;
      }
      const clamped = Math.max(1, Math.min(next, load.doc.numPages));
      setPageNumber(clamped);
      if (viewMode === "vertical") {
        const scrollEl = viewportRef.current;
        const scrollToPage = () => {
          const info = pageInfosRef.current.get(clamped - 1);
          if (!info || !scrollEl) {
            return false;
          }
          const elTop = info.containerEl.offsetTop;
          let nextTop = elTop - 12;
          if (Number.isFinite(y)) {
            const [, viewportY] = info.viewport.convertToViewportPoint(0, y as number);
            if (Number.isFinite(viewportY)) {
              nextTop += viewportY;
            }
          }
          scrollEl.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
          return true;
        };
        if (!scrollToPage()) {
          window.setTimeout(scrollToPage, 80);
        }
      }
    },
    [load, viewMode],
  );

  // Track current page in vertical mode via IntersectionObserver.
  useEffect(() => {
    if (viewMode !== "vertical" || load.kind !== "ready") {
      return;
    }
    const scrollEl = viewportRef.current;
    if (!scrollEl) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        let best: { pageIndex: number; ratio: number } | null = null;
        for (const entry of entries) {
          const idAttr = (entry.target as HTMLElement).dataset.pdfPageIndex;
          const pageIndex = idAttr === undefined ? Number.NaN : Number(idAttr);
          if (!Number.isInteger(pageIndex)) {
            continue;
          }
          if (!best || entry.intersectionRatio > best.ratio) {
            best = { pageIndex, ratio: entry.intersectionRatio };
          }
        }
        if (best && best.ratio > 0) {
          setPageNumber(best.pageIndex + 1);
        }
      },
      { root: scrollEl, threshold: [0.1, 0.25, 0.5, 0.75, 1] },
    );
    // Observe whatever pages currently exist; the observer is shared as new pages mount.
    const observed = new Set<HTMLElement>();
    const scan = () => {
      const els = scrollEl.querySelectorAll<HTMLElement>("[data-pdf-page-index]");
      els.forEach((el) => {
        if (!observed.has(el)) {
          observer.observe(el);
          observed.add(el);
        }
      });
    };
    scan();
    const mutationObserver = new MutationObserver(scan);
    mutationObserver.observe(scrollEl, { childList: true, subtree: true });
    return () => {
      mutationObserver.disconnect();
      observer.disconnect();
    };
  }, [viewMode, load]);

  const handleManualHighlight = useCallback(() => {
    if (!onAddAnnotation) {
      return;
    }
    const ok = createHighlightFromCurrentSelection(currentColor);
    if (!ok) {
      setHint("Select PDF text first.");
    }
  }, [createHighlightFromCurrentSelection, currentColor, onAddAnnotation]);

  const handleAddOutlineFromSelection = useCallback(() => {
    const changeOutline = onChangeOutlineRef.current;
    if (!changeOutline) {
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setHint("Select PDF text first.");
      return;
    }
    const range = selection.getRangeAt(0);
    const pageEl = findPageElement(range.commonAncestorContainer);
    if (!pageEl) {
      setHint("Select PDF text first.");
      return;
    }
    const pageIndex = Number(pageEl.dataset.pdfPageIndex);
    if (!Number.isInteger(pageIndex)) {
      setHint("Select PDF text first.");
      return;
    }
    const info = pageInfosRef.current.get(pageIndex);
    if (!info) {
      setHint("Select PDF text first.");
      return;
    }
    const outlineItem = buildManualOutlineFromSelection(selection, info);
    if (!outlineItem) {
      setHint("Select PDF text first.");
      return;
    }
    const nextOutline = [...(outlineRef.current ?? []), outlineItem];
    selection.removeAllRanges();
    setHasSelection(false);
    setSelectionPageIndex(null);
    setHint(`Added outline entry on page ${outlineItem.pageIndex + 1}.`);
    changeOutline(nextOutline);
  }, []);

  const handleDeleteOutlineItem = useCallback((itemId: string) => {
    const existingOutline = outlineRef.current ?? [];
    const target = findOutlineItem(existingOutline, itemId);
    if (target?.source !== "manual") {
      return;
    }
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      if (!window.confirm("Delete this outline entry?")) {
        return;
      }
    }
    const changeOutline = onChangeOutlineRef.current;
    if (!changeOutline) {
      return;
    }
    const nextOutline = removeOutlineItem(existingOutline, itemId);
    if (getOutlineFingerprint(existingOutline) !== getOutlineFingerprint(nextOutline)) {
      changeOutline(nextOutline);
    }
  }, []);

  const handleGoToOutlineItem = useCallback(
    (item: PdfOutlineItem) => {
      goToPage(item.pageIndex + 1, item.y);
      window.setTimeout(() => {
        viewportRef.current?.focus({ preventScroll: true });
      }, 0);
    },
    [goToPage],
  );

  const handleDeleteHighlight = useCallback(
    (annotationId: string) => {
      if (!onDeleteAnnotation) {
        return;
      }
      if (typeof window !== "undefined" && typeof window.confirm === "function") {
        if (!window.confirm("Delete this highlight?")) {
          return;
        }
      }
      onDeleteAnnotation(annotationId);
    },
    [onDeleteAnnotation],
  );

  // Keyboard navigation, scoped to the viewer root.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          tag === "button" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (load.kind !== "ready") {
        return;
      }
      const key = event.key;
      const isNext =
        key === "ArrowRight" ||
        key === "PageDown" ||
        (viewMode === "vertical" && key === "ArrowDown");
      const isPrev =
        key === "ArrowLeft" ||
        key === "PageUp" ||
        (viewMode === "vertical" && key === "ArrowUp");
      if (!isNext && !isPrev) {
        return;
      }
      event.preventDefault();
      goToPage(isNext ? pageNumber + 1 : pageNumber - 1);
    },
    [goToPage, load.kind, pageNumber, viewMode],
  );

  const headerLabel = useMemo(() => {
    const trimmed = originalName?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : "PDF";
  }, [originalName]);

  const annotationsList = annotations ?? [];

  const canPrev = load.kind === "ready" && pageNumber > 1;
  const canNext = load.kind === "ready" && pageNumber < numPages;
  const canZoomOut = zoomIndex > 0;
  const canZoomIn = zoomIndex < ZOOM_LEVELS.length - 1;
  const canHighlight = Boolean(onAddAnnotation && load.kind === "ready" && hasSelection);
  const canAddOutline = Boolean(onChangeOutline && load.kind === "ready" && hasSelection);
  const outlineCount = countOutlineItems(outlineItems);
  const embeddedOutlineItems = outlineItems.filter((item) => item.source === "embedded");
  const manualOutlineItems = outlineItems.filter((item) => item.source === "manual");
  const embeddedOutlineCount = countOutlineItems(embeddedOutlineItems);
  const manualOutlineCount = countOutlineItems(manualOutlineItems);

  const toolbarButtonClass =
    "inline-flex h-8 min-w-[2rem] items-center justify-center rounded-[10px] border border-[color:var(--panel-border)] bg-[color:var(--surface-muted)] px-2 text-xs font-medium text-slate-600 transition hover:border-sky-200/70 hover:bg-[color:var(--field-bg)] hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50";
  const activeToolbarButtonClass =
    "inline-flex h-8 min-w-[2rem] items-center justify-center rounded-[10px] border border-sky-300/60 bg-sky-50 px-2 text-xs font-medium text-sky-700 shadow-sm transition hover:bg-sky-100";

  // Pages to render.
  const pagesToRender = useMemo(() => {
    if (load.kind !== "ready") {
      return [] as number[];
    }
    if (viewMode === "vertical") {
      return Array.from({ length: load.doc.numPages }, (_, index) => index);
    }
    return [Math.max(0, Math.min(pageNumber - 1, load.doc.numPages - 1))];
  }, [load, viewMode, pageNumber]);

  const renderOutlineItems = (items: PdfOutlineItem[], fallbackDepth = 0) =>
    items.map((item) => {
      const displayDepth = Math.max(
        0,
        Math.min(item.depth ?? fallbackDepth, OUTLINE_MAX_DEPTH),
      );
      return (
        <li key={item.id} className="notebook-pdf-outline-list-item">
          <div className="notebook-pdf-outline-row" style={{ paddingLeft: `${displayDepth * 0.7}rem` }}>
            <button
              type="button"
              className="notebook-pdf-outline-item"
              onClick={() => handleGoToOutlineItem(item)}
              title={`${item.title} — page ${item.pageIndex + 1}`}
            >
              <span className="notebook-pdf-outline-title">{item.title}</span>
              <span className="notebook-pdf-outline-page">{item.pageIndex + 1}</span>
            </button>
            {item.source === "manual" && onChangeOutline ? (
              <button
                type="button"
                className="notebook-pdf-outline-delete"
                onClick={() => handleDeleteOutlineItem(item.id)}
                aria-label={`Delete manual outline entry ${item.title}`}
                title="Delete manual outline entry"
              >
                ×
              </button>
            ) : null}
          </div>
          {item.children && item.children.length > 0 ? (
            <ol className="notebook-pdf-outline-list">
              {renderOutlineItems(item.children, displayDepth + 1)}
            </ol>
          ) : null}
        </li>
      );
    });

  return (
    <div
      ref={rootRef}
      className={
        "flex min-h-0 min-w-0 flex-1 flex-col gap-2 rounded-[18px] border border-[color:var(--panel-border)] bg-[color:var(--panel-bg)] p-2" +
        (className ? ` ${className}` : "")
      }
      onKeyDown={handleKeyDown}
    >
      <div className="flex flex-wrap items-center gap-2 px-1" data-pdf-no-autohighlight="true">
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-slate-600" title={headerLabel}>
          {headerLabel}
        </div>
        <button
          type="button"
          className={isOutlineOpen ? activeToolbarButtonClass : toolbarButtonClass}
          onClick={() => setIsOutlineOpen((open) => !open)}
          aria-pressed={isOutlineOpen}
          title={isOutlineOpen ? "Hide outline" : "Show outline"}
        >
          Outline
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={toolbarButtonClass}
            onClick={() => goToPage(pageNumber - 1)}
            disabled={!canPrev}
            aria-label="Previous page"
            title="Previous page"
          >
            ‹
          </button>
          <span className="select-none px-1 text-xs tabular-nums text-slate-600">
            {load.kind === "ready" ? `${pageNumber} / ${numPages}` : "— / —"}
          </span>
          <button
            type="button"
            className={toolbarButtonClass}
            onClick={() => goToPage(pageNumber + 1)}
            disabled={!canNext}
            aria-label="Next page"
            title="Next page"
          >
            ›
          </button>
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Page layout">
          <button
            type="button"
            className={viewMode === "horizontal" ? activeToolbarButtonClass : toolbarButtonClass}
            onClick={() => setViewMode("horizontal")}
            aria-pressed={viewMode === "horizontal"}
            title="Single-page layout"
          >
            Single
          </button>
          <button
            type="button"
            className={viewMode === "vertical" ? activeToolbarButtonClass : toolbarButtonClass}
            onClick={() => setViewMode("vertical")}
            aria-pressed={viewMode === "vertical"}
            title="Continuous scroll layout"
          >
            Scroll
          </button>
        </div>

        {onAddAnnotation ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={highlightMode ? activeToolbarButtonClass : toolbarButtonClass}
              onClick={() => {
                setHighlightMode((prev) => !prev);
                setHint(null);
              }}
              aria-pressed={highlightMode}
              title={
                highlightMode
                  ? "Highlight mode ON — selecting text auto-highlights"
                  : "Turn highlight mode on"
              }
            >
              Highlight
            </button>
            <div className="relative">
              <button
                ref={colorButtonRef}
                type="button"
                className={toolbarButtonClass + " gap-1.5"}
                onClick={() => setIsColorMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={isColorMenuOpen}
                aria-label="Highlight color"
                title="Highlight color"
              >
                <span
                  className="inline-block h-3 w-3 rounded-full border border-slate-300/70"
                  style={{ backgroundColor: currentColor }}
                  aria-hidden="true"
                />
                <span className="text-xs">Color</span>
              </button>
              {isColorMenuOpen ? (
                <div
                  ref={colorMenuRef}
                  role="menu"
                  className="absolute right-0 top-full z-20 mt-1 flex items-center gap-1 rounded-[12px] border border-[color:var(--panel-border)] bg-[color:var(--panel-bg)] p-1 shadow-lg"
                  data-pdf-no-autohighlight="true"
                >
                  {HIGHLIGHT_COLORS.map((color) => {
                    const isSelected = color.value === currentColor;
                    return (
                      <button
                        key={color.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isSelected}
                        title={color.label}
                        onClick={() => {
                          setCurrentColor(color.value);
                          setIsColorMenuOpen(false);
                        }}
                        className={
                          "notebook-pdf-color-swatch" + (isSelected ? " is-selected" : "")
                        }
                        style={{ backgroundColor: color.value }}
                      >
                        <span className="sr-only">{color.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            {!highlightMode ? (
              <button
                type="button"
                className={toolbarButtonClass}
                onClick={handleManualHighlight}
                disabled={!canHighlight}
                aria-label="Highlight selected text"
                title={canHighlight ? "Highlight selected text" : "Select PDF text to highlight"}
              >
                Apply
              </button>
            ) : null}
          </div>
        ) : null}

        {onChangeOutline ? (
          <button
            type="button"
            className={toolbarButtonClass}
            onClick={handleAddOutlineFromSelection}
            disabled={!canAddOutline}
            aria-label="Add selected text to PDF outline"
            title={canAddOutline ? "Add selected text to outline" : "Select PDF text to add outline"}
          >
            Add outline
          </button>
        ) : null}

        <div className="flex items-center gap-1">
          <button
            type="button"
            className={toolbarButtonClass}
            onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
            disabled={!canZoomOut}
            aria-label="Zoom out"
            title="Zoom out"
          >
            −
          </button>
          <span className="select-none px-1 text-xs tabular-nums text-slate-600">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className={toolbarButtonClass}
            onClick={() => setZoomIndex((index) => Math.min(ZOOM_LEVELS.length - 1, index + 1))}
            disabled={!canZoomIn}
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className={toolbarButtonClass}
            onClick={() => setZoomIndex(DEFAULT_ZOOM_INDEX)}
            aria-label="Reset zoom"
            title="Reset zoom"
          >
            100%
          </button>
        </div>
      </div>

      {hint ? (
        <div className="px-1 text-[11px] text-slate-500" role="status">
          {hint}
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 gap-2">
        {isOutlineOpen ? (
          <aside
            className="notebook-pdf-outline-panel"
            aria-label="PDF outline"
            data-pdf-no-autohighlight="true"
          >
            <div className="notebook-pdf-outline-header">
              <span>Outline</span>
              <span className="notebook-pdf-outline-count">{outlineCount}</span>
            </div>
            <div className="notebook-pdf-outline-body scrollbar-subtle">
              {outlineStatus === "loading" && outlineCount === 0 ? (
                <div className="notebook-pdf-outline-empty">Loading bookmarks…</div>
              ) : null}
              {outlineStatus === "error" && outlineError ? (
                <div className="notebook-pdf-outline-empty text-rose-500">{outlineError}</div>
              ) : null}
              {embeddedOutlineItems.length > 0 ? (
                <section className="notebook-pdf-outline-section" aria-label="Embedded PDF outline">
                  <div className="notebook-pdf-outline-section-label">
                    <span>PDF</span>
                    <span>{embeddedOutlineCount}</span>
                  </div>
                  <ol className="notebook-pdf-outline-list">
                    {renderOutlineItems(embeddedOutlineItems)}
                  </ol>
                </section>
              ) : null}
              {manualOutlineItems.length > 0 ? (
                <section className="notebook-pdf-outline-section" aria-label="Manual PDF outline">
                  <div className="notebook-pdf-outline-section-label">
                    <span>Manual</span>
                    <span>{manualOutlineCount}</span>
                  </div>
                  <ol className="notebook-pdf-outline-list">
                    {renderOutlineItems(manualOutlineItems)}
                  </ol>
                </section>
              ) : null}
              {outlineStatus !== "loading" && outlineStatus !== "error" && outlineCount === 0 ? (
                <div className="notebook-pdf-outline-empty">No PDF bookmarks found.</div>
              ) : null}
            </div>
          </aside>
        ) : null}

        <div
          ref={viewportRef}
          tabIndex={0}
          className={
            "notebook-pdf-viewport flex min-h-0 min-w-0 flex-1 overflow-auto rounded-[12px] bg-[color:var(--surface-muted)] p-3 scrollbar-subtle outline-none" +
            (viewMode === "vertical"
              ? " notebook-pdf-viewport--vertical flex-col items-center gap-3"
              : " notebook-pdf-viewport--horizontal items-start justify-center")
          }
          aria-label={
            viewMode === "vertical"
              ? `${headerLabel} continuous scroll viewer`
              : `${headerLabel} single-page viewer`
          }
        >
          {load.kind === "loading" ? (
            <div className="m-auto text-xs text-slate-500">Loading PDF…</div>
          ) : load.kind === "error" ? (
            <div className="m-auto max-w-md px-3 py-4 text-center text-xs text-rose-600">{load.message}</div>
          ) : (
            pagesToRender.map((pageIndex) => (
              <PdfRenderedPage
                key={pageIndex}
                doc={(load as { kind: "ready"; doc: PDFDocumentProxy }).doc}
                pageIndex={pageIndex}
                zoom={zoom}
                annotations={annotationsList}
                onDeleteHighlight={handleDeleteHighlight}
                registerInfo={registerInfo}
                ariaLabel={`${headerLabel} — page ${pageIndex + 1}`}
              />
            ))
          )}
        </div>
      </div>

      {selectionPageIndex !== null && hasSelection && highlightMode ? (
        <span className="sr-only" role="status">
          Selection on page {selectionPageIndex + 1} will be highlighted.
        </span>
      ) : null}
    </div>
  );
}
