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
  /** When true the editor fills 100% of its parent height and scrolls internally. Overrides the 180px scrollable cap. */
  fillParent?: boolean;
  editorKey?: string;
}

export function NotebookEditorAdapter({ editorKey, ...props }: NotebookEditorProps) {
  if (FF.tiptapEditor) {
    return <TiptapEditor editorKey={editorKey} {...props} />;
  }

  return <RichTextEditor {...props} />;
}
