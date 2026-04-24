import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useRef } from "react";
import { cn } from "../lib/ui";

function getFocusableElements(container: HTMLElement | null) {
  if (!container) {
    return [];
  }

  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("aria-hidden"));
}

export function ModalShell({
  children,
  className,
  contentClassName,
  descriptionId,
  initialFocusRef,
  onClose,
  position = "side",
  titleId,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  descriptionId?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  position?: "center" | "side";
  titleId: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTarget =
      initialFocusRef?.current ?? getFocusableElements(dialogRef.current)[0] ?? dialogRef.current;
    const timer = window.setTimeout(() => {
      focusTarget?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus();
    };
  }, [initialFocusRef]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = getFocusableElements(dialogRef.current);
    if (!focusableElements.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex bg-slate-950/70 p-4 backdrop-blur-sm",
        position === "side" ? "justify-end" : "items-center justify-center",
        className,
      )}
      onKeyDown={handleKeyDown}
    >
      <div aria-hidden="true" className="absolute inset-0" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cn(
          "relative w-full outline-none",
          position === "side"
            ? "h-full max-w-[540px] overflow-y-auto border-l border-white/10 bg-[#081220]/95 p-6"
            : "glass-panel max-w-[720px] p-6",
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
