import { Bell, Check, Database, Download, ExternalLink, Palette, Pencil, Plus, RotateCcw, Trash2, Upload, X, Zap } from "lucide-react";
import { useState } from "react";
import { Panel } from "../components/ui";
import { themeList } from "../lib/themes";
import { fieldClassName, secondaryButtonClassName } from "../lib/ui";
import type { PersistenceSummary, ResourceLink, ThemeId } from "../types/models";

function formatStoragePath(path?: string | null) {
  if (!path) {
    return "the app data folder";
  }

  return path.replace(/^\/Users\/[^/]+/, "~");
}

function generateId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function CategoriesPanel({
  customCategories,
  onSetCustomCategories,
}: {
  customCategories: string[];
  onSetCustomCategories: (categories: string[]) => void;
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [newCategory, setNewCategory] = useState("");

  function commitEdit(index: number) {
    const next = editingValue.trim();
    if (!next) {
      setEditingIndex(null);
      setEditingValue("");
      return;
    }
    const updated = [...customCategories];
    updated[index] = next;
    onSetCustomCategories(updated);
    setEditingIndex(null);
    setEditingValue("");
  }

  function handleAdd() {
    const value = newCategory.trim();
    if (!value) {
      return;
    }
    onSetCustomCategories([...customCategories, value]);
    setNewCategory("");
  }

  function handleDelete(index: number) {
    if (customCategories.length <= 1) {
      return;
    }
    onSetCustomCategories(customCategories.filter((_, i) => i !== index));
  }

  return (
    <Panel title="Categories">
      <div className="space-y-2">
        {customCategories.map((category, index) => (
          <div
            key={`${category}-${index}`}
            className="flex items-center gap-2 rounded-[16px] border border-white/10 bg-slate-950/35 px-3 py-2"
          >
            {editingIndex === index ? (
              <>
                <input
                  autoFocus
                  value={editingValue}
                  onChange={(event) => setEditingValue(event.target.value)}
                  onBlur={() => commitEdit(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    } else if (event.key === "Escape") {
                      setEditingIndex(null);
                      setEditingValue("");
                    }
                  }}
                  className={`${fieldClassName} flex-1`}
                />
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => commitEdit(index)}
                >
                  <Check className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <p className="flex-1 text-sm text-white">{category}</p>
                <button
                  type="button"
                  aria-label={`Edit ${category}`}
                  className="rounded-full p-2 text-slate-300 transition hover:text-white"
                  onClick={() => {
                    setEditingIndex(index);
                    setEditingValue(category);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${category}`}
                  disabled={customCategories.length <= 1}
                  className="rounded-full p-2 text-slate-300 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => handleDelete(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        ))}
        <div className="flex items-center gap-2 rounded-[16px] border border-dashed border-white/10 bg-slate-950/20 px-3 py-2">
          <input
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleAdd();
              }
            }}
            placeholder="New category"
            className={`${fieldClassName} flex-1`}
          />
          <button type="button" className={secondaryButtonClassName} onClick={handleAdd}>
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>
    </Panel>
  );
}

function ResourcesPanel({
  resourceLinks,
  onSetResourceLinks,
}: {
  resourceLinks: ResourceLink[];
  onSetResourceLinks: (links: ResourceLink[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");

  function beginEdit(link: ResourceLink) {
    setEditingId(link.id);
    setEditLabel(link.label);
    setEditUrl(link.url);
  }

  function commitEdit() {
    if (!editingId) {
      return;
    }
    const trimmedUrl = editUrl.trim();
    if (!trimmedUrl) {
      setEditingId(null);
      return;
    }
    onSetResourceLinks(
      resourceLinks.map((link) =>
        link.id === editingId
          ? { ...link, label: editLabel.trim() || trimmedUrl, url: trimmedUrl }
          : link,
      ),
    );
    setEditingId(null);
  }

  function handleAdd() {
    const url = newUrl.trim();
    if (!url) {
      return;
    }
    onSetResourceLinks([
      ...resourceLinks,
      { id: generateId("link"), label: newLabel.trim() || url, url },
    ]);
    setNewLabel("");
    setNewUrl("");
  }

  function handleDelete(id: string) {
    onSetResourceLinks(resourceLinks.filter((link) => link.id !== id));
  }

  function handleOpen(url: string) {
    window.open(url, "_blank");
  }

  return (
    <Panel
      title="Resources"
      action={
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/55 px-3 py-2 text-sm text-slate-300">
          <ExternalLink className="h-4 w-4 text-cyan-200" />
          Links
        </div>
      }
    >
      <div className="space-y-2">
        {resourceLinks.length === 0 ? (
          <p className="text-sm text-slate-400">No saved resources yet.</p>
        ) : null}
        {resourceLinks.map((link) => (
          <div
            key={link.id}
            className="flex items-center gap-2 rounded-[16px] border border-white/10 bg-slate-950/35 px-3 py-2"
          >
            {editingId === link.id ? (
              <>
                <input
                  value={editLabel}
                  onChange={(event) => setEditLabel(event.target.value)}
                  placeholder="Label"
                  className={`${fieldClassName} flex-1`}
                />
                <input
                  value={editUrl}
                  onChange={(event) => setEditUrl(event.target.value)}
                  placeholder="https://…"
                  className={`${fieldClassName} flex-1`}
                />
                <button type="button" className={secondaryButtonClassName} onClick={commitEdit}>
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Cancel"
                  className="rounded-full p-2 text-slate-300 transition hover:text-white"
                  onClick={() => setEditingId(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleOpen(link.url)}
                  className="flex-1 text-left"
                >
                  <p className="text-sm font-semibold text-white">{link.label}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-400">{link.url}</p>
                </button>
                <button
                  type="button"
                  aria-label={`Open ${link.label}`}
                  className="rounded-full p-2 text-slate-300 transition hover:text-white"
                  onClick={() => handleOpen(link.url)}
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Edit ${link.label}`}
                  className="rounded-full p-2 text-slate-300 transition hover:text-white"
                  onClick={() => beginEdit(link)}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${link.label}`}
                  className="rounded-full p-2 text-slate-300 transition hover:text-white"
                  onClick={() => handleDelete(link.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 rounded-[16px] border border-dashed border-white/10 bg-slate-950/20 px-3 py-2">
          <input
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder="Label"
            className={`${fieldClassName} flex-1 min-w-[160px]`}
          />
          <input
            value={newUrl}
            onChange={(event) => setNewUrl(event.target.value)}
            placeholder="https://…"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleAdd();
              }
            }}
            className={`${fieldClassName} flex-1 min-w-[200px]`}
          />
          <button type="button" className={secondaryButtonClassName} onClick={handleAdd}>
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>
    </Panel>
  );
}

export function SettingsView({
  themeId,
  dailyGoalMinutes,
  notificationPermission,
  persistenceCopy,
  persistenceSummary,
  enhancedThemeIds,
  customCategories,
  resourceLinks,
  onThemeChange,
  onToggleThemeEnhanced,
  onDailyGoalMinutesChange,
  onEnableNotifications,
  onSendTestAlert,
  onExportBackup,
  onImportBackup,
  onOpenRecoveryCenter,
  onSetCustomCategories,
  onSetResourceLinks,
}: {
  themeId: ThemeId;
  dailyGoalMinutes: number;
  notificationPermission: NotificationPermission | "unsupported";
  persistenceCopy: string;
  persistenceSummary: PersistenceSummary | null;
  enhancedThemeIds: string[];
  customCategories: string[];
  resourceLinks: ResourceLink[];
  onThemeChange: (themeId: ThemeId) => void;
  onToggleThemeEnhanced: (themeId: ThemeId) => void;
  onDailyGoalMinutesChange: (hours: number) => void;
  onEnableNotifications: () => void;
  onSendTestAlert: () => void;
  onExportBackup: () => void;
  onImportBackup: () => void;
  onOpenRecoveryCenter: () => void;
  onSetCustomCategories: (categories: string[]) => void;
  onSetResourceLinks: (links: ResourceLink[]) => void;
}) {
  const reminderButtonLabel =
    notificationPermission === "granted"
      ? "Send test alert"
      : notificationPermission === "denied"
        ? "Open System Settings"
        : notificationPermission === "unsupported"
          ? "Alerts unavailable"
          : "Enable alerts on this Mac";

  const handleReminderClick =
    notificationPermission === "granted" ? onSendTestAlert : onEnableNotifications;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Panel
          title="Appearance"
          action={
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/55 px-3 py-2 text-sm text-slate-300">
              <Palette className="h-4 w-4 text-cyan-200" />
              Theme
            </div>
          }
        >
          <div className="grid gap-3 md:grid-cols-3">
            {themeList.map((theme) => {
              const isEnhanced = enhancedThemeIds.includes(theme.id);
              return (
                <div
                  key={theme.id}
                  className={`theme-option ${themeId === theme.id ? "border-white/20 bg-white/[0.07]" : ""}`}
                >
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => onThemeChange(theme.id)}
                  >
                    <p className="text-sm font-semibold text-white">{theme.label}</p>
                    <p className="mt-1 text-xs text-slate-400">{theme.description}</p>
                  </button>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.chart.primary }} />
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.chart.secondary }} />
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.chart.tertiary }} />
                    </div>
                    <button
                      type="button"
                      aria-label={isEnhanced ? `Disable enhanced ${theme.label}` : `Enhance ${theme.label}`}
                      aria-pressed={isEnhanced}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleThemeEnhanced(theme.id);
                      }}
                      className={`rounded-full border p-1.5 transition ${
                        isEnhanced
                          ? "border-yellow-300/50 bg-yellow-300/15 text-yellow-300"
                          : "border-white/10 text-slate-400 hover:text-white"
                      }`}
                    >
                      <Zap className={`h-3.5 w-3.5 ${isEnhanced ? "fill-yellow-300" : ""}`} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Study Defaults">
          <div className="panel-subtle">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Daily target</p>
            <p className="mt-2 text-3xl font-semibold text-white">{Math.max(Math.round(dailyGoalMinutes / 60), 1)}h</p>
            <label className="mt-5 block text-xs uppercase tracking-[0.16em] text-slate-500" htmlFor="daily-goal-hours">
              Goal hours
            </label>
            <input
              id="daily-goal-hours"
              type="number"
              min={1}
              max={16}
              step={1}
              inputMode="numeric"
              key={dailyGoalMinutes}
              defaultValue={Math.max(Math.round(dailyGoalMinutes / 60), 1)}
              onBlur={(event) => {
                const parsed = Number.parseInt(event.target.value.trim(), 10);
                const nextHours = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 16) : 1;
                onDailyGoalMinutesChange(nextHours);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              className={`${fieldClassName} mt-2`}
            />
            <p className="mt-2 text-sm text-slate-400">Saved range: 1 to 16 hours.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <CategoriesPanel
          customCategories={customCategories}
          onSetCustomCategories={onSetCustomCategories}
        />
        <ResourcesPanel resourceLinks={resourceLinks} onSetResourceLinks={onSetResourceLinks} />
      </div>

      <Panel
        title="Reminders"
        action={
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/55 px-3 py-2 text-sm text-slate-300">
            <Bell className="h-4 w-4 text-cyan-200" />
            Alerts
          </div>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
              Status:{" "}
              {notificationPermission === "granted"
                ? "enabled"
                : notificationPermission === "denied"
                  ? "blocked"
                  : notificationPermission === "unsupported"
                    ? "unsupported"
                  : "not enabled"}
            </p>
          </div>
          <button type="button" className={secondaryButtonClassName} onClick={handleReminderClick}>
            {reminderButtonLabel}
          </button>
        </div>
      </Panel>

      <Panel
        title="Storage"
        action={
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/55 px-3 py-2 text-sm text-slate-300">
            <Database className="h-4 w-4 text-cyan-200" />
            Local
          </div>
        }
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="panel-subtle">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Paths</p>
            <p className="mt-3 text-sm text-slate-200">
              Live data: {formatStoragePath(persistenceSummary?.storagePath)}
            </p>
            <p className="mt-2 text-sm text-slate-200">
              Snapshots: {formatStoragePath(persistenceSummary?.backupDirectory)}
            </p>
            <p className="mt-4 text-sm text-slate-300">{persistenceCopy}</p>
            {persistenceSummary?.recoveryMessage ? (
              <div className="mt-4 rounded-[18px] border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-slate-200">
                {persistenceSummary.recoveryMessage}
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <button type="button" className="panel-subtle text-left transition hover:border-white/15" onClick={onImportBackup}>
              <Upload className="h-5 w-5 text-cyan-200" />
              <p className="mt-4 text-sm font-semibold text-white">Import backup</p>
              <p className="mt-2 text-sm text-slate-400">Preview before restore.</p>
            </button>

            <button type="button" className="panel-subtle text-left transition hover:border-white/15" onClick={onExportBackup}>
              <Download className="h-5 w-5 text-cyan-200" />
              <p className="mt-4 text-sm font-semibold text-white">Export backup</p>
              <p className="mt-2 text-sm text-slate-400">Create a portable snapshot.</p>
            </button>

            <button
              type="button"
              className="panel-subtle text-left transition hover:border-white/15"
              onClick={onOpenRecoveryCenter}
            >
              <RotateCcw className="h-5 w-5 text-cyan-200" />
              <p className="mt-4 text-sm font-semibold text-white">Recovery center</p>
              <p className="mt-2 text-sm text-slate-400">Restore snapshots or trash.</p>
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="App">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="panel-subtle">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Theme</p>
            <p className="mt-2 text-lg font-semibold text-white">{themeList.find((theme) => theme.id === themeId)?.label}</p>
          </div>
          <div className="panel-subtle">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Goal</p>
            <p className="mt-2 text-lg font-semibold text-white">{Math.max(Math.round(dailyGoalMinutes / 60), 1)} hours</p>
          </div>
          <div className="panel-subtle">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Storage</p>
            <p className="mt-2 text-lg font-semibold text-white">
              {persistenceSummary ? formatStoragePath(persistenceSummary.storagePath) : "Loading"}
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
