import { useCallback, useEffect, useRef } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";

type ResizeMode = "x-right" | "x-left" | "y-bottom" | "y-top" | "corner";
type AlignValue = "left" | "center" | "right" | "fit" | "inline" | null;

function LockClosedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <rect x="3" y="7" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function LockOpenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <rect x="3" y="7" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 7V5a3 3 0 0 1 6 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function FreeformIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path d="M8 2v12M2 8h12M8 2l-2 2M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const MIN_W = 80;
const MIN_H = 60;

function findEditorSurface(el: HTMLElement | null): HTMLElement | null {
  let walker: HTMLElement | null = el;
  while (walker) {
    if (walker.classList.contains("ProseMirror")) return walker;
    walker = walker.parentElement;
  }
  return null;
}

export function NotebookImageNodeView({ node, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const { src, alt, title, width, height, dataAlign, lockAspect, positionMode, x, y } = node.attrs as {
    src: string;
    alt?: string | null;
    title?: string | null;
    width?: string | null;
    height?: string | null;
    dataAlign?: AlignValue;
    lockAspect?: string | null;
    positionMode?: "free" | null;
    x?: number | null;
    y?: number | null;
  };

  const imgRef = useRef<HTMLImageElement>(null);
  const dragRafRef = useRef<number>(0);

  const isFree = positionMode === "free";
  const isLocked = lockAspect !== "false";

  useEffect(() => {
    return () => {
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = 0;
      }
    };
  }, []);

  const startResize = useCallback(
    (mode: ResizeMode) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const el = imgRef.current;
      const startWidth = el?.offsetWidth ?? (width ? parseInt(String(width), 10) : 300);
      const startHeight = el?.offsetHeight ?? (height ? parseInt(String(height), 10) : 200);
      const isLockedCapture = lockAspect !== "false";

      // Capture max width from a stable editor content ancestor at pointerdown.
      // Querying parent on the fly would yield the already-shrunk wrapper width.
      let maxWidth = 1200;
      let walker: HTMLElement | null = el;
      while (walker) {
        if (
          walker.classList.contains("tiptap-editor__content") ||
          walker.classList.contains("ProseMirror") ||
          walker.classList.contains("notebook-editor-content")
        ) {
          maxWidth = walker.clientWidth;
          break;
        }
        walker = walker.parentElement;
      }
      if (maxWidth <= 0) maxWidth = 1200;

      const aspect = startHeight > 0 ? startWidth / startHeight : 1;

      const onPointerMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const shiftHeld = ev.shiftKey;
        const next: { width?: string; height?: string } = {};

        switch (mode) {
          case "x-right": {
            const w = Math.round(Math.min(maxWidth, Math.max(MIN_W, startWidth + dx)));
            next.width = String(w);
            if (shiftHeld) next.height = String(Math.round(Math.max(MIN_H, w / (aspect || 1))));
            break;
          }
          case "x-left": {
            const w = Math.round(Math.min(maxWidth, Math.max(MIN_W, startWidth - dx)));
            next.width = String(w);
            if (shiftHeld) next.height = String(Math.round(Math.max(MIN_H, w / (aspect || 1))));
            break;
          }
          case "y-bottom": {
            const h = Math.round(Math.max(MIN_H, startHeight + dy));
            next.height = String(h);
            if (shiftHeld) next.width = String(Math.round(Math.min(maxWidth, Math.max(MIN_W, h * (aspect || 1)))));
            break;
          }
          case "y-top": {
            const h = Math.round(Math.max(MIN_H, startHeight - dy));
            next.height = String(h);
            if (shiftHeld) next.width = String(Math.round(Math.min(maxWidth, Math.max(MIN_W, h * (aspect || 1)))));
            break;
          }
          case "corner": {
            if (isLockedCapture) {
              const w = Math.round(Math.min(maxWidth, Math.max(MIN_W, startWidth + dx)));
              next.width = String(w);
              next.height = String(Math.round(Math.max(MIN_H, w / (aspect || 1))));
            } else {
              const w = Math.round(Math.min(maxWidth, Math.max(MIN_W, startWidth + dx)));
              const h = Math.round(Math.max(MIN_H, startHeight + dy));
              next.width = String(w);
              next.height = String(h);
            }
            break;
          }
        }
        updateAttributes(next);
      };

      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [updateAttributes, width, height, lockAspect],
  );

  const handleDeletePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      deleteNode();
    },
    [deleteNode],
  );

  const handleLockPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      updateAttributes({ lockAspect: isLocked ? "false" : null });
    },
    [updateAttributes, isLocked],
  );

  const setAlign = useCallback(
    (value: Exclude<AlignValue, null>) =>
      (e: React.PointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (value === "fit") {
          updateAttributes({ dataAlign: "fit", width: null, height: null });
        } else {
          updateAttributes({ dataAlign: value });
        }
      },
    [updateAttributes],
  );

  const handleFreeformPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();

      if (isFree) {
        // Turn freeform OFF: return to flow with a safe alignment fallback.
        const fallbackAlign: Exclude<AlignValue, null> =
          dataAlign && dataAlign !== "fit" ? dataAlign : "center";
        updateAttributes({
          positionMode: null,
          x: null,
          y: null,
          dataAlign: fallbackAlign,
        });
        return;
      }

      // Turn freeform ON: seed x/y from current rendered position to avoid jumping.
      const imgEl = imgRef.current;
      let wrapperEl: HTMLElement | null = imgEl;
      while (wrapperEl) {
        if (wrapperEl.classList.contains("notebook-image-node")) break;
        wrapperEl = wrapperEl.parentElement;
      }
      const pm = findEditorSurface(imgEl);

      let xPos = 0;
      let yPos = 0;
      if (wrapperEl && pm) {
        const wRect = wrapperEl.getBoundingClientRect();
        const pmRect = pm.getBoundingClientRect();
        xPos = Math.max(0, Math.round(wRect.left - pmRect.left + pm.scrollLeft));
        yPos = Math.max(0, Math.round(wRect.top - pmRect.top + pm.scrollTop));
      }

      const next: Record<string, unknown> = {
        positionMode: "free",
        x: xPos,
        y: yPos,
      };
      // Preserve current rendered width/height so the image doesn't reflow.
      if (!width && imgEl) next.width = String(imgEl.offsetWidth);
      if (!height && imgEl) next.height = String(imgEl.offsetHeight);
      updateAttributes(next);
    },
    [isFree, dataAlign, width, height, updateAttributes],
  );

  const handleImagePointerDown = useCallback(
    (e: React.PointerEvent<HTMLImageElement>) => {
      // Only initiate drag when image is already selected and in freeform mode.
      // First click should still let ProseMirror create a NodeSelection.
      if (!isFree || !selected) return;
      if (e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      const imgEl = imgRef.current;
      const pm = findEditorSurface(imgEl);
      const pmWidth = pm?.clientWidth ?? 0;
      const imgW = imgEl?.offsetWidth ?? 0;

      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const startX = typeof x === "number" && Number.isFinite(x) ? x : 0;
      const startY = typeof y === "number" && Number.isFinite(y) ? y : 0;

      const maxX = pmWidth > 0 && imgW > 0 ? Math.max(0, pmWidth - imgW) : Number.POSITIVE_INFINITY;

      let pendingX = startX;
      let pendingY = startY;

      const flush = () => {
        dragRafRef.current = 0;
        updateAttributes({ x: pendingX, y: pendingY });
      };

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startClientX;
        const dy = ev.clientY - startClientY;
        pendingX = Math.round(Math.max(0, Math.min(maxX, startX + dx)));
        // No upper clamp on Y — longer pages should remain reachable.
        pendingY = Math.round(Math.max(0, startY + dy));
        if (!dragRafRef.current) {
          dragRafRef.current = requestAnimationFrame(flush);
        }
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      const onUp = () => {
        cleanup();
        if (dragRafRef.current) {
          cancelAnimationFrame(dragRafRef.current);
          dragRafRef.current = 0;
        }
        updateAttributes({ x: pendingX, y: pendingY });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [isFree, selected, x, y, updateAttributes],
  );

  const align: AlignValue = dataAlign ?? "inline";

  const imgStyle: React.CSSProperties = {
    display: "block",
    maxWidth: isFree ? "none" : "100%",
  };
  if (isFree) {
    if (width) imgStyle.width = `${width}px`;
    if (height) imgStyle.height = `${height}px`;
    else imgStyle.height = "auto";
    imgStyle.cursor = selected ? "move" : "pointer";
  } else if (align === "fit") {
    imgStyle.width = "100%";
    imgStyle.height = "auto";
  } else {
    if (width) imgStyle.width = `${width}px`;
    if (height) imgStyle.height = `${height}px`;
    else imgStyle.height = "auto";
  }

  const wrapperClassName = [
    "notebook-image-node",
    isFree
      ? "notebook-image-node--free"
      : `notebook-image-node--align-${align ?? "inline"}`,
    selected ? "notebook-image-node--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const wrapperStyle: React.CSSProperties | undefined = isFree
    ? {
        position: "absolute",
        left: `${typeof x === "number" && Number.isFinite(x) ? x : 0}px`,
        top: `${typeof y === "number" && Number.isFinite(y) ? y : 0}px`,
        margin: 0,
      }
    : undefined;

  return (
    <NodeViewWrapper className={wrapperClassName} style={wrapperStyle}>
      <div className="notebook-image-node__inner">
        <img
          ref={imgRef}
          src={src}
          alt={alt ?? ""}
          title={title ?? undefined}
          style={imgStyle}
          draggable={false}
          onPointerDown={isFree && selected ? handleImagePointerDown : undefined}
        />
        {selected && (
          <>
            <div className="notebook-image-node__toolbar" contentEditable={false}>
              <button
                type="button"
                title="Align left"
                aria-pressed={!isFree && align === "left"}
                disabled={isFree}
                className={`notebook-image-node__tool${!isFree && align === "left" ? " is-active" : ""}`}
                onPointerDown={setAlign("left")}
              >
                ⬅
              </button>
              <button
                type="button"
                title="Align center (block)"
                aria-pressed={!isFree && align === "center"}
                disabled={isFree}
                className={`notebook-image-node__tool${!isFree && align === "center" ? " is-active" : ""}`}
                onPointerDown={setAlign("center")}
              >
                ⬌
              </button>
              <button
                type="button"
                title="Align right"
                aria-pressed={!isFree && align === "right"}
                disabled={isFree}
                className={`notebook-image-node__tool${!isFree && align === "right" ? " is-active" : ""}`}
                onPointerDown={setAlign("right")}
              >
                ➡
              </button>
              <button
                type="button"
                title="Fit width"
                aria-pressed={!isFree && align === "fit"}
                disabled={isFree}
                className={`notebook-image-node__tool${!isFree && align === "fit" ? " is-active" : ""}`}
                onPointerDown={setAlign("fit")}
              >
                ⇔
              </button>
              <button
                type="button"
                title="Inline with text"
                aria-pressed={!isFree && align === "inline"}
                disabled={isFree}
                className={`notebook-image-node__tool${!isFree && align === "inline" ? " is-active" : ""}`}
                onPointerDown={setAlign("inline")}
              >
                ¶
              </button>
              <span className="notebook-image-node__tool-sep" aria-hidden />
              <button
                type="button"
                title={isFree ? "Disable freeform placement" : "Toggle freeform placement"}
                aria-pressed={isFree}
                className={`notebook-image-node__tool${isFree ? " is-active" : ""}`}
                onPointerDown={handleFreeformPointerDown}
              >
                <FreeformIcon />
              </button>
              <span className="notebook-image-node__tool-sep" aria-hidden />
              <button
                type="button"
                title={isLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
                aria-pressed={isLocked}
                className={`notebook-image-node__tool${isLocked ? " is-active" : ""}`}
                onPointerDown={handleLockPointerDown}
              >
                {isLocked ? <LockClosedIcon /> : <LockOpenIcon />}
              </button>
              <span className="notebook-image-node__tool-sep" aria-hidden />
              <button
                type="button"
                title="Delete image"
                className="notebook-image-node__tool notebook-image-node__tool--danger"
                onPointerDown={handleDeletePointerDown}
              >
                ✕
              </button>
            </div>

            {/* Edge handles */}
            <div
              className="notebook-image-node__handle notebook-image-node__handle--left"
              title="Drag to resize width (Shift: proportional)"
              onPointerDown={startResize("x-left")}
            />
            <div
              className="notebook-image-node__handle notebook-image-node__handle--right"
              title="Drag to resize width (Shift: proportional)"
              onPointerDown={startResize("x-right")}
            />
            <div
              className="notebook-image-node__handle notebook-image-node__handle--top"
              title="Drag to resize height (Shift: proportional)"
              onPointerDown={startResize("y-top")}
            />
            <div
              className="notebook-image-node__handle notebook-image-node__handle--bottom"
              title="Drag to resize height (Shift: proportional)"
              onPointerDown={startResize("y-bottom")}
            />

            {/* Diagonal corner — proportional if locked, free if unlocked */}
            <div
              className="notebook-image-node__handle notebook-image-node__handle--corner"
              title={isLocked ? "Drag to resize proportionally" : "Drag to resize freely"}
              onPointerDown={startResize("corner")}
            />

            {(width || height) && (
              <span className="notebook-image-node__width-badge">
                {width ? `${width}` : "auto"}
                {height ? ` × ${height}` : ""}
                {" px"}
              </span>
            )}
          </>
        )}
      </div>
    </NodeViewWrapper>
  );
}
