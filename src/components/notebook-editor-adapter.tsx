import { RichTextEditor } from "./rich-text-editor";

export interface NotebookEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minLines?: number;
  scrollable?: boolean;
}

export function NotebookEditorAdapter(props: NotebookEditorProps) {
  return <RichTextEditor {...props} />;
}
