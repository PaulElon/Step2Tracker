import { useCallback, useRef } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";

type ResizeMode = "x-right" | "x-left" | "y-bottom" | "y-top" | "corner";
type AlignValue = "left" | "center" | "right" | "fit" | "inline" | null;

export function NotebookImageNodeView({ node, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const { src, alt, title, width, height, dataAlign } = node.attrs as {
    src: string;
    alt?: string | null;
    title?: string | null;
    width?: string | null;
    height?: string | null;
    dataAlign?: AlignValue;
  };

  const imgRef = useRef<HTMLImageElement>(null);

  const startResize = useCallback(
    (mode: ResizeMode) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const el = imgRef.current;
      const startWidth = el?.offsetWidth ?? (width ? parseInt(String(width), 10) : 300);
      const startHeight = el?.offsetHeight ?? (height ? parseInt(String(height), 10) : 200);

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
        const next: { width?: string; height?: string } = {};

        switch (mode) {
          case "x-right": {
            const w = Math.round(Math.min(maxWidth, Math.max(40, startWidth + dx)));
            next.width = String(w);
            break;
          }
          case "x-left": {
            const w = Math.round(Math.min(maxWidth, Math.max(40, startWidth - dx)));
            next.width = String(w);
            break;
          }
          case "y-bottom": {
            const h = Math.round(Math.max(40, startHeight + dy));
            next.height = String(h);
            break;
          }
          case "y-top": {
            const h = Math.round(Math.max(40, startHeight - dy));
            next.height = String(h);
            break;
          }
          case "corner": {
            // Proportional: drive by width, drop any explicit height so aspect stays clean.
            const w = Math.round(Math.min(maxWidth, Math.max(40, startWidth + dx)));
            next.width = String(w);
            next.height = String(Math.round(w / (aspect || 1)));
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
    [updateAttributes, width, height],
  );

  const handleDeletePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      deleteNode();
    },
    [deleteNode],
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
              title="Drag to resize width"
              onPointerDown={startResize("x-left")}
            />
            <div
              className="notebook-image-node__handle notebook-image-node__handle--right"
              title="Drag to resize width"
              onPointerDown={startResize("x-right")}
            />
            <div
              className="notebook-image-node__handle notebook-image-node__handle--top"
              title="Drag to resize height"
              onPointerDown={startResize("y-top")}
            />
            <div
              className="notebook-image-node__handle notebook-image-node__handle--bottom"
              title="Drag to resize height"
              onPointerDown={startResize("y-bottom")}
            />

            {/* Diagonal corner (proportional) — preserved at bottom-right */}
            <div
              className="notebook-image-node__handle notebook-image-node__handle--corner"
              title="Drag to resize proportionally"
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
