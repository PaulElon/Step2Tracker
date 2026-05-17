import { useState, useEffect, useRef } from "react";
import { Check, Clock3, Pause, Pencil, Play, Square, Trash2, X } from "lucide-react";
import { FF } from "../../lib/feature-flags";
import { useTimeFolioStore } from "../../state/tf-store";
import { formatLongDate, formatMinutes, formatShortMinutes } from "../../lib/datetime";
import { cn, fieldClassName, primaryButtonClassName, secondaryButtonClassName } from "../../lib/ui";
import { splitAutoSessionMethodLabel } from "../../lib/tf-session-adapters";
import type { TfSessionLog } from "../../types/models";
import {
  MetricStrip,
  MetricStripItem,
  QuietPanel,
} from "../../components/ui";
import { AutoTrackerV2UserControlStrip } from "./autotracker-v2-user-control-card";
import { useAutoTrackerV2SessionControl } from "./autotracker-v2-session-control";

const EMPTY_FORM = {
  method: "",
  date: new Date().toISOString().slice(0, 10),
  minutes: "",
  notes: "",
  isDistraction: false,
};

type FormState = typeof EMPTY_FORM;
type FeedbackState = {
  kind: "success" | "error";
  text: string;
};

function toMethodKey(method: string): string {
  return method.trim().toLowerCase().replace(/\s+/g, "-");
}

function buildSession(form: FormState, id: string): TfSessionLog {
  const parsedMinutes = Number(form.minutes);
  const startISO = `${form.date}T00:00:00.000Z`;
  return {
    id,
    date: form.date,
    method: form.method.trim(),
    methodKey: toMethodKey(form.method),
    hours: Number.isFinite(parsedMinutes) ? parsedMinutes / 60 : 0,
    startISO,
    endISO: startISO,
    notes: form.notes.trim(),
    isDistraction: form.isDistraction,
    isLive: false,
  };
}

function validateSessionForm(form: FormState): string | null {
  if (!form.method.trim()) return "Method is required.";
  if (!form.date) return "Date is required.";

  const minutes = Number(form.minutes);
  if (!Number.isFinite(minutes)) return "Minutes must be a valid number.";
  if (!Number.isInteger(minutes)) return "Minutes must be a whole number.";
  if (minutes < 1) return "Minutes must be at least 1.";
  if (minutes > 1440) return "Minutes must be 1440 or less.";

  return null;
}

function sessionToForm(s: TfSessionLog): FormState {
  return {
    method: s.method,
    date: s.date,
    minutes: String(Math.round(s.hours * 60)),
    notes: s.notes,
    isDistraction: s.isDistraction,
  };
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}h ${m}m ${pad(s)}s` : `${m}m ${pad(s)}s`;
}

function localDateStr(isoStr: string): string {
  const d = new Date(isoStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type TimerStatus = "idle" | "running" | "paused";

interface ManualTimerProps {
  onSave: (session: TfSessionLog) => Promise<void>;
  onDismiss: () => void;
}

function ManualTimer({ onSave, onDismiss }: ManualTimerProps) {
  const [status, setStatus] = useState<TimerStatus>("idle");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [isDistraction, setIsDistraction] = useState(false);
  const [displayMs, setDisplayMs] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  const startISORef = useRef<string>("");
  const lastResumeRef = useRef<number>(0);
  const accumulatedRef = useRef<number>(0);

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => {
      setDisplayMs(accumulatedRef.current + (Date.now() - lastResumeRef.current));
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  function reset() {
    setStatus("idle");
    setMethod("");
    setNotes("");
    setIsDistraction(false);
    setDisplayMs(0);
    accumulatedRef.current = 0;
  }

  function handleStart() {
    if (!method.trim()) return;
    const now = Date.now();
    startISORef.current = new Date(now).toISOString();
    lastResumeRef.current = now;
    accumulatedRef.current = 0;
    setDisplayMs(0);
    setStatus("running");
  }

  function handlePause() {
    accumulatedRef.current += Date.now() - lastResumeRef.current;
    setDisplayMs(accumulatedRef.current);
    setStatus("paused");
  }

  function handleResume() {
    lastResumeRef.current = Date.now();
    setStatus("running");
  }

  async function handleStopAndSave() {
    if (isSaving) return;
    setIsSaving(true);
    const endMs = Date.now();
    const totalMs =
      accumulatedRef.current + (status === "running" ? endMs - lastResumeRef.current : 0);
    const minutes = Math.max(1, Math.floor(totalMs / 60000));
    try {
      const session: TfSessionLog = {
        id: `tf-session-${endMs}`,
        date: localDateStr(startISORef.current),
        method: method.trim(),
        methodKey: toMethodKey(method),
        hours: minutes / 60,
        startISO: startISORef.current,
        endISO: new Date(endMs).toISOString(),
        notes: notes.trim(),
        isDistraction,
        isLive: false,
      };
      await onSave(session);
      reset();
      onDismiss();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="glass-panel overflow-hidden p-0">
      <div className="grid gap-5 border-b border-[color:var(--panel-border)] bg-[radial-gradient(circle_at_50%_0%,var(--primary-start),transparent_42%)] px-5 py-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0 text-center lg:text-left">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-cyan-200" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Manual timer
            </p>
          </div>
          <p className="mt-1 truncate text-sm font-medium text-slate-200">
            {method.trim() || "Start a focused study block"}
          </p>
        </div>
        <div className="mx-auto min-w-[min(100%,24rem)] rounded-[24px] border border-[color:var(--panel-border)] bg-[color:var(--panel-support-bg)] px-6 py-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_60px_var(--panel-shadow)] lg:mx-0">
          <p className="font-mono text-[clamp(3rem,8vw,5.6rem)] font-semibold leading-none tabular-nums text-white">
            {formatElapsed(displayMs)}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-500">
            {status === "idle" ? "ready" : status}
          </p>
        </div>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Method *</label>
            <input
              className={fieldClassName}
              type="text"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="e.g. Active Recall"
              disabled={status !== "idle"}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Notes</label>
            <input
              className={fieldClassName}
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
            />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2 lg:justify-end">
          <label className="flex h-10 items-center gap-2 rounded-[14px] border border-white/[0.08] bg-white/[0.025] px-3 text-xs font-medium text-slate-300">
            <input
              type="checkbox"
              checked={isDistraction}
              onChange={(e) => setIsDistraction(e.target.checked)}
              className="accent-red-400"
            />
            Distraction
          </label>

          {status === "idle" && (
            <button
              type="button"
              className={primaryButtonClassName}
              onClick={handleStart}
              disabled={!method.trim()}
            >
              <Play className="h-4 w-4" />
              Start
            </button>
          )}
          {status === "running" && (
            <button type="button" className={secondaryButtonClassName} onClick={handlePause}>
              <Pause className="h-4 w-4" />
              Pause
            </button>
          )}
          {status === "paused" && (
            <button type="button" className={primaryButtonClassName} onClick={handleResume}>
              <Play className="h-4 w-4" />
              Resume
            </button>
          )}
          {status !== "idle" && (
            <button
              type="button"
              className={primaryButtonClassName}
              onClick={() => {
                void handleStopAndSave();
              }}
              disabled={isSaving}
            >
              <Square className="h-4 w-4" />
              {isSaving ? "Saving..." : "Stop & Save"}
            </button>
          )}
          <button
            type="button"
            className={secondaryButtonClassName}
            onClick={() => {
              reset();
              onDismiss();
            }}
            disabled={isSaving}
          >
            <X className="h-4 w-4" />
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}

interface SessionFormProps {
  initial: FormState;
  onSave: (form: FormState) => Promise<void>;
  onCancel: () => void;
  isNew: boolean;
}

function SessionForm({ initial, onSave, onCancel, isNew }: SessionFormProps) {
  const [form, setForm] = useState<FormState>(initial);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function set(key: keyof FormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSubmitError(null);
  }

  async function submitForm() {
    const validationError = validateSessionForm(form);
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    setIsSaving(true);
    setSubmitError(null);
    try {
      await onSave(form);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Unable to save session right now."
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <QuietPanel>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitForm();
        }}
        className="flex flex-col gap-3"
      >
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {isNew ? "New session" : "Edit session"}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Method *</label>
          <input
            className={fieldClassName}
            type="text"
            value={form.method}
            onChange={(e) => set("method", e.target.value)}
            placeholder="e.g. Active Recall"
            required
            disabled={isSaving}
          />
        </div>

        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs text-slate-400">Date *</label>
            <input
              className={fieldClassName}
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
              required
              disabled={isSaving}
            />
          </div>
          <div className="flex w-28 flex-col gap-1">
            <label className="text-xs text-slate-400">Minutes *</label>
            <input
              className={fieldClassName}
              type="number"
              inputMode="numeric"
              min="1"
              max="1440"
              step="1"
              value={form.minutes}
              onChange={(e) => set("minutes", e.target.value)}
              placeholder="45"
              required
              disabled={isSaving}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Notes</label>
          <textarea
            className={fieldClassName}
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Optional notes…"
            disabled={isSaving}
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-slate-300">
          <input
            type="checkbox"
            checked={form.isDistraction}
            onChange={(e) => set("isDistraction", e.target.checked)}
            className="accent-red-400"
            disabled={isSaving}
          />
          Mark as distraction
        </label>

        {submitError && (
          <div
            role="alert"
            className="rounded-md border border-red-800/70 bg-red-950/50 px-3 py-2 text-sm text-red-200"
          >
            {submitError}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            className={secondaryButtonClassName}
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button type="submit" className={primaryButtonClassName} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </QuietPanel>
  );
}

export function SessionLogPanel({
  pageTitle,
  showOverviewMetrics = false,
}: {
  pageTitle?: string;
  showOverviewMetrics?: boolean;
}) {
  const store = useTimeFolioStore();
  const { state, isLoading, error } = store;
  const autoTracker = useAutoTrackerV2SessionControl();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  if (isLoading) {
    return <div className="p-8 text-slate-400">Loading sessions…</div>;
  }

  if (error) {
    return <div className="p-8 text-red-400">Error: {error}</div>;
  }

  const sessions = [...state.sessionLogs].sort(
    (a, b) => new Date(b.startISO).getTime() - new Date(a.startISO).getTime()
  );
  const totalHours = sessions.reduce((sum, session) => sum + session.hours, 0);
  const latestSessionDate = sessions[0]?.date ?? null;
  const sessionGroups = sessions.reduce<
    Array<{ date: string; sessions: TfSessionLog[]; studyMinutes: number; distractionMinutes: number }>
  >((groups, session) => {
    const minutes = Math.max(0, Math.round(session.hours * 60));
    let group = groups[groups.length - 1];
    if (!group || group.date !== session.date) {
      group = { date: session.date, sessions: [], studyMinutes: 0, distractionMinutes: 0 };
      groups.push(group);
    }
    group.sessions.push(session);
    if (session.isDistraction) {
      group.distractionMinutes += minutes;
    } else {
      group.studyMinutes += minutes;
    }
    return groups;
  }, []);

  async function persistSession(session: TfSessionLog, successText: string) {
    try {
      await store.upsertSessionLog(session);
      setFeedback({ kind: "success", text: successText });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to save session right now.";
      setFeedback({ kind: "error", text: message });
      throw error;
    }
  }

  async function removeSession(id: string) {
    try {
      setDeletingId(id);
      await store.deleteSessionLog(id);
      setFeedback({ kind: "success", text: "Session deleted." });
      if (editingId === id) setEditingId(null);
      setDeleteConfirmId((current) => (current === id ? null : current));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to delete session right now.";
      setFeedback({ kind: "error", text: message });
      throw error;
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAdd(form: FormState) {
    await persistSession(buildSession(form, `tf-session-${Date.now()}`), "Session added.");
    setShowAddForm(false);
  }

  async function handleEdit(id: string, form: FormState) {
    await persistSession(buildSession(form, id), "Session updated.");
    setEditingId(null);
  }

  async function handleDeleteConfirm(id: string) {
    await removeSession(id);
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      {pageTitle ? (
        <div className="space-y-1 px-1">
          <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white">{pageTitle}</h2>
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <ManualTimer
          onSave={async (session) => {
            await persistSession(session, "Timer session saved.");
          }}
          onDismiss={() => undefined}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <button type="button" className={secondaryButtonClassName} onClick={() => setShowAddForm(true)}>
            + Add session
          </button>

          {FF.autotrackerV2UserMode ? (
            <div className="text-xs text-slate-400">
              <span className="font-medium text-slate-200">Configured Auto-Tracking rules:</span>{" "}
              Allowed {autoTracker.trackedRuleCount} · Distractions {autoTracker.distractionRuleCount}
            </div>
          ) : null}
        </div>

        {FF.autotrackerV2UserMode ? <AutoTrackerV2UserControlStrip control={autoTracker} /> : null}

        {showAddForm ? (
          <div className="mt-3">
            <SessionForm
              initial={EMPTY_FORM}
              isNew
              onSave={handleAdd}
              onCancel={() => setShowAddForm(false)}
            />
          </div>
        ) : null}
      </section>

      {showOverviewMetrics ? (
        <MetricStrip columns="sm:grid-cols-2 xl:grid-cols-4">
          <MetricStripItem
            label="Total time"
            value={formatMinutes(Math.round(totalHours * 60))}
            meta="All recorded TimeFolio session time."
          />
          <MetricStripItem
            label="Sessions"
            value={String(sessions.length)}
            meta="Manual, timer, and Auto-Tracking entries."
          />
          <MetricStripItem
            label="Latest session"
            value={latestSessionDate ? formatLongDate(latestSessionDate) : "No sessions yet"}
            meta="Most recent recorded study activity."
          />
          <MetricStripItem
            label="Summaries"
            value={String(state.summaries.length)}
            meta="Saved TimeFolio summary snapshots."
          />
        </MetricStrip>
      ) : null}

      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={
            feedback.kind === "success"
              ? "rounded-lg border border-emerald-800/70 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-200"
              : "rounded-lg border border-red-800/70 bg-red-950/50 px-3 py-2 text-sm text-red-200"
          }
        >
          {feedback.text}
        </div>
      )}

      {sessions.length === 0 && !showAddForm && (
        <div className="rounded-[18px] border border-dashed border-[color:var(--panel-border)] bg-[color:var(--panel-support-bg)] p-4 text-slate-400 [color:var(--rich-text-muted,#94a3b8)]">
          No TimeFolio sessions yet.
        </div>
      )}

      {sessions.length ? (
        <div className="overflow-hidden rounded-[20px] border border-[color:var(--panel-border)] bg-[color:var(--panel-bg)] shadow-[0_18px_54px_var(--panel-shadow)]">
          {sessionGroups.map((group, groupIndex) => (
            <section
              key={group.date}
              className={cn(groupIndex > 0 ? "border-t border-white/[0.08]" : "")}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 bg-white/[0.025] px-3.5 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-white">
                    {formatLongDate(group.date)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {group.sessions.length} entr{group.sessions.length === 1 ? "y" : "ies"} ·{" "}
                    {formatShortMinutes(group.studyMinutes)} focus
                    {group.distractionMinutes > 0 ? ` · ${formatShortMinutes(group.distractionMinutes)} distraction` : ""}
                  </p>
                </div>
              </div>

              <div className="divide-y divide-white/[0.06]">
                {group.sessions.map((s) =>
                  editingId === s.id ? (
                    <div key={s.id} className="px-3 py-3">
                      <SessionForm
                        initial={sessionToForm(s)}
                        isNew={false}
                        onSave={(form) => handleEdit(s.id, form)}
                        onCancel={() => setEditingId(null)}
                      />
                    </div>
                  ) : (
                    (() => {
                      const { label, isAuto } = splitAutoSessionMethodLabel(s.method);
                      const minutes = Math.max(0, Math.round(s.hours * 60));

                      return (
                        <article
                          key={s.id}
                          className={cn(
                            "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-white/[0.03]",
                            isAuto ? "bg-cyan-500/[0.025]" : "",
                            s.isDistraction ? "bg-rose-500/[0.035]" : "",
                          )}
                        >
                          <div className="flex h-full min-h-10 flex-col items-center pt-1">
                            <span
                              className={cn(
                                "h-2.5 w-2.5 rounded-full ring-4",
                                s.isDistraction
                                  ? "bg-rose-300 ring-rose-500/[0.12]"
                                  : isAuto
                                    ? "bg-cyan-300 ring-cyan-500/[0.12]"
                                    : "bg-emerald-300 ring-emerald-500/[0.12]",
                              )}
                              aria-hidden="true"
                            />
                            <span className="mt-1 h-full w-px flex-1 bg-white/[0.06]" aria-hidden="true" />
                          </div>

                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="min-w-0 truncate text-[13px] font-semibold text-white">
                                {label}
                              </span>
                              {isAuto ? (
                                <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-cyan-200">
                                  auto
                                </span>
                              ) : null}
                              {s.isDistraction ? (
                                <span className="rounded-full border border-rose-400/25 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-rose-200">
                                  distraction
                                </span>
                              ) : null}
                              {s.isLive ? (
                                <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-200">
                                  live
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                              <span>{formatLongDate(s.date)}</span>
                              <span className="font-medium tabular-nums text-slate-300">
                                {formatShortMinutes(minutes)}
                              </span>
                            </div>
                            {s.notes ? (
                              <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-400">
                                {s.notes}
                              </p>
                            ) : null}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              aria-label={`Edit ${label}`}
                              title="Edit session"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-white/10 bg-white/[0.025] text-slate-400 transition hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-cyan-100 disabled:opacity-50"
                              onClick={() => {
                                setDeleteConfirmId(null);
                                setEditingId(s.id);
                              }}
                              disabled={deletingId === s.id}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            {deleteConfirmId === s.id ? (
                              <>
                                <button
                                  type="button"
                                  className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-rose-400/30 bg-rose-500/15 px-2.5 text-xs font-medium text-rose-100 transition hover:bg-rose-500/25 disabled:opacity-60"
                                  onClick={() => {
                                    void handleDeleteConfirm(s.id);
                                  }}
                                  disabled={deletingId === s.id}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  {deletingId === s.id ? "Deleting..." : "Delete"}
                                </button>
                                <button
                                  type="button"
                                  aria-label="Cancel delete"
                                  title="Cancel delete"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-white/10 bg-white/[0.025] text-slate-400 transition hover:border-white/20 hover:text-white disabled:opacity-60"
                                  onClick={() => setDeleteConfirmId(null)}
                                  disabled={deletingId === s.id}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                aria-label={`Delete ${label}`}
                                title="Delete session"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-rose-400/25 bg-rose-500/[0.08] text-rose-200 transition hover:bg-rose-500/15 disabled:opacity-50"
                                onClick={() => setDeleteConfirmId(s.id)}
                                disabled={deletingId === s.id}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })()
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
