import { FF } from "../lib/feature-flags";
import { RichTextEditor } from "./rich-text-editor";
import { TiptapEditor } from "./tiptap-editor";

export interface NotebookEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minLines?: number;
  scrollable?: boolean;
  editorKey?: string;
}

export function NotebookEditorAdapter({ editorKey, ...props }: NotebookEditorProps) {
  if (FF.tiptapEditor) {
    return <TiptapEditor editorKey={editorKey} {...props} />;
  }

  return <RichTextEditor {...props} />;
}
