import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import type { NotebookEditorProps } from "./notebook-editor-adapter";

const TEXT_COLOR_OPTIONS = [
  { label: "Default", title: "Default text color", color: null, buttonText: "A", buttonStyle: undefined },
  { label: "White", title: "White text color", color: "#ffffff", buttonText: "A", buttonStyle: { backgroundColor: "#ffffff", color: "#0f172a" } },
  { label: "Red", title: "Red text color", color: "#ef4444", buttonText: "A", buttonStyle: { backgroundColor: "#ef4444", color: "#ffffff" } },
  { label: "Yellow", title: "Yellow text color", color: "#f59e0b", buttonText: "A", buttonStyle: { backgroundColor: "#f59e0b", color: "#0f172a" } },
  { label: "Green", title: "Green text color", color: "#22c55e", buttonText: "A", buttonStyle: { backgroundColor: "#22c55e", color: "#0f172a" } },
  { label: "Blue", title: "Blue text color", color: "#3b82f6", buttonText: "A", buttonStyle: { backgroundColor: "#3b82f6", color: "#ffffff" } },
] as const;

const HIGHLIGHT_OPTIONS = [
  { label: "None", title: "No highlight", color: null, buttonText: "H", buttonStyle: undefined },
  { label: "Yellow", title: "Yellow highlight", color: "#fef08a", buttonText: "H", buttonStyle: { backgroundColor: "#fef08a", color: "#0f172a" } },
  { label: "Green", title: "Green highlight", color: "#bbf7d0", buttonText: "H", buttonStyle: { backgroundColor: "#bbf7d0", color: "#0f172a" } },
  { label: "Blue", title: "Blue highlight", color: "#bfdbfe", buttonText: "H", buttonStyle: { backgroundColor: "#bfdbfe", color: "#0f172a" } },
  { label: "Red", title: "Red highlight", color: "#fecaca", buttonText: "H", buttonStyle: { backgroundColor: "#fecaca", color: "#0f172a" } },
] as const;

type ListItemType = "listItem" | "taskItem";

const TabIndentationExtension = Extension.create({
  name: "tabIndentation",
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        handleListIndent(editor, "indent");
        return true;
      },
      "Shift-Tab": ({ editor }) => {
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

    if (node.type.name === "taskItem") {
      return "taskItem";
    }

    if (node.type.name === "listItem") {
      return "listItem";
    }
  }

  return null;
}

function handleListIndent(editor: Editor, direction: "indent" | "outdent", focus = false) {
  const listItemType = getActiveListItemType(editor);

  if (!listItemType) {
    return false;
  }

  const chain = editor.chain();
  if (focus) {
    chain.focus();
  }

  if (direction === "indent") {
    chain.sinkListItem(listItemType).run();
  } else {
    chain.liftListItem(listItemType).run();
  }

  return true;
}

function canHandleListIndent(editor: Editor, direction: "indent" | "outdent") {
  const listItemType = getActiveListItemType(editor);

  if (!listItemType) {
    return false;
  }

  if (direction === "indent") {
    return editor.can().chain().sinkListItem(listItemType).run();
  }

  return editor.can().chain().liftListItem(listItemType).run();
}

function toggleChecklist(editor: Editor, focus = false) {
  const chain = editor.chain();
  if (focus) {
    chain.focus();
  }

  chain.toggleTaskList().run();
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

type ToolbarGroupProps = {
  children: ReactNode;
  label: string;
};

function ToolbarGroup({ children, label }: ToolbarGroupProps) {
  return (
    <div className="tiptap-editor__group" role="group" aria-label={label}>
      {children}
    </div>
  );
}

function ToolbarButton({ children, active = false, disabled = false, className, style, title, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      style={style}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onClick}
      className={`tiptap-editor__button${active ? " tiptap-editor__button--active" : ""}${className ? ` ${className}` : ""}`}
    >
      {children}
    </button>
  );
}

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

  onChangeRef.current = onChange;
  valueRef.current = value || "";

  const extensions = useMemo(
    () => [
      StarterKit,
      TabIndentationExtension,
      TextStyle,
      Color.configure({
        types: ["textStyle"],
      }),
      Highlight.configure({
        multicolor: true,
      }),
      Underline,
      TaskItem.configure({
        nested: true,
      }),
      TaskList.configure({
        itemTypeName: "taskItem",
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          class: "tiptap-editor__link",
        },
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
    ],
    [],
  );

  const editorProps = useMemo(
    () => ({
      attributes: {
        class: "notebook-tiptap-prosemirror",
      },
    }),
    [],
  );

  const editor = useEditor(
    {
      content: initialValueRef.current,
      extensions,
      editorProps,
      onUpdate: ({ editor: nextEditor }) => {
        if (isApplyingExternalContentRef.current) return;

        const html = nextEditor.getHTML();
        onChangeRef.current(html);
      },
    },
    [],
  );

  useEffect(() => {
    if (!editor) return;

    // Only sync external HTML when the page/document identity changes.
    // Same-key value churn must stay inside the editor so typing remains stable.
    if (lastAppliedEditorKeyRef.current === normalizedEditorKey) {
      return;
    }

    const nextHtml = valueRef.current;
    isApplyingExternalContentRef.current = true;
    try {
      editor.commands.setContent(nextHtml, false as never);
    } finally {
      isApplyingExternalContentRef.current = false;
    }

    lastAppliedEditorKeyRef.current = normalizedEditorKey;
  }, [editor, normalizedEditorKey]);

  const minHeight = `${Math.max(1, minLines) * 1.5}em`;
  const wrapperClassName = [
    "tiptap-editor w-full h-full min-h-0 flex flex-col rounded-xl border border-white/10 bg-slate-900/60 text-sm text-white focus-within:outline-none focus-within:ring-2 focus-within:ring-cyan-400/40",
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
  const isParagraph = editor ? editor.isActive("paragraph") : false;
  const isHeading1 = editor ? editor.isActive("heading", { level: 1 }) : false;
  const isHeading2 = editor ? editor.isActive("heading", { level: 2 }) : false;
  const isHeading3 = editor ? editor.isActive("heading", { level: 3 }) : false;
  const isBlockquote = editor ? editor.isActive("blockquote") : false;
  const isCodeBlock = editor ? editor.isActive("codeBlock") : false;
  const isBulletList = editor ? editor.isActive("bulletList") : false;
  const isOrderedList = editor ? editor.isActive("orderedList") : false;
  const isTaskList = editor ? editor.isActive("taskList") : false;
  const isLink = editor ? editor.isActive("link") : false;
  const isAlignLeft = editor ? editor.isActive({ textAlign: "left" }) : false;
  const isAlignCenter = editor ? editor.isActive({ textAlign: "center" }) : false;
  const isAlignRight = editor ? editor.isActive({ textAlign: "right" }) : false;
  const textColor = editor ? editor.getAttributes("textStyle").color ?? "" : "";
  const highlightColor = editor ? editor.getAttributes("highlight").color ?? "" : "";
  const canIndent = editor ? canHandleListIndent(editor, "indent") : false;
  const canOutdent = editor ? canHandleListIndent(editor, "outdent") : false;
  const canToggleChecklist = editor ? editor.can().chain().toggleTaskList().run() : false;

  const setLink = () => {
    if (!editor) return;

    const currentHref = editor.getAttributes("link").href;
    const nextHref = window.prompt("Enter link URL", typeof currentHref === "string" ? currentHref : "");

    if (nextHref == null) return;

    const trimmedHref = nextHref.trim();
    if (!trimmedHref) return;

    const normalizedHref = /^https?:\/\//i.test(trimmedHref) ? trimmedHref : `https://${trimmedHref}`;

    editor.chain().focus().extendMarkRange("link").setLink({ href: normalizedHref }).run();
  };

  const setTextColor = (color: string | null) => {
    if (!editor) return;

    const chain = editor.chain().focus();
    if (color) {
      chain.setColor(color).run();
      return;
    }

    chain.unsetColor().run();
  };

  const setHighlightColor = (color: string | null) => {
    if (!editor) return;

    const chain = editor.chain().focus();
    if (color) {
      chain.setHighlight({ color }).run();
      return;
    }

    chain.unsetHighlight().run();
  };

  const toolbar = (
    <div className="tiptap-editor__toolbar" role="toolbar" aria-label="Text formatting">
      <ToolbarGroup label="History controls">
        <ToolbarButton title="Undo" disabled={!isEditorReady || !canUndo} onClick={() => editor?.chain().focus().undo().run()}>
          Undo
        </ToolbarButton>
        <ToolbarButton title="Redo" disabled={!isEditorReady || !canRedo} onClick={() => editor?.chain().focus().redo().run()}>
          Redo
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup label="Text styles">
        <ToolbarButton title="Paragraph" active={isParagraph} disabled={!isEditorReady} onClick={() => editor?.chain().focus().setParagraph().run()}>
          P
        </ToolbarButton>
        <ToolbarButton
          title="Heading 1"
          active={isHeading1}
          disabled={!isEditorReady}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          H1
        </ToolbarButton>
        <ToolbarButton
          title="Heading 2"
          active={isHeading2}
          disabled={!isEditorReady}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </ToolbarButton>
        <ToolbarButton
          title="Heading 3"
          active={isHeading3}
          disabled={!isEditorReady}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          H3
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup label="Inline formatting">
        <ToolbarButton title="Bold" active={isBold} disabled={!isEditorReady} onClick={() => editor?.chain().focus().toggleBold().run()}>
          B
        </ToolbarButton>
        <ToolbarButton title="Italic" active={isItalic} disabled={!isEditorReady} onClick={() => editor?.chain().focus().toggleItalic().run()}>
          I
        </ToolbarButton>
        <ToolbarButton title="Underline" active={isUnderline} disabled={!isEditorReady} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
          U
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup label="Text color controls">
        <span className="tiptap-editor__group-label">Text</span>
        {TEXT_COLOR_OPTIONS.map((option) => {
          const isActive = option.color ? textColor === option.color : textColor === "";

          return (
            <ToolbarButton
              key={option.label}
              title={option.title}
              active={isActive}
              disabled={!isEditorReady}
              onClick={() => setTextColor(option.color)}
              className="tiptap-editor__button--swatch"
              style={option.buttonStyle as CSSProperties | undefined}
            >
              {option.buttonText}
            </ToolbarButton>
          );
        })}
      </ToolbarGroup>
      <ToolbarGroup label="Highlight controls">
        <span className="tiptap-editor__group-label">Highlight</span>
        {HIGHLIGHT_OPTIONS.map((option) => {
          const isActive = option.color ? highlightColor === option.color : highlightColor === "";

          return (
            <ToolbarButton
              key={option.label}
              title={option.title}
              active={isActive}
              disabled={!isEditorReady}
              onClick={() => setHighlightColor(option.color)}
              className="tiptap-editor__button--swatch"
              style={option.buttonStyle as CSSProperties | undefined}
            >
              {option.buttonText}
            </ToolbarButton>
          );
        })}
      </ToolbarGroup>
      <ToolbarGroup label="Lists">
        <ToolbarButton title="Bullet list" active={isBulletList} disabled={!isEditorReady} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          Bullet
        </ToolbarButton>
        <ToolbarButton title="Numbered list" active={isOrderedList} disabled={!isEditorReady} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
          Numbered
        </ToolbarButton>
        <ToolbarButton
          title="Checklist"
          active={isTaskList}
          disabled={!isEditorReady || !canToggleChecklist}
          onClick={() => editor && toggleChecklist(editor, true)}
        >
          Checklist
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup label="Indentation">
        <ToolbarButton
          title="Indent"
          disabled={!isEditorReady || !canIndent}
          onClick={() => editor && handleListIndent(editor, "indent", true)}
        >
          Indent
        </ToolbarButton>
        <ToolbarButton
          title="Outdent"
          disabled={!isEditorReady || !canOutdent}
          onClick={() => editor && handleListIndent(editor, "outdent", true)}
        >
          Outdent
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup label="Block formatting">
        <ToolbarButton
          title="Blockquote"
          active={isBlockquote}
          disabled={!isEditorReady}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          Quote
        </ToolbarButton>
        <ToolbarButton
          title="Code block"
          active={isCodeBlock}
          disabled={!isEditorReady}
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        >
          Code
        </ToolbarButton>
        <ToolbarButton
          title="Line"
          disabled={!isEditorReady}
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
        >
          Line
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup label="Link controls">
        <ToolbarButton title="Link" active={isLink} disabled={!isEditorReady} onClick={setLink}>
          Link
        </ToolbarButton>
        <ToolbarButton title="Unlink" disabled={!isEditorReady} onClick={() => editor?.chain().focus().unsetLink().run()}>
          Unlink
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup label="Alignment controls">
        <ToolbarButton
          title="Left"
          active={isAlignLeft}
          disabled={!isEditorReady}
          onClick={() => editor?.chain().focus().setTextAlign("left").run()}
        >
          Left
        </ToolbarButton>
        <ToolbarButton
          title="Center"
          active={isAlignCenter}
          disabled={!isEditorReady}
          onClick={() => editor?.chain().focus().setTextAlign("center").run()}
        >
          Center
        </ToolbarButton>
        <ToolbarButton
          title="Right"
          active={isAlignRight}
          disabled={!isEditorReady}
          onClick={() => editor?.chain().focus().setTextAlign("right").run()}
        >
          Right
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup label="Cleanup">
        <ToolbarButton
          title="Clear formatting"
          disabled={!isEditorReady}
          onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}
        >
          Clear
        </ToolbarButton>
      </ToolbarGroup>
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
      <EditorContent editor={editor} className="tiptap-editor__content flex min-h-0 flex-1 scrollbar-subtle" />
    </div>
  );
}
