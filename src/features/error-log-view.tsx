import { createElement, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Download, Edit2, Trash2, X } from "lucide-react";
import { MetricCard } from "../components/ui";
import { primaryButtonClassName, secondaryButtonClassName } from "../lib/ui";
import {
  ERROR_LOG_ERROR_TYPE_VALUES,
  ERROR_LOG_SOURCE_VALUES,
  ERROR_LOG_SYSTEM_VALUES,
} from "../lib/storage";
import { useAppStore } from "../state/app-store";
import type {
  ErrorLogEntry,
  ErrorLogErrorType,
  ErrorLogInput,
  ErrorLogPriority,
  ErrorLogSource,
  ErrorLogSystem,
  WeakTopicInput,
  WeakTopicPriority,
} from "../types/models";

type SortKey = "newest" | "system" | "topic" | "errorType" | "priority";

const PRIORITY_PILL: Record<ErrorLogPriority, string> = {
  high: "border-rose-300/30 bg-rose-300/15 text-rose-200",
  medium: "border-amber-300/30 bg-amber-300/15 text-amber-200",
  low: "border-slate-300/20 bg-slate-300/10 text-slate-300",
};

const SOURCE_COLORS: Record<ErrorLogSource, string> = {
  UWorld: "bg-cyan-500/15 border-cyan-500/25 text-cyan-200",
  TrueLearn: "bg-emerald-500/15 border-emerald-500/25 text-emerald-200",
  NBME: "bg-violet-500/15 border-violet-500/25 text-violet-200",
  "CMS Form": "bg-rose-500/15 border-rose-500/25 text-rose-200",
  AMBOSS: "bg-amber-500/15 border-amber-500/25 text-amber-200",
  COMSAE: "bg-indigo-500/15 border-indigo-500/25 text-indigo-200",
  Other: "bg-slate-500/15 border-slate-500/25 text-slate-300",
};

const ERROR_TYPE_COLORS: Record<ErrorLogErrorType, string> = {
  "Knowledge Gap": "bg-amber-500/15 border-amber-500/25 text-amber-200",
  "Misread Question": "bg-blue-500/15 border-blue-500/25 text-blue-200",
  "Wrong Algorithm": "bg-rose-500/15 border-rose-500/25 text-rose-200",
  "Trap Answer": "bg-purple-500/15 border-purple-500/25 text-purple-200",
};

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${className}`}>
      {children}
    </span>
  );
}

function modeCount<T extends string>(values: T[]): T | null {
  if (!values.length) return null;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let top = values[0];
  let topCount = 0;
  for (const [k, c] of counts) {
    if (c > topCount) { top = k; topCount = c; }
  }
  return top;
}

// Whitelist serializer: only <b>, <i>, <u>, <br> pass through; all others unwrap to text
function sanitizeHtml(html: string): string {
  const allowed = new Set(["b", "i", "u", "br"]);
  const doc = new DOMParser().parseFromString(html, "text/html");
  function processNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes).map(processNode).join("");
    if (allowed.has(tag)) return tag === "br" ? "<br>" : `<${tag}>${children}</${tag}>`;
    return children;
  }
  return Array.from(doc.body.childNodes).map(processNode).join("");
}

function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent ?? "";
}

// Parses sanitized rich-text HTML into React elements (no raw HTML injection)
function parseRichHtml(html: string): React.ReactNode[] {
  const sanitized = sanitizeHtml(html);
  const doc = new DOMParser().parseFromString(sanitized, "text/html");
  function walk(node: Node, key: number): React.ReactNode {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes).map((n, i) => walk(n, i));
    if (tag === "br") return createElement("br", { key });
    if (tag === "b" || tag === "i" || tag === "u") return createElement(tag, { key }, ...children);
    return <>{children}</>;
  }
  return Array.from(doc.body.childNodes).map((n, i) => walk(n, i));
}

function RichRender({ html, className }: { html: string; className?: string }) {
  return <span className={className}>{parseRichHtml(html)}</span>;
}

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="fixed right-4 top-4 z-50 rounded-xl border border-emerald-500/30 bg-slate-900/95 px-4 py-3 text-sm text-emerald-200 shadow-lg backdrop-blur">
      {message}
    </div>
  );
}

// Sets contentEditable content safely using DOMParser + replaceChildren (no innerHTML assignment)
function setEditorContent(el: HTMLDivElement, html: string) {
  const sanitized = sanitizeHtml(html);
  const doc = new DOMParser().parseFromString(sanitized, "text/html");
  const frag = document.createDocumentFragment();
  Array.from(doc.body.childNodes).forEach((n) => frag.appendChild(document.importNode(n, true)));
  el.replaceChildren(frag);
}

function RichEditor({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hasFocusRef = useRef(false);

  useEffect(() => {
    if (ref.current && !hasFocusRef.current) {
      setEditorContent(ref.current, value);
    }
  }, [value]);

  function execFormat(cmd: string) {
    ref.current?.focus();
    // execCommand is deprecated but universally supported for this lightweight use-case
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand(cmd, false);
  }

  function readEditorHtml(): string {
    if (!ref.current) return "";
    // Serialize the live DOM tree through our sanitizer (no innerHTML read needed)
    function serializeNode(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      const children = Array.from(el.childNodes).map(serializeNode).join("");
      const allowed = new Set(["b", "i", "u", "br"]);
      if (allowed.has(tag)) return tag === "br" ? "<br>" : `<${tag}>${children}</${tag}>`;
      if (tag === "div") return children + (el.nextSibling ? "<br>" : "");
      return children;
    }
    return Array.from(ref.current.childNodes).map(serializeNode).join("");
  }

  return (
    <div className={className}>
      <div className="mb-0.5 flex gap-0.5">
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); execFormat("bold"); }}
          className="rounded px-1 py-0.5 text-[10px] font-bold text-slate-500 hover:bg-white/10 hover:text-white"
        >
          B
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); execFormat("italic"); }}
          className="rounded px-1 py-0.5 text-[10px] italic text-slate-500 hover:bg-white/10 hover:text-white"
        >
          I
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); execFormat("underline"); }}
          className="rounded px-1 py-0.5 text-[10px] underline text-slate-500 hover:bg-white/10 hover:text-white"
        >
          U
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onFocus={() => { hasFocusRef.current = true; }}
        onBlur={() => {
          hasFocusRef.current = false;
          onChange(readEditorHtml());
        }}
        className="min-h-[28px] w-full rounded-xl border border-white/10 bg-slate-900/60 px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40 [&:empty]:before:pointer-events-none [&:empty]:before:text-slate-500 [&:empty]:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}

function exportCsv(entries: ErrorLogEntry[]) {
  const headers = ["Source", "Exam/Block", "System", "Topic", "Error Type", "Priority", "Missed Pattern", "Fix", "Date"];
  const rows = entries.map((e) => [
    e.source,
    e.examBlock,
    e.system,
    e.topic,
    e.errorType,
    e.priority,
    stripHtml(e.missedPattern),
    stripHtml(e.fix),
    e.entryDate || e.createdAt.slice(0, 10),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `exam-mistakes-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_FORM: ErrorLogInput = {
  source: "UWorld",
  examBlock: "",
  system: "IM/FM",
  topic: "",
  errorType: "Knowledge Gap",
  missedPattern: "",
  fix: "",
  priority: "medium",
  entryDate: todayIso(),
};

type FormErrors = Partial<Record<keyof ErrorLogInput, string>>;

function validateForm(draft: ErrorLogInput): FormErrors {
  const errors: FormErrors = {};
  if (!draft.source.trim()) errors.source = "Required";
  if (!draft.system.trim()) errors.system = "Required";
  if (!draft.topic.trim()) errors.topic = "Required";
  if (!draft.errorType.trim()) errors.errorType = "Required";
  if (!stripHtml(draft.missedPattern).trim()) errors.missedPattern = "Required";
  if (!stripHtml(draft.fix).trim()) errors.fix = "Required";
  return errors;
}

const PRIORITY_SORT_ORDER: Record<ErrorLogPriority, number> = { high: 0, medium: 1, low: 2 };

export function ErrorLogView() {
  const { state, upsertErrorLogEntry, trashErrorLogEntry, upsertWeakTopic } = useAppStore();
  const entries = state.errorLogEntries;

  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState<ErrorLogSource | "All">("All");
  const [filterSystem, setFilterSystem] = useState<ErrorLogSystem | "All">("All");
  const [filterErrorType, setFilterErrorType] = useState<ErrorLogErrorType | "All">("All");
  const [editingEntry, setEditingEntry] = useState<ErrorLogEntry | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ErrorLogInput>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const topicRef = useRef<HTMLInputElement>(null);
  const deferredSearch = useDeferredValue(search);
  const isEditMode = !!editingEntry;

  useEffect(() => {
    if (editingEntry) {
      setDraft({
        id: editingEntry.id,
        source: editingEntry.source as ErrorLogSource,
        examBlock: editingEntry.examBlock,
        system: editingEntry.system as ErrorLogSystem,
        topic: editingEntry.topic,
        errorType: editingEntry.errorType as ErrorLogErrorType,
        missedPattern: editingEntry.missedPattern,
        fix: editingEntry.fix,
        priority: (editingEntry.priority ?? "medium") as ErrorLogPriority,
        entryDate: editingEntry.entryDate || editingEntry.createdAt.slice(0, 10),
      });
    } else {
      setDraft({ ...EMPTY_FORM, entryDate: todayIso() });
    }
    setFormErrors({});
  }, [editingEntry]);

  const filtered = useMemo(() => {
    const q = deferredSearch.toLowerCase().trim();
    return entries.filter((e) => {
      if (filterSource !== "All" && e.source !== filterSource) return false;
      if (filterSystem !== "All" && e.system !== filterSystem) return false;
      if (filterErrorType !== "All" && e.errorType !== filterErrorType) return false;
      if (q && !`${e.topic} ${e.source} ${e.examBlock} ${stripHtml(e.missedPattern)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, deferredSearch, filterSource, filterSystem, filterErrorType]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortKey === "newest") return b.createdAt.localeCompare(a.createdAt);
      if (sortKey === "system") return a.system.localeCompare(b.system) || b.createdAt.localeCompare(a.createdAt);
      if (sortKey === "topic") return a.topic.localeCompare(b.topic);
      if (sortKey === "errorType") return a.errorType.localeCompare(b.errorType) || b.createdAt.localeCompare(a.createdAt);
      if (sortKey === "priority") {
        const pa = PRIORITY_SORT_ORDER[(a.priority ?? "medium") as ErrorLogPriority] ?? 1;
        const pb = PRIORITY_SORT_ORDER[(b.priority ?? "medium") as ErrorLogPriority] ?? 1;
        return pa - pb || b.createdAt.localeCompare(a.createdAt);
      }
      return 0;
    });
  }, [filtered, sortKey]);

  const mostCommonErrorType = modeCount(entries.map((e) => e.errorType as ErrorLogErrorType));
  const mostCommonSystem = modeCount(entries.map((e) => e.system as ErrorLogSystem));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors = validateForm(draft);
    if (Object.keys(errors).length) {
      setFormErrors(errors);
      return;
    }
    setSaving(true);
    try {
      await upsertErrorLogEntry(draft);
      setEditingEntry(null);
      setDraft({ ...EMPTY_FORM, entryDate: todayIso() });
      setFormErrors({});
      setTimeout(() => topicRef.current?.focus(), 50);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await trashErrorLogEntry(id);
    setConfirmDeleteId(null);
  }

  async function handleAddWeakTopic(entry: ErrorLogEntry) {
    const capitalizedPriority = (
      (entry.priority ?? "medium").charAt(0).toUpperCase() +
      (entry.priority ?? "medium").slice(1)
    ) as WeakTopicPriority;

    const notesText = [
      entry.system,
      entry.errorType,
      stripHtml(entry.missedPattern),
      stripHtml(entry.fix),
    ].filter(Boolean).join(" | ");

    const input: WeakTopicInput = {
      topic: entry.topic,
      entryType: "manual",
      priority: capitalizedPriority,
      status: "Active",
      notes: notesText,
      lastSeenAt: entry.entryDate || entry.createdAt.slice(0, 10),
      sourceLabel: entry.source,
    };

    await upsertWeakTopic(input);
    setToast(`Added "${entry.topic}" as a weak topic.`);
  }

  const selectClass = "w-full rounded-xl border border-white/10 bg-slate-900/60 px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40";
  const inputClass = "w-full rounded-xl border border-white/10 bg-slate-900/60 px-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/40";

  function compactField(label: string, error: string | undefined, children: React.ReactNode) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <label className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
          {label}
        </label>
        {children}
        {error ? <p className="text-[10px] text-rose-400">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 pb-6">
      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}

      {/* Row 1 — Metric cards */}
      <div className="grid shrink-0 grid-cols-3 gap-3">
        <MetricCard label="Total Logged" value={String(entries.length)} />
        <MetricCard label="Most Common Error Type" value={mostCommonErrorType ?? "—"} />
        <MetricCard label="Most Common Category" value={mostCommonSystem ?? "—"} />
      </div>

      {/* Row 2 — Log Entry form, horizontal bar, same height as Row 1 */}
      <section className="glass-panel shrink-0 min-w-0 overflow-x-auto">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-white">
            {isEditMode ? "Edit Entry" : "Log Entry"}
          </p>
          {isEditMode ? (
            <button
              type="button"
              onClick={() => setEditingEntry(null)}
              className="rounded-lg p-1 text-slate-500 hover:text-slate-300 transition-colors"
              title="Cancel edit"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="flex items-start gap-3">
          {compactField("Source", formErrors.source,
            <select
              value={draft.source}
              onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value as ErrorLogSource }))}
              className={`${selectClass} w-[90px]`}
            >
              {ERROR_LOG_SOURCE_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}

          {compactField("Exam / Block", undefined,
            <input
              type="text"
              value={draft.examBlock}
              onChange={(e) => setDraft((d) => ({ ...d, examBlock: e.target.value }))}
              placeholder="Block 2"
              className={`${inputClass} w-[80px]`}
            />
          )}

          {compactField("System", formErrors.system,
            <select
              value={draft.system}
              onChange={(e) => setDraft((d) => ({ ...d, system: e.target.value as ErrorLogSystem }))}
              className={`${selectClass} w-[100px]`}
            >
              {ERROR_LOG_SYSTEM_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}

          {compactField("Topic", formErrors.topic,
            <input
              ref={topicRef}
              type="text"
              value={draft.topic}
              onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value }))}
              placeholder="Aortic dissection"
              className={`${inputClass} w-[130px]`}
            />
          )}

          {compactField("Error Type", formErrors.errorType,
            <select
              value={draft.errorType}
              onChange={(e) => setDraft((d) => ({ ...d, errorType: e.target.value as ErrorLogErrorType }))}
              className={`${selectClass} w-[120px]`}
            >
              {ERROR_LOG_ERROR_TYPE_VALUES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}

          {compactField("Priority", undefined,
            <select
              value={draft.priority}
              onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as ErrorLogPriority }))}
              className={`${selectClass} w-[82px]`}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          )}

          {compactField("Date", undefined,
            <input
              type="date"
              value={draft.entryDate}
              onChange={(e) => setDraft((d) => ({ ...d, entryDate: e.target.value }))}
              className={`${inputClass} w-[118px]`}
            />
          )}

          <div className="flex min-w-0 flex-col gap-0.5" style={{ width: 160 }}>
            <label className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
              Missed Pattern
            </label>
            <RichEditor
              value={draft.missedPattern}
              onChange={(html) => setDraft((d) => ({ ...d, missedPattern: html }))}
              placeholder="What did you miss?"
            />
            {formErrors.missedPattern ? <p className="text-[10px] text-rose-400">{formErrors.missedPattern}</p> : null}
          </div>

          <div className="flex min-w-0 flex-col gap-0.5" style={{ width: 160 }}>
            <label className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
              Fix
            </label>
            <RichEditor
              value={draft.fix}
              onChange={(html) => setDraft((d) => ({ ...d, fix: html }))}
              placeholder="What will you do differently?"
            />
            {formErrors.fix ? <p className="text-[10px] text-rose-400">{formErrors.fix}</p> : null}
          </div>

          <div className="flex shrink-0 flex-col justify-end gap-1.5 self-end">
            <button
              type="submit"
              disabled={saving}
              className={primaryButtonClassName}
            >
              {saving ? "Saving…" : isEditMode ? "Save Changes" : "Log Entry"}
            </button>
            {isEditMode ? (
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className={secondaryButtonClassName}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section>

      {/* Row 3 — Entries list, fills remaining space */}
      <section className="glass-panel min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto scrollbar-subtle">
          {/* Header + controls */}
          <div className="sticky top-0 z-10 bg-inherit pb-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">
                Entries
                {sorted.length !== entries.length ? (
                  <span className="ml-1.5 text-xs font-normal text-slate-400">
                    ({sorted.length} of {entries.length})
                  </span>
                ) : null}
              </p>
              <button
                type="button"
                className={secondaryButtonClassName}
                onClick={() => exportCsv(sorted)}
                title="Export CSV"
              >
                <Download className="h-4 w-4" />
                Export
              </button>
            </div>

            {/* Search + filters */}
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                type="text"
                placeholder="Search topic, source, pattern…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="min-w-[180px] flex-1 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
              />
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value as ErrorLogSource | "All")}
                className="rounded-xl border border-white/10 bg-slate-900/60 px-2 py-1.5 text-xs text-white focus:outline-none"
              >
                <option value="All">All Sources</option>
                {ERROR_LOG_SOURCE_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                value={filterSystem}
                onChange={(e) => setFilterSystem(e.target.value as ErrorLogSystem | "All")}
                className="rounded-xl border border-white/10 bg-slate-900/60 px-2 py-1.5 text-xs text-white focus:outline-none"
              >
                <option value="All">All Systems</option>
                {ERROR_LOG_SYSTEM_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                value={filterErrorType}
                onChange={(e) => setFilterErrorType(e.target.value as ErrorLogErrorType | "All")}
                className="rounded-xl border border-white/10 bg-slate-900/60 px-2 py-1.5 text-xs text-white focus:outline-none"
              >
                <option value="All">All Error Types</option>
                {ERROR_LOG_ERROR_TYPE_VALUES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Sort pills */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(["newest", "priority", "system", "topic", "errorType"] as SortKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSortKey(key)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    sortKey === key
                      ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-200"
                      : "border-white/10 bg-white/5 text-slate-400 hover:text-white"
                  }`}
                >
                  {key === "newest" ? "Newest" : key === "errorType" ? "Error Type" : key.charAt(0).toUpperCase() + key.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Entry cards */}
          <div className="mt-2 space-y-2 pb-4">
            {sorted.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">
                {entries.length === 0
                  ? "No mistakes logged yet. Use the form above to log your first one."
                  : "No entries match the current filters."}
              </div>
            ) : (
              sorted.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  isEditing={editingEntry?.id === entry.id}
                  confirmDeleteId={confirmDeleteId}
                  onEdit={() => { setEditingEntry(entry); setConfirmDeleteId(null); }}
                  onDeleteRequest={() => setConfirmDeleteId(entry.id)}
                  onDeleteConfirm={() => { void handleDelete(entry.id); }}
                  onDeleteCancel={() => setConfirmDeleteId(null)}
                  onAddWeakTopic={() => { void handleAddWeakTopic(entry); }}
                />
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function EntryCard({
  entry,
  isEditing,
  confirmDeleteId,
  onEdit,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  onAddWeakTopic,
}: {
  entry: ErrorLogEntry;
  isEditing: boolean;
  confirmDeleteId: string | null;
  onEdit: () => void;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  onAddWeakTopic: () => void;
}) {
  const priority = (entry.priority ?? "medium") as ErrorLogPriority;
  const displayDate = entry.entryDate || entry.createdAt.slice(0, 10);

  return (
    <div
      className={`w-full rounded-xl border p-3 transition-colors ${
        isEditing
          ? "border-cyan-400/30 bg-cyan-400/5"
          : "border-white/[0.07] bg-white/[0.03] hover:border-white/15"
      }`}
    >
      {/* Top row: badges + topic + date + actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={SOURCE_COLORS[entry.source as ErrorLogSource] ?? SOURCE_COLORS.Other}>
              {entry.source}
            </Badge>
            <Badge className={ERROR_TYPE_COLORS[entry.errorType as ErrorLogErrorType] ?? ERROR_TYPE_COLORS["Knowledge Gap"]}>
              {entry.errorType}
            </Badge>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${PRIORITY_PILL[priority]}`}>
              {priority}
            </span>
            {entry.examBlock ? (
              <span className="text-[10px] text-slate-500">{entry.examBlock}</span>
            ) : null}
            <span className="text-xs font-semibold text-white">{entry.topic}</span>
            <span className="text-xs text-slate-400">{entry.system}</span>
            <span className="text-[10px] text-slate-500">{displayDate}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-1">
          {confirmDeleteId === entry.id ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onDeleteConfirm}
                className="text-xs font-medium text-rose-400 hover:text-rose-300"
              >
                Confirm delete
              </button>
              <button
                type="button"
                onClick={onDeleteCancel}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={onAddWeakTopic}
                className="rounded-lg px-2 py-1 text-[10px] font-medium text-slate-400 hover:bg-white/5 hover:text-cyan-300 transition-colors"
                title="Add as weak topic"
              >
                + Weak Topic
              </button>
              <button
                type="button"
                onClick={onEdit}
                className="rounded-lg p-1.5 text-slate-500 hover:text-cyan-300 transition-colors"
                title="Edit"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onDeleteRequest}
                className="rounded-lg p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Missed Pattern */}
      {entry.missedPattern ? (
        <p className="mt-1.5 text-xs text-slate-300">
          <span className="font-medium text-slate-500">Missed: </span>
          <RichRender html={entry.missedPattern} />
        </p>
      ) : null}

      {/* Fix */}
      {entry.fix ? (
        <p className="mt-1 text-xs text-slate-400">
          <span className="font-medium text-slate-500">Fix: </span>
          <RichRender html={entry.fix} />
        </p>
      ) : null}
    </div>
  );
}
