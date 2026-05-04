import { useCallback, useRef } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";

export function NotebookImageNodeView({ node, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const { src, alt, title, width } = node.attrs as {
    src: string;
    alt?: string | null;
    title?: string | null;
    width?: string | null;
  };

  const imgRef = useRef<HTMLImageElement>(null);

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidth =
        imgRef.current?.offsetWidth ?? (width ? parseInt(String(width), 10) : 300);

      // Walk up from the image to find the stable editor content container.
      // Must be captured at pointerdown — the NodeViewWrapper shrinks with the
      // image, so querying parentElement inside pointermove would give the
      // already-shrunk width and prevent growing the image back.
      let maxWidth = 1200;
      let el: HTMLElement | null = imgRef.current;
      while (el) {
        if (
          el.classList.contains("tiptap-editor__content") ||
          el.classList.contains("ProseMirror") ||
          el.classList.contains("notebook-editor-content")
        ) {
          maxWidth = el.clientWidth;
          break;
        }
        el = el.parentElement;
      }
      if (maxWidth <= 0) maxWidth = 1200;

      const onPointerMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const next = Math.round(Math.min(maxWidth, Math.max(80, startWidth + dx)));
        updateAttributes({ width: String(next) });
      };

      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [updateAttributes, width],
  );

  const handleDeletePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      deleteNode();
    },
    [deleteNode],
  );

  const imgStyle: React.CSSProperties = {
    display: "block",
    maxWidth: "100%",
    height: "auto",
  };
  if (width) imgStyle.width = `${width}px`;

  return (
    <NodeViewWrapper
      className={`notebook-image-node${selected ? " notebook-image-node--selected" : ""}`}
    >
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
          <button
            type="button"
            className="notebook-image-node__delete"
            title="Delete image"
            onPointerDown={handleDeletePointerDown}
          >
            ✕
          </button>
          <div
            className="notebook-image-node__resize-handle"
            onPointerDown={handleResizePointerDown}
          />
          {width && (
            <span className="notebook-image-node__width-badge">{width}px</span>
          )}
        </>
      )}
    </NodeViewWrapper>
  );
}
