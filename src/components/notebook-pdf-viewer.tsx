import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PageViewport, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { readNotebookPdfBytes } from "../lib/notebook-pdf";
import type { PdfAnnotation, PdfAnnotationQuad } from "../types/models";

if (typeof pdfjs.GlobalWorkerOptions.workerSrc !== "string" || !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;
const DEFAULT_ZOOM_INDEX = 2; // 1.0
const DEFAULT_HIGHLIGHT_COLOR = "#fde047";
const MAX_SNIPPET_LENGTH = 500;

export interface NotebookPdfViewerProps {
  filename: string;
  originalName?: string;
  className?: string;
  onPageCount?: (count: number) => void;
  annotations?: PdfAnnotation[];
  onAddAnnotation?: (annotation: PdfAnnotation) => void;
  onDeleteAnnotation?: (annotationId: string) => void;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; doc: PDFDocumentProxy }
  | { kind: "error"; message: string };

interface PageRenderInfo {
  viewport: PageViewport;
  pageIndex: number;
  cssWidth: number;
  cssHeight: number;
}

function createHighlightId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `nb-pdf-hl-${crypto.randomUUID()}`;
  }
  return `nb-pdf-hl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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

export function NotebookPdfViewer({
  filename,
  originalName,
  className,
  onPageCount,
  annotations,
  onAddAnnotation,
  onDeleteAnnotation,
}: NotebookPdfViewerProps) {
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [pageNumber, setPageNumber] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [pageRenderInfo, setPageRenderInfo] = useState<PageRenderInfo | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const renderTokenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    setPageNumber(1);
    setRenderError(null);
    setPageRenderInfo(null);
    setHasSelection(false);
    setSelectionMessage(null);

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
    // onPageCount intentionally omitted from deps: it is informational only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename]);

  useEffect(() => {
    return () => {
      if (load.kind === "ready") {
        load.doc.destroy().catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.kind === "ready" ? load.doc : null]);

  const numPages = load.kind === "ready" ? load.doc.numPages : 0;
  const zoom = ZOOM_LEVELS[zoomIndex];

  useEffect(() => {
    if (load.kind !== "ready") {
      return;
    }
    const canvas = canvasRef.current;
    const textLayer = textLayerRef.current;
    if (!canvas) {
      return;
    }
    const safePage = Math.max(1, Math.min(pageNumber, load.doc.numPages));
    const token = ++renderTokenRef.current;
    let activePage: PDFPageProxy | null = null;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;
    let textLayerInstance: pdfjs.TextLayer | null = null;

    (async () => {
      try {
        const page = await load.doc.getPage(safePage);
        if (token !== renderTokenRef.current) {
          page.cleanup();
          return;
        }
        activePage = page;
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: zoom * dpr });
        const cssViewport = page.getViewport({ scale: zoom });
        const cssWidth = Math.floor(cssViewport.width);
        const cssHeight = Math.floor(cssViewport.height);
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvas 2D context unavailable.");
        }
        context.clearRect(0, 0, canvas.width, canvas.height);
        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
        if (token !== renderTokenRef.current) {
          return;
        }
        setRenderError(null);

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
            // Text layer is optional for viewing; ignore failures so the page still renders.
          }
        }
        if (token !== renderTokenRef.current) {
          return;
        }
        setPageRenderInfo({
          viewport: cssViewport,
          pageIndex: safePage - 1,
          cssWidth,
          cssHeight,
        });
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
  }, [load, pageNumber, zoom]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const textLayer = textLayerRef.current;
      if (!textLayer) {
        setHasSelection(false);
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setHasSelection(false);
        return;
      }
      let inside = false;
      for (let i = 0; i < selection.rangeCount; i += 1) {
        const range = selection.getRangeAt(i);
        const node = range.commonAncestorContainer;
        if (node && textLayer.contains(node)) {
          inside = true;
          break;
        }
      }
      setHasSelection(inside);
      if (inside && selectionMessage) {
        setSelectionMessage(null);
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [selectionMessage]);

  const overlayAnnotations = useMemo(() => {
    if (!annotations || annotations.length === 0 || !pageRenderInfo) {
      return [] as PdfAnnotation[];
    }
    return annotations.filter((annotation) => annotation.pageIndex === pageRenderInfo.pageIndex);
  }, [annotations, pageRenderInfo]);

  const handleCreateHighlight = useCallback(() => {
    if (!pageRenderInfo) {
      return;
    }
    const textLayer = textLayerRef.current;
    if (!textLayer) {
      setSelectionMessage("PDF text layer is not ready yet.");
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSelectionMessage("Select PDF text first.");
      return;
    }
    const containerRect = textLayer.getBoundingClientRect();
    const viewport = pageRenderInfo.viewport;
    const quads: PdfAnnotationQuad[] = [];
    let snippet = "";
    for (let i = 0; i < selection.rangeCount; i += 1) {
      const range = selection.getRangeAt(i);
      const node = range.commonAncestorContainer;
      if (!node || !textLayer.contains(node)) {
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
      setSelectionMessage("Select PDF text first.");
      return;
    }
    const now = new Date().toISOString();
    const annotation: PdfAnnotation = {
      id: createHighlightId(),
      kind: "highlight",
      pageIndex: pageRenderInfo.pageIndex,
      color: DEFAULT_HIGHLIGHT_COLOR,
      quads,
      createdAt: now,
      updatedAt: now,
    };
    const trimmedSnippet = snippet.trim();
    if (trimmedSnippet.length > 0) {
      annotation.textSnippet = trimmedSnippet.slice(0, MAX_SNIPPET_LENGTH);
    }
    selection.removeAllRanges();
    setHasSelection(false);
    setSelectionMessage(null);
    onAddAnnotation?.(annotation);
  }, [pageRenderInfo, onAddAnnotation]);

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

  const headerLabel = useMemo(() => {
    const trimmed = originalName?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : "PDF";
  }, [originalName]);

  const goToPage = (next: number) => {
    if (load.kind !== "ready") {
      return;
    }
    const clamped = Math.max(1, Math.min(next, load.doc.numPages));
    setPageNumber(clamped);
  };

  const canPrev = load.kind === "ready" && pageNumber > 1;
  const canNext = load.kind === "ready" && pageNumber < numPages;
  const canZoomOut = zoomIndex > 0;
  const canZoomIn = zoomIndex < ZOOM_LEVELS.length - 1;
  const canHighlight = Boolean(
    onAddAnnotation && pageRenderInfo && hasSelection && load.kind === "ready",
  );

  const toolbarButtonClass =
    "inline-flex h-8 min-w-[2rem] items-center justify-center rounded-[10px] border border-[color:var(--panel-border)] bg-[color:var(--surface-muted)] px-2 text-xs font-medium text-slate-600 transition hover:border-sky-200/70 hover:bg-[color:var(--field-bg)] hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div
      className={
        "flex min-h-0 min-w-0 flex-1 flex-col gap-2 rounded-[18px] border border-[color:var(--panel-border)] bg-[color:var(--panel-bg)] p-2" +
        (className ? ` ${className}` : "")
      }
    >
      <div className="flex flex-wrap items-center gap-2 px-1">
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-slate-600" title={headerLabel}>
          {headerLabel}
        </div>
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
        {onAddAnnotation ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={toolbarButtonClass}
              onClick={handleCreateHighlight}
              disabled={!canHighlight}
              aria-label="Highlight selected text"
              title={canHighlight ? "Highlight selected text" : "Select PDF text to highlight"}
            >
              Highlight
            </button>
          </div>
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

      {selectionMessage ? (
        <div className="px-1 text-[11px] text-slate-500" role="status">
          {selectionMessage}
        </div>
      ) : null}

      <div className="notebook-pdf-viewport flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-[12px] bg-[color:var(--surface-muted)] p-3 scrollbar-subtle">
        {load.kind === "loading" ? (
          <div className="m-auto text-xs text-slate-500">Loading PDF…</div>
        ) : load.kind === "error" ? (
          <div className="m-auto max-w-md px-3 py-4 text-center text-xs text-rose-600">{load.message}</div>
        ) : renderError ? (
          <div className="m-auto max-w-md px-3 py-4 text-center text-xs text-rose-600">{renderError}</div>
        ) : (
          <div
            className="notebook-pdf-page-stack relative inline-block rounded-[8px] bg-white shadow-sm"
            style={
              pageRenderInfo
                ? { width: `${pageRenderInfo.cssWidth}px`, height: `${pageRenderInfo.cssHeight}px` }
                : undefined
            }
          >
            <canvas
              ref={canvasRef}
              className="notebook-pdf-canvas block"
              aria-label={`${headerLabel} — page ${pageNumber}`}
            />
            <div
              ref={textLayerRef}
              className="notebook-pdf-text-layer"
              aria-hidden="true"
            />
            {pageRenderInfo && overlayAnnotations.length > 0 ? (
              <div className="notebook-pdf-annotation-layer" aria-hidden="false">
                {overlayAnnotations.flatMap((annotation) =>
                  annotation.quads.map((quad, quadIndex) => {
                    const rect = quadToViewportRect(quad, pageRenderInfo.viewport);
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
                          handleDeleteHighlight(annotation.id);
                        }}
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
          </div>
        )}
      </div>
    </div>
  );
}
