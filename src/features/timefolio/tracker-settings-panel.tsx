import { useEffect, useState, type KeyboardEvent } from "react";
import { useTimeFolioStore } from "../../state/tf-store";
import type { TfTrackerPrefs } from "../../types/models";

type TrackerListKey = keyof TfTrackerPrefs;

const TRACKER_LISTS: Array<{
  key: TrackerListKey;
  title: string;
  description: string;
  placeholder: string;
}> = [
  {
    key: "customAutoApps",
    title: "Auto-tracked apps",
    description: "Apps you want TimeFolio to treat as study or focus-friendly activity.",
    placeholder: "e.g. Notion",
  },
  {
    key: "customAutoWebsites",
    title: "Auto-tracked websites",
    description: "Websites you want to count as productive by default.",
    placeholder: "e.g. docs.example.com",
  },
  {
    key: "customDistractionApps",
    title: "Distraction apps",
    description: "Apps you want to flag as distractions in your local TimeFolio view.",
    placeholder: "e.g. Discord",
  },
  {
    key: "customDistractionWebsites",
    title: "Distraction websites",
    description: "Websites you want to classify as distractions.",
    placeholder: "e.g. youtube.com",
  },
];

function cloneTrackerPrefs(prefs: TfTrackerPrefs): TfTrackerPrefs {
  return {
    customAutoApps: [...prefs.customAutoApps],
    customAutoWebsites: [...prefs.customAutoWebsites],
    customDistractionApps: [...prefs.customDistractionApps],
    customDistractionWebsites: [...prefs.customDistractionWebsites],
  };
}

function sanitizeItems(items: string[]): string[] {
  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

function listsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((item, index) => item === b[index]);
}

function PanelStatus({
  tone,
  title,
  message,
  actionLabel,
  onAction,
}: {
  tone: "loading" | "error";
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const wrapper =
    tone === "error"
      ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
      : "border-slate-700 bg-slate-900/80 text-slate-100";

  return (
    <div className="p-8">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-900/80 p-6 shadow-lg shadow-black/20">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            <p className="mt-1 text-sm text-slate-400">{message}</p>
          </div>
          {actionLabel && onAction ? (
            <button
              type="button"
              onClick={onAction}
              className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700/80"
            >
              {actionLabel}
            </button>
          ) : null}
        </div>
        <div className={`rounded-xl border px-4 py-3 text-sm ${wrapper}`}>
          {tone === "loading" ? "Loading local TimeFolio tracker preferences…" : "Unable to load tracker preferences from the local store."}
        </div>
      </div>
    </div>
  );
}

function TrackerListCard({
  title,
  description,
  placeholder,
  items,
  onItemsChange,
  onSave,
  isSaving,
  isDirty,
}: {
  title: string;
  description: string;
  placeholder: string;
  items: string[];
  onItemsChange: (nextItems: string[]) => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
  isDirty: boolean;
}) {
  const [newItem, setNewItem] = useState("");

  function addItem() {
    const value = newItem.trim();
    if (!value) {
      return;
    }
    onItemsChange([...items, value]);
    setNewItem("");
  }

  function updateItem(index: number, value: string) {
    const next = [...items];
    next[index] = value;
    onItemsChange(next);
  }

  function removeItem(index: number) {
    onItemsChange(items.filter((_, currentIndex) => currentIndex !== index));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addItem();
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-800/70 p-5 shadow-lg shadow-black/10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">
          {items.length}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 px-4 py-5 text-sm text-slate-500">
          No items yet. Add the first entry below.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item, index) => (
            <div key={`${title}-${index}-${item}`} className="flex gap-2">
              <input
                type="text"
                value={item}
                onChange={(event) => updateItem(index, event.target.value)}
                disabled={isSaving}
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => removeItem(index)}
                disabled={isSaving}
                className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200 transition-colors hover:bg-rose-500/20 disabled:opacity-60"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={newItem}
          onChange={(event) => setNewItem(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSaving}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={addItem}
          disabled={isSaving || newItem.trim().length === 0}
          className="rounded-lg border border-indigo-500/40 bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Add item
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-xs text-slate-500">
          {isDirty ? "Unsaved local edits" : "Up to date with TimeFolio store"}
        </span>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || !isDirty}
          className="rounded-lg border border-slate-700 bg-slate-800/90 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </section>
  );
}

export function TrackerSettingsPanel() {
  const { state, isLoading, error, reload, saveState } = useTimeFolioStore();
  const [draftPrefs, setDraftPrefs] = useState<TfTrackerPrefs>(() => cloneTrackerPrefs(state.trackerPrefs));
  const [savingKey, setSavingKey] = useState<TrackerListKey | null>(null);

  useEffect(() => {
    setDraftPrefs(cloneTrackerPrefs(state.trackerPrefs));
  }, [state.trackerPrefs]);

  if (isLoading) {
    return (
      <PanelStatus
        tone="loading"
        title="Tracker Settings"
        message="Manage the local app and website labels that TimeFolio uses for tracking."
      />
    );
  }

  if (error) {
    return (
      <PanelStatus
        tone="error"
        title="Tracker Settings"
        message={error}
        actionLabel="Retry"
        onAction={reload}
      />
    );
  }

  async function handleSave(key: TrackerListKey) {
    const nextTrackerPrefs = {
      ...draftPrefs,
      [key]: sanitizeItems(draftPrefs[key]),
    } as TfTrackerPrefs;

    setSavingKey(key);
    try {
      await saveState({
        ...state,
        trackerPrefs: nextTrackerPrefs,
      });
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="p-8 flex flex-col gap-6">
      <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-6 shadow-lg shadow-black/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="inline-flex w-fit rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-emerald-300">
              Local only
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Tracker Settings</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                Manage the app and website labels that TimeFolio stores on this device for tracker classification.
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-3 text-xs leading-5 text-slate-400">
            Changes are saved into the TimeFolio store state only.
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {TRACKER_LISTS.map((config) => {
          const items = draftPrefs[config.key];
          const originalItems = state.trackerPrefs[config.key];
          const sanitizedDraft = sanitizeItems(items);
          const isDirty = !listsMatch(sanitizedDraft, sanitizeItems(originalItems));

          return (
            <TrackerListCard
              key={config.key}
              title={config.title}
              description={config.description}
              placeholder={config.placeholder}
              items={items}
              onItemsChange={(nextItems) =>
                setDraftPrefs((prev) => ({
                  ...prev,
                  [config.key]: nextItems,
                }))
              }
              onSave={() => handleSave(config.key)}
              isSaving={savingKey === config.key}
              isDirty={isDirty}
            />
          );
        })}
      </div>
    </div>
  );
}
