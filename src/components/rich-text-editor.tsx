import { useEffect, useRef } from "react";

const ALLOWED_INLINE = new Set(["b", "i", "u", "strong", "em", "br"]);
const ALLOWED_BLOCK = new Set(["ul", "ol", "li", "div", "p"]);

function sanitizeNode(node: Node): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "br") {
    return document.createElement("br");
  }

  let normalizedTag = tag;
  if (tag === "strong") normalizedTag = "b";
  if (tag === "em") normalizedTag = "i";

  if (tag === "ul" && (el as HTMLUListElement).dataset.list === "dashed") {
    const out = document.createElement("ul");
    out.dataset.list = "dashed";
    Array.from(el.childNodes).forEach((c) => {
      const sn = sanitizeNode(c);
      if (sn) out.appendChild(sn);
    });
    return out;
  }

  if (ALLOWED_INLINE.has(tag) || ALLOWED_BLOCK.has(tag)) {
    const out = document.createElement(normalizedTag);
    Array.from(el.childNodes).forEach((c) => {
      const sn = sanitizeNode(c);
      if (sn) out.appendChild(sn);
    });
    return out;
  }

  const frag = document.createDocumentFragment();
  Array.from(el.childNodes).forEach((c) => {
    const sn = sanitizeNode(c);
    if (sn) frag.appendChild(sn);
  });
  return frag;
}

function sanitizeHtml(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = document.createElement("div");
  Array.from(doc.body.childNodes).forEach((c) => {
    const sn = sanitizeNode(c);
    if (sn) out.appendChild(sn);
  });
  return out.innerHTML;
}

function setEditorContent(el: HTMLDivElement, html: string) {
  const sanitized = sanitizeHtml(html);
  const tmp = document.createElement("div");
  tmp.innerHTML = sanitized;
  const frag = document.createDocumentFragment();
  Array.from(tmp.childNodes).forEach((c) => frag.appendChild(c));
  el.replaceChildren(frag);
}

function readEditorHtml(el: HTMLDivElement): string {
  return sanitizeHtml(el.innerHTML);
}

function startList(kind: "bullet" | "number" | "dashed") {
  if (kind === "number") {

    document.execCommand("insertOrderedList");
    return;
  }

  document.execCommand("insertUnorderedList");

  if (kind === "dashed") {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    let node: Node | null = range.startContainer;
    while (node && node.nodeType !== Node.ELEMENT_NODE) {
      node = node.parentNode;
    }
    while (node && (node as Element).tagName?.toLowerCase() !== "ul") {
      node = (node as Element).parentNode;
    }
    if (node) {
      (node as HTMLUListElement).dataset.list = "dashed";
    }
  }
}

function getCurrentLineText(): { text: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) {
    return { text: "" };
  }
  const text = (node.textContent ?? "").slice(0, range.startOffset);
  return { text };
}

function deleteCharsBeforeCaret(count: number) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;
  const offset = range.startOffset;
  const newOffset = Math.max(0, offset - count);
  const textNode = node as Text;
  const before = textNode.textContent ?? "";
  textNode.textContent = before.slice(0, newOffset) + before.slice(offset);
  const newRange = document.createRange();
  newRange.setStart(textNode, newOffset);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  minLines = 1,
  scrollable = false,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minLines?: number;
  scrollable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hasFocusRef = useRef(false);
  const valueRef = useRef(value);

  useEffect(() => {
    if (ref.current && !hasFocusRef.current && valueRef.current !== value) {
      setEditorContent(ref.current, value);
      valueRef.current = value;
    }
  }, [value]);

  useEffect(() => {
    if (ref.current && !ref.current.innerHTML && value) {
      setEditorContent(ref.current, value);
      valueRef.current = value;
    }

  }, []);

  function flush() {
    if (!ref.current) return;
    const html = readEditorHtml(ref.current);
    valueRef.current = html;
    onChange(html);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && (e.key === "b" || e.key === "B")) {
      e.preventDefault();

      document.execCommand("bold");
      return;
    }
    if (meta && (e.key === "i" || e.key === "I")) {
      e.preventDefault();

      document.execCommand("italic");
      return;
    }
    if (meta && (e.key === "u" || e.key === "U")) {
      e.preventDefault();

      document.execCommand("underline");
      return;
    }

    if (e.key === " ") {
      const line = getCurrentLineText();
      if (!line) return;
      const t = line.text;
      if (t === "*") {
        e.preventDefault();
        deleteCharsBeforeCaret(1);
        startList("bullet");
        return;
      }
      if (t === "-") {
        e.preventDefault();
        deleteCharsBeforeCaret(1);
        startList("dashed");
        return;
      }
      const numMatch = /^(\d+)[.)]$/.exec(t);
      if (numMatch) {
        e.preventDefault();
        deleteCharsBeforeCaret(numMatch[0].length);
        startList("number");
        return;
      }
    }
  }

  function onInput() {
    flush();
  }

  const minHeight = `${Math.max(1, minLines) * 1.5}em`;

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onKeyDown={onKeyDown}
      onInput={onInput}
      onFocus={() => {
        hasFocusRef.current = true;
      }}
      onBlur={() => {
        hasFocusRef.current = false;
        flush();
      }}
      style={{ minHeight, maxHeight: scrollable ? "180px" : undefined, overflowY: scrollable ? "auto" : undefined }}
      className={`rich-text-editor w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40 [&:empty]:before:pointer-events-none [&:empty]:before:text-slate-500 [&:empty]:before:content-[attr(data-placeholder)] ${className ?? ""}`}
    />
  );
}

export function RichTextRender({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) {
      const sanitized = sanitizeHtml(html);
      const tmp = document.createElement("span");
      tmp.innerHTML = sanitized;
      const frag = document.createDocumentFragment();
      Array.from(tmp.childNodes).forEach((c) => frag.appendChild(c));
      ref.current.replaceChildren(frag);
    }
  }, [html]);
  return <span ref={ref} className={className} />;
}

export function richTextToPlain(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent ?? "";
}
