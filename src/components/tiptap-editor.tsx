import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension, type Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import Underline from "@tiptap/extension-underline";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import type { NotebookEditorProps } from "./notebook-editor-adapter";
import { uploadNotebookImage } from "../lib/notebook-images";

type MenuId = "style" | "textColor" | "highlight" | "align" | "list" | "table" | "link";
type OpenMenu = MenuId | null;
type ListItemType = "listItem" | "taskItem";

const TEXT_COLORS: ReadonlyArray<{ label: string; color: string | null }> = [
  { label: "Default", color: null },
  { label: "White", color: "#ffffff" },
  { label: "Gray", color: "#94a3b8" },
  { label: "Red", color: "#ef4444" },
  { label: "Orange", color: "#f97316" },
  { label: "Yellow", color: "#f59e0b" },
  { label: "Green", color: "#22c55e" },
  { label: "Blue", color: "#3b82f6" },
  { label: "Purple", color: "#a855f7" },
  { label: "Pink", color: "#ec4899" },
];

const HIGHLIGHT_COLORS: ReadonlyArray<{ label: string; color: string | null }> = [
  { label: "None", color: null },
  { label: "Yellow", color: "#fef08a" },
  { label: "Green", color: "#bbf7d0" },
  { label: "Blue", color: "#bfdbfe" },
  { label: "Red", color: "#fecaca" },
  { label: "Pink", color: "#fbcfe8" },
];

// Local extension: adds fontSize to textStyle mark via global attribute.
const FontSizeExtension = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.fontSize || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${String(attributes.fontSize)}` };
            },
          },
        },
      },
    ];
  },
});

const TabIndentationExtension = Extension.create({
  name: "tabIndentation",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (editor.isActive("table")) return false;
        handleListIndent(editor, "indent");
        return true;
      },
      "Shift-Tab": ({ editor }) => {
        if (editor.isActive("table")) return false;
        handleListIndent(editor, "outdent");
        return true;
      },
    };
  },
});

function getActiveListItemType(editor: Editor): ListItemType | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "taskItem") return "taskItem";
    if (node.type.name === "listItem") return "listItem";
  }
  return null;
}

function handleListIndent(editor: Editor, direction: "indent" | "outdent", focus = false) {
  const listItemType = getActiveListItemType(editor);
  if (!listItemType) return false;
  const chain = editor.chain();
  if (focus) chain.focus();
  if (direction === "indent") chain.sinkListItem(listItemType).run();
  else chain.liftListItem(listItemType).run();
  return true;
}

function isInsideTable(editor: Editor) {
  return editor.isActive("table");
}

function toggleChecklist(editor: Editor, focus = false) {
  const chain = editor.chain();
  if (focus) chain.focus();
  chain.toggleTaskList().run();
}

// ─── SVG icon components ─────────────────────────────────────────────────────

function ChainLinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path d="M6.5 9.5L9.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4.5 8.5L3 10a2.828 2.828 0 1 0 4 4L8.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 7.5L13 6a2.828 2.828 0 1 0-4-4L7.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TableGridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.5 6h13M1.5 10.5h13M5.5 1.5v13M10.5 1.5v13" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ImageFrameIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="5.5" cy="5.5" r="1.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 11.5l3.5-3 2.5 2 2.5-2.5 4.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlignLeftIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path d="M2 3.5h12M2 7h8M2 10.5h12M2 14h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AlignCenterIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path d="M2 3.5h12M4 7h8M2 10.5h12M5 14h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AlignRightIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path d="M2 3.5h12M6 7h8M2 10.5h12M8 14h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Toolbar primitives ────────────────────────────────────────────────────

function Sep() {
  return <div className="tiptap-sep" aria-hidden />;
}

type ToolbarButtonProps = {
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  title: string;
  onClick?: () => void;
};

function ToolbarButton({ children, active = false, disabled = false, className, style, title, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      style={style}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`tiptap-editor__button${active ? " tiptap-editor__button--active" : ""}${className ? ` ${className}` : ""}`}
    >
      {children}
    </button>
  );
}

type DropdownMenuProps = {
  id: MenuId;
  label: ReactNode;
  title: string;
  openMenu: OpenMenu;
  onToggle: (id: MenuId) => void;
  disabled?: boolean;
  children: ReactNode;
  active?: boolean;
};

function DropdownMenu({ id, label, title, openMenu, onToggle, disabled = false, children, active = false }: DropdownMenuProps) {
  const isOpen = openMenu === id;
  return (
    <div className="tiptap-dd">
      <button
        type="button"
        title={title}
        aria-haspopup="true"
        aria-expanded={isOpen}
        disabled={disabled}
        className={`tiptap-editor__button tiptap-dd__trigger${isOpen || active ? " tiptap-editor__button--active" : ""}`}
        onMouseDown={(e) => {
          e.preventDefault();
          if (!disabled) onToggle(id);
        }}
      >
        {label}
      </button>
      {isOpen && <div className="tiptap-dd__panel">{children}</div>}
    </div>
  );
}

type DropdownItemProps = {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
};

function DropdownItem({ active = false, onClick, children }: DropdownItemProps) {
  return (
    <button
      type="button"
      className={`tiptap-dd__item${active ? " tiptap-dd__item--active" : ""}`}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

type ColorGridProps = {
  colors: ReadonlyArray<{ label: string; color: string | null }>;
  activeColor: string;
  onSelect: (color: string | null) => void;
};

function ColorGrid({ colors, activeColor, onSelect }: ColorGridProps) {
  return (
    <div className="tiptap-dd__color-grid">
      {colors.map(({ label, color }) => {
        const isActive = color ? activeColor === color : activeColor === "";
        return (
          <button
            key={label}
            type="button"
            title={label}
            className={`tiptap-dd__swatch${isActive ? " tiptap-dd__swatch--active" : ""}${!color ? " tiptap-dd__swatch--none" : ""}`}
            style={{ backgroundColor: color ?? "transparent" }}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(color);
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function TiptapEditor({
  value,
  onChange,
  placeholder,
  className,
  minLines = 1,
  scrollable = false,
  editorKey,
}: NotebookEditorProps) {
  const normalizedEditorKey = editorKey ?? "__default__";
  const initialValueRef = useRef(value || "");
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value || "");
  const lastAppliedEditorKeyRef = useRef<string | null>(null);
  const isApplyingExternalContentRef = useRef(false);

  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [fontSizeLocal, setFontSizeLocal] = useState(16);
  const [isUploading, setIsUploading] = useState(false);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const fontSizeInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setFontSizeLocalRef = useRef(setFontSizeLocal);
  const uploadHandlerRef = useRef<(file: File) => Promise<void>>(async () => {});
  setFontSizeLocalRef.current = setFontSizeLocal;

  onChangeRef.current = onChange;
  valueRef.current = value || "";

  // Always-current upload handler; captured by the ProseMirror plugin via ref.
  uploadHandlerRef.current = async (file: File) => {
    setIsUploading(true);
    try {
      const src = await uploadNotebookImage(file);
      editor?.chain().focus().setImage({ src }).run();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
    }
  };

  const toggleMenu = useCallback((id: MenuId) => {
    setOpenMenu((prev) => (prev === id ? null : id));
  }, []);

  const closeMenu = useCallback(() => setOpenMenu(null), []);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!openMenu) return;
    const onMD = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKD = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", onMD, true);
    document.addEventListener("keydown", onKD);
    return () => {
      document.removeEventListener("mousedown", onMD, true);
      document.removeEventListener("keydown", onKD);
    };
  }, [openMenu]);

  // Keep font size input in sync with editor selection (when not focused)
  useEffect(() => {
    const input = fontSizeInputRef.current;
    if (input && document.activeElement !== input) {
      input.value = String(fontSizeLocal);
    }
  }, [fontSizeLocal]);

  const extensions = useMemo(
    () => [
      StarterKit,
      TabIndentationExtension,
      FontSizeExtension,
      TextStyle,
      Color.configure({ types: ["textStyle"] }),
      Highlight.configure({ multicolor: true }),
      Table.configure({ resizable: true, allowTableNodeSelection: true }),
      TableRow,
      TableHeader,
      TableCell,
      Underline,
      Placeholder.configure({ placeholder: "Start writing..." }),
      TaskItem.configure({ nested: true }),
      TaskList.configure({ itemTypeName: "taskItem" }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { class: "tiptap-editor__link" },
      }),
      Image.configure({ inline: false, allowBase64: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Extension.create({
        name: "imageUpload",
        addProseMirrorPlugins() {
          return [
            new Plugin({
              props: {
                handlePaste(_view, event) {
                  const items = Array.from(event.clipboardData?.items ?? []);
                  const imageItem = items.find((i) => i.type.startsWith("image/"));
                  if (!imageItem) return false;
                  const file = imageItem.getAsFile();
                  if (!file) return false;
                  event.preventDefault();
                  void uploadHandlerRef.current(file);
                  return true;
                },
                handleDrop(_view, event) {
                  const files = Array.from(event.dataTransfer?.files ?? []);
                  const imageFile = files.find((f) => f.type.startsWith("image/"));
                  if (!imageFile) return false;
                  event.preventDefault();
                  void uploadHandlerRef.current(imageFile);
                  return true;
                },
              },
            }),
          ];
        },
      }),
    ],
    [],
  );

  const editorProps = useMemo(
    () => ({ attributes: { class: "notebook-tiptap-prosemirror" } }),
    [],
  );

  const editor = useEditor(
    {
      content: initialValueRef.current,
      extensions,
      editorProps,
      onUpdate: ({ editor: nextEditor }) => {
        if (isApplyingExternalContentRef.current) return;
        onChangeRef.current(nextEditor.getHTML());
      },
      onSelectionUpdate: ({ editor: nextEditor }) => {
        const fs = nextEditor.getAttributes("textStyle")?.fontSize;
        if (fs) {
          const n = parseInt(String(fs), 10);
          if (!isNaN(n) && n > 0) setFontSizeLocalRef.current(n);
        }
      },
    },
    [],
  );

  useEffect(() => {
    if (!editor) return;
    if (lastAppliedEditorKeyRef.current === normalizedEditorKey) return;
    const nextHtml = valueRef.current;
    isApplyingExternalContentRef.current = true;
    try {
      editor.commands.setContent(nextHtml, false as never);
    } finally {
      isApplyingExternalContentRef.current = false;
    }
    lastAppliedEditorKeyRef.current = normalizedEditorKey;
  }, [editor, normalizedEditorKey]);

  const applyFontSize = useCallback(
    (size: number) => {
      if (!editor) return;
      const clamped = Math.min(72, Math.max(8, size));
      editor.chain().focus().setMark("textStyle", { fontSize: `${clamped}px` }).run();
      setFontSizeLocal(clamped);
    },
    [editor],
  );

  // Add/Edit Link — opens prompt, trims, prefixes https://, sets via extendMarkRange
  const addEditLink = useCallback(() => {
    if (!editor) return;
    closeMenu();
    const currentHref = editor.getAttributes("link").href;
    const nextHref = window.prompt("Enter link URL", typeof currentHref === "string" ? currentHref : "");
    if (nextHref == null) return;
    const trimmedHref = nextHref.trim();
    if (!trimmedHref) return;
    const normalizedHref = /^https?:\/\//i.test(trimmedHref) ? trimmedHref : `https://${trimmedHref}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href: normalizedHref }).run();
  }, [editor, closeMenu]);

  // Remove Link
  const removeLink = useCallback(() => {
    if (!editor) return;
    closeMenu();
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
  }, [editor, closeMenu]);

  const insertImage = () => {
    if (!editor || isUploading) return;
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    void uploadHandlerRef.current(file);
  };

  const setTextColor = (color: string | null) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (color) chain.setColor(color).run();
    else chain.unsetColor().run();
  };

  const setHighlightColor = (color: string | null) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (color) chain.setHighlight({ color }).run();
    else chain.unsetHighlight().run();
  };

  const insertTable = () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  const addTableRowAfter = () => editor?.chain().focus().addRowAfter().run();
  const deleteTableRow = () => editor?.chain().focus().deleteRow().run();
  const addTableColumnAfter = () => editor?.chain().focus().addColumnAfter().run();
  const deleteTableColumn = () => editor?.chain().focus().deleteColumn().run();
  const toggleTableHeaderRow = () => editor?.chain().focus().toggleHeaderRow().run();
  const deleteTable = () => editor?.chain().focus().deleteTable().run();

  // Delete horizontal rule near/at the cursor position
  const deleteHorizontalRule = useCallback(() => {
    if (!editor) return;
    const { state } = editor.view;
    const { selection } = state;

    // Case 1: NodeSelection directly on an hr
    if ("node" in selection) {
      const sel = selection as { node?: { type?: { name?: string }; nodeSize?: number }; from?: number };
      if (sel.node?.type?.name === "horizontalRule" && typeof sel.from === "number" && typeof sel.node.nodeSize === "number") {
        editor.chain().focus().deleteRange({ from: sel.from, to: sel.from + sel.node.nodeSize }).run();
        return;
      }
    }

    // Case 2: scan ±2 positions around cursor for an hr node
    const { from, to } = selection;
    const searchFrom = Math.max(0, from - 2);
    const searchTo = Math.min(state.doc.content.size, to + 2);

    let hrPos: number | null = null;
    let hrEnd: number | null = null;

    state.doc.nodesBetween(searchFrom, searchTo, (node, pos) => {
      if (hrPos !== null) return false;
      if (node.type.name === "horizontalRule") {
        hrPos = pos;
        hrEnd = pos + node.nodeSize;
        return false;
      }
    });

    if (hrPos !== null && hrEnd !== null) {
      editor.chain().focus().deleteRange({ from: hrPos, to: hrEnd }).run();
    }
  }, [editor]);

  const minHeight = `${Math.max(1, minLines) * 1.5}em`;
  const wrapperClassName = [
    "tiptap-editor w-full h-full min-h-0 flex flex-col rounded-xl border border-white/10 text-sm text-white focus-within:outline-none focus-within:ring-2 focus-within:ring-cyan-400/40",
    "tiptap-editor--pageless",
    scrollable ? "overflow-y-auto scrollbar-subtle" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const canUndo = editor ? editor.can().chain().focus().undo().run() : false;
  const canRedo = editor ? editor.can().chain().focus().redo().run() : false;
  const isEditorReady = Boolean(editor);
  const isBold = editor ? editor.isActive("bold") : false;
  const isItalic = editor ? editor.isActive("italic") : false;
  const isUnderline = editor ? editor.isActive("underline") : false;
  const isStrike = editor ? editor.isActive("strike") : false;
  const isParagraph = editor ? editor.isActive("paragraph") : false;
  const isHeading1 = editor ? editor.isActive("heading", { level: 1 }) : false;
  const isHeading2 = editor ? editor.isActive("heading", { level: 2 }) : false;
  const isHeading3 = editor ? editor.isActive("heading", { level: 3 }) : false;
  const isBlockquote = editor ? editor.isActive("blockquote") : false;
  const isCodeBlock = editor ? editor.isActive("codeBlock") : false;
  const isBulletList = editor ? editor.isActive("bulletList") : false;
  const isOrderedList = editor ? editor.isActive("orderedList") : false;
  const isTaskList = editor ? editor.isActive("taskList") : false;
  const isTable = editor ? isInsideTable(editor) : false;
  const isLink = editor ? editor.isActive("link") : false;
  const isImage = editor ? editor.isActive("image") : false;
  const isAlignLeft = editor ? editor.isActive({ textAlign: "left" }) : false;
  const isAlignCenter = editor ? editor.isActive({ textAlign: "center" }) : false;
  const isAlignRight = editor ? editor.isActive({ textAlign: "right" }) : false;
  const textColor = editor ? (editor.getAttributes("textStyle").color ?? "") : "";
  const highlightColor = editor ? (editor.getAttributes("highlight").color ?? "") : "";
  const canToggleChecklist = editor ? editor.can().chain().toggleTaskList().run() : false;
  const canAddRow = isTable && (editor?.can().chain().focus().addRowAfter().run() ?? false);
  const canDeleteRow = isTable && (editor?.can().chain().focus().deleteRow().run() ?? false);
  const canAddColumn = isTable && (editor?.can().chain().focus().addColumnAfter().run() ?? false);
  const canDeleteColumn = isTable && (editor?.can().chain().focus().deleteColumn().run() ?? false);
  const canToggleHeaderRow = isTable && (editor?.can().chain().focus().toggleHeaderRow().run() ?? false);
  const canDeleteTable = isTable && (editor?.can().chain().focus().deleteTable().run() ?? false);

  const activeStyleLabel =
    isHeading1 ? "H1" :
    isHeading2 ? "H2" :
    isHeading3 ? "H3" :
    isBlockquote ? "Quote" :
    isCodeBlock ? "Code" :
    "Normal";

  const activeAlignIcon = isAlignCenter ? <AlignCenterIcon /> : isAlignRight ? <AlignRightIcon /> : <AlignLeftIcon />;
  const activeListIcon = isBulletList ? "•" : isOrderedList ? "1." : isTaskList ? "☑" : "☰";

  const toolbar = (
    <div ref={toolbarRef} className="tiptap-editor__toolbar" role="toolbar" aria-label="Text formatting">
      {/* History */}
      <ToolbarButton title="Undo" disabled={!isEditorReady || !canUndo} onClick={() => editor?.chain().focus().undo().run()}>↺</ToolbarButton>
      <ToolbarButton title="Redo" disabled={!isEditorReady || !canRedo} onClick={() => editor?.chain().focus().redo().run()}>↻</ToolbarButton>

      <Sep />

      {/* Style dropdown */}
      <DropdownMenu
        id="style"
        label={<>{activeStyleLabel}<span className="tiptap-dd__caret"> ▾</span></>}
        title="Text style"
        openMenu={openMenu}
        onToggle={toggleMenu}
        disabled={!isEditorReady}
      >
        <DropdownItem active={isParagraph} onClick={() => { editor?.chain().focus().setParagraph().run(); closeMenu(); }}>
          Normal
        </DropdownItem>
        <DropdownItem active={isHeading1} onClick={() => { editor?.chain().focus().toggleHeading({ level: 1 }).run(); closeMenu(); }}>
          <strong>H1 — Heading 1</strong>
        </DropdownItem>
        <DropdownItem active={isHeading2} onClick={() => { editor?.chain().focus().toggleHeading({ level: 2 }).run(); closeMenu(); }}>
          <strong>H2 — Heading 2</strong>
        </DropdownItem>
        <DropdownItem active={isHeading3} onClick={() => { editor?.chain().focus().toggleHeading({ level: 3 }).run(); closeMenu(); }}>
          <strong>H3 — Heading 3</strong>
        </DropdownItem>
        <DropdownItem active={isBlockquote} onClick={() => { editor?.chain().focus().toggleBlockquote().run(); closeMenu(); }}>
          ❝ Quote
        </DropdownItem>
        <DropdownItem active={isCodeBlock} onClick={() => { editor?.chain().focus().toggleCodeBlock().run(); closeMenu(); }}>
          ⌥ Code block
        </DropdownItem>
      </DropdownMenu>

      {/* Font size */}
      <div className="tiptap-fontsize">
        <button
          type="button"
          className="tiptap-fontsize__btn"
          title="Decrease font size"
          disabled={!isEditorReady || fontSizeLocal <= 8}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyFontSize(fontSizeLocal - 1)}
        >
          −
        </button>
        <input
          ref={fontSizeInputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          className="tiptap-fontsize__display"
          defaultValue={fontSizeLocal}
          aria-label="Font size"
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              const n = parseInt((e.target as HTMLInputElement).value, 10);
              if (!isNaN(n)) applyFontSize(n);
              editor?.commands.focus();
            }
          }}
          onBlur={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!isNaN(n)) applyFontSize(n);
            else if (fontSizeInputRef.current) fontSizeInputRef.current.value = String(fontSizeLocal);
          }}
        />
        <button
          type="button"
          className="tiptap-fontsize__btn"
          title="Increase font size"
          disabled={!isEditorReady || fontSizeLocal >= 72}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyFontSize(fontSizeLocal + 1)}
        >
          +
        </button>
      </div>

      <Sep />

      {/* Inline formatting */}
      <ToolbarButton title="Bold" active={isBold} disabled={!isEditorReady} onClick={() => editor?.chain().focus().toggleBold().run()}>
        <b>B</b>
      </ToolbarButton>
      <ToolbarButton title="Italic" active={isItalic} disabled={!isEditorReady} onClick={() => editor?.chain().focus().toggleItalic().run()}>
        <i>I</i>
      </ToolbarButton>
      <ToolbarButton title="Underline" active={isUnderline} disabled={!isEditorReady} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
        <u>U</u>
      </ToolbarButton>
      <ToolbarButton
        title="Strikethrough"
        active={isStrike}
        disabled={!isEditorReady}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <span style={{ textDecorationLine: "line-through" }}>S</span>
      </ToolbarButton>

      <Sep />

      {/* Text color */}
      <DropdownMenu
        id="textColor"
        label={
          <span className="tiptap-color-badge">
            <span className="tiptap-color-badge__letter">A</span>
            <span
              className="tiptap-color-badge__bar"
              style={{ backgroundColor: textColor || "rgba(226,232,240,0.45)" }}
            />
          </span>
        }
        title="Text color"
        openMenu={openMenu}
        onToggle={toggleMenu}
        disabled={!isEditorReady}
      >
        <ColorGrid
          colors={TEXT_COLORS}
          activeColor={textColor}
          onSelect={(c) => { setTextColor(c); closeMenu(); }}
        />
      </DropdownMenu>

      {/* Highlight */}
      <DropdownMenu
        id="highlight"
        label={
          <span className="tiptap-hl-badge">
            <span className="tiptap-hl-badge__letter">H</span>
            <span
              className="tiptap-hl-badge__bar"
              style={{ backgroundColor: highlightColor || "transparent" }}
            />
          </span>
        }
        title="Highlight color"
        openMenu={openMenu}
        onToggle={toggleMenu}
        disabled={!isEditorReady}
      >
        <ColorGrid
          colors={HIGHLIGHT_COLORS}
          activeColor={highlightColor}
          onSelect={(c) => { setHighlightColor(c); closeMenu(); }}
        />
      </DropdownMenu>

      <Sep />

      {/* Link — chain-style icon, dropdown with Add/Edit and Remove */}
      <DropdownMenu
        id="link"
        label={<><ChainLinkIcon /><span className="tiptap-dd__caret"> ▾</span></>}
        title="Link"
        openMenu={openMenu}
        onToggle={toggleMenu}
        disabled={!isEditorReady}
        active={isLink}
      >
        <DropdownItem onClick={addEditLink}>
          ⛓ Add / Edit Link
        </DropdownItem>
        <DropdownItem onClick={removeLink}>
          ✕ Remove Link
        </DropdownItem>
      </DropdownMenu>

      {/* Table — larger grid icon */}
      <DropdownMenu
        id="table"
        label={<><TableGridIcon /><span className="tiptap-dd__caret"> ▾</span></>}
        title="Table"
        openMenu={openMenu}
        onToggle={toggleMenu}
        disabled={!isEditorReady}
      >
        <DropdownItem onClick={() => { insertTable(); closeMenu(); }}>Insert 3×3 table</DropdownItem>
        <DropdownItem onClick={() => { if (canAddRow) { addTableRowAfter(); closeMenu(); } }}>Row +</DropdownItem>
        <DropdownItem onClick={() => { if (canDeleteRow) { deleteTableRow(); closeMenu(); } }}>Row −</DropdownItem>
        <DropdownItem onClick={() => { if (canAddColumn) { addTableColumnAfter(); closeMenu(); } }}>Col +</DropdownItem>
        <DropdownItem onClick={() => { if (canDeleteColumn) { deleteTableColumn(); closeMenu(); } }}>Col −</DropdownItem>
        <DropdownItem
          active={isTable && (editor?.isActive("tableHeader") ?? false)}
          onClick={() => { if (canToggleHeaderRow) { toggleTableHeaderRow(); closeMenu(); } }}
        >
          Toggle header
        </DropdownItem>
        <DropdownItem onClick={() => { if (canDeleteTable) { deleteTable(); closeMenu(); } }}>Delete table</DropdownItem>
      </DropdownMenu>

      {/* Image — larger picture-frame icon */}
      <ToolbarButton
        title={isUploading ? "Uploading…" : "Insert image"}
        active={isImage}
        disabled={!isEditorReady || isUploading}
        onClick={insertImage}
      >
        <ImageFrameIcon />
      </ToolbarButton>

      <Sep />

      {/* Alignment — SVG left-align style icon */}
      <DropdownMenu
        id="align"
        label={<>{activeAlignIcon}<span className="tiptap-dd__caret"> ▾</span></>}
        title="Text alignment"
        openMenu={openMenu}
        onToggle={toggleMenu}
        disabled={!isEditorReady}
      >
        <DropdownItem active={isAlignLeft} onClick={() => { editor?.chain().focus().setTextAlign("left").run(); closeMenu(); }}>
          <AlignLeftIcon /> <span style={{ marginLeft: "0.35rem" }}>Left</span>
        </DropdownItem>
        <DropdownItem active={isAlignCenter} onClick={() => { editor?.chain().focus().setTextAlign("center").run(); closeMenu(); }}>
          <AlignCenterIcon /> <span style={{ marginLeft: "0.35rem" }}>Center</span>
        </DropdownItem>
        <DropdownItem active={isAlignRight} onClick={() => { editor?.chain().focus().setTextAlign("right").run(); closeMenu(); }}>
          <AlignRightIcon /> <span style={{ marginLeft: "0.35rem" }}>Right</span>
        </DropdownItem>
      </DropdownMenu>

      {/* Lists — includes HR insert/delete at bottom */}
      <DropdownMenu
        id="list"
        label={<>{activeListIcon} List<span className="tiptap-dd__caret"> ▾</span></>}
        title="Lists and indentation"
        openMenu={openMenu}
        onToggle={toggleMenu}
        disabled={!isEditorReady}
      >
        <DropdownItem active={isBulletList} onClick={() => { editor?.chain().focus().toggleBulletList().run(); closeMenu(); }}>
          • Bullet list
        </DropdownItem>
        <DropdownItem active={isOrderedList} onClick={() => { editor?.chain().focus().toggleOrderedList().run(); closeMenu(); }}>
          1. Numbered list
        </DropdownItem>
        <DropdownItem
          active={isTaskList}
          onClick={() => {
            if (canToggleChecklist) { editor && toggleChecklist(editor, true); }
            closeMenu();
          }}
        >
          ☑ Checklist
        </DropdownItem>
        <DropdownItem onClick={() => { editor && handleListIndent(editor, "indent", true); closeMenu(); }}>
          → Indent
        </DropdownItem>
        <DropdownItem onClick={() => { editor && handleListIndent(editor, "outdent", true); closeMenu(); }}>
          ← Outdent
        </DropdownItem>
        <DropdownItem onClick={() => { editor?.chain().focus().setHorizontalRule().run(); closeMenu(); }}>
          ― Insert Line
        </DropdownItem>
        <DropdownItem onClick={() => { deleteHorizontalRule(); closeMenu(); }}>
          ✕ Delete Line
        </DropdownItem>
      </DropdownMenu>

    </div>
  );

  if (!editor) {
    return (
      <div className={wrapperClassName} style={{ minHeight, maxHeight: scrollable ? "180px" : undefined }}>
        {toolbar}
        <div className="flex min-h-0 flex-1 items-center px-2 py-2 text-slate-500">{placeholder ?? "Loading editor..."}</div>
      </div>
    );
  }

  return (
    <div className={wrapperClassName} style={{ minHeight, maxHeight: scrollable ? "180px" : undefined }}>
      {toolbar}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />
      <EditorContent editor={editor} className="tiptap-editor__content flex min-h-0 flex-1 scrollbar-subtle" />
    </div>
  );
}
