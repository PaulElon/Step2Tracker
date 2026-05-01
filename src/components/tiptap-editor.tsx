import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import type { NotebookEditorProps } from "./notebook-editor-adapter";

type ToolbarButtonProps = {
  children: string;
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick?: () => void;
};

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
  const editor = useEditor({
    content: value || "",
    extensions: [StarterKit, Underline],
    editorProps: {
      attributes: {
        class: "notebook-tiptap-prosemirror",
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      onChange(nextEditor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;

    const currentHtml = editor.getHTML();
    const nextHtml = value || "";

    if (currentHtml !== nextHtml) {
      editor.commands.setContent(nextHtml, { emitUpdate: false });
    }
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
  const isBold = editor ? editor.isActive("bold") : false;
  const isItalic = editor ? editor.isActive("italic") : false;
  const isUnderline = editor ? editor.isActive("underline") : false;
  const isBulletList = editor ? editor.isActive("bulletList") : false;
  const isOrderedList = editor ? editor.isActive("orderedList") : false;

  if (!editor) {
    return (
      <div className={wrapperClassName} style={{ minHeight, maxHeight: scrollable ? "180px" : undefined }}>
        <div className="tiptap-editor__toolbar" role="toolbar" aria-label="Text formatting">
          <ToolbarButton title="Undo" disabled>
            Undo
          </ToolbarButton>
          <ToolbarButton title="Redo" disabled>
            Redo
          </ToolbarButton>
          <ToolbarButton title="Bold" disabled>
            B
          </ToolbarButton>
          <ToolbarButton title="Italic" disabled>
            I
          </ToolbarButton>
          <ToolbarButton title="Underline" disabled>
            U
          </ToolbarButton>
          <ToolbarButton title="Bullet list" disabled>
            •
          </ToolbarButton>
          <ToolbarButton title="Numbered list" disabled>
            1.
          </ToolbarButton>
        </div>
        <div className="flex min-h-0 flex-1 items-center px-2 py-2 text-slate-500">{placeholder ?? "Loading editor..."}</div>
      </div>
    );
  }

  return (
    <div className={wrapperClassName} style={{ minHeight, maxHeight: scrollable ? "180px" : undefined }}>
      <div className="tiptap-editor__toolbar" role="toolbar" aria-label="Text formatting">
        <ToolbarButton title="Undo" disabled={!canUndo} onClick={() => editor.chain().focus().undo().run()}>
          Undo
        </ToolbarButton>
        <ToolbarButton title="Redo" disabled={!canRedo} onClick={() => editor.chain().focus().redo().run()}>
          Redo
        </ToolbarButton>
        <ToolbarButton title="Bold" active={isBold} onClick={() => editor.chain().focus().toggleBold().run()}>
          B
        </ToolbarButton>
        <ToolbarButton title="Italic" active={isItalic} onClick={() => editor.chain().focus().toggleItalic().run()}>
          I
        </ToolbarButton>
        <ToolbarButton title="Underline" active={isUnderline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          U
        </ToolbarButton>
        <ToolbarButton title="Bullet list" active={isBulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          •
        </ToolbarButton>
        <ToolbarButton title="Numbered list" active={isOrderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          1.
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} className="tiptap-editor__content flex min-h-0 flex-1" />
    </div>
  );
}
