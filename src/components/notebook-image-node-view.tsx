import { useCallback, useRef } from "react";
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

const MIN_W = 80;
const MIN_H = 60;

export function NotebookImageNodeView({ node, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const { src, alt, title, width, height, dataAlign, lockAspect } = node.attrs as {
    src: string;
    alt?: string | null;
    title?: string | null;
    width?: string | null;
    height?: string | null;
    dataAlign?: AlignValue;
    lockAspect?: string | null;
  };

  const imgRef = useRef<HTMLImageElement>(null);

  // null or absent = locked; "false" = unlocked
  const isLocked = lockAspect !== "false";

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
              // Locked: proportional — width drives height via captured aspect
              const w = Math.round(Math.min(maxWidth, Math.max(MIN_W, startWidth + dx)));
              next.width = String(w);
              next.height = String(Math.round(Math.max(MIN_H, w / (aspect || 1))));
            } else {
              // Unlocked: both axes move independently from pointer delta
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

  const align: AlignValue = dataAlign ?? "inline";

  const imgStyle: React.CSSProperties = {
    display: "block",
    maxWidth: "100%",
  };
  if (align === "fit") {
    imgStyle.width = "100%";
    imgStyle.height = "auto";
  } else {
    if (width) imgStyle.width = `${width}px`;
    if (height) imgStyle.height = `${height}px`;
    else imgStyle.height = "auto";
  }

  const wrapperClassName = [
    "notebook-image-node",
    `notebook-image-node--align-${align ?? "inline"}`,
    selected ? "notebook-image-node--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <NodeViewWrapper className={wrapperClassName}>
      <div className="notebook-image-node__inner">
        <img
          ref={imgRef}
          src={src}
          alt={alt ?? ""}
          title={title ?? undefined}
          style={imgStyle}
          draggable={false}
        />
        {selected && (
          <>
            <div className="notebook-image-node__toolbar" contentEditable={false}>
              <button
                type="button"
                title="Align left"
                aria-pressed={align === "left"}
                className={`notebook-image-node__tool${align === "left" ? " is-active" : ""}`}
                onPointerDown={setAlign("left")}
              >
                ⬅
              </button>
              <button
                type="button"
                title="Align center (block)"
                aria-pressed={align === "center"}
                className={`notebook-image-node__tool${align === "center" ? " is-active" : ""}`}
                onPointerDown={setAlign("center")}
              >
                ⬌
              </button>
              <button
                type="button"
                title="Align right"
                aria-pressed={align === "right"}
                className={`notebook-image-node__tool${align === "right" ? " is-active" : ""}`}
                onPointerDown={setAlign("right")}
              >
                ➡
              </button>
              <button
                type="button"
                title="Fit width"
                aria-pressed={align === "fit"}
                className={`notebook-image-node__tool${align === "fit" ? " is-active" : ""}`}
                onPointerDown={setAlign("fit")}
              >
                ⇔
              </button>
              <button
                type="button"
                title="Inline with text"
                aria-pressed={align === "inline"}
                className={`notebook-image-node__tool${align === "inline" ? " is-active" : ""}`}
                onPointerDown={setAlign("inline")}
              >
                ¶
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
