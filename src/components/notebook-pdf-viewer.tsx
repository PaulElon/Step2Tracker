import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { readNotebookPdfBytes } from "../lib/notebook-pdf";

if (typeof pdfjs.GlobalWorkerOptions.workerSrc !== "string" || !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;
const DEFAULT_ZOOM_INDEX = 2; // 1.0

export interface NotebookPdfViewerProps {
  filename: string;
  originalName?: string;
  className?: string;
  onPageCount?: (count: number) => void;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; doc: PDFDocumentProxy }
  | { kind: "error"; message: string };

export function NotebookPdfViewer({
  filename,
  originalName,
  className,
  onPageCount,
}: NotebookPdfViewerProps) {
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [pageNumber, setPageNumber] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [renderError, setRenderError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTokenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    setPageNumber(1);
    setRenderError(null);

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
    if (!canvas) {
      return;
    }
    const safePage = Math.max(1, Math.min(pageNumber, load.doc.numPages));
    const token = ++renderTokenRef.current;
    let activePage: PDFPageProxy | null = null;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;

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
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(cssViewport.width)}px`;
        canvas.style.height = `${Math.floor(cssViewport.height)}px`;
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
    };
  }, [load, pageNumber, zoom]);

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

      <div className="notebook-pdf-viewport flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-[12px] bg-[color:var(--surface-muted)] p-3 scrollbar-subtle">
        {load.kind === "loading" ? (
          <div className="m-auto text-xs text-slate-500">Loading PDF…</div>
        ) : load.kind === "error" ? (
          <div className="m-auto max-w-md px-3 py-4 text-center text-xs text-rose-600">{load.message}</div>
        ) : renderError ? (
          <div className="m-auto max-w-md px-3 py-4 text-center text-xs text-rose-600">{renderError}</div>
        ) : (
          <canvas
            ref={canvasRef}
            className="notebook-pdf-canvas block rounded-[8px] bg-white shadow-sm"
            aria-label={`${headerLabel} — page ${pageNumber}`}
          />
        )}
      </div>
    </div>
  );
}
