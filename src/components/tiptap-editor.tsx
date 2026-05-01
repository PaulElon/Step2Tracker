import { useEffect, useRef, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import type { NotebookEditorProps } from "./notebook-editor-adapter";

type ToolbarButtonProps = {
  children: string;
  active?: boolean;
  disabled?: boolean;
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

function ToolbarButton({ children, active = false, disabled = false, title, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onClick}
      className={`tiptap-editor__button${active ? " tiptap-editor__button--active" : ""}`}
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
}: NotebookEditorProps) {
  const lastEmittedHtmlRef = useRef(value || "");

  const editor = useEditor({
    content: value || "",
    extensions: [
      StarterKit,
      Underline,
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
    editorProps: {
      attributes: {
        class: "notebook-tiptap-prosemirror",
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      const html = nextEditor.getHTML();
      lastEmittedHtmlRef.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    if (!editor) return;

    const currentHtml = editor.getHTML();
    const nextHtml = value || "";

    if (nextHtml === lastEmittedHtmlRef.current) return;
    if (currentHtml === nextHtml) return;

    lastEmittedHtmlRef.current = nextHtml;
    editor.commands.setContent(nextHtml, { emitUpdate: false });
  }, [editor, value]);

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
  const isLink = editor ? editor.isActive("link") : false;
  const isAlignLeft = editor ? editor.isActive({ textAlign: "left" }) : false;
  const isAlignCenter = editor ? editor.isActive({ textAlign: "center" }) : false;
  const isAlignRight = editor ? editor.isActive({ textAlign: "right" }) : false;

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
      <ToolbarGroup label="Lists">
        <ToolbarButton title="Bullet list" active={isBulletList} disabled={!isEditorReady} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          Bullet
        </ToolbarButton>
        <ToolbarButton title="Numbered list" active={isOrderedList} disabled={!isEditorReady} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
          Numbered
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
