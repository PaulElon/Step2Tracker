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
}

export function NotebookEditorAdapter(props: NotebookEditorProps) {
  if (FF.tiptapEditor) {
    return <TiptapEditor {...props} />;
  }

  return <RichTextEditor {...props} />;
}
