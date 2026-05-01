import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import type { NotebookEditorProps } from "./notebook-editor-adapter";

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

  if (!editor) {
    return (
      <div className={wrapperClassName} style={{ minHeight, maxHeight: scrollable ? "180px" : undefined }}>
        <div className="flex h-full min-h-0 flex-1 items-center px-2 py-2 text-slate-500">{placeholder ?? "Loading editor..."}</div>
      </div>
    );
  }

  return (
    <div className={wrapperClassName} style={{ minHeight, maxHeight: scrollable ? "180px" : undefined }}>
      <EditorContent editor={editor} className="flex h-full min-h-0 flex-1" />
    </div>
  );
}
