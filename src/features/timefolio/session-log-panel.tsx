import { useState, useEffect, useRef } from "react";
import { useTimeFolioStore } from "../../state/tf-store";
import { formatLongDate } from "../../lib/datetime";
import { fieldClassName, primaryButtonClassName, secondaryButtonClassName } from "../../lib/ui";
import type { TfSessionLog } from "../../types/models";

const EMPTY_FORM = {
  method: "",
  date: new Date().toISOString().slice(0, 10),
  hours: "",
  notes: "",
  isDistraction: false,
};

type FormState = typeof EMPTY_FORM;

function toMethodKey(method: string): string {
  return method.trim().toLowerCase().replace(/\s+/g, "-");
}

function buildSession(form: FormState, id: string): TfSessionLog {
  const startISO = `${form.date}T00:00:00.000Z`;
  return {
    id,
    date: form.date,
    method: form.method.trim(),
    methodKey: toMethodKey(form.method),
    hours: parseFloat(form.hours as string) || 0,
    startISO,
    endISO: startISO,
    notes: form.notes.trim(),
    isDistraction: form.isDistraction,
    isLive: false,
  };
}

function sessionToForm(s: TfSessionLog): FormState {
  return {
    method: s.method,
    date: s.date,
    hours: String(s.hours),
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
    const endMs = Date.now();
    const totalMs =
      accumulatedRef.current + (status === "running" ? endMs - lastResumeRef.current : 0);
    const hours = Math.round((totalMs / 3600000) * 100) / 100;
    const session: TfSessionLog = {
      id: `tf-session-${endMs}`,
      date: localDateStr(startISORef.current),
      method: method.trim(),
      methodKey: toMethodKey(method),
      hours,
      startISO: startISORef.current,
      endISO: new Date(endMs).toISOString(),
      notes: notes.trim(),
      isDistraction,
      isLive: false,
    };
    await onSave(session);
    reset();
    onDismiss();
  }

  return (
    <div className="rounded-lg border border-indigo-700 bg-slate-800/80 p-4 flex flex-col gap-3">
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
          <button type="button" className={primaryButtonClassName} onClick={handleStopAndSave}>
            Stop &amp; Save
          </button>
        )}
        <button
          type="button"
          className={secondaryButtonClassName}
          onClick={() => { reset(); onDismiss(); }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

interface SessionFormProps {
  initial: FormState;
  onSave: (form: FormState) => void;
  onCancel: () => void;
  isNew: boolean;
}

function SessionForm({ initial, onSave, onCancel, isNew }: SessionFormProps) {
  const [form, setForm] = useState<FormState>(initial);

  function set(key: keyof FormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.method.trim()) return;
    onSave(form);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-slate-600 bg-slate-800/80 p-4 flex flex-col gap-3"
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
          />
        </div>
        <div className="flex flex-col gap-1 w-24">
          <label className="text-xs text-slate-400">Hours *</label>
          <input
            className={fieldClassName}
            type="number"
            min="0.1"
            max="24"
            step="0.1"
            value={form.hours}
            onChange={(e) => set("hours", e.target.value)}
            placeholder="1.5"
            required
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
        />
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-slate-300">
        <input
          type="checkbox"
          checked={form.isDistraction}
          onChange={(e) => set("isDistraction", e.target.checked)}
          className="accent-red-400"
        />
        Mark as distraction
      </label>

      <div className="flex gap-2 justify-end pt-1">
        <button type="button" className={secondaryButtonClassName} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={primaryButtonClassName}>
          Save
        </button>
      </div>
    </form>
  );
}

export function SessionLogPanel() {
  const { state, isLoading, error, upsertSessionLog, deleteSessionLog } = useTimeFolioStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [showTimer, setShowTimer] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (isLoading) {
    return <div className="p-8 text-slate-400">Loading sessions…</div>;
  }

  if (error) {
    return <div className="p-8 text-red-400">Error: {error}</div>;
  }

  const sessions = [...state.sessionLogs].sort(
    (a, b) => new Date(b.startISO).getTime() - new Date(a.startISO).getTime()
  );

  async function handleAdd(form: FormState) {
    await upsertSessionLog(buildSession(form, `tf-session-${Date.now()}`));
    setShowAddForm(false);
  }

  async function handleEdit(id: string, form: FormState) {
    await upsertSessionLog(buildSession(form, id));
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    await deleteSessionLog(id);
    if (editingId === id) setEditingId(null);
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      {!showAddForm && !showTimer && (
        <div className="flex justify-end gap-2">
          <button className={secondaryButtonClassName} onClick={() => setShowTimer(true)}>
            Start timer
          </button>
          <button className={primaryButtonClassName} onClick={() => setShowAddForm(true)}>
            + Add session
          </button>
        </div>
      )}

      {showTimer && (
        <ManualTimer
          onSave={async (session) => { await upsertSessionLog(session); }}
          onDismiss={() => setShowTimer(false)}
        />
      )}

      {showAddForm && (
        <SessionForm
          initial={EMPTY_FORM}
          isNew
          onSave={handleAdd}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {sessions.length === 0 && !showAddForm && (
        <div className="p-4 text-slate-400">No TimeFolio sessions yet.</div>
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
          <div
            key={s.id}
            className="rounded-lg border border-slate-700 bg-slate-800 p-4 flex flex-col gap-1"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-semibold text-slate-100">{s.method}</span>
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
                  onClick={() => setEditingId(s.id)}
                >
                  Edit
                </button>
                <button
                  className="text-xs rounded px-2.5 py-0.5 bg-red-900/40 text-red-300 hover:bg-red-900/70 transition-colors"
                  onClick={() => handleDelete(s.id)}
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="flex gap-4 text-sm text-slate-400">
              <span>{formatLongDate(s.date)}</span>
              <span>{s.hours}h</span>
            </div>
            {s.notes && <p className="text-sm text-slate-300 mt-1">{s.notes}</p>}
          </div>
        )
      )}
    </div>
  );
}
