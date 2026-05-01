import { RichTextEditor, richTextToPlain } from "../components/rich-text-editor";
import { formatSavedAt } from "../lib/datetime";
import { useAppStore } from "../state/app-store";

export function NotebookView() {
  const { state, persistenceStatus, lastSavedAt, setNotesHtml } = useAppStore();
  const isEmpty = !richTextToPlain(state.preferences.notesHtml).trim();
  const saveCopy =
    persistenceStatus === "booting"
      ? "Opening local store…"
      : persistenceStatus === "error"
        ? "Local persistence issue detected."
        : lastSavedAt
          ? `Saved ${formatSavedAt(lastSavedAt)}`
          : "Saved locally.";

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4">
      <section className="glass-panel overflow-hidden">
        <div className="rounded-[24px] border border-cyan-300/15 bg-gradient-to-br from-cyan-300/10 to-blue-400/5 p-6">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Notebook</p>
          <h3 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">Notebook</h3>
          <p className="mt-2 text-base text-slate-300">
            Single-page notes sync with your existing Dashboard notes.
          </p>
        </div>
      </section>

      <section className="glass-panel flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Study Notes</p>
            <p className="mt-1 text-sm text-slate-300">Use formatting shortcuts to capture details quickly.</p>
          </div>
          <p className="text-xs text-slate-400">{saveCopy}</p>
        </div>

        <RichTextEditor
          value={state.preferences.notesHtml}
          onChange={(html) => {
            void setNotesHtml(html);
          }}
          placeholder="Type freely. Cmd+B/I/U for bold/italic/underline. * → bullet, - → dashed, 1. → numbered."
          className="min-h-[320px] flex-1 overflow-y-auto scrollbar-subtle"
        />

        {isEmpty ? (
          <div className="rounded-[18px] border border-dashed border-white/10 bg-slate-950/30 p-3 text-sm text-slate-300">
            Notebook workspace is active. Multi-page organization is still in progress; for now, keep quick study
            notes here.
          </div>
        ) : null}
      </section>
    </div>
  );
}
