import { Download, Edit2, Trash2, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, MetricCard, Panel } from "../components/ui";
import { primaryButtonClassName, secondaryButtonClassName } from "../lib/ui";
import {
  ERROR_LOG_ERROR_TYPE_VALUES,
  ERROR_LOG_SOURCE_VALUES,
  ERROR_LOG_SYSTEM_VALUES,
} from "../lib/storage";
import { useAppStore } from "../state/app-store";
import type { ErrorLogEntry, ErrorLogErrorType, ErrorLogInput, ErrorLogSource, ErrorLogSystem } from "../types/models";

type SortKey = "newest" | "system" | "topic" | "errorType";

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

function exportCsv(entries: ErrorLogEntry[]) {
  const headers = ["Source", "Exam/Block", "System", "Topic", "Error Type", "Missed Pattern", "Fix", "Date"];
  const rows = entries.map((e) => [
    e.source,
    e.examBlock,
    e.system,
    e.topic,
    e.errorType,
    e.missedPattern,
    e.fix,
    e.createdAt.slice(0, 10),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `error-log-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const EMPTY_FORM: ErrorLogInput = {
  source: "UWorld",
  examBlock: "",
  system: "IM/FM",
  topic: "",
  errorType: "Knowledge Gap",
  missedPattern: "",
  fix: "",
};

type FormErrors = Partial<Record<keyof ErrorLogInput, string>>;

function validateForm(draft: ErrorLogInput): FormErrors {
  const errors: FormErrors = {};
  if (!draft.source.trim()) errors.source = "Required";
  if (!draft.system.trim()) errors.system = "Required";
  if (!draft.topic.trim()) errors.topic = "Required";
  if (!draft.errorType.trim()) errors.errorType = "Required";
  if (!draft.missedPattern.trim()) errors.missedPattern = "Required";
  if (!draft.fix.trim()) errors.fix = "Required";
  return errors;
}

export function ErrorLogView() {
  const { state, upsertErrorLogEntry, trashErrorLogEntry } = useAppStore();
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
  const topicRef = useRef<HTMLInputElement>(null);

  const deferredSearch = useDeferredValue(search);

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
      });
    } else {
      setDraft(EMPTY_FORM);
    }
    setFormErrors({});
  }, [editingEntry]);

  const filtered = useMemo(() => {
    const q = deferredSearch.toLowerCase().trim();
    return entries.filter((e) => {
      if (filterSource !== "All" && e.source !== filterSource) return false;
      if (filterSystem !== "All" && e.system !== filterSystem) return false;
      if (filterErrorType !== "All" && e.errorType !== filterErrorType) return false;
      if (q && !`${e.topic} ${e.source} ${e.examBlock} ${e.missedPattern}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, deferredSearch, filterSource, filterSystem, filterErrorType]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortKey === "newest") return b.createdAt.localeCompare(a.createdAt);
      if (sortKey === "system") return a.system.localeCompare(b.system) || b.createdAt.localeCompare(a.createdAt);
      if (sortKey === "topic") return a.topic.localeCompare(b.topic);
      if (sortKey === "errorType") return a.errorType.localeCompare(b.errorType) || b.createdAt.localeCompare(a.createdAt);
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
      setDraft(EMPTY_FORM);
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

  function field(label: string, error: string | undefined, children: React.ReactNode) {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-400">{label}</label>
        {children}
        {error ? <p className="mt-1 text-xs text-rose-400">{error}</p> : null}
      </div>
    );
  }

  const selectClass = "w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40";
  const inputClass = "w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/40";
  const textareaClass = `${inputClass} resize-none`;

  const isEditMode = !!editingEntry;

  return (
    <div className="space-y-4 pb-6">
      {/* Metrics */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="Total Logged" value={String(entries.length)} />
        <MetricCard label="Most Common Error" value={mostCommonErrorType ?? "—"} />
        <MetricCard label="Most Common System" value={mostCommonSystem ?? "—"} />
      </div>

      {/* Main grid */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        {/* Left — table */}
        <Panel>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">Entries</p>
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
          <div className="mt-3 flex flex-wrap gap-2">
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
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(["newest", "system", "topic", "errorType"] as SortKey[]).map((key) => (
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

          {/* Table */}
          <div className="mt-3">
            {sorted.length === 0 ? (
              <>
                <EmptyState title="No errors logged" description="Use the form on the right to log your first error." />
                {/* Ghost example row */}
                <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-3 opacity-50">
                  <div className="flex flex-wrap items-start gap-2">
                    <Badge className={SOURCE_COLORS["UWorld"]}>UWorld</Badge>
                    <Badge className={ERROR_TYPE_COLORS["Trap Answer"]}>Trap Answer</Badge>
                    <span className="text-xs font-semibold text-slate-300">Aortic dissection</span>
                    <span className="text-xs text-slate-500">IM/FM</span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-400">Missed pattern: Tearing chest pain + pulse deficit</p>
                  <p className="mt-0.5 text-xs text-slate-500">Fix: Always compare bilateral BPs in chest pain</p>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                {sorted.map((entry) => (
                  <div
                    key={entry.id}
                    className={`group rounded-xl border p-3 transition-colors ${
                      editingEntry?.id === entry.id
                        ? "border-cyan-400/30 bg-cyan-400/5"
                        : "border-white/[0.07] bg-white/[0.03] hover:border-white/15"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge className={SOURCE_COLORS[entry.source as ErrorLogSource] ?? SOURCE_COLORS.Other}>
                            {entry.source}
                          </Badge>
                          <Badge className={ERROR_TYPE_COLORS[entry.errorType as ErrorLogErrorType] ?? ERROR_TYPE_COLORS["Knowledge Gap"]}>
                            {entry.errorType}
                          </Badge>
                          {entry.examBlock ? (
                            <span className="text-[10px] text-slate-500">{entry.examBlock}</span>
                          ) : null}
                          <span className="text-xs font-semibold text-white">{entry.topic}</span>
                          <span className="text-xs text-slate-400">{entry.system}</span>
                        </div>
                        <p className="mt-1 line-clamp-1 text-xs text-slate-400">{entry.missedPattern}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {confirmDeleteId === entry.id ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => { void handleDelete(entry.id); }}
                              className="text-xs font-medium text-rose-400 hover:text-rose-300"
                            >
                              Confirm delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs text-slate-500 hover:text-slate-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingEntry(entry);
                                setConfirmDeleteId(null);
                              }}
                              className="rounded-lg p-1.5 text-slate-500 hover:text-cyan-300 transition-colors"
                              title="Edit"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(entry.id)}
                              className="rounded-lg p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>

        {/* Right — Quick Add / Edit */}
        <Panel>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">
              {isEditMode ? "Edit Entry" : "Log Entry"}
            </p>
            {isEditMode ? (
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:text-slate-300 transition-colors"
                title="Cancel edit"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <form onSubmit={(e) => { void handleSubmit(e); }} className="mt-4 space-y-3">
            {field("Source", formErrors.source,
              <select
                value={draft.source}
                onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value as ErrorLogSource }))}
                className={selectClass}
              >
                {ERROR_LOG_SOURCE_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}

            {field("Exam / Block (optional)", undefined,
              <input
                type="text"
                value={draft.examBlock}
                onChange={(e) => setDraft((d) => ({ ...d, examBlock: e.target.value }))}
                placeholder="e.g. Block 2"
                className={inputClass}
              />
            )}

            {field("System", formErrors.system,
              <select
                value={draft.system}
                onChange={(e) => setDraft((d) => ({ ...d, system: e.target.value as ErrorLogSystem }))}
                className={selectClass}
              >
                {ERROR_LOG_SYSTEM_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}

            {field("Topic", formErrors.topic,
              <input
                ref={topicRef}
                type="text"
                value={draft.topic}
                onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value }))}
                placeholder="e.g. Aortic dissection"
                className={inputClass}
              />
            )}

            {field("Error Type", formErrors.errorType,
              <select
                value={draft.errorType}
                onChange={(e) => setDraft((d) => ({ ...d, errorType: e.target.value as ErrorLogErrorType }))}
                className={selectClass}
              >
                {ERROR_LOG_ERROR_TYPE_VALUES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}

            {field("Missed Pattern", formErrors.missedPattern,
              <textarea
                rows={2}
                value={draft.missedPattern}
                onChange={(e) => setDraft((d) => ({ ...d, missedPattern: e.target.value }))}
                placeholder="What concept or clue did you miss?"
                className={textareaClass}
              />
            )}

            {field("Fix", formErrors.fix,
              <textarea
                rows={2}
                value={draft.fix}
                onChange={(e) => setDraft((d) => ({ ...d, fix: e.target.value }))}
                placeholder="What will you do differently?"
                className={textareaClass}
              />
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={saving}
                className={`${primaryButtonClassName} flex-1`}
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
        </Panel>
      </div>
    </div>
  );
}
