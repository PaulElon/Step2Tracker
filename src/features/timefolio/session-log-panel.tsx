import { useState, useEffect, useRef } from "react";
import { FF } from "../../lib/feature-flags";
import { useTimeFolioStore } from "../../state/tf-store";
import { formatLongDate, formatMinutes, formatShortMinutes } from "../../lib/datetime";
import { cn, fieldClassName, primaryButtonClassName, secondaryButtonClassName } from "../../lib/ui";
import { splitAutoSessionMethodLabel } from "../../lib/tf-session-adapters";
import type { TfSessionLog } from "../../types/models";
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

function OverviewStat({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-slate-950/35 p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{meta}</p>
    </div>
  );
}

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
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)] backdrop-blur">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
        Manual timer
      </div>

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
          placeholder="Optional notes…"
        />
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-slate-300">
        <input
          type="checkbox"
          checked={isDistraction}
          onChange={(e) => setIsDistraction(e.target.checked)}
          className="accent-red-400"
        />
        Mark as distraction
      </label>

      {status !== "idle" && (
        <div className="text-2xl font-mono text-center py-1 text-slate-100">
          {formatElapsed(displayMs)}
          {status === "paused" && (
            <span className="text-xs text-slate-400 ml-3">paused</span>
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap pt-1">
        {status === "idle" && (
          <button
            type="button"
            className={primaryButtonClassName}
            onClick={handleStart}
            disabled={!method.trim()}
          >
            Start
          </button>
        )}
        {status === "running" && (
          <button type="button" className={secondaryButtonClassName} onClick={handlePause}>
            Pause
          </button>
        )}
        {status === "paused" && (
          <button type="button" className={primaryButtonClassName} onClick={handleResume}>
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
          Cancel
        </button>
      </div>
    </div>
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
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submitForm();
      }}
      className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)] backdrop-blur"
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
        <div className="flex flex-col gap-1 flex-1">
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
        <div className="flex flex-col gap-1 w-28">
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
  );
}

export function SessionLogPanel({
  pageDescription,
  pageTitle,
  showOverviewMetrics = false,
}: {
  pageDescription?: string;
  pageTitle?: string;
  showOverviewMetrics?: boolean;
}) {
  const store = useTimeFolioStore();
  const { state, isLoading, error } = store;
  const autoTracker = useAutoTrackerV2SessionControl();
  const [showAddForm, setShowAddForm] = useState(false);
  const [showTimer, setShowTimer] = useState(false);
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
          {pageDescription ? <p className="text-sm text-slate-400">{pageDescription}</p> : null}
        </div>
      ) : null}

      <section className="rounded-3xl border border-slate-700 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-5 shadow-lg shadow-black/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="inline-flex w-fit rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-cyan-300">
              Session Log
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">Timer and Auto-Tracking</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                Keep manual sessions, quick adds, and Auto-Tracking controls in one place.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className={secondaryButtonClassName}
              onClick={() => setShowTimer(true)}
            >
              Start Timer
            </button>
            <button className={primaryButtonClassName} onClick={() => setShowAddForm(true)}>
              + Add session
            </button>
          </div>
        </div>

        {FF.autotrackerV2UserMode ? (
          <AutoTrackerV2UserControlStrip control={autoTracker} />
        ) : null}

        {showTimer ? (
          <div className="mt-4">
            <ManualTimer
              onSave={async (session) => {
                await persistSession(session, "Timer session saved.");
              }}
              onDismiss={() => setShowTimer(false)}
            />
          </div>
        ) : null}

        {showAddForm ? (
          <div className="mt-4">
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
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <OverviewStat
            label="Total Hours"
            value={formatMinutes(Math.round(totalHours * 60))}
            meta="All recorded TimeFolio session time."
          />
          <OverviewStat
            label="Sessions"
            value={String(sessions.length)}
            meta="Manual, timer, and Auto-Tracking entries."
          />
          <OverviewStat
            label="Latest Session"
            value={latestSessionDate ? formatLongDate(latestSessionDate) : "No sessions yet"}
            meta="Most recent recorded study activity."
          />
          <OverviewStat
            label="Summaries"
            value={String(state.summaries.length)}
            meta="Saved TimeFolio summary snapshots."
          />
        </section>
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
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-4 text-slate-400">
          No TimeFolio sessions yet.
        </div>
      )}

      {sessions.map((s) =>
        editingId === s.id ? (
          <SessionForm
            key={s.id}
            initial={sessionToForm(s)}
            isNew={false}
            onSave={(form) => handleEdit(s.id, form)}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          (() => {
            const { label, isAuto } = splitAutoSessionMethodLabel(s.method);

            return (
              <div
                key={s.id}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border p-4",
                  isAuto
                    ? "border-cyan-500/15 bg-cyan-500/[0.06] p-3.5"
                    : "border-slate-700 bg-slate-800",
                )}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate font-semibold text-slate-100">{label}</span>
                    {isAuto ? (
                      <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-cyan-200">
                        auto
                      </span>
                    ) : null}
                  </div>
                  <div className="flex gap-1.5 items-center">
                    {s.isDistraction && (
                      <span className="text-xs rounded px-1.5 py-0.5 bg-red-900/60 text-red-300">
                        distraction
                      </span>
                    )}
                    {s.isLive && (
                      <span className="text-xs rounded px-1.5 py-0.5 bg-green-900/60 text-green-300">
                        live
                      </span>
                    )}
                    <button
                      className={secondaryButtonClassName}
                      style={{ padding: "2px 10px", fontSize: "0.75rem" }}
                      onClick={() => {
                        setDeleteConfirmId(null);
                        setEditingId(s.id);
                      }}
                      disabled={deletingId === s.id}
                    >
                      Edit
                    </button>
                    {deleteConfirmId === s.id ? (
                      <>
                        <button
                          className="text-xs rounded px-2.5 py-0.5 bg-red-900/70 text-red-100 hover:bg-red-800 transition-colors disabled:opacity-60"
                          onClick={() => {
                            void handleDeleteConfirm(s.id);
                          }}
                          disabled={deletingId === s.id}
                        >
                          {deletingId === s.id ? "Deleting..." : "Confirm delete"}
                        </button>
                        <button
                          className="text-xs rounded px-2.5 py-0.5 bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors disabled:opacity-60"
                          onClick={() => setDeleteConfirmId(null)}
                          disabled={deletingId === s.id}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="text-xs rounded px-2.5 py-0.5 bg-red-900/40 text-red-300 hover:bg-red-900/70 transition-colors"
                        onClick={() => setDeleteConfirmId(s.id)}
                        disabled={deletingId === s.id}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex gap-4 text-sm text-slate-400">
                  <span>{formatLongDate(s.date)}</span>
                  <span>{formatShortMinutes(Math.max(0, Math.round(s.hours * 60)))}</span>
                </div>
                {s.notes && <p className="text-sm text-slate-300 mt-1">{s.notes}</p>}
              </div>
            );
          })()
        )
      )}
    </div>
  );
}
