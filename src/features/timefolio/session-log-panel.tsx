import { useState } from "react";
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
      {!showAddForm && (
        <div className="flex justify-end">
          <button className={primaryButtonClassName} onClick={() => setShowAddForm(true)}>
            + Add session
          </button>
        </div>
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
